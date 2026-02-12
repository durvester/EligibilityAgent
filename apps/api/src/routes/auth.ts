/**
 * Auth Routes
 *
 * Handles SMART on FHIR OAuth flow with tenant-centric architecture.
 *
 * Flow:
 * 1. /launch - Receive ISS and launch token from EHR, redirect to authorization
 * 2. /callback - Exchange code for tokens, create tenant/session, set cookie
 * 3. /me - Get current user info from session
 * 4. /logout - Revoke session, clear cookie
 * 5. /refresh - Refresh internal JWT (extend session)
 */

import { FastifyPluginAsync } from 'fastify';
import { v4 as uuid } from 'uuid';
import axios from 'axios';
import { prisma } from '@eligibility-agent/db';
import { createSession, revokeSession, refreshSession, verifyAndGetSession } from '../services/session-service.js';
import { getSessionCookieOptions } from '../lib/jwt.js';
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '../lib/redis.js';
import { auditLogin, auditLogout } from '../services/audit-service.js';
import { getRequiredEnv } from '../lib/validate-env.js';
import { sessionMiddleware } from '../middleware/session.js';
import { getCredentialsForIssuer } from '../services/ehr-credentials.js';

interface LaunchQuery {
  iss: string;
  launch: string;
}

interface CallbackBody {
  code: string;
  state: string;
}

interface CallbackQuery {
  code: string;
  state: string;
}

interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported?: string[];
  scopes_supported?: string[];
  capabilities?: string[];
}

interface LaunchState {
  iss: string;
  launch: string;
  authorizeUrl: string;
  tokenUrl: string;
  createdAt: number;
  clientId: string;
  clientSecret: string;
}

// In-memory state store (use Redis in production for multi-instance)
const stateStore = new Map<string, LaunchState>();

/**
 * Discover SMART configuration from FHIR server.
 * Caches results in Redis.
 */
async function discoverSmartConfiguration(iss: string): Promise<SmartConfiguration> {
  // Normalize ISS (remove trailing slash)
  const baseUrl = iss.replace(/\/$/, '');

  // Check Redis cache first
  const cached = await cacheGet<SmartConfiguration>(CacheKeys.smartConfig(baseUrl));
  if (cached) {
    return cached;
  }

  // Try .well-known/smart-configuration first (preferred)
  try {
    const wellKnownUrl = `${baseUrl}/.well-known/smart-configuration`;
    const response = await axios.get<SmartConfiguration>(wellKnownUrl, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const config = response.data;
    await cacheSet(CacheKeys.smartConfig(baseUrl), config, CacheTTL.SMART_CONFIG);
    return config;
  } catch {
    // .well-known not found, try metadata endpoint
  }

  // Fall back to FHIR metadata endpoint
  try {
    const metadataUrl = `${baseUrl}/metadata`;
    const response = await axios.get(metadataUrl, {
      timeout: 10000,
      headers: { Accept: 'application/fhir+json' },
    });

    const metadata = response.data;
    const security = metadata.rest?.[0]?.security;
    const oauthExtension = security?.extension?.find(
      (ext: { url: string }) =>
        ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
    );

    if (!oauthExtension) {
      throw new Error('No OAuth configuration found in FHIR metadata');
    }

    const authorizeUrl = oauthExtension.extension?.find(
      (e: { url: string }) => e.url === 'authorize'
    )?.valueUri;
    const tokenUrl = oauthExtension.extension?.find(
      (e: { url: string }) => e.url === 'token'
    )?.valueUri;

    if (!authorizeUrl || !tokenUrl) {
      throw new Error('Missing authorize or token URL in FHIR metadata');
    }

    const config: SmartConfiguration = {
      authorization_endpoint: authorizeUrl,
      token_endpoint: tokenUrl,
    };

    await cacheSet(CacheKeys.smartConfig(baseUrl), config, CacheTTL.SMART_CONFIG);
    return config;
  } catch {
    throw new Error(`Failed to discover SMART configuration for ${iss}`);
  }
}

/**
 * Get or create tenant from issuer (FHIR base URL).
 * Issuer IS the tenant identifier.
 */
async function getOrCreateTenant(
  issuer: string,
  accessToken?: string
): Promise<{ id: string; name: string | null }> {
  // Look up existing tenant
  let tenant = await prisma.tenant.findUnique({
    where: { issuer },
    select: { id: true, name: true },
  });

  if (tenant) {
    return tenant;
  }

  // Create new tenant
  // Try to fetch organization name from FHIR server
  let organizationName: string | null = null;
  let organizationJson: object | null = null;

  if (accessToken) {
    try {
      const orgResponse = await axios.get(`${issuer}/Organization`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/fhir+json',
        },
        timeout: 10000,
      });

      const orgs = orgResponse.data.entry;
      if (orgs && orgs.length > 0) {
        organizationName = orgs[0].resource?.name;
        organizationJson = orgs[0].resource;
      }
    } catch {
      // Organization fetch is best-effort, don't fail tenant creation
    }
  }

  tenant = await prisma.tenant.create({
    data: {
      issuer,
      name: organizationName,
      organizationJson: organizationJson as object,
    },
    select: { id: true, name: true },
  });

  return tenant;
}

