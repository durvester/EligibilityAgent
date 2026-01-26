/**
 * FHIR Routes
 *
 * Provides FHIR proxy endpoints for fetching patient data.
 * All routes require authentication - access tokens are retrieved from the session.
 *
 * The session middleware ensures:
 * 1. Valid internal JWT from cookie
 * 2. Session attached to request
 * 3. PF access token retrieved from database (auto-refreshed if needed)
 */

import { FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import { prisma } from '@eligibility-agent/db';
import type { FhirPatient, FhirCoverage, FhirPractitioner, PatientInfo, InsuranceInfo, ProviderInfo } from '@eligibility-agent/shared';
import { getPfToken } from '../services/session-service.js';
import { auditViewPatient, auditViewCoverage } from '../services/audit-service.js';

/**
 * Allowed FHIR server domains.
 * Add trusted domains here.
 */
const ALLOWED_FHIR_DOMAINS = [
  'practicefusion.com',
  'localhost', // Development only
];

/**
 * Validate that a FHIR URL is from an allowed domain.
 * Prevents SSRF attacks by restricting which servers we proxy to.
 */
function isAllowedFhirUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must be HTTPS in production
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      return false;
    }

    // Allow localhost in development
    if (process.env.NODE_ENV !== 'production' && parsed.hostname === 'localhost') {
      return true;
    }

    // Check against allowed domains
    return ALLOWED_FHIR_DOMAINS.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * Get FHIR base URL for the tenant.
 */
async function getFhirBaseUrl(tenantId: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { issuer: true },
  });
  return tenant?.issuer || null;
}

function transformPatient(fhir: FhirPatient): PatientInfo {
  const name = fhir.name?.[0];
  const address = fhir.address?.[0];

  // Extract SSN from identifiers
  const ssnIdentifier = fhir.identifier?.find(id =>
    id.system === 'http://hl7.org/fhir/sid/us-ssn' ||
    id.system === 'urn:oid:2.16.840.1.113883.4.1' ||
    id.type?.coding?.some(c => c.code === 'SS' || c.code === 'SSN')
  );

  return {
    fhirId: fhir.id,
    firstName: name?.given?.[0] || '',
    lastName: name?.family || '',
    middleName: name?.given?.[1],
    dateOfBirth: fhir.birthDate || '',
    gender: fhir.gender === 'male' ? 'M' : fhir.gender === 'female' ? 'F' : 'U',
    ssn: ssnIdentifier?.value,
    address: address ? {
      street: address.line?.join(', '),
      city: address.city,
      state: address.state,
      zipCode: address.postalCode,
    } : undefined,
    phone: fhir.telecom?.find(t => t.system === 'phone')?.value,
  };
}

function transformCoverage(fhir: FhirCoverage & {
  extension?: Array<{ url: string; valueString?: string }>;
}): InsuranceInfo {
  const payerName = fhir.payor?.[0]?.display || '';

  // Find group number from class array (type code = 'group')
  const groupClass = fhir.class?.find(c =>
    c.type?.coding?.some(coding => coding.code === 'group')
  );

  // Practice Fusion stores member ID in extension: coverage-insured-unique-id
  const memberIdExtension = fhir.extension?.find(
    ext => ext.url?.includes('coverage-insured-unique-id')
  );
  const memberId = memberIdExtension?.valueString || fhir.subscriberId || '';

  return {
    payerName,
    memberId,
    groupNumber: groupClass?.value,
    effectiveDate: fhir.period?.start,
    terminationDate: fhir.period?.end,
  };
}

function transformPractitioner(fhir: FhirPractitioner): ProviderInfo {
  const name = fhir.name?.[0];
  const npiIdentifier = fhir.identifier?.find(id =>
    id.system === 'http://hl7.org/fhir/sid/us-npi'
  );

  return {
    fhirId: fhir.id,
    npi: npiIdentifier?.value || '',
    firstName: name?.given?.[0] || '',
    lastName: name?.family || '',
    credentials: name?.suffix?.join(', '),
  };
}

const fhirRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get patient with coverage and practitioners.
   *
   * Access token is retrieved from the session (not headers).
   * FHIR base URL comes from the tenant's issuer.
   */
  fastify.get<{ Params: { patientId: string } }>('/patient/:patientId', async (request, reply) => {
    const { patientId } = request.params;
    const session = request.session;

    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    // Get FHIR base URL from tenant
    const fhirBaseUrl = await getFhirBaseUrl(session.tenantId);
    if (!fhirBaseUrl) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TENANT_CONFIG_ERROR', message: 'Tenant FHIR configuration not found' },
      });
    }

    // Validate FHIR URL is from allowed domain
    if (!isAllowedFhirUrl(fhirBaseUrl)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FHIR_URL', message: 'FHIR base URL is not from an allowed domain.' },
      });
    }

    // Get PF access token from session (auto-refreshes if needed)
    const accessToken = await getPfToken(session.id, fhirBaseUrl);
    if (!accessToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Session token has expired. Please re-authenticate.' },
      });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    };

    try {
      // Extract practitioner ID from session's userFhirId
      let loggedInProviderId: string | null = null;
      if (session.userFhirId) {
        const match = session.userFhirId.match(/Practitioner\/([^/]+)$/);
        if (match) {
          loggedInProviderId = match[1];
        }
      }

      // Fetch Patient, Coverage, and Practitioner in PARALLEL for speed
      fastify.log.info({ fhirBaseUrl, patientId, loggedInProviderId }, 'Fetching FHIR resources in parallel');
      const startTime = Date.now();

      const [patientResult, coverageResult, practitionerResult] = await Promise.allSettled([
        axios.get<FhirPatient>(
          `${fhirBaseUrl}/Patient/${patientId}`,
          { headers, timeout: 15000 }
        ),
        axios.get<{ entry?: Array<{ resource: FhirCoverage }> }>(
          `${fhirBaseUrl}/Coverage?patient=${patientId}`,
          { headers, timeout: 15000 }
        ),
        loggedInProviderId
          ? axios.get<FhirPractitioner>(
              `${fhirBaseUrl}/Practitioner/${loggedInProviderId}`,
              { headers, timeout: 15000 }
            )
          : Promise.resolve(null),
      ]);

      fastify.log.info({ elapsed: Date.now() - startTime }, 'Parallel FHIR requests completed');

      // Process Patient (required)
      if (patientResult.status === 'rejected') {
        throw patientResult.reason;
      }
      const patient = transformPatient(patientResult.value.data);

      // Audit the patient view
      auditViewPatient(request, patientId);

      // Process Coverage (optional)
      let insurance: InsuranceInfo | null = null;
      if (coverageResult.status === 'fulfilled' && coverageResult.value) {
        const coverageResource = coverageResult.value.data.entry?.[0]?.resource;

        if (coverageResource) {
          insurance = transformCoverage(coverageResource);
          // Audit the coverage view
          auditViewCoverage(request, patientId, coverageResource.id);
        }
      } else if (coverageResult.status === 'rejected') {
        fastify.log.warn({ error: coverageResult.reason }, 'Failed to fetch coverage');
      }

      // Process Practitioner (optional)
      let currentProvider: ProviderInfo | null = null;
      if (practitionerResult.status === 'fulfilled' && practitionerResult.value) {
        currentProvider = transformPractitioner(practitionerResult.value.data);
      } else if (practitionerResult.status === 'rejected') {
        fastify.log.warn({ error: practitionerResult.reason }, 'Failed to fetch logged-in practitioner');
      }

      // Include raw FHIR resources for agent context
      const rawFhir: {
        patient?: FhirPatient;
        coverage?: FhirCoverage;
        practitioner?: FhirPractitioner;
      } = {
        patient: patientResult.value.data,
      };

      if (coverageResult.status === 'fulfilled' && coverageResult.value) {
        const coverageResource = coverageResult.value.data.entry?.[0]?.resource;
        if (coverageResource) {
          rawFhir.coverage = coverageResource;
        }
      }

      if (practitionerResult.status === 'fulfilled' && practitionerResult.value) {
        rawFhir.practitioner = practitionerResult.value.data;
      }

      return {
        success: true,
        patient,
        insurance,
        provider: currentProvider,
        rawFhir,
      };
    } catch (error) {
      fastify.log.error(error, 'FHIR request failed');

      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const message = error.response.data?.issue?.[0]?.diagnostics
          || error.response.data?.error_description
          || error.response.data?.error
          || `FHIR request failed with status ${status}`;

        return reply.status(status).send({
          success: false,
          error: { code: 'FHIR_ERROR', message },
        });
      }

      return reply.status(500).send({
        success: false,
        error: { code: 'FHIR_ERROR', message: 'Failed to fetch patient data' },
      });
    }
  });

  /**
   * List practitioners with pagination (lazy scroll support).
   */
  fastify.get<{ Querystring: { _count?: string; _offset?: string } }>('/practitioners', async (request, reply) => {
    const session = request.session;
    const count = parseInt(request.query._count || '20', 10);
    const offset = parseInt(request.query._offset || '0', 10);

    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const fhirBaseUrl = await getFhirBaseUrl(session.tenantId);
    if (!fhirBaseUrl) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TENANT_CONFIG_ERROR', message: 'Tenant FHIR configuration not found' },
      });
    }

    if (!isAllowedFhirUrl(fhirBaseUrl)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FHIR_URL', message: 'FHIR base URL is not from an allowed domain.' },
      });
    }

    const accessToken = await getPfToken(session.id, fhirBaseUrl);
    if (!accessToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Session token has expired. Please re-authenticate.' },
      });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    };

    try {
      const searchUrl = `${fhirBaseUrl}/Practitioner?_count=${count}&_offset=${offset}&_sort=family`;

      fastify.log.info({ searchUrl, count, offset }, 'Fetching practitioners');

      const practResponse = await axios.get<{
        entry?: Array<{ resource: FhirPractitioner }>;
        total?: number;
      }>(
        searchUrl,
        { headers, timeout: 15000 }
      );

      const practitioners = (practResponse.data.entry || [])
        .map(e => transformPractitioner(e.resource))
        .filter(p => p.firstName || p.lastName);

      const total = practResponse.data.total;
      const hasMore = total ? (offset + practitioners.length) < total : practitioners.length === count;

      return {
        success: true,
        practitioners,
        pagination: {
          offset,
          count: practitioners.length,
          total,
          hasMore,
        }
      };
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch practitioners');
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch practitioners' },
      });
    }
  });

  /**
   * Generic FHIR resource fetch.
   */
  fastify.get<{ Params: { resourceType: string; resourceId: string } }>('/:resourceType/:resourceId', async (request, reply) => {
    const { resourceType, resourceId } = request.params;
    const session = request.session;

    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const fhirBaseUrl = await getFhirBaseUrl(session.tenantId);
    if (!fhirBaseUrl) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TENANT_CONFIG_ERROR', message: 'Tenant FHIR configuration not found' },
      });
    }

    if (!isAllowedFhirUrl(fhirBaseUrl)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FHIR_URL', message: 'FHIR base URL is not from an allowed domain.' },
      });
    }

    const accessToken = await getPfToken(session.id, fhirBaseUrl);
    if (!accessToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Session token has expired. Please re-authenticate.' },
      });
    }

    try {
      const response = await axios.get(
        `${fhirBaseUrl}/${resourceType}/${resourceId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/fhir+json',
          },
          timeout: 30000,
        }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      fastify.log.error(error, 'FHIR request failed');

      if (axios.isAxiosError(error) && error.response) {
        return reply.status(error.response.status).send({
          success: false,
          error: {
            code: 'FHIR_ERROR',
            message: error.response.data?.issue?.[0]?.diagnostics || 'FHIR request failed',
          },
        });
      }

      return reply.status(500).send({
        success: false,
        error: { code: 'FHIR_ERROR', message: 'Failed to fetch FHIR resource' },
      });
    }
  });
};

export default fhirRoutes;
