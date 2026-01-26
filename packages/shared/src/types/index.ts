// SMART on FHIR Types
export interface SmartLaunchContext {
  iss: string;
  launch: string;
  state?: string;
}

export interface SmartTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
  patient?: string;
  id_token?: string;
}

// FHIR R4 Types
export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: FhirAddress[];
}

export interface FhirCoverage {
  resourceType: 'Coverage';
  id: string;
  status: 'active' | 'cancelled' | 'draft' | 'entered-in-error';
  identifier?: FhirIdentifier[];
  subscriberId?: string;
  beneficiary: FhirReference;
  payor: FhirReference[];
  class?: FhirCoverageClass[];
  period?: FhirPeriod;
}

export interface FhirPractitioner {
  resourceType: 'Practitioner';
  id: string;
  identifier?: FhirIdentifier[];
  active?: boolean;
  name?: FhirHumanName[];
  qualification?: FhirPractitionerQualification[];
}

export interface FhirIdentifier {
  use?: string;
  type?: FhirCodeableConcept;
  system?: string;
  value?: string;
}

export interface FhirHumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface FhirAddress {
  use?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FhirContactPoint {
  system?: string;
  value?: string;
  use?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirReference {
  reference?: string;
  display?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirCoverageClass {
  type: FhirCodeableConcept;
  value: string;
  name?: string;
}

export interface FhirPractitionerQualification {
  identifier?: FhirIdentifier[];
  code: FhirCodeableConcept;
}

// App Domain Types
export interface PatientInfo {
  fhirId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | 'U';
  ssn?: string; // Last 4 digits or full SSN if available
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  phone?: string;
}

export interface InsuranceInfo {
  payerName: string;
  payerId?: string;
  stediPayerId?: string;
  memberId: string;
  groupNumber?: string;
  subscriberRelationship?: 'self' | 'spouse' | 'child' | 'other';
  effectiveDate?: string;
  terminationDate?: string;
}

export interface ProviderInfo {
  fhirId?: string;
  npi: string;
  firstName: string;
  lastName: string;
  credentials?: string;
  specialty?: string;
  organizationName?: string;
  organizationNpi?: string;
}

export interface EligibilityRequest {
  patient: PatientInfo;
  insurance: InsuranceInfo;
  provider: ProviderInfo;
  serviceTypeCode: string;
  dateOfService?: string;
}

export interface EligibilityResponse {
  status: 'active' | 'inactive' | 'unknown';
  planName?: string;
  planType?: string;
  effectiveDate?: string;
  terminationDate?: string;
  benefits: BenefitInfo[];
  copay?: CopayInfo[];
  deductible?: DeductibleInfo;
  outOfPocketMax?: OutOfPocketInfo;
  coinsurance?: CoinsuranceInfo[];
  rawResponse?: unknown;
  errors?: string[];
  warnings?: string[];
}

export interface BenefitInfo {
  serviceType: string;
  serviceTypeCode: string;
  coverageLevel?: 'individual' | 'family';
  inNetwork: boolean;
  description?: string;
  amount?: number;
  percent?: number;
}

export interface CopayInfo {
  serviceType: string;
  amount: number;
  inNetwork: boolean;
}

export interface DeductibleInfo {
  individual?: { total: number; remaining: number; inNetwork: boolean };
  family?: { total: number; remaining: number; inNetwork: boolean };
}

export interface OutOfPocketInfo {
  individual?: { total: number; remaining: number; inNetwork: boolean };
  family?: { total: number; remaining: number; inNetwork: boolean };
}

export interface CoinsuranceInfo {
  serviceType: string;
  percent: number;
  inNetwork: boolean;
}

// NPI Types
export interface NpiResult {
  npi: string;
  entityType: 'individual' | 'organization';
  name: {
    first?: string;
    last?: string;
    organization?: string;
    credential?: string;
  };
  taxonomies: Array<{
    code: string;
    desc: string;
    primary: boolean;
    state?: string;
    license?: string;
  }>;
  addresses: Array<{
    type: 'mailing' | 'practice';
    line1: string;
    city: string;
    state: string;
    zip: string;
    phone?: string;
  }>;
}

export interface InsuranceCardData {
  payerName?: string;
  memberId?: string;
  groupNumber?: string;
  subscriberName?: string;
  planName?: string;
  effectiveDate?: string;
  confidence: number;
}

// API Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export type AuditAction =
  | 'launch'
  | 'auth_callback'
  | 'view_patient'
  | 'fetch_coverage'
  | 'check_eligibility'
  | 'view_results'
  | 'confirm_save'
  | 'upload_card'
  | 'view_history';

// Discrepancy Types (agent-detected mismatches)
export interface Discrepancy {
  field: string;           // e.g., "memberId", "patientName"
  inputValue: string;      // What we sent
  responseValue: string;   // What Stedi returned
  severity: 'warning' | 'error';
  suggestion?: string;     // Agent's suggested correction
}

export interface DiscrepancyReport {
  hasDiscrepancies: boolean;
  source: string;          // Attribution: "Discrepancies identified by comparing..."
  items: Discrepancy[];
}

// Agent Types
export interface AgentInput {
  patient: PatientInfo;
  insurance?: Partial<InsuranceInfo>;
  provider?: Partial<ProviderInfo>;
  serviceTypeCode?: string;
  cardImage?: string; // base64 encoded insurance card image
  // Raw FHIR resources for full context
  rawFhir?: {
    patient?: FhirPatient;
    coverage?: FhirCoverage;
    practitioner?: FhirPractitioner;
  };
}

export interface AgentStep {
  id: string;
  type: 'thinking' | 'tool_start' | 'tool_end' | 'text';
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  text?: string;
  thinking?: string;
  timestamp: number;
}

export interface AgentEvent {
  type: 'start' | 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'complete' | 'error';
  // For thinking events - agent's reasoning (extended thinking)
  thinking?: string;
  // For text events - agent's response text
  text?: string;
  // For tool events
  tool?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  // For completion
  eligibilityResult?: EligibilityResponse;
  summary?: string;                    // Agent-generated markdown with source attribution
  discrepancies?: DiscrepancyReport;   // Agent-detected discrepancies
  rawResponse?: unknown;               // Full Stedi 271 JSON
  usage?: AgentUsage;
  // For errors
  message?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCost: number;
}

export interface AgentResult {
  success: boolean;
  eligibilityResult?: EligibilityResponse;
  steps: AgentStep[];
  usage: AgentUsage;
  error?: string;
}

// Payer Search Types
export interface StediPayer {
  stediId: string;
  displayName: string;
  primaryPayerId?: string;
  aliases: string[];
  coverageTypes: string[];
  operatingStates: string[];
  eligibilitySupported: boolean;
}

export interface PayerSearchResult {
  payers: StediPayer[];
  total: number;
}

export interface PayerMapping {
  id: string;
  payerName: string;
  stediPayerId: string;
  stediPayerName: string;
  createdAt: Date;
  usageCount: number;
}
