/**
 * Stedi Insurance Discovery Service
 *
 * Find patient's insurance coverage when payer is unknown.
 * This is a slow operation (up to 120s) that checks multiple payers.
 *
 * Use as a fallback when:
 * - No payer information is available
 * - Multiple eligibility checks have failed with "Subscriber Not Found"
 */

import axios from 'axios';
import type { EligibilityResponse } from '@eligibility-agent/shared';
import { serviceLogger } from '../lib/logger.js';

const STEDI_API_URL = process.env.STEDI_API_URL || 'https://healthcare.us.stedi.com/2024-04-01';

// Note: STEDI_API_KEY read inside functions to ensure dotenv has loaded
function getStediApiKey(): string {
  const key = process.env.STEDI_API_KEY;
  if (!key) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }
  return key;
}

export interface InsuranceDiscoveryParams {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  providerNpi: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  ssn?: string; // Last 4 digits recommended
  gender?: 'M' | 'F';
}

export interface DiscoveredCoverage {
  payerName: string;
  payerId?: string;
  memberId: string;
  groupNumber?: string;
  subscriberName?: string;
  planName?: string;
  confidence: 'HIGH' | 'REVIEW_NEEDED';
  confidenceReason?: string;
  eligibilityResponse: EligibilityResponse;
}

export interface InsuranceDiscoveryResult {
  status: 'COMPLETE' | 'PENDING' | 'NO_COVERAGE_FOUND';
  discoveryId: string;
  coverages: DiscoveredCoverage[];
}

/**
 * Discover insurance coverage for a patient.
 * This operation can take up to 120 seconds.
 */
export async function discoverInsurance(
  params: InsuranceDiscoveryParams
): Promise<InsuranceDiscoveryResult> {
  const apiKey = getStediApiKey();

  // Format date as YYYYMMDD for Stedi
  const dobFormatted = params.dateOfBirth.replace(/-/g, '');
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

  const request: Record<string, unknown> = {
    provider: {
      npi: params.providerNpi,
    },
    encounter: {
      beginningDateOfService: today,
      endDateOfService: today,
    },
    subscriber: {
      dateOfBirth: dobFormatted,
      firstName: params.firstName.toUpperCase(),
      lastName: params.lastName.toUpperCase(),
    },
  };

  // Add address if provided (highly recommended for better match rates)
  if (params.address) {
    const address: Record<string, string> = {};
    if (params.address.street) address.address1 = params.address.street.toUpperCase();
    if (params.address.city) address.city = params.address.city.toUpperCase();
    if (params.address.state) address.state = params.address.state.toUpperCase();
    if (params.address.zipCode) address.postalCode = params.address.zipCode;

    if (Object.keys(address).length > 0) {
      (request.subscriber as Record<string, unknown>).address = address;
    }
  }

  // Add gender if provided
  if (params.gender) {
    (request.subscriber as Record<string, unknown>).gender = params.gender;
  }

  serviceLogger.info({
    providerNpi: (request.provider as { npi: string }).npi,
    hasAddress: !!(request.subscriber as { address?: unknown }).address,
  }, 'Submitting insurance discovery request');

  try {
    const response = await axios.post(
      `${STEDI_API_URL}/insurance-discovery/check/v1`,
      request,
      {
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 130000, // 130 seconds (discovery can take up to 120s)
      }
    );

    const data = response.data;

    serviceLogger.info({
      discoveryId: data.discoveryId,
      coveragesFound: data.coveragesFound || 0,
    }, 'Insurance discovery response received');

    // Check for errors in response
    if (data.errors && data.errors.length > 0) {
      serviceLogger.warn({ errorCount: data.errors.length }, 'Discovery returned errors');
      // Return as NO_COVERAGE_FOUND with error info
      return {
        status: 'NO_COVERAGE_FOUND',
        discoveryId: data.discoveryId || '',
        coverages: [],
      };
    }

    // Check coverages found count
    const coveragesFound = data.coveragesFound || 0;
    if (coveragesFound === 0 || !data.items || data.items.length === 0) {
      serviceLogger.info({}, 'No coverages found');
      return {
        status: 'NO_COVERAGE_FOUND',
        discoveryId: data.discoveryId || '',
        coverages: [],
      };
    }

    // Parse coverages from items array
    const coverages: DiscoveredCoverage[] = data.items.map((item: any) => {
      const eligibilityResponse = parseDiscoveryEligibility(item);

      return {
        payerName: item.payer?.name || item.payer?.organizationName || item.payer?.lastName || 'Unknown Payer',
        payerId: item.payer?.payorIdentification || item.payer?.npi,
        memberId: item.subscriber?.memberId || item.dependent?.memberId || '',
        groupNumber: item.subscriber?.groupNumber || item.planInformation?.groupNumber,
        subscriberName: item.subscriber
          ? `${item.subscriber.firstName || ''} ${item.subscriber.lastName || ''}`.trim()
          : undefined,
        planName: item.planInformation?.planNumber || item.planInformation?.groupOrPolicyNumber,
        confidence: item.confidence === 'HIGH' ? 'HIGH' : 'REVIEW_NEEDED',
        confidenceReason: typeof item.confidence === 'object' ? item.confidence?.reason : undefined,
        eligibilityResponse,
      };
    });

    serviceLogger.info({ coverageCount: coverages.length }, 'Found coverages');

    return {
      status: 'COMPLETE',
      discoveryId: data.discoveryId || '',
      coverages,
    };
  } catch (error) {
    serviceLogger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Insurance discovery request failed');

    if (axios.isAxiosError(error) && error.response) {
      const errorData = error.response.data;
      serviceLogger.error({
        status: error.response.status,
        message: errorData?.message || errorData?.error,
      }, 'Insurance discovery API error');
      throw new Error(
        `Insurance discovery failed: ${errorData?.message || errorData?.error || `HTTP ${error.response.status}`}`
      );
    }

    throw error;
  }
}

/**
 * Parse eligibility data from a discovery response item.
 */
function parseDiscoveryEligibility(item: any): EligibilityResponse {
  const result: EligibilityResponse = {
    status: 'unknown',
    benefits: [],
    errors: [],
    warnings: [],
  };

  const benefits = item.benefitsInformation || [];

  for (const benefit of benefits) {
    const code = benefit.code;

    // Active coverage
    if (code === '1' || benefit.name === 'Active Coverage') {
      result.status = 'active';
      result.planName = benefit.planCoverage;
      result.planType = benefit.insuranceType;
    }

    // Inactive
    if (code === '6' || benefit.name === 'Inactive') {
      result.status = 'inactive';
    }

    // Add to benefits list
    if (benefit.serviceTypes?.[0]) {
      result.benefits.push({
        serviceType: benefit.serviceTypes[0],
        serviceTypeCode: benefit.serviceTypeCodes?.[0] || '',
        inNetwork: benefit.inPlanNetworkIndicator !== 'N',
        description: benefit.name,
      });
    }
  }

  // Extract dates
  const planDates = item.planDateInformation || {};
  if (planDates.planBegin) {
    result.effectiveDate = formatStediDate(planDates.planBegin);
  }

  return result;
}

/**
 * Format a Stedi date (YYYYMMDD) to ISO format (YYYY-MM-DD).
 */
function formatStediDate(date: string): string {
  if (date.length === 8) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return date;
}
