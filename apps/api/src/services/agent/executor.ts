/**
 * Tool Executor for the Eligibility Agent
 *
 * Executes tool calls by invoking the appropriate service functions.
 * Each tool returns a result that gets passed back to Claude.
 *
 * Note: Payer mapping tools removed - agent uses search_payers and its knowledge.
 */

import { lookupNpi, searchNpi } from '../npi.js';
import { searchPayers } from '../payer-search.js';
import { checkEligibilityWithStedi } from '../stedi.js';
import { discoverInsurance } from '../insurance-discovery.js';
import { serviceLogger } from '../../lib/logger.js';
import type { ToolName } from './tools.js';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a tool by name with the given input.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  serviceLogger.info({ toolName, inputKeys: Object.keys(input) }, 'Executing tool');

  try {
    switch (toolName as ToolName) {
      case 'lookup_npi':
        return await executeLookupNpi(input);

      case 'search_npi':
        return await executeSearchNpi(input);

      case 'search_payers':
        return await executeSearchPayers(input);

      case 'check_eligibility':
        return await executeCheckEligibility(input);

      case 'discover_insurance':
        return await executeDiscoverInsurance(input);

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    serviceLogger.error({ toolName, error: error instanceof Error ? error.message : 'Unknown' }, 'Tool execution failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function executeLookupNpi(input: Record<string, unknown>): Promise<ToolResult> {
  const npi = input.npi as string;
  if (!npi) {
    return { success: false, error: 'NPI is required' };
  }

  const result = await lookupNpi(npi);

  if (!result.valid) {
    return {
      success: false,
      error: result.message || 'Invalid NPI',
    };
  }

  return {
    success: true,
    data: {
      npi: result.npi,
      firstName: result.firstName,
      lastName: result.lastName,
      organizationName: result.organizationName,
      credentials: result.credentials,
      specialty: result.specialty,
      address: result.address,
    },
  };
}

async function executeSearchNpi(input: Record<string, unknown>): Promise<ToolResult> {
  const firstName = input.firstName as string;
  const lastName = input.lastName as string;

  if (!firstName || !lastName) {
    return { success: false, error: 'First name and last name are required' };
  }

  const results = await searchNpi({
    firstName,
    lastName,
    state: input.state as string | undefined,
  });

  if (results.length === 0) {
    return {
      success: true,
      data: {
        message: 'No providers found matching the search criteria',
        providers: [],
      },
    };
  }

  return {
    success: true,
    data: {
      providers: results.map(r => ({
        npi: r.npi,
        firstName: r.firstName,
        lastName: r.lastName,
        credentials: r.credentials,
        specialty: r.specialty,
        organizationName: r.organizationName,
      })),
    },
  };
}

async function executeSearchPayers(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input.query as string;
  if (!query) {
    return { success: false, error: 'Search query is required' };
  }

  const result = await searchPayers(query);

  if (result.payers.length === 0) {
    return {
      success: true,
      data: {
        message: `No payers found matching "${query}" with eligibility support`,
        payers: [],
      },
    };
  }

  return {
    success: true,
    data: {
      payers: result.payers.slice(0, 10).map(p => ({
        stediId: p.stediId,
        displayName: p.displayName,
        aliases: p.aliases.slice(0, 5), // Limit aliases to keep response small
        eligibilitySupported: p.eligibilitySupported,
      })),
      total: result.total,
    },
  };
}

async function executeCheckEligibility(input: Record<string, unknown>): Promise<ToolResult> {
  const stediPayerId = input.stediPayerId as string;
  const memberId = input.memberId as string;
  const patientFirstName = input.patientFirstName as string;
  const patientLastName = input.patientLastName as string;
  const patientDob = input.patientDob as string;
  const providerNpi = input.providerNpi as string;
  const providerFirstName = input.providerFirstName as string | undefined;
  const providerLastName = input.providerLastName as string | undefined;
  const providerOrganizationName = input.providerOrganizationName as string | undefined;
  const serviceTypeCode = (input.serviceTypeCode as string) || '30';
  const groupNumber = input.groupNumber as string | undefined;

  if (!stediPayerId || !memberId || !patientFirstName || !patientLastName || !patientDob || !providerNpi) {
    return {
      success: false,
      error: 'Missing required fields: stediPayerId, memberId, patientFirstName, patientLastName, patientDob, providerNpi',
    };
  }

  const result = await checkEligibilityWithStedi({
    stediPayerId,
    memberId,
    patientFirstName,
    patientLastName,
    patientDob,
    providerNpi,
    providerFirstName,
    providerLastName,
    providerOrganizationName,
    serviceTypeCode,
    groupNumber,
  });

  // Check for errors
  if (result.errors && result.errors.length > 0 && result.status === 'unknown') {
    return {
      success: false,
      error: result.errors.join('; '),
      data: {
        status: result.status,
        errors: result.errors,
        rawResponse: result.rawResponse,
      },
    };
  }

  return {
    success: true,
    data: {
      status: result.status,
      planName: result.planName,
      planType: result.planType,
      effectiveDate: result.effectiveDate,
      terminationDate: result.terminationDate,
      copay: result.copay,
      deductible: result.deductible,
      outOfPocketMax: result.outOfPocketMax,
      coinsurance: result.coinsurance,
      benefits: result.benefits?.slice(0, 10), // Limit to keep response manageable
      warnings: result.warnings,
      rawResponse: result.rawResponse, // Full Stedi 271 response for agent analysis
    },
  };
}

async function executeDiscoverInsurance(input: Record<string, unknown>): Promise<ToolResult> {
  const firstName = input.firstName as string;
  const lastName = input.lastName as string;
  const dateOfBirth = input.dateOfBirth as string;
  const providerNpi = input.providerNpi as string;

  if (!firstName || !lastName || !dateOfBirth || !providerNpi) {
    return {
      success: false,
      error: 'Missing required fields: firstName, lastName, dateOfBirth, providerNpi',
    };
  }

  const address = input.address as {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } | undefined;

  const result = await discoverInsurance({
    firstName,
    lastName,
    dateOfBirth,
    providerNpi,
    address,
    ssn: input.ssn as string | undefined,
    gender: input.gender as 'M' | 'F' | undefined,
  });

  if (result.status === 'NO_COVERAGE_FOUND') {
    return {
      success: true,
      data: {
        status: 'NO_COVERAGE_FOUND',
        message: 'No active insurance coverage found for this patient. This could mean the patient is uninsured, or we were unable to find a match with the provided demographics.',
        coverages: [],
      },
    };
  }

  if (result.status === 'PENDING') {
    return {
      success: true,
      data: {
        status: 'PENDING',
        discoveryId: result.discoveryId,
        message: 'Discovery is still in progress. Results may be available shortly.',
      },
    };
  }

  return {
    success: true,
    data: {
      status: 'COMPLETE',
      coveragesFound: result.coverages.length,
      coverages: result.coverages.map(c => ({
        payerName: c.payerName,
        payerId: c.payerId,
        memberId: c.memberId,
        groupNumber: c.groupNumber,
        planName: c.planName,
        confidence: c.confidence,
        confidenceReason: c.confidenceReason,
        coverageStatus: c.eligibilityResponse.status,
      })),
    },
  };
}
