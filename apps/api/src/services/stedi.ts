import axios from 'axios';
import type { EligibilityResponse, SourceAttribution } from '@eligibility-agent/shared';
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

interface EligibilityParams {
  stediPayerId: string;
  memberId: string;
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  providerNpi: string;
  providerFirstName?: string;
  providerLastName?: string;
  providerOrganizationName?: string;
  serviceTypeCode: string;
  groupNumber?: string;
}

interface StediEligibilityRequest {
  tradingPartnerServiceId: string;
  provider: {
    organizationName?: string;
    firstName?: string;
    lastName?: string;
    npi: string;
  };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // YYYYMMDD format
    groupNumber?: string;
  };
  encounter: {
    serviceTypeCodes: string[];
    // dateRange is optional - omit to use payer's current date
  };
}

/**
 * Parse Stedi X12 271 response into our standard format
 * Exported for testing
 */
export function parseStediResponse(
  response: any,
  sourceInfo: { payerId: string; payerName?: string; requestId?: string }
): EligibilityResponse {
  // Build source attribution
  const sourceAttribution: SourceAttribution = {
    payer: sourceInfo.payerName || sourceInfo.payerId,
    payerId: sourceInfo.payerId,
    timestamp: new Date().toISOString(),
    responseFormat: 'X12_271',
    // Extract transaction ID from response if available
    transactionId: response?.controlNumber || response?.transactionId,
    stediRequestId: sourceInfo.requestId,
  };

  const result: EligibilityResponse = {
    status: 'unknown',
    benefits: [],
    errors: [],
    warnings: [],
    rawResponse: response,
    sourceAttribution,
  };

  try {
    // Extract plan info
    const planInfo = response.planInformation || response.plan || {};
    result.planName = planInfo.planName || planInfo.groupName;
    result.planType = planInfo.planType;

    // Extract coverage status from benefits
    const benefitsInfo = response.benefitsInformation || response.benefits || [];

    for (const benefit of benefitsInfo) {
      const code = benefit.code || benefit.benefitCode;
      const serviceType = benefit.serviceType || benefit.serviceTypeCodes?.[0];
      const amount = parseFloat(benefit.benefitAmount) || undefined;
      const percent = parseFloat(benefit.benefitPercent) || undefined;

      // Check for active coverage
      if (code === '1' || code === 'Active Coverage') {
        result.status = 'active';
        if (benefit.dateQualifier === 'Plan Begin' || benefit.dateQualifier === '346') {
          result.effectiveDate = benefit.date;
        }
        if (benefit.dateQualifier === 'Plan End' || benefit.dateQualifier === '347') {
          result.terminationDate = benefit.date;
        }
      }

      // Check for inactive
      if (code === '6' || code === 'Inactive') {
        result.status = 'inactive';
      }

      // Extract copay
      if (code === 'B' || code === 'Co-Payment') {
        result.copay = result.copay || [];
        result.copay.push({
          serviceType: serviceType || 'General',
          amount: amount || 0,
          inNetwork: benefit.inPlanNetwork !== 'N',
        });
      }

      // Extract deductible
      if (code === 'C' || code === 'Deductible') {
        result.deductible = result.deductible || {};
        const coverageLevel = benefit.coverageLevelCode === 'FAM' ? 'family' : 'individual';
        const remaining = parseFloat(benefit.benefitAmountRemaining) || amount || 0;

        result.deductible[coverageLevel] = {
          total: amount || 0,
          remaining,
          inNetwork: benefit.inPlanNetwork !== 'N',
        };
      }

      // Extract out-of-pocket max
      if (code === 'G' || code === 'Out of Pocket') {
        result.outOfPocketMax = result.outOfPocketMax || {};
        const coverageLevel = benefit.coverageLevelCode === 'FAM' ? 'family' : 'individual';
        const remaining = parseFloat(benefit.benefitAmountRemaining) || amount || 0;

        result.outOfPocketMax[coverageLevel] = {
          total: amount || 0,
          remaining,
          inNetwork: benefit.inPlanNetwork !== 'N',
        };
      }

      // Extract coinsurance
      if (code === 'A' || code === 'Co-Insurance') {
        result.coinsurance = result.coinsurance || [];
        result.coinsurance.push({
          serviceType: serviceType || 'General',
          percent: percent || 0,
          inNetwork: benefit.inPlanNetwork !== 'N',
        });
      }

      // Add to general benefits list
      if (serviceType) {
        result.benefits.push({
          serviceType,
          serviceTypeCode: benefit.serviceTypeCodes?.[0] || '',
          inNetwork: benefit.inPlanNetwork !== 'N',
          amount,
          percent,
          description: benefit.benefitDescription,
        });
      }
    }

    // Extract errors/rejections
    const errors = response.errors || response.rejectionReasons || [];
    for (const error of errors) {
      result.errors?.push(error.description || error.message || JSON.stringify(error));
    }

    // If no status determined, check for errors
    if (result.status === 'unknown' && result.errors && result.errors.length > 0) {
      result.status = 'unknown';
    }

  } catch (error) {
    result.errors?.push('Failed to parse eligibility response');
  }

  return result;
}

