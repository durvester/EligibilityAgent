import { FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import type { NpiResult } from '@eligibility-agent/shared';

const NPI_REGISTRY_URL = process.env.NPI_REGISTRY_URL || 'https://npiregistry.cms.hhs.gov/api';

interface NpiValidateQuery {
  npi: string;
}

interface NpiSearchQuery {
  firstName?: string;
  lastName?: string;
  state?: string;
  taxonomy?: string;
  limit?: number;
}

// Validate NPI using Luhn algorithm
function validateNpiChecksum(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;

  // NPI uses Luhn algorithm with prefix 80840
  const prefixedNpi = '80840' + npi;
  let sum = 0;
  let alternate = false;

  for (let i = prefixedNpi.length - 1; i >= 0; i--) {
    let digit = parseInt(prefixedNpi[i], 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// Transform NPPES response to NpiResult
function transformNpiResult(result: any): NpiResult {
  const basic = result.basic || {};
  const isOrg = result.enumeration_type === 'NPI-2';

  return {
    npi: result.number,
    entityType: isOrg ? 'organization' : 'individual',
    name: {
      first: basic.first_name,
      last: basic.last_name,
      organization: basic.organization_name,
      credential: basic.credential,
    },
    taxonomies: (result.taxonomies || []).map((t: any) => ({
      code: t.code,
      desc: t.desc,
      primary: t.primary,
      state: t.state,
      license: t.license,
    })),
    addresses: (result.addresses || []).map((a: any) => ({
      type: a.address_purpose?.toLowerCase() === 'mailing' ? 'mailing' : 'practice',
      line1: a.address_1,
      city: a.city,
      state: a.state,
      zip: a.postal_code?.slice(0, 5),
      phone: a.telephone_number,
    })),
  };
}

const npiRoutes: FastifyPluginAsync = async (fastify) => {
  // Validate NPI format and lookup
  fastify.get<{ Querystring: NpiValidateQuery }>('/validate', async (request, reply) => {
    const { npi } = request.query;

    if (!npi) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_NPI', message: 'NPI is required' },
      });
    }

    // Validate format
    if (!/^\d{10}$/.test(npi)) {
      return {
        success: true,
        valid: false,
        message: 'NPI must be exactly 10 digits',
      };
    }

    // Validate checksum
    if (!validateNpiChecksum(npi)) {
      return {
        success: true,
        valid: false,
        message: 'Invalid NPI checksum',
      };
    }

    // Lookup in NPPES
    try {
      const response = await axios.get(NPI_REGISTRY_URL, {
        params: { version: '2.1', number: npi },
        timeout: 10000,
      });

      const results = response.data.results || [];
      if (results.length === 0) {
        return {
          success: true,
          valid: false,
          message: 'NPI not found in registry',
        };
      }

      const result = transformNpiResult(results[0]);
      return {
        success: true,
        valid: true,
        provider: {
          npi: result.npi,
          firstName: result.name.first,
          lastName: result.name.last,
          organizationName: result.name.organization,
          credentials: result.name.credential,
          specialty: result.taxonomies.find(t => t.primary)?.desc,
        },
      };
    } catch (error) {
      fastify.log.error(error, 'NPI lookup failed');
      return {
        success: true,
        valid: true, // Checksum valid, just couldn't verify with registry
        message: 'Could not verify with NPPES registry',
      };
    }
  });

  // Search NPI registry
  fastify.get<{ Querystring: NpiSearchQuery }>('/search', async (request, reply) => {
    const { firstName, lastName, state, taxonomy, limit = 10 } = request.query;

    if (!firstName && !lastName && !taxonomy) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_SEARCH', message: 'At least one search parameter required' },
      });
    }

    try {
      const response = await axios.get(NPI_REGISTRY_URL, {
        params: {
          version: '2.1',
          first_name: firstName,
          last_name: lastName,
          state,
          taxonomy_description: taxonomy,
          limit: Math.min(limit, 50),
        },
        timeout: 15000,
      });

      const results = (response.data.results || []).map(transformNpiResult);

      return {
        success: true,
        count: response.data.result_count || results.length,
        results,
      };
    } catch (error) {
      fastify.log.error(error, 'NPI search failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'NPI_SEARCH_FAILED', message: 'NPI search failed' },
      });
    }
  });

  // Lookup specific NPI
  fastify.get<{ Params: { npi: string } }>('/:npi', async (request, reply) => {
    const { npi } = request.params;

    if (!/^\d{10}$/.test(npi)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_NPI', message: 'NPI must be exactly 10 digits' },
      });
    }

    try {
      const response = await axios.get(NPI_REGISTRY_URL, {
        params: { version: '2.1', number: npi },
        timeout: 10000,
      });

      const results = response.data.results || [];
      if (results.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NPI_NOT_FOUND', message: 'NPI not found in registry' },
        });
      }

      return {
        success: true,
        data: transformNpiResult(results[0]),
      };
    } catch (error) {
      fastify.log.error(error, 'NPI lookup failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'NPI_LOOKUP_FAILED', message: 'NPI lookup failed' },
      });
    }
  });
};

export default npiRoutes;
