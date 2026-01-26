/**
 * PHI-Safe Logger Utility
 *
 * Provides logging functions that automatically redact sensitive health information.
 * Use this instead of console.log to ensure PHI is not leaked to logs.
 */

import type { FastifyBaseLogger } from 'fastify';

/**
 * PHI field patterns to redact
 */
const PHI_PATTERNS = {
  // Names: "John" -> "J***"
  name: /^[A-Za-z]{1}[A-Za-z]+$/,

  // Member IDs: "ABC123456789" -> "****6789"
  memberId: /^[A-Za-z0-9]{4,}$/,

  // SSN: "123-45-6789" -> "***-**-6789"
  ssn: /^\d{3}-?\d{2}-?\d{4}$/,

  // Date of birth: "1990-05-15" -> "[DOB]"
  dob: /^\d{4}-\d{2}-\d{2}$/,

  // NPI: "1234567890" -> "****7890"
  npi: /^\d{10}$/,
};

/**
 * Known PHI field names (case-insensitive partial match)
 */
const PHI_FIELD_NAMES = [
  'firstname',
  'lastname',
  'middlename',
  'name',
  'givenname',
  'familyname',
  'dob',
  'dateofbirth',
  'birthdate',
  'ssn',
  'socialsecurity',
  'memberid',
  'subscriberid',
  'patientid',
  'address',
  'street',
  'phone',
  'email',
  'fax',
];

/**
 * Check if a field name is likely to contain PHI
 */
function isPHIFieldName(fieldName: string): boolean {
  const lower = fieldName.toLowerCase().replace(/[_-]/g, '');
  return PHI_FIELD_NAMES.some(pattern => lower.includes(pattern));
}

/**
 * Mask a name: "John" -> "J***"
 */
function maskName(value: string): string {
  if (!value || value.length < 2) return '***';
  return value.charAt(0) + '***';
}

/**
 * Mask an ID: "ABC123456789" -> "****6789"
 */
function maskId(value: string): string {
  if (!value || value.length < 5) return '****';
  return '****' + value.slice(-4);
}

/**
 * Mask a date: "1990-05-15" -> "[DATE]"
 */
function maskDate(): string {
  return '[REDACTED]';
}

/**
 * Redact a single value based on its field name
 */
function redactValue(fieldName: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item, idx) => redactValue(`${fieldName}[${idx}]`, item));
  }

  // Handle objects recursively
  if (typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }

  // Handle strings
  if (typeof value === 'string') {
    const lowerField = fieldName.toLowerCase().replace(/[_-]/g, '');

    // Check by field name
    if (lowerField.includes('firstname') || lowerField.includes('lastname') ||
        lowerField.includes('givenname') || lowerField.includes('familyname') ||
        lowerField === 'name') {
      return maskName(value);
    }

    if (lowerField.includes('memberid') || lowerField.includes('subscriberid')) {
      return maskId(value);
    }

    if (lowerField.includes('ssn') || lowerField.includes('socialsecurity')) {
      if (value.length >= 9) {
        return '***-**-' + value.slice(-4).replace(/\D/g, '');
      }
      return '****';
    }

    if (lowerField.includes('dob') || lowerField.includes('birthdate') ||
        lowerField.includes('dateofbirth')) {
      return maskDate();
    }

    if (lowerField.includes('address') || lowerField.includes('street')) {
      return '[ADDRESS]';
    }

    if (lowerField.includes('phone') || lowerField.includes('fax')) {
      return '[PHONE]';
    }

    if (lowerField.includes('email')) {
      return '[EMAIL]';
    }

    // Check by value pattern if field name doesn't match
    if (PHI_PATTERNS.dob.test(value)) {
      return maskDate();
    }

    if (PHI_PATTERNS.ssn.test(value.replace(/-/g, ''))) {
      return '***-**-' + value.slice(-4).replace(/\D/g, '');
    }

    if (PHI_PATTERNS.npi.test(value) && lowerField.includes('npi')) {
      return maskId(value);
    }
  }

  return value;
}

/**
 * Redact PHI from an object recursively
 */
export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip null/undefined
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // Redact based on field name and value
    result[key] = redactValue(key, value);
  }

  return result as T;
}

/**
 * Create a PHI-safe logger wrapper around Fastify logger
 * Pass the fastify instance to get the logger
 */
export function createSafeLogger(baseLogger: FastifyBaseLogger) {
  return {
    /**
     * Log info with automatic PHI redaction
     */
    info(obj: Record<string, unknown>, msg?: string) {
      baseLogger.info(redactObject(obj), msg);
    },

    /**
     * Log debug with automatic PHI redaction
     */
    debug(obj: Record<string, unknown>, msg?: string) {
      baseLogger.debug(redactObject(obj), msg);
    },

    /**
     * Log warn with automatic PHI redaction
     */
    warn(obj: Record<string, unknown>, msg?: string) {
      baseLogger.warn(redactObject(obj), msg);
    },

    /**
     * Log error with automatic PHI redaction
     */
    error(obj: Record<string, unknown>, msg?: string) {
      baseLogger.error(redactObject(obj), msg);
    },

    /**
     * Raw logger access (use with caution - no redaction)
     */
    raw: baseLogger,
  };
}

/**
 * Standalone logger for services without Fastify context
 * Uses console but formats as JSON and redacts PHI
 */
export const serviceLogger = {
  info(obj: Record<string, unknown>, msg?: string) {
    const redacted = redactObject(obj);
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ level: 'info', time: timestamp, msg, ...redacted }));
  },

  debug(obj: Record<string, unknown>, msg?: string) {
    if (process.env.NODE_ENV === 'development') {
      const redacted = redactObject(obj);
      const timestamp = new Date().toISOString();
      console.log(JSON.stringify({ level: 'debug', time: timestamp, msg, ...redacted }));
    }
  },

  warn(obj: Record<string, unknown>, msg?: string) {
    const redacted = redactObject(obj);
    const timestamp = new Date().toISOString();
    console.warn(JSON.stringify({ level: 'warn', time: timestamp, msg, ...redacted }));
  },

  error(obj: Record<string, unknown>, msg?: string) {
    const redacted = redactObject(obj);
    const timestamp = new Date().toISOString();
    console.error(JSON.stringify({ level: 'error', time: timestamp, msg, ...redacted }));
  },
};

export type SafeLogger = ReturnType<typeof createSafeLogger>;
