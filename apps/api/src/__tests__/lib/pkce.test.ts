/**
 * Tests for PKCE (Proof Key for Code Exchange) utilities
 *
 * Verifies RFC 7636 compliance:
 * - Code verifier: cryptographically random, URL-safe, 43-128 chars
 * - Code challenge: deterministic SHA-256 hash, base64url-encoded, 43 chars
 */

import { describe, it, expect } from '@jest/globals';
import { generateCodeVerifier, generateCodeChallenge } from '../../lib/pkce.js';

describe('generateCodeVerifier', () => {
  it('should generate a string between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('should generate URL-safe characters only', () => {
    const verifier = generateCodeVerifier();

    // base64url alphabet: A-Z, a-z, 0-9, -, _
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should generate unique verifiers on each call', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();

    expect(verifier1).not.toBe(verifier2);
  });

  it('should accept custom length parameter', () => {
    const verifier = generateCodeVerifier(64);

    // 64 bytes -> ~86 base64url chars
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });
});

describe('generateCodeChallenge', () => {
  it('should produce a 43-character string', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // SHA-256 produces 32 bytes -> 43 base64url chars (no padding)
    expect(challenge.length).toBe(43);
  });

  it('should produce URL-safe characters only', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should be deterministic (same verifier produces same challenge)', () => {
    const verifier = generateCodeVerifier();
    const challenge1 = generateCodeChallenge(verifier);
    const challenge2 = generateCodeChallenge(verifier);

    expect(challenge1).toBe(challenge2);
  });

  it('should produce different challenges for different verifiers', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();
    const challenge1 = generateCodeChallenge(verifier1);
    const challenge2 = generateCodeChallenge(verifier2);

    expect(challenge1).not.toBe(challenge2);
  });

  it('should match known SHA-256 test vector', () => {
    // RFC 7636 Appendix B test vector
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = generateCodeChallenge(verifier);

    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
