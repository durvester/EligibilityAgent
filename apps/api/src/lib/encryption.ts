import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment or generate a warning
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    console.warn(
      '[SECURITY WARNING] ENCRYPTION_KEY not set. Using fallback key for development only. ' +
      'Generate a secure key with: openssl rand -base64 32'
    );
    // Fallback for development - DO NOT use in production
    return scryptSync('dev-fallback-key-not-for-production', 'salt', 32);
  }

  // Derive a 32-byte key from the provided key
  return scryptSync(key, 'eligibility-agent-salt', 32);
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
