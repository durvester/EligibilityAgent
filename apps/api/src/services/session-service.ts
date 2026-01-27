/**
 * Session Service
 *
 * Manages user sessions with internal JWTs and PF OAuth tokens.
 *
 * Architecture:
 * - Internal JWT: Used for ALL internal API authentication (stored in HTTP-only cookie)
 * - PF OAuth tokens: ONLY used for FHIR calls (stored encrypted in database)
 *
 * The session links:
 * 1. Internal JWT (jti) -> Session record -> Tenant
 * 2. Session record -> Encrypted PF tokens
 */

import { prisma } from '@eligibility-agent/db';
import { encrypt, decrypt } from '../lib/encryption.js';
import { signInternalJwt, verifyInternalJwt, type JwtPayload } from '../lib/jwt.js';
import { cacheGet, cacheSet, cacheDelete, CacheKeys, CacheTTL } from '../lib/redis.js';
import { serviceLogger } from '../lib/logger.js';
import axios from 'axios';

// Buffer time before expiration to trigger refresh (5 minutes)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface SessionInfo {
  id: string;
  tenantId: string;
  userFhirId: string | null;
  userName: string | null;
  patientId: string | null;
}

export interface CreateSessionInput {
  tenantId: string;
  userFhirId: string | null;
  userName: string | null;
  patientId: string | null;
  scope: string | null;
  pfAccessToken: string;
  pfRefreshToken: string | null;
  pfExpiresIn: number; // seconds
}

/**
 * Create a new session after OAuth callback.
 *
 * @returns Session ID, internal JWT, and expiration time
 */
export async function createSession(
  input: CreateSessionInput
): Promise<{ sessionId: string; internalJwt: string; expiresAt: Date }> {
  // Calculate PF token expiration
  const pfTokenExpiresAt = new Date(Date.now() + input.pfExpiresIn * 1000);

  // Create session in database first (we'll update the JWT ID after signing)
  const session = await prisma.session.create({
    data: {
      tenantId: input.tenantId,
      userFhirId: input.userFhirId,
      userName: input.userName,
      internalJwtId: 'pending', // Placeholder - updated after JWT is signed
      internalJwtExpiresAt: new Date(), // Placeholder - updated after JWT is signed
      pfAccessTokenEncrypted: encrypt(input.pfAccessToken),
      pfRefreshTokenEncrypted: input.pfRefreshToken
        ? encrypt(input.pfRefreshToken)
        : null,
      pfTokenExpiresAt,
      patientId: input.patientId,
      scope: input.scope,
    },
  });

  // Now sign the JWT with the real session ID
  const { token, jti, expiresAt } = await signInternalJwt({
    sessionId: session.id,
    tenantId: input.tenantId,
    userFhirId: input.userFhirId,
    userName: input.userName,
  });

  // Update session with the actual JWT ID from the token we're returning
  await prisma.session.update({
    where: { id: session.id },
    data: {
      internalJwtId: jti,
      internalJwtExpiresAt: expiresAt,
    },
  });

  // Cache session info in Redis using the correct jti
  await cacheSet(CacheKeys.session(jti), {
    id: session.id,
    tenantId: input.tenantId,
    userFhirId: input.userFhirId,
    userName: input.userName,
    patientId: input.patientId,
  }, CacheTTL.SESSION);

  serviceLogger.info({
    sessionId: session.id,
    tenantId: input.tenantId,
    userFhirId: input.userFhirId,
    jti,
  }, 'Session created');

  return {
    sessionId: session.id,
    internalJwt: token,
    expiresAt,
  };
}

/**
 * Get session info from JWT ID.
 * Checks Redis cache first, falls back to database.
 *
 * @param jwtId - JWT ID (jti claim)
 * @returns Session info or null if not found/revoked
 */
export async function getSessionByJwtId(jwtId: string): Promise<SessionInfo | null> {
  // Check Redis cache first
  const cached = await cacheGet<SessionInfo>(CacheKeys.session(jwtId));
  if (cached) {
    return cached;
  }

  // Fall back to database
  const session = await prisma.session.findFirst({
    where: {
      internalJwtId: jwtId,
      revoked: false,
      internalJwtExpiresAt: { gt: new Date() },
    },
  });

  if (!session) {
    return null;
  }

  const sessionInfo: SessionInfo = {
    id: session.id,
    tenantId: session.tenantId,
    userFhirId: session.userFhirId,
    userName: session.userName,
    patientId: session.patientId,
  };

  // Re-cache for future lookups
  await cacheSet(CacheKeys.session(jwtId), sessionInfo, CacheTTL.SESSION);

  // Update last accessed time (fire and forget)
  prisma.session.update({
    where: { id: session.id },
    data: { lastAccessedAt: new Date() },
  }).catch((err: unknown) => {
    serviceLogger.warn({ err, sessionId: session.id }, 'Failed to update lastAccessedAt');
  });

  return sessionInfo;
}

/**
 * Get decrypted PF access token for FHIR calls.
 * Auto-refreshes if token is close to expiration.
 *
 * @param sessionId - Session ID
 * @param fhirBaseUrl - FHIR server URL (for token refresh)
 * @returns Decrypted access token or null if session expired/invalid
 */
export async function getPfToken(
  sessionId: string,
  fhirBaseUrl: string
): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.revoked) {
    return null;
  }

  const now = Date.now();
  const needsRefresh = session.pfTokenExpiresAt.getTime() - now < REFRESH_BUFFER_MS;

  if (needsRefresh && session.pfRefreshTokenEncrypted) {
    // Attempt to refresh
    const refreshed = await refreshPfToken(
      sessionId,
      decrypt(session.pfRefreshTokenEncrypted),
      fhirBaseUrl
    );

    if (refreshed) {
      return refreshed;
    }
    // If refresh failed, try existing token if still valid
  }

  // Return existing token if not expired
  if (session.pfTokenExpiresAt.getTime() > now) {
    return decrypt(session.pfAccessTokenEncrypted);
  }

  // Token expired and couldn't refresh
  serviceLogger.warn({ sessionId }, 'PF token expired and refresh failed');
  return null;
}

