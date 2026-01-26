import axios from 'axios';

const NPI_REGISTRY_URL = process.env.NPI_REGISTRY_URL || 'https://npiregistry.cms.hhs.gov/api';

interface NpiLookupResult {
  valid: boolean;
  npi?: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  credentials?: string;
  specialty?: string;
  address?: {
    city: string;
    state: string;
  };
  message?: string;
}

// Validate NPI using Luhn algorithm
function validateNpiChecksum(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;

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

export async function lookupNpi(npi: string): Promise<NpiLookupResult> {
  // Validate format
  if (!/^\d{10}$/.test(npi)) {
    return { valid: false, message: 'NPI must be exactly 10 digits' };
  }

  // Validate checksum
  if (!validateNpiChecksum(npi)) {
    return { valid: false, message: 'Invalid NPI checksum' };
  }

  try {
    const response = await axios.get(NPI_REGISTRY_URL, {
      params: { version: '2.1', number: npi },
      timeout: 10000,
    });

    const results = response.data.results || [];
    if (results.length === 0) {
      return { valid: false, message: 'NPI not found in NPPES registry' };
    }

    const result = results[0];
    const basic = result.basic || {};
    const isOrg = result.enumeration_type === 'NPI-2';
    const primaryTaxonomy = (result.taxonomies || []).find((t: any) => t.primary);
    const practiceAddress = (result.addresses || []).find((a: any) =>
      a.address_purpose?.toLowerCase() === 'location'
    ) || result.addresses?.[0];

    return {
      valid: true,
      npi: result.number,
      firstName: basic.first_name,
      lastName: basic.last_name,
      organizationName: basic.organization_name,
      credentials: basic.credential,
      specialty: primaryTaxonomy?.desc,
      address: practiceAddress ? {
        city: practiceAddress.city,
        state: practiceAddress.state,
      } : undefined,
    };
  } catch (error) {
    console.error('NPI lookup error:', error);
    // Checksum valid, just couldn't verify with registry
    return {
      valid: true,
      npi,
      message: 'Could not verify with NPPES registry (checksum valid)'
    };
  }
}

export async function searchNpi(params: {
  firstName?: string;
  lastName?: string;
  state?: string;
  taxonomy?: string;
}): Promise<NpiLookupResult[]> {
  try {
    const response = await axios.get(NPI_REGISTRY_URL, {
      params: {
        version: '2.1',
        first_name: params.firstName,
        last_name: params.lastName,
        state: params.state,
        taxonomy_description: params.taxonomy,
        limit: 20,
      },
      timeout: 15000,
    });

    return (response.data.results || []).map((result: any) => {
      const basic = result.basic || {};
      const primaryTaxonomy = (result.taxonomies || []).find((t: any) => t.primary);

      return {
        valid: true,
        npi: result.number,
        firstName: basic.first_name,
        lastName: basic.last_name,
        organizationName: basic.organization_name,
        credentials: basic.credential,
        specialty: primaryTaxonomy?.desc,
      };
    });
  } catch (error) {
    console.error('NPI search error:', error);
    return [];
  }
}