/**
 * Extract fhirUser from id_token.
 */
function extractFhirUser(idToken: string): {
  fhirUser: string | undefined;
  userName: string | undefined;
} {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) {
      return { fhirUser: undefined, userName: undefined };
    }

    // Decode payload (second part)
    let payloadStr: string;
    try {
      payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
    } catch {
      // Fallback to regular base64 with URL-safe character replacement
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      payloadStr = Buffer.from(base64, 'base64').toString('utf8');
    }
    const payload = JSON.parse(payloadStr);

    // Try different claim names for fhirUser
    const fhirUser =
      payload.fhirUser ||
      payload.fhir_user ||
      payload.profile ||
      payload.sub;

    // Try to extract user name
    const userName = payload.name || payload.preferred_username;

    return { fhirUser, userName };
  } catch {
    return { fhirUser: undefined, userName: undefined };
  }
}

/**
 * Extract practitioner ID from fhirUser URL.
 * E.g., "https://fhir.server.com/Practitioner/123" -> "Practitioner/123"
 */
function extractPractitionerReference(fhirUser: string | undefined): string | null {
  if (!fhirUser) return null;

  const match = fhirUser.match(/(Practitioner\/[^/]+)$/);
  return match ? match[1] : null;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * SMART on FHIR Launch
   *
   * 1. Receive iss (FHIR base URL) and launch token from EHR
   * 2. Discover OAuth endpoints from iss
   * 3. Redirect to authorization endpoint
   */
  fastify.get<{ Querystring: LaunchQuery }>('/launch', async (request, reply) => {
    const { iss, launch } = request.query;

    if (!iss || !launch) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_LAUNCH', message: 'Missing iss or launch parameter' },
      });
    }

    fastify.log.info({ iss, launch }, 'SMART launch initiated');

    try {
      // Discover SMART configuration
      const smartConfig = await discoverSmartConfiguration(iss);

      fastify.log.info({
        iss,
        authorizeUrl: smartConfig.authorization_endpoint,
        tokenUrl: smartConfig.token_endpoint,
      }, 'SMART configuration discovered');

      // Get EHR-specific OAuth credentials
      let credentials;
      try {
        credentials = getCredentialsForIssuer(iss);
      } catch (error) {
        // NO credentials configured for this issuer - FAIL EXPLICITLY
        fastify.log.error({ iss, error }, 'OAuth credentials not configured for issuer');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'CREDENTIALS_NOT_CONFIGURED',
            message: error instanceof Error ? error.message : `OAuth credentials not configured for issuer: ${iss}`,
          },
        });
      }

      // Generate state for CSRF protection
      const state = uuid();
      stateStore.set(state, {
        iss,
        launch,
        authorizeUrl: smartConfig.authorization_endpoint,
        tokenUrl: smartConfig.token_endpoint,
        createdAt: Date.now(),
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      });

      // Clean up old states (older than 10 minutes)
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      for (const [key, value] of stateStore.entries()) {
        if (value.createdAt < tenMinutesAgo) {
          stateStore.delete(key);
        }
      }

      // Build authorization URL with EHR-specific credentials
      const appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL');
      const redirectUri = `${appUrl}/callback`;

      const authorizeUrl = new URL(smartConfig.authorization_endpoint);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', credentials.clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('scope', credentials.scopes);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('launch', launch);
      authorizeUrl.searchParams.set('aud', iss);

      fastify.log.info({ authorizeUrl: authorizeUrl.toString() }, 'Redirecting to authorization');

      return reply.redirect(authorizeUrl.toString());
    } catch (error) {
      fastify.log.error(error, 'SMART discovery failed');

      return reply.status(500).send({
        success: false,
        error: {
          code: 'DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to discover SMART configuration',
        },
      });
    }
  });

  /**
   * OAuth Callback (GET) - Direct browser redirect
   *
   * This is the preferred flow:
   * 1. Frontend /callback page redirects browser here with code & state
   * 2. We exchange code for tokens
   * 3. Set HTTP-only cookie DIRECTLY on browser (no proxy issues)
   * 4. Redirect to frontend eligibility page
   *
   * This avoids all the Next.js Route Handler cookie forwarding issues.
   */
  fastify.get<{ Querystring: CallbackQuery }>('/callback', async (request, reply) => {
    const { code, state } = request.query;
    const appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL');

    // Helper to redirect to error page
    const redirectToError = (code: string, message: string) => {
      const errorUrl = new URL(`${appUrl}/auth/error`);
      errorUrl.searchParams.set('code', code);
      errorUrl.searchParams.set('message', message);
      return reply.redirect(errorUrl.toString());
    };

    if (!code || !state) {
      return redirectToError('INVALID_CALLBACK', 'Missing code or state parameter');
    }

    // Validate state and get stored launch context
    const launchState = stateStore.get(state);
    if (!launchState) {
      return redirectToError('INVALID_STATE', 'Invalid or expired state. Please try logging in again.');
    }
    stateStore.delete(state);

    const redirectUri = `${appUrl}/callback`;

    try {
      // Exchange code for token using credentials from launch state
      const tokenResponse = await axios.post(
        launchState.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: launchState.clientId,
          client_secret: launchState.clientSecret,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      const tokenData = tokenResponse.data;

      // Extract fhirUser from id_token
      const { fhirUser, userName } = tokenData.id_token
        ? extractFhirUser(tokenData.id_token)
        : { fhirUser: tokenData.fhirUser, userName: undefined };

      const userFhirId = extractPractitionerReference(fhirUser);

      fastify.log.info({
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        patient: tokenData.patient,
        userFhirId,
      }, 'Token exchange successful (GET callback)');

      // Get or create tenant from issuer
      const tenant = await getOrCreateTenant(launchState.iss, tokenData.access_token);

      // Get EHR identifier for token refresh
      const credentials = getCredentialsForIssuer(launchState.iss);

      // Create session
      const { sessionId, internalJwt } = await createSession({
        tenantId: tenant.id,
        userFhirId,
        userName: userName || null,
        patientId: tokenData.patient || null,
        scope: tokenData.scope || null,
        pfAccessToken: tokenData.access_token,
        pfRefreshToken: tokenData.refresh_token || null,
        pfExpiresIn: tokenData.expires_in || 3600,
        tokenEndpoint: launchState.tokenUrl, // Store for token refresh
        ehrIdentifier: credentials.ehrName, // Store EHR identifier for token refresh
      });

      // Audit the login
      auditLogin(
        tenant.id,
        sessionId,
        userFhirId,
        userName || null,
        request.ip,
        request.headers['user-agent']
      );

      // Set session cookie DIRECTLY on browser response
      const cookieOptions = getSessionCookieOptions();
      reply.setCookie(cookieOptions.name, internalJwt, {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path,
        domain: cookieOptions.domain,
        maxAge: cookieOptions.maxAge,
      });

      fastify.log.info({
        sessionId,
        tenantId: tenant.id,
        cookieDomain: cookieOptions.domain || '(not set)',
      }, 'Session created, redirecting to app');

      // Redirect to eligibility page with patient context
      const eligibilityUrl = new URL(`${appUrl}/eligibility`);
      if (tokenData.patient) {
        eligibilityUrl.searchParams.set('patient', tokenData.patient);
      }

      return reply.redirect(eligibilityUrl.toString());
    } catch (error) {
      fastify.log.error(error, 'Token exchange failed (GET callback)');

      if (axios.isAxiosError(error) && error.response) {
        const message = error.response.data?.error_description ||
          error.response.data?.error ||
          'Token exchange failed';
        return redirectToError('TOKEN_EXCHANGE_FAILED', message);
      }

      return redirectToError('TOKEN_EXCHANGE_FAILED', 'Authentication failed. Please try again.');
    }
  });

  /**
   * OAuth Callback (POST) - Legacy Route Handler proxy
   *
   * Kept for backward compatibility with the Next.js Route Handler approach.
   * The GET handler above is preferred.
   */
  fastify.post<{ Body: CallbackBody }>('/callback', async (request, reply) => {
    const { code, state } = request.body;

    if (!code || !state) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CALLBACK', message: 'Missing code or state' },
      });
    }

    // Validate state and get stored launch context
    const launchState = stateStore.get(state);
    if (!launchState) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Invalid or expired state' },
      });
    }
    stateStore.delete(state);

    const appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL');
    const redirectUri = `${appUrl}/callback`;

    try {
      // Exchange code for token using credentials from launch state
      const tokenResponse = await axios.post(
        launchState.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: launchState.clientId,
          client_secret: launchState.clientSecret,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      const tokenData = tokenResponse.data;

      // Extract fhirUser from id_token
      const { fhirUser, userName } = tokenData.id_token
        ? extractFhirUser(tokenData.id_token)
        : { fhirUser: tokenData.fhirUser, userName: undefined };

      const userFhirId = extractPractitionerReference(fhirUser);

      fastify.log.info({
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        hasIdToken: !!tokenData.id_token,
        patient: tokenData.patient,
        fhirUser,
        userFhirId,
        expiresIn: tokenData.expires_in,
      }, 'Token exchange successful');

      // Get or create tenant from issuer
      const tenant = await getOrCreateTenant(launchState.iss, tokenData.access_token);

      // Get EHR identifier for token refresh
      const credentials = getCredentialsForIssuer(launchState.iss);

      // Create session
      const { sessionId, internalJwt, expiresAt } = await createSession({
        tenantId: tenant.id,
        userFhirId,
        userName: userName || null,
        patientId: tokenData.patient || null,
        scope: tokenData.scope || null,
        pfAccessToken: tokenData.access_token,
        pfRefreshToken: tokenData.refresh_token || null,
        pfExpiresIn: tokenData.expires_in || 3600,
        tokenEndpoint: launchState.tokenUrl, // Store for token refresh
        ehrIdentifier: credentials.ehrName, // Store EHR identifier for token refresh
      });

      // Audit the login
      auditLogin(
        tenant.id,
        sessionId,
        userFhirId,
        userName || null,
        request.ip,
        request.headers['user-agent']
      );

      // Set session cookie
      const cookieOptions = getSessionCookieOptions();
      reply.setCookie(cookieOptions.name, internalJwt, {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        path: cookieOptions.path,
        domain: cookieOptions.domain,
        maxAge: cookieOptions.maxAge,
      });

      fastify.log.info({
        sessionId,
        tenantId: tenant.id,
        userFhirId,
      }, 'Session created');

      // Return tenant/user info AND session token for Route Handler to set cookie
      // The token is returned in body because Set-Cookie header forwarding through
      // Next.js Route Handlers is unreliable in Node.js fetch
      return {
        success: true,
        tenantId: tenant.id,
        tenantName: tenant.name,
        userName,
        userFhirId,
        patientId: tokenData.patient,
        fhirBaseUrl: launchState.iss,
        expiresAt: expiresAt.toISOString(),
        // Session token for Route Handler to set as cookie
        _sessionToken: internalJwt,
        _cookieOptions: cookieOptions,
      };
    } catch (error) {
      fastify.log.error(error, 'Token exchange failed');

      if (axios.isAxiosError(error) && error.response) {
        return reply.status(error.response.status).send({
          success: false,
          error: {
            code: 'TOKEN_EXCHANGE_FAILED',
            message:
              error.response.data?.error_description ||
              error.response.data?.error ||
              'Token exchange failed',
          },
        });
      }

      return reply.status(500).send({
        success: false,
        error: { code: 'TOKEN_EXCHANGE_FAILED', message: 'Token exchange failed' },
      });
    }
  });

  /**
   * Get current user info from session.
   *
   * Uses session middleware to validate JWT from cookie.
   */
  fastify.get('/me', {
    preHandler: sessionMiddleware,
  }, async (request, reply) => {
    if (!request.session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    // Get tenant info
    const tenant = await prisma.tenant.findUnique({
      where: { id: request.session.tenantId },
      select: { id: true, name: true, issuer: true },
    });

    return {
      success: true,
      session: {
        id: request.session.id,
        tenantId: request.session.tenantId,
        tenantName: tenant?.name || null,
        fhirBaseUrl: tenant?.issuer || null,
        userFhirId: request.session.userFhirId,
        userName: request.session.userName,
        patientId: request.session.patientId,
      },
    };
  });

  /**
   * Logout - revoke session and clear cookie.
   */
  fastify.post('/logout', {
    preHandler: sessionMiddleware,
  }, async (request, reply) => {
    if (request.session) {
      // Audit the logout
      auditLogout(request);

      // Revoke session
      await revokeSession(request.session.id);
    }

    // Clear cookie
    const cookieOptions = getSessionCookieOptions();
    reply.clearCookie(cookieOptions.name, {
      path: cookieOptions.path,
      domain: cookieOptions.domain,
    });

    return { success: true };
  });

  /**
   * Refresh internal JWT (extend session).
   *
   * Called by frontend when JWT is close to expiration.
   */
  fastify.post('/refresh', {
    preHandler: sessionMiddleware,
  }, async (request, reply) => {
    if (!request.session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const result = await refreshSession(request.session.id);

    if (!result) {
      return reply.status(401).send({
        success: false,
        error: { code: 'SESSION_EXPIRED', message: 'Session has expired' },
      });
    }

    // Set new cookie (backup - Route Handler also sets cookie from body)
    const cookieOptions = getSessionCookieOptions();
    reply.setCookie(cookieOptions.name, result.internalJwt, {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      path: cookieOptions.path,
      domain: cookieOptions.domain,
      maxAge: cookieOptions.maxAge,
    });

    // Return token in body for Route Handler to set as cookie
    return {
      success: true,
      expiresAt: result.expiresAt.toISOString(),
      _sessionToken: result.internalJwt,
      _cookieOptions: cookieOptions,
    };
  });
};

export default authRoutes;
