/**
 * Tests for EHR Credentials Service
 *
 * These tests verify:
 * 1. Pattern matching for issuer URLs
 * 2. Explicit error handling when credentials missing
 * 3. Startup validation (at least one EHR required)
 * 4. NO FALLBACKS policy enforcement
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock environment variables
const originalEnv = process.env;

// Import after environment is set up
let getCredentialsForIssuer: (iss: string) => { clientId: string; clientSecret: string; scopes: string; ehrName: string; usePkce: boolean };
let validateEhrCredentials: () => string[];

beforeEach(async () => {
  // Reset modules to get fresh imports with new env vars
  jest.resetModules();
  process.env = { ...originalEnv };

  // Import functions dynamically after env is set
  const module = await import('../../services/ehr-credentials.js');
  getCredentialsForIssuer = module.getCredentialsForIssuer;
  validateEhrCredentials = module.validateEhrCredentials;
});

afterEach(() => {
  process.env = originalEnv;
});

describe('getCredentialsForIssuer', () => {
  describe('Practice Fusion pattern matching', () => {
    beforeEach(() => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
    });

    it('should match practicefusion.com domain', async () => {
      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.ehrName).toBe('PF');
      expect(result.clientId).toBe('pf-client-123');
      expect(result.clientSecret).toBe('pf-secret-456');
      expect(result.scopes).toBe('launch openid fhirUser');
    });

    it('should match practicefusion.com with subdomains', async () => {
      const result = getCredentialsForIssuer('https://api.practicefusion.com/fhir');

      expect(result.ehrName).toBe('PF');
    });

    it('should match practicefusion.com with paths', async () => {
      const result = getCredentialsForIssuer('https://fhir.practicefusion.com/tenant/123');

      expect(result.ehrName).toBe('PF');
    });

    it('should be case-insensitive', async () => {
      const result = getCredentialsForIssuer('https://fhir.PracticeFusion.COM');

      expect(result.ehrName).toBe('PF');
    });
  });

  describe('Veradigm/Allscripts pattern matching', () => {
    beforeEach(() => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser patient/Patient.read';
    });

    it('should match allscripts.com domain', async () => {
      const result = getCredentialsForIssuer('https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842');

      expect(result.ehrName).toBe('VERADIGM');
      expect(result.clientId).toBe('veradigm-client-789');
      expect(result.clientSecret).toBe('veradigm-secret-012');
      expect(result.scopes).toBe('launch openid fhirUser patient/Patient.read');
    });

    it('should match allscripts.com with subdomains', async () => {
      const result = getCredentialsForIssuer('https://api.allscripts.com');

      expect(result.ehrName).toBe('VERADIGM');
    });

    it('should be case-insensitive', async () => {
      const result = getCredentialsForIssuer('https://fhir.AllScripts.COM');

      expect(result.ehrName).toBe('VERADIGM');
    });
  });

  describe('error handling: unknown issuer', () => {
    beforeEach(() => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
    });

    it('should throw error for unknown issuer', async () => {
      expect(() => getCredentialsForIssuer('https://fhir.epic.com'))
        .toThrow('No EHR configuration found for issuer');
    });

    it('should include issuer in error message', async () => {
      expect(() => getCredentialsForIssuer('https://unknown.ehr.com'))
        .toThrow('https://unknown.ehr.com');
    });

    it('should suggest contacting administrator', async () => {
      expect(() => getCredentialsForIssuer('https://unknown.ehr.com'))
        .toThrow('contact the administrator');
    });
  });

  describe('error handling: incomplete credentials', () => {
    it('should throw error if clientId missing', async () => {
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
      // PF_CLIENT_ID missing

      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('Incomplete OAuth credentials for PF');
    });

    it('should throw error if clientSecret missing', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_SCOPES = 'launch openid fhirUser';
      // PF_CLIENT_SECRET missing

      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('Incomplete OAuth credentials for PF');
    });

    it('should throw error if scopes missing', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      // PF_SCOPES missing

      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('Incomplete OAuth credentials for PF');
    });

    it('should list missing variables in error message', async () => {
      process.env.PF_SCOPES = 'launch openid fhirUser';
      // PF_CLIENT_ID and PF_CLIENT_SECRET missing

      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('PF_CLIENT_ID');
      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('PF_CLIENT_SECRET');
    });
  });

  describe('NO FALLBACKS policy', () => {
    it('should not fallback to different EHR credentials', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
      // VERADIGM credentials NOT set

      // Should throw for Veradigm issuer even though PF credentials exist
      expect(() => getCredentialsForIssuer('https://fhir.allscripts.com'))
        .toThrow('Incomplete OAuth credentials for VERADIGM');
    });

    it('should not use empty string credentials', async () => {
      process.env.PF_CLIENT_ID = '';
      process.env.PF_CLIENT_SECRET = '';
      process.env.PF_SCOPES = '';

      expect(() => getCredentialsForIssuer('https://fhir.practicefusion.com'))
        .toThrow('Incomplete OAuth credentials');
    });
  });
});

describe('validateEhrCredentials', () => {
  describe('successful validation', () => {
    it('should pass with all PF credentials set', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';

      const errors = validateEhrCredentials();

      expect(errors).toEqual([]);
    });

    it('should pass with all Veradigm credentials set', async () => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser';

      const errors = validateEhrCredentials();

      expect(errors).toEqual([]);
    });

    it('should pass with both PF and Veradigm credentials set', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser';

      const errors = validateEhrCredentials();

      expect(errors).toEqual([]);
    });
  });

  describe('validation failures', () => {
    it('should fail if no EHR credentials configured', async () => {
      // No credentials set

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('No EHR OAuth credentials configured');
    });

    it('should require at least ONE complete EHR', async () => {
      // No credentials set

      const errors = validateEhrCredentials();

      expect(errors[0]).toContain('At least ONE EHR must be fully configured');
    });

    it('should warn about partial PF configuration', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      // PF_CLIENT_SECRET and PF_SCOPES missing

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Incomplete PF OAuth credentials'))).toBe(true);
    });

    it('should warn about partial Veradigm configuration', async () => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      // VERADIGM_CLIENT_SECRET and VERADIGM_SCOPES missing

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Incomplete VERADIGM OAuth credentials'))).toBe(true);
    });

    it('should list missing variables for partial configuration', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      // PF_CLIENT_SECRET and PF_SCOPES missing

      const errors = validateEhrCredentials();

      const pfError = errors.find(e => e.includes('PF'));
      expect(pfError).toContain('PF_CLIENT_SECRET');
      expect(pfError).toContain('PF_SCOPES');
    });
  });

  describe('mixed configuration scenarios', () => {
    it('should pass if PF complete and Veradigm not configured', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
      // No Veradigm credentials

      const errors = validateEhrCredentials();

      expect(errors).toEqual([]);
    });

    it('should pass if Veradigm complete and PF not configured', async () => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser';
      // No PF credentials

      const errors = validateEhrCredentials();

      expect(errors).toEqual([]);
    });

    it('should fail if PF partial and Veradigm not configured', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      // PF incomplete, no Veradigm

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Incomplete PF'))).toBe(true);
      expect(errors.some(e => e.includes('No EHR OAuth credentials configured'))).toBe(true);
    });

    it('should fail if both EHRs partially configured', async () => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      // Both incomplete

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Incomplete PF'))).toBe(true);
      expect(errors.some(e => e.includes('Incomplete VERADIGM'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should treat empty strings as missing', async () => {
      process.env.PF_CLIENT_ID = '';
      process.env.PF_CLIENT_SECRET = '';
      process.env.PF_SCOPES = '';

      const errors = validateEhrCredentials();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('No EHR OAuth credentials configured');
    });

    it('should accept whitespace-only strings as valid (JS quirk)', async () => {
      process.env.PF_CLIENT_ID = '   ';
      process.env.PF_CLIENT_SECRET = '   ';
      process.env.PF_SCOPES = '   ';

      const errors = validateEhrCredentials();

      // JavaScript treats whitespace strings as truthy, so validation passes
      // This is acceptable - EHR will reject invalid credentials at runtime
      expect(errors).toEqual([]);
    });
  });
});

describe('regression tests', () => {
  describe('existing Practice Fusion functionality', () => {
    beforeEach(() => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read user/Practitioner.read';
    });

    it('should maintain backward compatibility with existing PF integrations', async () => {
      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.ehrName).toBe('PF');
      expect(result.clientId).toBe('pf-client-123');
      expect(result.clientSecret).toBe('pf-secret-456');
      expect(result.scopes).toContain('patient/Patient.read');
      expect(result.scopes).toContain('patient/Coverage.read');
    });

    it('should work with typical PF issuer URLs', async () => {
      const urls = [
        'https://fhir.practicefusion.com',
        'https://api.practicefusion.com/fhir',
        'https://sandbox.practicefusion.com',
      ];

      urls.forEach(url => {
        const result = getCredentialsForIssuer(url);
        expect(result.ehrName).toBe('PF');
      });
    });
  });

  describe('new Veradigm functionality', () => {
    beforeEach(() => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read';
    });

    it('should support Veradigm production issuer URL', async () => {
      const result = getCredentialsForIssuer('https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842');

      expect(result.ehrName).toBe('VERADIGM');
      expect(result.clientId).toBe('veradigm-client-789');
      expect(result.clientSecret).toBe('veradigm-secret-012');
    });

    it('should work with various Allscripts URL formats', async () => {
      const urls = [
        'https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842',
        'https://api.allscripts.com',
        'https://sandbox.allscripts.com/fhir',
      ];

      urls.forEach(url => {
        const result = getCredentialsForIssuer(url);
        expect(result.ehrName).toBe('VERADIGM');
      });
    });
  });
});

describe('usePkce flag', () => {
  describe('Practice Fusion PKCE', () => {
    beforeEach(() => {
      process.env.PF_CLIENT_ID = 'pf-client-123';
      process.env.PF_CLIENT_SECRET = 'pf-secret-456';
      process.env.PF_SCOPES = 'launch openid fhirUser';
    });

    it('should return usePkce false by default (no env var)', async () => {
      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.usePkce).toBe(false);
    });

    it('should return usePkce true when PF_USE_PKCE=true', async () => {
      process.env.PF_USE_PKCE = 'true';

      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.usePkce).toBe(true);
    });

    it('should return usePkce false when PF_USE_PKCE=false', async () => {
      process.env.PF_USE_PKCE = 'false';

      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.usePkce).toBe(false);
    });

    it('should return usePkce false for non-"true" values', async () => {
      process.env.PF_USE_PKCE = 'yes';

      const result = getCredentialsForIssuer('https://fhir.practicefusion.com');

      expect(result.usePkce).toBe(false);
    });
  });

  describe('Veradigm PKCE', () => {
    beforeEach(() => {
      process.env.VERADIGM_CLIENT_ID = 'veradigm-client-789';
      process.env.VERADIGM_CLIENT_SECRET = 'veradigm-secret-012';
      process.env.VERADIGM_SCOPES = 'launch openid fhirUser';
    });

    it('should return usePkce false by default', async () => {
      const result = getCredentialsForIssuer('https://fhir.allscripts.com');

      expect(result.usePkce).toBe(false);
    });

    it('should return usePkce true when VERADIGM_USE_PKCE=true', async () => {
      process.env.VERADIGM_USE_PKCE = 'true';

      const result = getCredentialsForIssuer('https://fhir.allscripts.com');

      expect(result.usePkce).toBe(true);
    });
  });
});
