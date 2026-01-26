import { FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import type { FhirPatient, FhirCoverage, FhirPractitioner, PatientInfo, InsuranceInfo, ProviderInfo } from '@eligibility-agent/shared';

function getAccessToken(request: { headers: { authorization?: string } }): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

function getFhirBaseUrl(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const value = request.headers['x-fhir-base-url'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] || null;
  return null;
}

function transformPatient(fhir: FhirPatient): PatientInfo {
  const name = fhir.name?.[0];
  const address = fhir.address?.[0];

  // Extract SSN from identifiers
  // Common systems: http://hl7.org/fhir/sid/us-ssn, urn:oid:2.16.840.1.113883.4.1
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
  // This is the primary source for member ID
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
   * Get patient with coverage and practitioners
   *
   * Requires:
   * - Authorization: Bearer <access_token>
   * - X-FHIR-Base-URL: <fhir_base_url from token response>
   * Optional:
   * - X-FHIR-User: <fhirUser from token response> - to identify logged-in user
   */
  fastify.get<{ Params: { patientId: string } }>('/patient/:patientId', async (request, reply) => {
    const { patientId } = request.params;
    const accessToken = getAccessToken(request);
    const fhirBaseUrl = getFhirBaseUrl(request);
    // Get fhirUser header - this identifies the logged-in practitioner
    const fhirUserHeader = request.headers['x-fhir-user'];
    const fhirUser = typeof fhirUserHeader === 'string' ? fhirUserHeader : fhirUserHeader?.[0];

    if (!accessToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing access token. Include Authorization: Bearer <token> header.' },
      });
    }

    if (!fhirBaseUrl) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_FHIR_URL', message: 'Missing X-FHIR-Base-URL header. This should be the fhirBaseUrl from the token response.' },
      });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    };

    try {
      // Extract practitioner ID from fhirUser first (e.g., "Practitioner/123" -> "123")
      let loggedInProviderId: string | null = null;
      fastify.log.info({ fhirUserHeader: fhirUser }, 'fhirUser header received');
      if (fhirUser) {
        const match = fhirUser.match(/Practitioner\/([^/]+)$/);
        if (match) {
          loggedInProviderId = match[1];
          fastify.log.info({ loggedInProviderId }, 'Extracted practitioner ID from fhirUser');
        } else {
          fastify.log.warn({ fhirUser }, 'fhirUser did not match Practitioner pattern');
        }
      } else {
        fastify.log.warn('No fhirUser header provided');
      }

      // Fetch Patient, Coverage, and Practitioner in PARALLEL for speed
      fastify.log.info({ fhirBaseUrl, patientId, loggedInProviderId }, 'Fetching FHIR resources in parallel');
      const startTime = Date.now();

      const [patientResult, coverageResult, practitionerResult] = await Promise.allSettled([
        // 1. Patient (required)
        axios.get<FhirPatient>(
          `${fhirBaseUrl}/Patient/${patientId}`,
          { headers, timeout: 15000 }
        ),
        // 2. Coverage (optional)
        axios.get<{ entry?: Array<{ resource: FhirCoverage }> }>(
          `${fhirBaseUrl}/Coverage?patient=${patientId}`,
          { headers, timeout: 15000 }
        ),
        // 3. Practitioner (optional - only if we have the ID)
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

      // Process Coverage (optional)
      let insurance: InsuranceInfo | null = null;
      if (coverageResult.status === 'fulfilled' && coverageResult.value) {
        const coverageResource = coverageResult.value.data.entry?.[0]?.resource;

        // Log the raw coverage resource to understand its structure
        fastify.log.info({
          coverageRaw: JSON.stringify(coverageResource, null, 2),
          hasIdentifier: !!coverageResource?.identifier,
          identifierCount: (coverageResource as any)?.identifier?.length,
          subscriberId: coverageResource?.subscriberId,
        }, 'Raw Coverage resource from FHIR');

        if (coverageResource) {
          insurance = transformCoverage(coverageResource);
          fastify.log.info({
            transformedMemberId: insurance.memberId,
            transformedPayer: insurance.payerName
          }, 'Transformed insurance info');
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
   * List practitioners with pagination (lazy scroll support)
   *
   * Query params:
   * - _count: number of items per page (default 20)
   * - _offset: skip this many items (for pagination)
   */
  fastify.get<{ Querystring: { _count?: string; _offset?: string } }>('/practitioners', async (request, reply) => {
    const accessToken = getAccessToken(request);
    const fhirBaseUrl = getFhirBaseUrl(request);
    const count = parseInt(request.query._count || '20', 10);
    const offset = parseInt(request.query._offset || '0', 10);

    if (!accessToken || !fhirBaseUrl) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing credentials' },
      });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    };

    try {
      // Fetch practitioners with pagination
      // Note: FHIR uses _count for page size and _offset for pagination
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

      // Check if there are more items
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
   * Generic FHIR resource fetch
   */
  fastify.get<{ Params: { resourceType: string; resourceId: string } }>('/:resourceType/:resourceId', async (request, reply) => {
    const { resourceType, resourceId } = request.params;
    const accessToken = getAccessToken(request);
    const fhirBaseUrl = getFhirBaseUrl(request);

    if (!accessToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing access token' },
      });
    }

    if (!fhirBaseUrl) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_FHIR_URL', message: 'Missing X-FHIR-Base-URL header' },
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
