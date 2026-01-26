/**
 * Tool definitions for the eligibility agent.
 *
 * These are standard Anthropic tool definitions (JSON schema).
 * The agent decides which tools to use based on context.
 *
 * Note: Payer mapping tools removed - agent uses search_payers and its knowledge.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export const ELIGIBILITY_TOOLS: Tool[] = [
  {
    name: 'lookup_npi',
    description: 'Validate NPI format (10 digits, Luhn checksum) and lookup provider details from the NPPES registry. Use this to verify a provider\'s NPI is valid and get their name, specialty, and practice location.',
    input_schema: {
      type: 'object' as const,
      properties: {
        npi: {
          type: 'string',
          description: '10-digit National Provider Identifier',
        },
      },
      required: ['npi'],
    },
  },
  {
    name: 'search_npi',
    description: 'Search the NPPES registry for providers by name. Returns up to 20 matching providers with their NPI, name, credentials, and specialty. Use this when you have a provider name but not their NPI.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: {
          type: 'string',
          description: 'Provider first name',
        },
        lastName: {
          type: 'string',
          description: 'Provider last name',
        },
        state: {
          type: 'string',
          description: 'Two-letter state code (optional, narrows results)',
        },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'search_payers',
    description: 'Search Stedi\'s payer directory by name. Returns matching payers with their Stedi ID (needed for eligibility checks), display name, and whether eligibility is supported. Use fuzzy matching - e.g., "Blue Cross" will match various BCBS plans.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Payer name to search (supports partial matching)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_eligibility',
    description: 'Submit an X12 270 eligibility check to Stedi and get a 271 response. Returns coverage status, benefits, copays, deductibles, and out-of-pocket maximums. Requires: stediPayerId, memberId, patient info, providerNpi.',
    input_schema: {
      type: 'object' as const,
      properties: {
        stediPayerId: {
          type: 'string',
          description: 'Stedi payer ID (e.g., "KRPCH" for BCBS Michigan)',
        },
        memberId: {
          type: 'string',
          description: 'Patient\'s insurance member ID',
        },
        patientFirstName: {
          type: 'string',
          description: 'Patient first name',
        },
        patientLastName: {
          type: 'string',
          description: 'Patient last name',
        },
        patientDob: {
          type: 'string',
          description: 'Patient date of birth (YYYY-MM-DD format)',
        },
        providerNpi: {
          type: 'string',
          description: '10-digit provider NPI',
        },
        serviceTypeCode: {
          type: 'string',
          description: 'Service type code (default: "30" for Health Benefit Plan Coverage)',
        },
        groupNumber: {
          type: 'string',
          description: 'Insurance group number (optional)',
        },
      },
      required: ['stediPayerId', 'memberId', 'patientFirstName', 'patientLastName', 'patientDob', 'providerNpi'],
    },
  },
  {
    name: 'discover_insurance',
    description: 'Find a patient\'s active insurance coverage when payer is unknown. This is SLOW (up to 120 seconds) as it checks multiple payers. Use only as a fallback when: (1) no payer info available, or (2) multiple eligibility checks failed. Provide as much demographic data as possible for better results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: {
          type: 'string',
          description: 'Patient first name',
        },
        lastName: {
          type: 'string',
          description: 'Patient last name',
        },
        dateOfBirth: {
          type: 'string',
          description: 'Patient date of birth (YYYY-MM-DD format)',
        },
        providerNpi: {
          type: 'string',
          description: 'Provider NPI (required for discovery)',
        },
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zipCode: { type: 'string' },
          },
          description: 'Patient address (highly recommended for better match rates)',
        },
        ssn: {
          type: 'string',
          description: 'Last 4 digits of SSN (optional, improves accuracy)',
        },
        gender: {
          type: 'string',
          enum: ['M', 'F'],
          description: 'Patient gender (optional)',
        },
      },
      required: ['firstName', 'lastName', 'dateOfBirth', 'providerNpi'],
    },
  },
];

export type ToolName =
  | 'lookup_npi'
  | 'search_npi'
  | 'search_payers'
  | 'check_eligibility'
  | 'discover_insurance';