/**
 * Submit eligibility check to Stedi X12 270/271 API
 */
export async function checkEligibilityWithStedi(params: EligibilityParams): Promise<EligibilityResponse> {
  const apiKey = getStediApiKey();

  // Build X12 270 request
  // Stedi expects dateOfBirth in YYYYMMDD format (no dashes)
  const dobFormatted = params.patientDob.replace(/-/g, '');

  // Build provider object - Stedi requires either organizationName or firstName+lastName
  const provider: StediEligibilityRequest['provider'] = {
    npi: params.providerNpi,
  };

  if (params.providerOrganizationName) {
    provider.organizationName = params.providerOrganizationName;
  } else if (params.providerFirstName && params.providerLastName) {
    provider.firstName = params.providerFirstName;
    provider.lastName = params.providerLastName;
  } else {
    // Fallback: use a generic organization name if no name provided
    // This allows the check to proceed; agent should provide proper names
    provider.organizationName = 'Healthcare Provider';
  }

  const request: StediEligibilityRequest = {
    tradingPartnerServiceId: params.stediPayerId,
    provider,
    subscriber: {
      memberId: params.memberId,
      firstName: params.patientFirstName,
      lastName: params.patientLastName,
      dateOfBirth: dobFormatted,
      groupNumber: params.groupNumber,
    },
    encounter: {
      serviceTypeCodes: [params.serviceTypeCode],
      // Omit dateRange to use current date (payer default)
    },
  };

  serviceLogger.info({
    payerId: request.tradingPartnerServiceId,
    providerNpi: request.provider.npi,
    serviceTypes: request.encounter.serviceTypeCodes,
  }, 'Submitting Stedi eligibility request');

  try {
    const response = await axios.post(
      `${STEDI_API_URL}/change/medicalnetwork/eligibility/v3`,
      request,
      {
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60 second timeout
      }
    );

    // Extract Stedi request ID from response headers if available
    const stediRequestId = response.headers['x-request-id'] || response.headers['x-stedi-request-id'];

    serviceLogger.info({
      status: response.status,
      hasData: !!response.data,
      stediRequestId,
    }, 'Stedi eligibility response received');

    return parseStediResponse(response.data, {
      payerId: params.stediPayerId,
      requestId: stediRequestId,
    });
  } catch (error) {
    serviceLogger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'Stedi request failed');

    if (axios.isAxiosError(error) && error.response) {
      const errorData = error.response.data;
      serviceLogger.error({
        status: error.response.status,
        message: errorData?.message || errorData?.error,
      }, 'Stedi API error response');

      return {
        status: 'unknown',
        benefits: [],
        errors: [errorData?.message || errorData?.error || `Stedi API error: ${error.response.status}`],
        rawResponse: errorData,
        sourceAttribution: {
          payer: params.stediPayerId,
          payerId: params.stediPayerId,
          timestamp: new Date().toISOString(),
          responseFormat: 'X12_271',
        },
      };
    }

    throw error;
  }
}
