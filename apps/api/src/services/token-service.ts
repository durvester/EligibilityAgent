import { prisma } from '@eligibility-agent/db';
import { encrypt, decrypt } from '../lib/encryption.js';
import axios from 'axios';

/**
 * Token Service - Handles OAuth token storage, retrieval, and refresh
 *
 * Tokens are encrypted at rest using AES-256-GCM.
 * Refresh tokens are used to obtain new access tokens before expiration.
 */

interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  patientId: string | null;
  fhirBaseUrl: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  patient?: string;
}

// Buffer time before expiration to trigger refresh (5 minutes)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Store tokens in PostgreSQL with encryption
 */
export async function storeToken(
  tenantId: string,
  userFhirId: string | null,
  accessToken: string,
  refreshToken: string | null,
  expiresIn: number, // seconds
  patientId: string | null,
  scope: string | null
): Promise<string> {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Encrypt tokens before storage
  const accessTokenEncrypted = encrypt(accessToken);
  const refreshTokenEncrypted = refreshToken ? encrypt(refreshToken) : null;

  const token = await prisma.oAuthToken.create({
    data: {
      tenantId,
      userFhirId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      expiresAt,
      patientId,
      scope,
    },
  });

  return token.id;
}

/**
 * Get a valid token, refreshing if necessary
 */
export async function getValidToken(
  tokenId: string,
  fhirBaseUrl: string
): Promise<StoredToken | null> {
  const token = await prisma.oAuthToken.findUnique({
    where: { id: tokenId },
  });

  if (!token) {
    return null;
  }

  // Decrypt the access token
  const accessToken = decrypt(token.accessTokenEncrypted);
  const refreshToken = token.refreshTokenEncrypted
    ? decrypt(token.refreshTokenEncrypted)
    : null;

  // Check if token needs refresh
  const needsRefresh = token.expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

  if (needsRefresh && refreshToken) {
    // Attempt to refresh the token
    const refreshedToken = await refreshAccessToken(
      tokenId,
      refreshToken,
      fhirBaseUrl
    );

    if (refreshedToken) {
      return refreshedToken;
    }
  }

  // Return existing token if still valid or refresh failed
  if (token.expiresAt.getTime() > Date.now()) {
    return {
      accessToken,
      refreshToken,
      expiresAt: token.expiresAt,
      patientId: token.patientId,
      fhirBaseUrl,
    };
  }

  // Token expired and couldn't refresh
  return null;
}

/**
 * Get token by patient ID and tenant
 */
export async function getTokenByPatient(
  tenantId: string,
  patientId: string,
  fhirBaseUrl: string
): Promise<StoredToken | null> {
  const token = await prisma.oAuthToken.findFirst({
    where: {
      tenantId,
      patientId,
      expiresAt: { gt: new Date() }, // Not expired
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    return null;
  }

  return getValidToken(token.id, fhirBaseUrl);
}

/**
 * Refresh an access token using the refresh token
 */
async function refreshAccessToken(
  tokenId: string,
  refreshToken: string,
  fhirBaseUrl: string
): Promise<StoredToken | null> {
  try {
    // Discover token endpoint
    const smartConfig = await discoverTokenEndpoint(fhirBaseUrl);

    const response = await axios.post<TokenResponse>(
      smartConfig.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.PF_CLIENT_ID || '',
        client_secret: process.env.PF_CLIENT_SECRET || '',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );

    const data = response.data;
    const expiresIn = data.expires_in || 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Encrypt new tokens
    const accessTokenEncrypted = encrypt(data.access_token);
    const refreshTokenEncrypted = data.refresh_token
      ? encrypt(data.refresh_token)
      : encrypt(refreshToken); // Keep old refresh token if new one not provided

    // Update token in database
    await prisma.oAuthToken.update({
      where: { id: tokenId },
      data: {
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        updatedAt: new Date(),
      },
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt,
      patientId: data.patient || null,
      fhirBaseUrl,
    };
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
}

/**
 * Discover token endpoint from FHIR server
 */
async function discoverTokenEndpoint(
  fhirBaseUrl: string
): Promise<{ tokenEndpoint: string }> {
  const baseUrl = fhirBaseUrl.replace(/\/$/, '');

  // Try .well-known/smart-configuration
  try {
    const response = await axios.get(`${baseUrl}/.well-known/smart-configuration`, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    return { tokenEndpoint: response.data.token_endpoint };
  } catch {
    // Fall back to metadata
  }

  // Try metadata endpoint
  const metadataResponse = await axios.get(`${baseUrl}/metadata`, {
    timeout: 10000,
    headers: { Accept: 'application/fhir+json' },
  });

  const security = metadataResponse.data.rest?.[0]?.security;
  const oauthExtension = security?.extension?.find(
    (ext: { url: string }) =>
      ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
  );

  const tokenUrl = oauthExtension?.extension?.find(
    (e: { url: string }) => e.url === 'token'
  )?.valueUri;

  if (!tokenUrl) {
    throw new Error('Could not discover token endpoint');
  }

  return { tokenEndpoint: tokenUrl };
}

/**
 * Delete expired tokens (cleanup job)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.oAuthToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}

/**
 * Revoke a token (delete from database)
 */
export async function revokeToken(tokenId: string): Promise<void> {
  await prisma.oAuthToken.delete({
    where: { id: tokenId },
  });
}
