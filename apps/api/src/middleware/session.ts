/**
 * Session Middleware
 *
 * Extracts and validates internal JWT from HTTP-only cookie.
 * Attaches session info to request for downstream handlers.
 *
 * Use this middleware on all protected routes.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAndGetSession, type SessionInfo } from '../services/session-service.js';
import { serviceLogger } from '../lib/logger.js';

// Extend FastifyRequest to include session
declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
  }
}

/**
 * Get the session cookie name from environment or default.
 */
function getCookieName(): string {
  return process.env.SESSION_COOKIE_NAME || 'eligibility_session';
}

/**
 * Parse cookies from the Cookie header.
 * Simple parser that handles standard cookie format.
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');

  for (const pair of pairs) {
    const [key, ...valueParts] = pair.trim().split('=');
    if (key) {
      // Join value parts in case value contains '='
      cookies[key.trim()] = valueParts.join('=').trim();
    }
  }

  return cookies;
}

/**
 * Session middleware - validates JWT and attaches session to request.
 *
 * If session is invalid or missing, request.session will be null.
 * Use requireSession middleware for routes that must have a valid session.
 */
export async function sessionMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // Initialize session as null
  request.session = null;

  // Get cookie header
  const cookieHeader = request.headers.cookie;
  const cookieName = getCookieName();
  const cookies = parseCookies(cookieHeader);
  const token = cookies[cookieName];

  // Log cookie state for debugging (info level so it shows in production)
  serviceLogger.info({
    path: request.url,
    hasCookieHeader: !!cookieHeader,
    cookieHeaderLength: cookieHeader?.length || 0,
    cookieName,
    hasToken: !!token,
    tokenLength: token?.length || 0,
    tokenPreview: token ? token.substring(0, 30) + '...' : '(none)',
    parsedCookieKeys: Object.keys(cookies),
  }, 'Session middleware - cookie check');

  if (!token) {
    serviceLogger.info({ path: request.url, cookieName }, 'No session cookie present');
    return;
  }

  try {
    // Verify JWT and get session info
    const session = await verifyAndGetSession(token);

    if (session) {
      request.session = session;
      serviceLogger.info({
        path: request.url,
        sessionId: session.id,
        tenantId: session.tenantId,
      }, 'Session validated successfully');
    } else {
      serviceLogger.info({ path: request.url }, 'Session not found or revoked');
    }
  } catch (error) {
    serviceLogger.info(
      { error: error instanceof Error ? error.message : 'Unknown', path: request.url },
      'Session validation failed'
    );
  }
}

/**
 * Require valid session middleware.
 *
 * Returns 401 Unauthorized if no valid session.
 * Use after sessionMiddleware on routes that require authentication.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.session) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }
}

/**
 * Require specific tenant middleware factory.
 *
 * Ensures the session belongs to the expected tenant.
 * Useful for multi-tenant routes where tenant is in the URL.
 */
export function requireTenant(getTenantId: (request: FastifyRequest) => string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.session) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const expectedTenantId = getTenantId(request);
    if (request.session.tenantId !== expectedTenantId) {
      serviceLogger.warn({
        sessionTenantId: request.session.tenantId,
        expectedTenantId,
        path: request.url,
      }, 'Tenant mismatch');

      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied to this tenant',
        },
      });
    }
  };
}
