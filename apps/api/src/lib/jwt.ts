/**
 * Internal JWT Service
 *
 * Creates and verifies internal JWTs used for API authentication.
 * These JWTs are stored in HTTP-only cookies and used for ALL internal API communication.
 *
 * IMPORTANT: PF OAuth tokens are ONLY used for FHIR calls - never for internal API auth.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { v4 as uuid } from 'uuid';
import { getRequiredEnv } from './validate-env.js';
import { serviceLogger } from './logger.js';

export interface JwtPayload {
  sessionId: string;
  tenantId: string;
  userFhirId: string | null;
  userName: string | null;
  jti: string; // JWT ID for revocation checking
}

// Cache the secret key to avoid repeated env lookups and encoding
let cachedSecretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (cachedSecretKey) {
    return cachedSecretKey;
  }
  const secret = getRequiredEnv('JWT_SECRET');
  cachedSecretKey = new TextEncoder().encode(secret);
  return cachedSecretKey;
}

/**
 * Parse JWT expiration string (e.g., "15m", "1h", "7d") to seconds.
 */
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    serviceLogger.warn({ expiresIn }, 'Invalid JWT_EXPIRES_IN format, using default 15m');
    return 15 * 60; // Default 15 minutes
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    default:
      return 15 * 60;
  }
}

/**
 * Sign a new internal JWT.
 *
 * @param payload - Session data to include in the JWT
 * @returns Signed JWT string and the JWT ID (jti)
 */
export async function signInternalJwt(
  payload: Omit<JwtPayload, 'jti'>
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = uuid();
  const expiresInSeconds = parseExpiresIn(process.env.JWT_EXPIRES_IN || '15m');
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const token = await new SignJWT({
    sessionId: payload.sessionId,
    tenantId: payload.tenantId,
    userFhirId: payload.userFhirId,
    userName: payload.userName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .setIssuer('eligibility-agent')
    .setAudience('eligibility-agent')
    .sign(getSecretKey());

  return { token, jti, expiresAt };
}

/**
 * Verify and decode an internal JWT.
 *
 * @param token - JWT string to verify
 * @returns Decoded payload if valid
 * @throws Error if token is invalid, expired, or malformed
 */
export async function verifyInternalJwt(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: 'eligibility-agent',
      audience: 'eligibility-agent',
    });

    // Validate required claims exist
    if (!payload.sessionId || typeof payload.sessionId !== 'string') {
      throw new Error('Missing or invalid sessionId claim');
    }
    if (!payload.tenantId || typeof payload.tenantId !== 'string') {
      throw new Error('Missing or invalid tenantId claim');
    }
    if (!payload.jti || typeof payload.jti !== 'string') {
      throw new Error('Missing or invalid jti claim');
    }

    return {
      sessionId: payload.sessionId,
      tenantId: payload.tenantId,
      userFhirId:
        typeof payload.userFhirId === 'string' ? payload.userFhirId : null,
      userName: typeof payload.userName === 'string' ? payload.userName : null,
      jti: payload.jti,
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new Error('JWT expired');
    }
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      throw new Error('JWT claim validation failed');
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new Error('JWT signature verification failed');
    }
    throw error;
  }
}

/**
 * Cookie configuration for session tokens.
 */
export function getSessionCookieOptions(): {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  domain?: string;
  maxAge: number;
} {
  const expiresInSeconds = parseExpiresIn(process.env.JWT_EXPIRES_IN || '15m');
  const domain = process.env.SESSION_COOKIE_DOMAIN || undefined;
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    name: process.env.SESSION_COOKIE_NAME || 'eligibility_session',
    httpOnly: true,
    secure: isProduction,
    // SameSite=None required for cookies to be sent in cross-site iframe contexts
    // (SMART on FHIR apps are embedded in EHR iframes from different domains).
    // SameSite=None requires Secure=true (HTTPS), so use Lax in development.
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    // Domain MUST be set to parent domain for cookie to work across subdomains
    // e.g., ".eligibility.practicefusionpm.com" for both frontend and api subdomains
    domain: domain || undefined,
    maxAge: expiresInSeconds,
  };
}
