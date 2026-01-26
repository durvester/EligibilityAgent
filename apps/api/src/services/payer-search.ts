/**
 * Stedi Payer Search Service
 *
 * Searches Stedi's payer directory to find payer IDs for eligibility checks.
 */

import axios from 'axios';
import type { StediPayer, PayerSearchResult } from '@eligibility-agent/shared';

const STEDI_API_URL = process.env.STEDI_API_URL || 'https://healthcare.us.stedi.com/2024-04-01';

// Note: STEDI_API_KEY is read inside functions to ensure dotenv has loaded
function getStediApiKey(): string {
  const key = process.env.STEDI_API_KEY;
  if (!key) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }
  return key;
}

interface StediPayerResponse {
  items: Array<{
    payer: {
      stediId: string;
      displayName: string;
      primaryPayerId?: string;
      aliases: string[];
      names: string[];
      coverageTypes: string[];
      operatingStates: string[];
      transactionSupport: {
        eligibilityCheck: 'SUPPORTED' | 'ENROLLMENT_REQUIRED' | 'NOT_SUPPORTED';
        [key: string]: string;
      };
    };
    score: number;
  }>;
  stats: {
    total: number;
  };
}

/**
 * Search for payers by name in Stedi's payer directory.
 * Returns payers sorted by relevance score.
 */
export async function searchPayers(query: string): Promise<PayerSearchResult> {
  const apiKey = getStediApiKey();

  if (!query || query.trim().length < 2) {
    return { payers: [], total: 0 };
  }

  try {
    const response = await axios.get<StediPayerResponse>(
      `${STEDI_API_URL}/payers/search`,
      {
        params: { query: query.trim() },
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const payers: StediPayer[] = response.data.items.map(item => ({
      stediId: item.payer.stediId,
      displayName: item.payer.displayName,
      primaryPayerId: item.payer.primaryPayerId,
      aliases: item.payer.aliases || [],
      coverageTypes: item.payer.coverageTypes || [],
      operatingStates: item.payer.operatingStates || [],
      eligibilitySupported: item.payer.transactionSupport?.eligibilityCheck === 'SUPPORTED',
    }));

    // Filter to only payers that support eligibility checks
    const eligiblePayers = payers.filter(p => p.eligibilitySupported);

    console.log(`[PayerSearch] Query "${query}" found ${eligiblePayers.length} payers with eligibility support`);

    return {
      payers: eligiblePayers,
      total: response.data.stats?.total || eligiblePayers.length,
    };
  } catch (error) {
    console.error('[PayerSearch] Search failed:', error);

    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Payer search failed: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
    }

    throw error;
  }
}

/**
 * Get details for a specific payer by Stedi ID.
 */
export async function getPayerById(stediId: string): Promise<StediPayer | null> {
  const apiKey = getStediApiKey();

  try {
    const response = await axios.get(
      `${STEDI_API_URL}/payer/${stediId}`,
      {
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const payer = response.data;
    return {
      stediId: payer.stediId,
      displayName: payer.displayName,
      primaryPayerId: payer.primaryPayerId,
      aliases: payer.aliases || [],
      coverageTypes: payer.coverageTypes || [],
      operatingStates: payer.operatingStates || [],
      eligibilitySupported: payer.transactionSupport?.eligibilityCheck === 'SUPPORTED',
    };
  } catch (error) {
    console.error(`[PayerSearch] Failed to get payer ${stediId}:`, error);
    return null;
  }
}
