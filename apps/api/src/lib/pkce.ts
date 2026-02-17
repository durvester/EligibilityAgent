/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
 *
 * Implements RFC 7636 with S256 challenge method.
 * Uses Node.js crypto for cryptographically secure random generation.
 */

import crypto from 'crypto';

/**
 * Generate a cryptographically random code verifier.
 * Per RFC 7636, must be 43-128 characters, using unreserved characters [A-Z, a-z, 0-9, "-", ".", "_", "~"].
 *
 * @param length - Number of random bytes (default 32, producing 43 base64url chars)
 * @returns URL-safe base64-encoded random string
 */
export function generateCodeVerifier(length = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Generate a code challenge from a code verifier using S256 method.
 * SHA-256 hash of the verifier, base64url-encoded without padding.
 *
 * @param verifier - The code verifier string
 * @returns base64url-encoded SHA-256 hash (43 characters)
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
