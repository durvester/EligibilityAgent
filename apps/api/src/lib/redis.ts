/**
 * Redis Cache Service (Upstash)
 *
 * Required for caching - NO FALLBACK to in-memory.
 * If Redis is not configured, the application will fail at startup.
 */

import { Redis } from '@upstash/redis';
import { getRequiredEnv } from './validate-env.js';
import { serviceLogger } from './logger.js';

// Initialize Redis client - this will throw if env vars are missing
let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) {
    return redis;
  }

  const url = getRequiredEnv('UPSTASH_REDIS_URL');
  const token = getRequiredEnv('UPSTASH_REDIS_TOKEN');

  redis = new Redis({ url, token });
  return redis;
}

/**
 * Get a value from cache.
 *
 * @param key - Cache key
 * @returns Cached value or null if not found
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await getRedis().get<T>(key);
    if (value !== null) {
      serviceLogger.debug({ key }, 'Cache hit');
    }
    return value;
  } catch (error) {
    serviceLogger.error({ error, key }, 'Redis get failed');
    throw error; // Don't swallow errors - let caller handle
  }
}

/**
 * Set a value in cache with TTL.
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    await getRedis().set(key, value, { ex: ttlSeconds });
    serviceLogger.debug({ key, ttlSeconds }, 'Cache set');
  } catch (error) {
    serviceLogger.error({ error, key }, 'Redis set failed');
    throw error;
  }
}

/**
 * Delete a value from cache.
 *
 * @param key - Cache key to delete
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    await getRedis().del(key);
    serviceLogger.debug({ key }, 'Cache delete');
  } catch (error) {
    serviceLogger.error({ error, key }, 'Redis delete failed');
    throw error;
  }
}

/**
 * Delete multiple keys matching a pattern.
 *
 * @param pattern - Key pattern (e.g., "user:*")
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const keys = await getRedis().keys(pattern);
    if (keys.length > 0) {
      await getRedis().del(...keys);
      serviceLogger.debug({ pattern, count: keys.length }, 'Cache pattern delete');
    }
  } catch (error) {
    serviceLogger.error({ error, pattern }, 'Redis pattern delete failed');
    throw error;
  }
}

/**
 * Check if a key exists in cache.
 *
 * @param key - Cache key
 * @returns true if key exists
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const result = await getRedis().exists(key);
    return result === 1;
  } catch (error) {
    serviceLogger.error({ error, key }, 'Redis exists check failed');
    throw error;
  }
}

/**
 * Set a key only if it doesn't exist (for distributed locks).
 *
 * @param key - Lock key
 * @param value - Lock value (e.g., request ID)
 * @param ttlSeconds - Lock TTL
 * @returns true if lock acquired
 */
export async function cacheSetNx(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<boolean> {
  try {
    const result = await getRedis().set(key, value, { ex: ttlSeconds, nx: true });
    return result === 'OK';
  } catch (error) {
    serviceLogger.error({ error, key }, 'Redis setNx failed');
    throw error;
  }
}

/**
 * Health check for monitoring.
 *
 * @returns Status and latency
 */
export async function checkRedisHealth(): Promise<{
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await getRedis().ping();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cache key builders for consistent key naming.
 */
export const CacheKeys = {
  npi: (npi: string) => `npi:${npi}`,
  smartConfig: (issuer: string) => `smart-config:${issuer}`,
  session: (jti: string) => `session:${jti}`,
} as const;

/**
 * Cache TTL constants (in seconds).
 */
export const CacheTTL = {
  NPI: 3600, // 1 hour
  SMART_CONFIG: 3600, // 1 hour
  SESSION: 900, // 15 minutes (same as JWT expiry)
} as const;
