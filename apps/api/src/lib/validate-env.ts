/**
 * Environment Variable Validation
 *
 * Validates required environment variables at startup.
 * Fails fast with clear error messages if configuration is missing.
 *
 * NO FALLBACKS POLICY:
 * - All required variables must be set explicitly
 * - Development and production have the same requirements
 * - Fail at startup, not at runtime
 */

import { serviceLogger } from './logger.js';

interface EnvValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate all required environment variables.
 * Call this before starting the server.
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];

  // === Required API keys ===
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required for the eligibility agent');
  }

  if (!process.env.STEDI_API_KEY) {
    errors.push('STEDI_API_KEY is required for eligibility checks');
  }

  // === Required OAuth configuration ===
  if (!process.env.PF_CLIENT_ID) {
    errors.push('PF_CLIENT_ID is required for EHR OAuth');
  }

  if (!process.env.PF_CLIENT_SECRET) {
    errors.push('PF_CLIENT_SECRET is required for EHR OAuth');
  }

  if (!process.env.PF_SCOPES) {
    errors.push(
      'PF_SCOPES is required. ' +
        'Recommended: launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read'
    );
  }

  // === Required database configuration ===
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required for session and audit storage');
  }

  if (!process.env.ENCRYPTION_KEY) {
    errors.push(
      'ENCRYPTION_KEY is required for token encryption. ' +
        'Generate with: openssl rand -base64 32'
    );
  }

  // === Required JWT configuration ===
  if (!process.env.JWT_SECRET) {
    errors.push(
      'JWT_SECRET is required for internal authentication. ' +
        'Generate with: openssl rand -base64 64'
    );
  }

  // === Required Redis configuration ===
  if (!process.env.UPSTASH_REDIS_URL) {
    errors.push(
      'UPSTASH_REDIS_URL is required for caching. ' +
        'Create a free Upstash account at https://upstash.com'
    );
  }

  if (!process.env.UPSTASH_REDIS_TOKEN) {
    errors.push(
      'UPSTASH_REDIS_TOKEN is required for caching. ' +
        'Create a free Upstash account at https://upstash.com'
    );
  }

  // === Required URL configuration ===
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    errors.push('NEXT_PUBLIC_APP_URL is required for OAuth redirects');
  }

  // Note: NEXT_PUBLIC_API_URL is a frontend-only variable for SSE streaming
  // It's not needed by the API itself

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate environment and exit if invalid.
 * Use this in the main server startup.
 */
export function validateEnvironmentOrExit(): void {
  const result = validateEnvironment();

  // Exit on errors
  if (!result.valid) {
    serviceLogger.error(
      { errors: result.errors },
      'Missing required environment variables'
    );

    // Also log to console for visibility during startup
    console.error('\n[ENV ERROR] Missing required environment variables:\n');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    console.error(
      '\nPlease configure the required environment variables and restart.\n'
    );
    process.exit(1);
  }

  serviceLogger.info({}, 'Environment validation passed');
}

/**
 * Get a required environment variable or throw.
 * Use this for runtime access when you need to ensure a variable exists.
 */
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}
