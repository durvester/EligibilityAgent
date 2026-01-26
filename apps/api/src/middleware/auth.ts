/**
 * Authorization Middleware
 *
 * Verifies that requests have valid authentication before proceeding.
 * For protected routes like /agent/* and /eligibility/*
 */

import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

/**
 * Verify authentication hook.
 * Checks that a Bearer token is present.
 *
 * Note: This is a basic check - it verifies token presence, not validity.
 * Token validity is verified by the FHIR server when making requests.
 */
export async function verifyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);

  if (!token) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header. Include: Authorization: Bearer <token>',
      },
    });
    return;
  }

  // Token exists - store it for route handlers
  // Further validation happens when calling FHIR/Stedi APIs
  request.authToken = token;
}

/**
 * Plugin to add auth middleware to routes.
 * Register on route prefix (e.g., /agent, /eligibility)
 */
export const authMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', verifyAuth);
};

// Extend FastifyRequest to include authToken
declare module 'fastify' {
  interface FastifyRequest {
    authToken?: string;
  }
}
