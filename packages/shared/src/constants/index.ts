// X12 Service Type Codes
export const SERVICE_TYPES = {
  '30': 'Health Benefit Plan Coverage',
  '1': 'Medical Care',
  '2': 'Surgical',
  '3': 'Consultation',
  '4': 'Diagnostic X-Ray',
  '5': 'Diagnostic Lab',
  '6': 'Radiation Therapy',
  '7': 'Anesthesia',
  '8': 'Surgical Assistance',
  '12': 'Durable Medical Equipment Purchase',
  '14': 'Renal Supplies in the Home',
  '18': 'Durable Medical Equipment Rental',
  '33': 'Chiropractic',
  '35': 'Dental Care',
  '37': 'Vision (Optometry)',
  '42': 'Home Health Care',
  '45': 'Hospice',
  '47': 'Hospital',
  '48': 'Hospital - Inpatient',
  '50': 'Hospital - Outpatient',
  '51': 'Hospital - Emergency',
  '52': 'Hospital - Emergency Medical',
  '53': 'Hospital - Ambulatory Surgical',
  '54': 'Long Term Care',
  '56': 'Major Medical',
  '60': 'Mental Health',
  '61': 'Inpatient Mental Health',
  '62': 'Outpatient Mental Health',
  '63': 'Mental Health Facility - Inpatient',
  '64': 'Mental Health Facility - Outpatient',
  '65': 'Substance Abuse',
  '66': 'Inpatient Substance Abuse',
  '67': 'Outpatient Substance Abuse',
  '68': 'Substance Abuse Facility - Inpatient',
  '69': 'Substance Abuse Facility - Outpatient',
  '73': 'Physical Therapy',
  '76': 'Occupational Therapy',
  '78': 'Speech Therapy',
  '86': 'Emergency Services',
  '88': 'Pharmacy',
  '98': 'Professional (Physician) Visit - Office',
  'AL': 'Vision (Optometry)',
  'MH': 'Mental Health',
  'UC': 'Urgent Care',
} as const;

export type ServiceTypeCode = keyof typeof SERVICE_TYPES;

// FHIR Identifier Systems
export const FHIR_SYSTEMS = {
  NPI: 'http://hl7.org/fhir/sid/us-npi',
  SSN: 'http://hl7.org/fhir/sid/us-ssn',
  MEMBER_ID: 'http://terminology.hl7.org/CodeSystem/v2-0203',
} as const;

// Coverage Relationship Codes
export const COVERAGE_RELATIONSHIPS = {
  self: 'Self',
  spouse: 'Spouse',
  child: 'Child',
  other: 'Other',
} as const;

// Error Codes
export const ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FHIR_ERROR: 'FHIR_ERROR',
  STEDI_ERROR: 'STEDI_ERROR',
  NPI_INVALID: 'NPI_INVALID',
  PAYER_NOT_FOUND: 'PAYER_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AGENT_ERROR: 'AGENT_ERROR',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_MAX_CALLS: 'AGENT_MAX_CALLS',
} as const;

// Agent Limits
export const AGENT_LIMITS = {
  MAX_STEDI_CALLS: 10,
  MAX_TURNS: 15,
  MAX_RETRY_ATTEMPTS: 3,
  TIMEOUT_MS: 180000, // 3 minutes
} as const;

// Agent Event Types
export const AGENT_EVENT_TYPES = {
  STREAM: 'stream',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;
