/**
 * Payer Mapping Service
 *
 * In-memory cache for payer name → Stedi ID mappings.
 * Successful eligibility checks save mappings for future use.
 *
 * TODO: Persist to PostgreSQL payer_mappings table when DATABASE_URL is configured.
 */

import type { PayerMapping } from '@eligibility-agent/shared';
import { v4 as uuidv4 } from 'uuid';

// In-memory store (lost on restart)
// Key: normalized payer name (lowercase, trimmed)
const payerMappings = new Map<string, PayerMapping>();

/**
 * Normalize payer name for consistent lookups.
 */
function normalizePayerName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Get a payer mapping by name.
 * Returns null if no mapping exists.
 */
export async function getPayerMapping(payerName: string): Promise<PayerMapping | null> {
  const normalized = normalizePayerName(payerName);
  const mapping = payerMappings.get(normalized);

  if (mapping) {
    console.log(`[PayerMapping] Found mapping for "${payerName}": ${mapping.stediPayerId}`);
    // Increment usage count
    mapping.usageCount++;
    return mapping;
  }

  // Try partial match (e.g., "Blue Cross" matches "Blue Cross Blue Shield of Michigan")
  for (const [key, value] of payerMappings.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      console.log(`[PayerMapping] Found partial match for "${payerName}": ${value.stediPayerId}`);
      value.usageCount++;
      return value;
    }
  }

  console.log(`[PayerMapping] No mapping found for "${payerName}"`);
  return null;
}

/**
 * Save a new payer mapping.
 * Call this after a successful eligibility check.
 */
export async function savePayerMapping(
  payerName: string,
  stediPayerId: string,
  stediPayerName?: string
): Promise<PayerMapping> {
  const normalized = normalizePayerName(payerName);

  const mapping: PayerMapping = {
    id: uuidv4(),
    payerName: payerName.trim(),
    stediPayerId,
    stediPayerName: stediPayerName || payerName,
    createdAt: new Date(),
    usageCount: 1,
  };

  payerMappings.set(normalized, mapping);
  console.log(`[PayerMapping] Saved mapping: "${payerName}" → ${stediPayerId}`);

  // Also save with the Stedi payer name if different
  if (stediPayerName && stediPayerName !== payerName) {
    const normalizedStediName = normalizePayerName(stediPayerName);
    if (!payerMappings.has(normalizedStediName)) {
      payerMappings.set(normalizedStediName, { ...mapping, id: uuidv4() });
    }
  }

  return mapping;
}

/**
 * Get all stored mappings.
 * Useful for debugging and admin.
 */
export async function getAllMappings(): Promise<PayerMapping[]> {
  return Array.from(payerMappings.values());
}

/**
 * Clear all mappings.
 * Useful for testing.
 */
export async function clearAllMappings(): Promise<void> {
  payerMappings.clear();
  console.log('[PayerMapping] Cleared all mappings');
}

/**
 * Pre-load common payer mappings.
 * Call this on server startup.
 */
export async function seedCommonMappings(): Promise<void> {
  // These are commonly used payers - seed to avoid initial lookup
  // Comment out if you want the agent to discover all mappings naturally
  const commonMappings: Array<{ name: string; stediId: string; displayName: string }> = [
    // Add common payers here as they're discovered
    // { name: 'Aetna', stediId: '60054', displayName: 'Aetna' },
    // { name: 'United Healthcare', stediId: '87726', displayName: 'United Healthcare' },
  ];

  for (const mapping of commonMappings) {
    await savePayerMapping(mapping.name, mapping.stediId, mapping.displayName);
  }

  if (commonMappings.length > 0) {
    console.log(`[PayerMapping] Seeded ${commonMappings.length} common mappings`);
  }
}
