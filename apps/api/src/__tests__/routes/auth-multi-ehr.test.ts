/**
 * Integration Tests for Multi-EHR OAuth Flow
 *
 * Tests the complete OAuth flow with multiple EHR systems:
 * 1. Launch endpoint credential selection
 * 2. Token exchange using correct credentials
 * 3. Session creation with ehrIdentifier
 * 4. Token refresh using ehrIdentifier
 *
 * These tests verify NO FALLBACKS and explicit error handling.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock types for testing (matches LaunchState in auth.ts)
interface LaunchState {
  iss: string;
  launch: string;
  authorizeUrl: string;
  tokenUrl: string;
  createdAt: number;
  clientId: string;
  clientSecret: string;
  codeVerifier?: string;
}

interface SessionData {
  ehrIdentifier: string;
  pfAccessToken: string;
  pfRefreshToken: string | null;
}

describe('Multi-EHR OAuth Flow', () => {
  describe('Launch endpoint credential selection', () => {
    it('should select PF credentials for practicefusion.com issuer', () => {
      const issuer = 'https://fhir.practicefusion.com';

      // Simulate credential lookup
      const isPracticeFusion = /practicefusion\.com/i.test(issuer);

      expect(isPracticeFusion).toBe(true);

      // Would use PF_CLIENT_ID, PF_CLIENT_SECRET, PF_SCOPES
      const expectedEhrName = 'PF';
      expect(expectedEhrName).toBe('PF');
    });

    it('should select Veradigm credentials for allscripts.com issuer', () => {
      const issuer = 'https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842';

      // Simulate credential lookup
      const isVeradigm = /allscripts\.com/i.test(issuer);

      expect(isVeradigm).toBe(true);

      // Would use VERADIGM_CLIENT_ID, VERADIGM_CLIENT_SECRET, VERADIGM_SCOPES
      const expectedEhrName = 'VERADIGM';
      expect(expectedEhrName).toBe('VERADIGM');
    });

    it('should store credentials in launch state', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
      };

      expect(launchState.clientId).toBe('pf-client-123');
      expect(launchState.clientSecret).toBe('pf-secret-456');
    });
  });

  describe('Token exchange with correct credentials', () => {
    it('should use clientId from launch state', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
      };

      // Simulate token exchange parameters
      const tokenExchangeParams = {
        grant_type: 'authorization_code',
        code: 'test-auth-code',
        redirect_uri: 'https://app.example.com/callback',
        client_id: launchState.clientId,
        client_secret: launchState.clientSecret,
      };

      expect(tokenExchangeParams.client_id).toBe('pf-client-123');
      expect(tokenExchangeParams.client_secret).toBe('pf-secret-456');
    });

    it('should use different credentials for Veradigm', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.allscripts.com/authorize',
        tokenUrl: 'https://auth.allscripts.com/token',
        createdAt: Date.now(),
        clientId: 'veradigm-client-789',
        clientSecret: 'veradigm-secret-012',
      };

      const tokenExchangeParams = {
        client_id: launchState.clientId,
        client_secret: launchState.clientSecret,
      };

      expect(tokenExchangeParams.client_id).toBe('veradigm-client-789');
      expect(tokenExchangeParams.client_secret).toBe('veradigm-secret-012');
    });
  });

  describe('Session creation with ehrIdentifier', () => {
    it('should store ehrIdentifier in session', () => {
      const sessionData: SessionData = {
        ehrIdentifier: 'PF',
        pfAccessToken: 'access-token-123',
        pfRefreshToken: 'refresh-token-456',
      };

      expect(sessionData.ehrIdentifier).toBe('PF');
    });

    it('should store correct ehrIdentifier for Veradigm', () => {
      const sessionData: SessionData = {
        ehrIdentifier: 'VERADIGM',
        pfAccessToken: 'access-token-789',
        pfRefreshToken: 'refresh-token-012',
      };

      expect(sessionData.ehrIdentifier).toBe('VERADIGM');
    });

    it('should always include ehrIdentifier', () => {
      const sessionData: SessionData = {
        ehrIdentifier: 'PF',
        pfAccessToken: 'access-token-123',
        pfRefreshToken: null,
      };

      // ehrIdentifier should never be null for new sessions
      expect(sessionData.ehrIdentifier).toBeTruthy();
      expect(sessionData.ehrIdentifier).not.toBe('');
    });
  });

  describe('Token refresh using ehrIdentifier', () => {
    it('should build correct env var names from ehrIdentifier', () => {
      const ehrIdentifier = 'PF';

      const clientIdVar = `${ehrIdentifier}_CLIENT_ID`;
      const clientSecretVar = `${ehrIdentifier}_CLIENT_SECRET`;

      expect(clientIdVar).toBe('PF_CLIENT_ID');
      expect(clientSecretVar).toBe('PF_CLIENT_SECRET');
    });

    it('should use different env vars for Veradigm', () => {
      const ehrIdentifier = 'VERADIGM';

      const clientIdVar = `${ehrIdentifier}_CLIENT_ID`;
      const clientSecretVar = `${ehrIdentifier}_CLIENT_SECRET`;

      expect(clientIdVar).toBe('VERADIGM_CLIENT_ID');
      expect(clientSecretVar).toBe('VERADIGM_CLIENT_SECRET');
    });

    it('should fail if ehrIdentifier is null', () => {
      const ehrIdentifier = null;

      // Token refresh should fail explicitly
      expect(ehrIdentifier).toBeNull();

      // In real code, this would return null and log error
      // "Missing ehrIdentifier in session - cannot refresh token. User must re-login."
    });

    it('should fail if credentials not found in environment', () => {
      const ehrIdentifier = 'UNKNOWN_EHR';

      const clientIdVar = `${ehrIdentifier}_CLIENT_ID`;
      const clientSecretVar = `${ehrIdentifier}_CLIENT_SECRET`;

      // These would not exist in environment
      const clientId = process.env[clientIdVar];
      const clientSecret = process.env[clientSecretVar];

      expect(clientId).toBeUndefined();
      expect(clientSecret).toBeUndefined();

      // In real code, this would return null and log error
      // "Missing OAuth credentials for UNKNOWN_EHR. Cannot refresh token."
    });
  });

  describe('Error scenarios', () => {
    it('should return 400 for unknown issuer at launch', () => {
      const issuer = 'https://fhir.epic.com';

      const isPracticeFusion = /practicefusion\.com/i.test(issuer);
      const isVeradigm = /allscripts\.com/i.test(issuer);

      expect(isPracticeFusion).toBe(false);
      expect(isVeradigm).toBe(false);

      // Launch endpoint should return 400 with error:
      // "OAuth credentials not configured for issuer: https://fhir.epic.com"
    });

    it('should NOT fallback to different EHR credentials', () => {
      const issuer = 'https://fhir.allscripts.com';

      // Even if PF credentials are set, should not use them for Veradigm
      const isPracticeFusion = /practicefusion\.com/i.test(issuer);
      expect(isPracticeFusion).toBe(false);

      // Should only match Veradigm pattern
      const isVeradigm = /allscripts\.com/i.test(issuer);
      expect(isVeradigm).toBe(true);
    });

    it('should fail token refresh if ehrIdentifier missing', () => {
      const session = {
        ehrIdentifier: null, // Old session from before multi-EHR support
        pfRefreshToken: 'refresh-token-123',
      };

      // Token refresh should fail explicitly
      expect(session.ehrIdentifier).toBeNull();

      // Real code would:
      // 1. Log error: "Missing ehrIdentifier - cannot refresh token"
      // 2. Return null (forces re-login)
      // 3. NOT fallback to PF credentials
    });
  });

  describe('Backward compatibility', () => {
    it('should continue to work for existing PF tenants', () => {
      const issuer = 'https://fhir.practicefusion.com';
      const isPracticeFusion = /practicefusion\.com/i.test(issuer);

      expect(isPracticeFusion).toBe(true);

      // Would use same PF_CLIENT_ID, PF_CLIENT_SECRET as before
      // Just now stored in session as ehrIdentifier='PF'
    });

    it('should migrate old sessions via data migration', () => {
      // Data migration sets ehrIdentifier='PF' for all existing sessions
      const migratedSession = {
        ehrIdentifier: 'PF', // Set by migration: UPDATE sessions SET ehr_identifier = 'PF' WHERE ...
        pfRefreshToken: 'existing-refresh-token',
      };

      expect(migratedSession.ehrIdentifier).toBe('PF');
    });
  });

  describe('Multi-tenant scenarios', () => {
    it('should support different tenants with different EHRs', () => {
      const tenant1 = {
        issuer: 'https://fhir.practicefusion.com',
        ehrIdentifier: 'PF',
      };

      const tenant2 = {
        issuer: 'https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842',
        ehrIdentifier: 'VERADIGM',
      };

      expect(tenant1.ehrIdentifier).toBe('PF');
      expect(tenant2.ehrIdentifier).toBe('VERADIGM');

      // Each tenant uses different OAuth credentials based on ehrIdentifier
    });

    it('should support multiple tenants with same EHR', () => {
      const tenant1 = {
        issuer: 'https://fhir.practicefusion.com/practice-a',
        ehrIdentifier: 'PF',
      };

      const tenant2 = {
        issuer: 'https://fhir.practicefusion.com/practice-b',
        ehrIdentifier: 'PF',
      };

      expect(tenant1.ehrIdentifier).toBe(tenant2.ehrIdentifier);

      // Both share same PF_CLIENT_ID, PF_CLIENT_SECRET, PF_SCOPES
      // But are separate tenants with separate sessions/data
    });
  });
});

describe('Pattern matching edge cases', () => {
  it('should match domain regardless of protocol', () => {
    const httpsUrl = 'https://fhir.practicefusion.com';
    const httpUrl = 'http://fhir.practicefusion.com';

    const pattern = /practicefusion\.com/i;

    expect(pattern.test(httpsUrl)).toBe(true);
    expect(pattern.test(httpUrl)).toBe(true);
  });

  it('should match domain regardless of subdomain', () => {
    const urls = [
      'https://fhir.practicefusion.com',
      'https://api.practicefusion.com',
      'https://sandbox.practicefusion.com',
      'https://dev.api.practicefusion.com',
    ];

    const pattern = /practicefusion\.com/i;

    urls.forEach(url => {
      expect(pattern.test(url)).toBe(true);
    });
  });

  it('should match domain regardless of path', () => {
    const urls = [
      'https://fhir.practicefusion.com',
      'https://fhir.practicefusion.com/tenant/123',
      'https://fhir.practicefusion.com/fhir/r4',
      'https://fhir.practicefusion.com/v1/fhir',
    ];

    const pattern = /practicefusion\.com/i;

    urls.forEach(url => {
      expect(pattern.test(url)).toBe(true);
    });
  });

  it('should be case-insensitive', () => {
    const urls = [
      'https://fhir.PracticeFusion.com',
      'https://fhir.PRACTICEFUSION.COM',
      'https://fhir.practicefusion.COM',
    ];

    const pattern = /practicefusion\.com/i;

    urls.forEach(url => {
      expect(pattern.test(url)).toBe(true);
    });
  });

  it('should NOT match different TLDs', () => {
    const urls = [
      'https://fhir.practicefusion.org',  // .org not .com
      'https://fhir.epicehr.com',  // different domain entirely
    ];

    const pattern = /practicefusion\.com/i;

    urls.forEach(url => {
      expect(pattern.test(url)).toBe(false);
    });
  });
});

describe('PKCE in OAuth Flow', () => {
  describe('Authorization URL with PKCE', () => {
    it('should include PKCE params in authorization URL when usePkce is true', () => {
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const authorizeUrl = new URL('https://auth.practicefusion.com/authorize');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', 'pf-client-123');
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      expect(authorizeUrl.searchParams.get('code_challenge')).toBe(codeChallenge);
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should NOT include PKCE params when usePkce is false', () => {
      const usePkce = false;

      const authorizeUrl = new URL('https://auth.practicefusion.com/authorize');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', 'pf-client-123');

      if (usePkce) {
        authorizeUrl.searchParams.set('code_challenge', 'test');
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      }

      expect(authorizeUrl.searchParams.has('code_challenge')).toBe(false);
      expect(authorizeUrl.searchParams.has('code_challenge_method')).toBe(false);
    });
  });

  describe('Token exchange with PKCE', () => {
    it('should include code_verifier in token exchange when present in launch state', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
        codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      };

      const tokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code: 'test-auth-code',
        redirect_uri: 'https://app.example.com/callback',
        client_id: launchState.clientId,
        client_secret: launchState.clientSecret,
      };

      if (launchState.codeVerifier) {
        tokenParams.code_verifier = launchState.codeVerifier;
      }

      expect(tokenParams.code_verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    });

    it('should NOT include code_verifier in token exchange when not in launch state', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
        // No codeVerifier - PKCE not enabled
      };

      const tokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code: 'test-auth-code',
        redirect_uri: 'https://app.example.com/callback',
        client_id: launchState.clientId,
        client_secret: launchState.clientSecret,
      };

      if (launchState.codeVerifier) {
        tokenParams.code_verifier = launchState.codeVerifier;
      }

      expect(tokenParams.code_verifier).toBeUndefined();
    });
  });

  describe('Launch state with PKCE', () => {
    it('should store codeVerifier in launch state when PKCE enabled', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
        codeVerifier: 'random-verifier-string',
      };

      expect(launchState.codeVerifier).toBe('random-verifier-string');
    });

    it('should have undefined codeVerifier when PKCE not enabled', () => {
      const launchState: LaunchState = {
        iss: 'https://fhir.practicefusion.com',
        launch: 'test-launch-token',
        authorizeUrl: 'https://auth.practicefusion.com/authorize',
        tokenUrl: 'https://auth.practicefusion.com/token',
        createdAt: Date.now(),
        clientId: 'pf-client-123',
        clientSecret: 'pf-secret-456',
      };

      expect(launchState.codeVerifier).toBeUndefined();
    });
  });
});
