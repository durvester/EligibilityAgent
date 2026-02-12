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
import { signInternalJwt, verifyInternalJwt } from '../lib/jwt.js';
import { cacheGet, cacheSet, cacheDelete, CacheKeys, CacheTTL } from '../lib/redis.js';
import { serviceLogger } from '../lib/logger.js';
import axios from 'axios';


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
  tokenEndpoint: string; // OAuth token endpoint for refresh
  ehrIdentifier: string; // EHR system identifier (e.g., 'PF', 'VERADIGM')
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
      tokenEndpoint: input.tokenEndpoint, // Store for token refresh
      ehrIdentifier: input.ehrIdentifier, // Store EHR identifier for token refresh
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
 * Returns the current token without checking expiry - caller handles 401 retry.
 *
 * @param sessionId - Session ID
 * @returns Decrypted access token or null if session invalid/revoked
 */
export async function getPfToken(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.revoked) {
    return null;
  }

  return decrypt(session.pfAccessTokenEncrypted);
}

/**
 * Get token endpoint for a session (used for refresh).
 */
export async function getTokenEndpoint(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { tokenEndpoint: true },
  });
  return session?.tokenEndpoint || null;
}

/**
 * Refresh PF access token using the refresh token.
 * Called when a FHIR request returns 401.
 *
 * Uses EHR-specific credentials based on ehrIdentifier stored in session.
 * NO FALLBACKS - if ehrIdentifier is missing or credentials not found, fails explicitly.
 *
 * @param sessionId - Session ID
 * @returns New access token or null if refresh failed
 */
export async function refreshPfAccessToken(sessionId: string): Promise<string | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.revoked || !session.pfRefreshTokenEncrypted || !session.tokenEndpoint) {
    serviceLogger.warn(
      {
        sessionId,
        hasRefreshToken: !!session?.pfRefreshTokenEncrypted,
        hasTokenEndpoint: !!session?.tokenEndpoint,
      },
      'Cannot refresh OAuth token - missing required fields'
    );
    return null;
  }

  // REQUIRE ehrIdentifier - no fallbacks
  if (!session.ehrIdentifier) {
    serviceLogger.error(
      { sessionId },
      'Cannot refresh OAuth token - ehrIdentifier is null. Session created before multi-EHR support. User must re-login.'
    );
    return null;
  }

  // Get EHR-specific credentials from environment
  const clientId = process.env[`${session.ehrIdentifier}_CLIENT_ID`];
  const clientSecret = process.env[`${session.ehrIdentifier}_CLIENT_SECRET`];

  if (!clientId || !clientSecret) {
    serviceLogger.error(
      {
        sessionId,
        ehrIdentifier: session.ehrIdentifier,
        missingClientId: !clientId,
        missingClientSecret: !clientSecret,
      },
      'Cannot refresh OAuth token - EHR credentials not found in environment. User must re-login.'
    );
    return null;
  }

  try {
    const refreshToken = decrypt(session.pfRefreshTokenEncrypted);

    serviceLogger.info(
      { sessionId, ehrIdentifier: session.ehrIdentifier },
      'Refreshing OAuth token'
    );

    const response = await axios.post(
      session.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
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
          : session.pfRefreshTokenEncrypted, // Keep old if new not provided
        pfTokenExpiresAt,
      },
    });

    serviceLogger.info(
      { sessionId, ehrIdentifier: session.ehrIdentifier },
      'OAuth token refreshed successfully'
    );
    return data.access_token;
  } catch (error) {
    serviceLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown',
        sessionId,
        ehrIdentifier: session.ehrIdentifier,
      },
      'OAuth token refresh failed'
    );
    return null;
  }
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

