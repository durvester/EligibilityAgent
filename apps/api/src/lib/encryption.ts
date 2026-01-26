import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { serviceLogger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Cached base encryption key (derived once, reused)
let cachedBaseKey: Buffer | null = null;
let cachedKeySource: string | null = null;

/**
 * Get encryption key from environment.
 * Caches the derived key to avoid repeated scrypt calls.
 * In production, throws if not set. In development, uses fallback.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  const keySource = key || 'dev-fallback';

  // Return cached key if source hasn't changed
  if (cachedBaseKey && cachedKeySource === keySource) {
    return cachedBaseKey;
  }

  if (!key) {
    // In production, require a proper key
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY is required in production. ' +
        'Generate with: openssl rand -base64 32'
      );
    }

    // Development fallback only
    serviceLogger.warn({}, 'ENCRYPTION_KEY not set - using development fallback');
    cachedBaseKey = scryptSync('dev-fallback-key-not-for-production', 'salt', 32);
    cachedKeySource = keySource;
    return cachedBaseKey;
  }

  // Derive and cache the key
  cachedBaseKey = scryptSync(key, 'eligibility-agent-salt', 32);
  cachedKeySource = keySource;
  return cachedBaseKey;
}

/**
 * Encrypt a string value
 * Returns base64 encoded string: salt:iv:authTag:encrypted
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);

  // Derive a unique key for this encryption using the salt
  const derivedKey = scryptSync(key, salt, 32);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine salt, iv, authTag, and encrypted data
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt an encrypted string
 * Expects base64 encoded string: salt:iv:authTag:encrypted
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();

  const [saltB64, ivB64, authTagB64, encrypted] = encryptedData.split(':');

  if (!saltB64 || !ivB64 || !authTagB64 || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  // Derive the same key used for encryption
  const derivedKey = scryptSync(key, salt, 32);

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
