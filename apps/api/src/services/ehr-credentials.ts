/**
 * EHR Credentials Service
 *
 * Maps FHIR issuer URLs to OAuth credentials using pattern matching.
 * Follows the "NO FALLBACKS" principle - explicitly fails when credentials are missing.
 *
 * Architecture:
 * - Each EHR vendor has a regex pattern for issuer URL matching
 * - Credentials are stored in environment variables with vendor-specific prefixes
 * - At startup, validates that at least ONE EHR's credentials are configured
 * - At runtime, throws explicit error if no credentials found for issuer
 *
 * Adding new EHR systems:
 * 1. Add pattern to EHR_CONFIGS array
 * 2. Set environment variables: {PREFIX}_CLIENT_ID, {PREFIX}_CLIENT_SECRET, {PREFIX}_SCOPES
 * 3. Restart application
 */

import { serviceLogger } from '../lib/logger.js';

export interface EhrCredentials {
  clientId: string;
  clientSecret: string;
  scopes: string;
  ehrName: string;
}

interface EhrConfig {
  name: string; // Env var prefix (e.g., 'PF', 'VERADIGM')
  issMatch: RegExp; // Regex pattern for issuer URL matching
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  scopes: () => string | undefined;
}

/**
 * EHR system configurations.
 * Pattern matching inspired by SMART client library's issMatch pattern (v2.3.11+).
 * See: http://docs.smarthealthit.org/client-js/api.html
 *
 * Matching strategy: Simple domain-level matching (not subdomain-specific).
 * Example: "practicefusion.com" matches any URL containing that domain.
 */
const EHR_CONFIGS: EhrConfig[] = [
  {
    name: 'PF',
    issMatch: /practicefusion\.com/i,
    clientId: () => process.env.PF_CLIENT_ID,
    clientSecret: () => process.env.PF_CLIENT_SECRET,
    scopes: () => process.env.PF_SCOPES,
  },
  {
    name: 'VERADIGM',
    issMatch: /allscripts\.com/i, // Veradigm was formerly Allscripts
    clientId: () => process.env.VERADIGM_CLIENT_ID,
    clientSecret: () => process.env.VERADIGM_CLIENT_SECRET,
    scopes: () => process.env.VERADIGM_SCOPES,
  },
  // Add more EHR systems here as needed:
  // {
  //   name: 'EPIC',
  //   issMatch: /epic\.com/i,
  //   clientId: () => process.env.EPIC_CLIENT_ID,
  //   clientSecret: () => process.env.EPIC_CLIENT_SECRET,
  //   scopes: () => process.env.EPIC_SCOPES,
  // },
];

/**
 * Get OAuth credentials for a FHIR issuer URL.
 * Uses pattern matching to detect EHR vendor and retrieve credentials.
 *
 * @param iss - FHIR issuer URL (e.g., "https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842")
 * @returns OAuth credentials for the matched EHR system
 * @throws Error if no EHR configuration matches the issuer
 * @throws Error if matched EHR has incomplete credentials
 *
 * @example
 * // Veradigm production URL
 * const creds = getCredentialsForIssuer(
 *   'https://fhir.fhirpoint.open.allscripts.com/fhirroute/fhir/10552842'
 * );
 * // Returns: { clientId: '...', clientSecret: '...', scopes: '...', ehrName: 'VERADIGM' }
 *
 * @example
 * // Practice Fusion URL
 * const creds = getCredentialsForIssuer('https://fhir.practicefusion.com');
 * // Returns: { clientId: '...', clientSecret: '...', scopes: '...', ehrName: 'PF' }
 */
export function getCredentialsForIssuer(iss: string): EhrCredentials {
  // Find matching EHR configuration
  const config = EHR_CONFIGS.find((c) => c.issMatch.test(iss));

  if (!config) {
    throw new Error(
      `No EHR configuration found for issuer: ${iss}. ` +
        'Please contact the administrator to register this EHR system.'
    );
  }

  // Retrieve credentials from environment
  const clientId = config.clientId();
  const clientSecret = config.clientSecret();
  const scopes = config.scopes();

  // Validate credentials are complete
  if (!clientId || !clientSecret || !scopes) {
    const missing: string[] = [];
    if (!clientId) missing.push(`${config.name}_CLIENT_ID`);
    if (!clientSecret) missing.push(`${config.name}_CLIENT_SECRET`);
    if (!scopes) missing.push(`${config.name}_SCOPES`);

    throw new Error(
      `Incomplete OAuth credentials for ${config.name} EHR. Missing: ${missing.join(', ')}. ` +
        'Please set these environment variables and restart the application.'
    );
  }

  serviceLogger.info({ ehrName: config.name, iss }, 'Using EHR OAuth credentials');

  return {
    clientId,
    clientSecret,
    scopes,
    ehrName: config.name,
  };
}

/**
 * Validate EHR credentials at startup.
 * Returns array of error messages for missing/incomplete credentials.
 * At least ONE EHR's credentials must be fully configured.
 *
 * @returns Array of error messages (empty if validation passes)
 */
export function validateEhrCredentials(): string[] {
  const errors: string[] = [];
  const configured: string[] = [];

  // Check each EHR configuration
  for (const config of EHR_CONFIGS) {
    const clientId = config.clientId();
    const clientSecret = config.clientSecret();
    const scopes = config.scopes();

    const hasAll = !!(clientId && clientSecret && scopes);
    const hasAny = !!(clientId || clientSecret || scopes);

    if (hasAll) {
      configured.push(config.name);
    } else if (hasAny) {
      // Partial configuration - warn about missing pieces
      const missing: string[] = [];
      if (!clientId) missing.push(`${config.name}_CLIENT_ID`);
      if (!clientSecret) missing.push(`${config.name}_CLIENT_SECRET`);
      if (!scopes) missing.push(`${config.name}_SCOPES`);

      errors.push(
        `Incomplete ${config.name} OAuth credentials. Missing: ${missing.join(', ')}. ` +
          'Either set all three variables or remove all to skip this EHR.'
      );
    }
  }

  // Require at least ONE fully configured EHR
  if (configured.length === 0) {
    errors.push(
      'No EHR OAuth credentials configured. At least ONE EHR must be fully configured. ' +
        'Available EHR systems: ' +
        EHR_CONFIGS.map((c) => c.name).join(', ') +
        '. ' +
        'Set {PREFIX}_CLIENT_ID, {PREFIX}_CLIENT_SECRET, and {PREFIX}_SCOPES for at least one EHR.'
    );
  } else {
    // Log configured EHR systems
    serviceLogger.info({ configured }, 'EHR credentials validation passed');
  }

  return errors;
}