/**
 * Refresh the internal JWT (extends session).
 * Called when user makes a request with a nearly-expired JWT.
 *
 * @param sessionId - Session ID
 * @returns New JWT and expiration or null if session invalid
 */
export async function refreshSession(
  sessionId: string
): Promise<{ internalJwt: string; expiresAt: Date } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.revoked) {
    return null;
  }

  // Delete old cache entry
  await cacheDelete(CacheKeys.session(session.internalJwtId));

  // Sign new JWT
  const { token, jti, expiresAt } = await signInternalJwt({
    sessionId: session.id,
    tenantId: session.tenantId,
    userFhirId: session.userFhirId,
    userName: session.userName,
  });

  // Update session with new JWT ID
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      internalJwtId: jti,
      internalJwtExpiresAt: expiresAt,
      lastAccessedAt: new Date(),
    },
  });

  // Cache new session info
  await cacheSet(CacheKeys.session(jti), {
    id: session.id,
    tenantId: session.tenantId,
    userFhirId: session.userFhirId,
    userName: session.userName,
    patientId: session.patientId,
  }, CacheTTL.SESSION);

  serviceLogger.info({ sessionId }, 'Session refreshed');

  return { internalJwt: token, expiresAt };
}

/**
 * Revoke a session (logout).
 *
 * @param sessionId - Session ID to revoke
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return;
  }

  // Delete cache entry
  await cacheDelete(CacheKeys.session(session.internalJwtId));

  // Mark session as revoked
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  });

  serviceLogger.info({ sessionId }, 'Session revoked');
}

/**
 * Verify JWT and get session info.
 * Convenience method combining JWT verification with session lookup.
 *
 * @param token - JWT string
 * @returns Session info or null if invalid
 */
export async function verifyAndGetSession(token: string): Promise<SessionInfo | null> {
  try {
    const payload = await verifyInternalJwt(token);
    return await getSessionByJwtId(payload.jti);
  } catch (error) {
    serviceLogger.debug({ error }, 'JWT verification failed');
    return null;
  }
}

// ============================================================================
// Private helpers
// ============================================================================

/**
 * Refresh PF OAuth token using refresh token.
 */
async function refreshPfToken(
  sessionId: string,
  refreshToken: string,
  fhirBaseUrl: string
): Promise<string | null> {
  try {
    // Validate inputs
    if (!fhirBaseUrl || fhirBaseUrl.trim() === '') {
      serviceLogger.error({ sessionId, fhirBaseUrl }, 'Cannot refresh PF token: FHIR base URL is empty');
      return null;
    }

    // Discover token endpoint
    const tokenEndpoint = await discoverTokenEndpoint(fhirBaseUrl);

    const response = await axios.post(
      tokenEndpoint,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.PF_CLIENT_ID || '',
        client_secret: process.env.PF_CLIENT_SECRET || '',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );

    const data = response.data;
    const expiresIn = data.expires_in || 3600;
    const pfTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Update session with new tokens
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        pfAccessTokenEncrypted: encrypt(data.access_token),
        pfRefreshTokenEncrypted: data.refresh_token
          ? encrypt(data.refresh_token)
          : encrypt(refreshToken), // Keep old refresh token if new one not provided
        pfTokenExpiresAt,
      },
    });

    serviceLogger.info({ sessionId }, 'PF token refreshed');
    return data.access_token;
  } catch (error) {
    serviceLogger.error(
      { error: error instanceof Error ? error.message : 'Unknown', sessionId },
      'PF token refresh failed'
    );
    return null;
  }
}

/**
 * Discover token endpoint from FHIR server.
 */
async function discoverTokenEndpoint(fhirBaseUrl: string): Promise<string> {
  // Validate the URL before attempting to use it
  if (!fhirBaseUrl || fhirBaseUrl.trim() === '') {
    throw new Error('FHIR base URL is required for token endpoint discovery');
  }

  // Try to parse the URL to validate it
  try {
    new URL(fhirBaseUrl);
  } catch {
    throw new Error(`Invalid FHIR base URL: ${fhirBaseUrl}`);
  }

  const baseUrl = fhirBaseUrl.replace(/\/$/, '');

  // Check cache first
  const cached = await cacheGet<string>(CacheKeys.smartConfig(baseUrl));
  if (cached) {
    return cached;
  }

  // Try .well-known/smart-configuration
  try {
    const response = await axios.get(`${baseUrl}/.well-known/smart-configuration`, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const tokenEndpoint = response.data.token_endpoint;
    await cacheSet(CacheKeys.smartConfig(baseUrl), tokenEndpoint, CacheTTL.SMART_CONFIG);
    return tokenEndpoint;
  } catch {
    // Fall back to metadata
  }

  // Try metadata endpoint
  const metadataResponse = await axios.get(`${baseUrl}/metadata`, {
    timeout: 10000,
    headers: { Accept: 'application/fhir+json' },
  });

  const security = metadataResponse.data.rest?.[0]?.security;
  const oauthExtension = security?.extension?.find(
    (ext: { url: string }) =>
      ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
  );

  const tokenUrl = oauthExtension?.extension?.find(
    (e: { url: string }) => e.url === 'token'
  )?.valueUri;

  if (!tokenUrl) {
    throw new Error('Could not discover token endpoint');
  }

  await cacheSet(CacheKeys.smartConfig(baseUrl), tokenUrl, CacheTTL.SMART_CONFIG);
  return tokenUrl;
}
