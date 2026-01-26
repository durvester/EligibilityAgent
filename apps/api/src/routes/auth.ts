import { FastifyPluginAsync } from 'fastify';
import { v4 as uuid } from 'uuid';
import axios from 'axios';
import * as tokenService from '../services/token-service.js';

interface LaunchQuery {
  iss: string;
  launch: string;
}

interface CallbackBody {
  code: string;
  state: string;
}

interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported?: string[];
  scopes_supported?: string[];
  capabilities?: string[];
}

interface LaunchState {
  iss: string;
  launch: string;
  authorizeUrl: string;
  tokenUrl: string;
  createdAt: number;
}

// In-memory state store (use Redis/DB in production)
const stateStore = new Map<string, LaunchState>();

// Cache for SMART configurations (avoid repeated discovery calls)
const smartConfigCache = new Map<string, { config: SmartConfiguration; expiresAt: number }>();

/**
 * Discover SMART configuration from FHIR server
 * Follows SMART on FHIR spec: try .well-known/smart-configuration first,
 * then fall back to metadata endpoint
 */
async function discoverSmartConfiguration(iss: string): Promise<SmartConfiguration> {
  // Check cache first
  const cached = smartConfigCache.get(iss);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  // Normalize ISS (remove trailing slash)
  const baseUrl = iss.replace(/\/$/, '');

  // Try .well-known/smart-configuration first (preferred)
  try {
    const wellKnownUrl = `${baseUrl}/.well-known/smart-configuration`;
    const response = await axios.get<SmartConfiguration>(wellKnownUrl, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const config = response.data;

    // Cache for 1 hour
    smartConfigCache.set(iss, {
      config,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return config;
  } catch (wellKnownError) {
    console.log(`[SMART] .well-known/smart-configuration not found for ${iss}, trying metadata`);
  }

  // Fall back to FHIR metadata endpoint
  try {
    const metadataUrl = `${baseUrl}/metadata`;
    const response = await axios.get(metadataUrl, {
      timeout: 10000,
      headers: { Accept: 'application/fhir+json' },
    });

    const metadata = response.data;

    // Extract OAuth endpoints from CapabilityStatement
    const security = metadata.rest?.[0]?.security;
    const oauthExtension = security?.extension?.find(
      (ext: any) => ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
    );

    if (!oauthExtension) {
      throw new Error('No OAuth configuration found in FHIR metadata');
    }

    const authorizeUrl = oauthExtension.extension?.find((e: any) => e.url === 'authorize')?.valueUri;
    const tokenUrl = oauthExtension.extension?.find((e: any) => e.url === 'token')?.valueUri;

    if (!authorizeUrl || !tokenUrl) {
      throw new Error('Missing authorize or token URL in FHIR metadata');
    }

    const config: SmartConfiguration = {
      authorization_endpoint: authorizeUrl,
      token_endpoint: tokenUrl,
    };

    // Cache for 1 hour
    smartConfigCache.set(iss, {
      config,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return config;
  } catch (metadataError) {
    throw new Error(`Failed to discover SMART configuration for ${iss}`);
  }
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * SMART on FHIR Launch
   *
   * 1. Receive iss (FHIR base URL) and launch token from EHR
   * 2. Discover OAuth endpoints from iss via .well-known or metadata
   * 3. Redirect to authorization endpoint
   */
  fastify.get<{ Querystring: LaunchQuery }>('/launch', async (request, reply) => {
    const { iss, launch } = request.query;

    if (!iss || !launch) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_LAUNCH', message: 'Missing iss or launch parameter' },
      });
    }

    fastify.log.info({ iss, launch }, 'SMART launch initiated');

    try {
      // Discover SMART configuration from the FHIR server
      const smartConfig = await discoverSmartConfiguration(iss);

      fastify.log.info({
        iss,
        authorizeUrl: smartConfig.authorization_endpoint,
        tokenUrl: smartConfig.token_endpoint
      }, 'SMART configuration discovered');

      // Generate state for CSRF protection
      const state = uuid();
      stateStore.set(state, {
        iss,
        launch,
        authorizeUrl: smartConfig.authorization_endpoint,
        tokenUrl: smartConfig.token_endpoint,
        createdAt: Date.now(),
      });

      // Clean up old states (older than 10 minutes)
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      for (const [key, value] of stateStore.entries()) {
        if (value.createdAt < tenMinutesAgo) {
          stateStore.delete(key);
        }
      }

      // Build authorization URL
      const redirectUri = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/callback`
        : 'http://localhost:3000/callback';

      const authorizeUrl = new URL(smartConfig.authorization_endpoint);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', process.env.PF_CLIENT_ID || '');
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('scope', process.env.PF_SCOPES || 'launch/patient openid fhirUser patient/Patient.read patient/Coverage.read');
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('launch', launch);
      authorizeUrl.searchParams.set('aud', iss); // The FHIR server URL

      fastify.log.info({ authorizeUrl: authorizeUrl.toString() }, 'Redirecting to authorization');

      return reply.redirect(authorizeUrl.toString());
    } catch (error) {
      fastify.log.error(error, 'SMART discovery failed');

      return reply.status(500).send({
        success: false,
        error: {
          code: 'DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to discover SMART configuration',
        },
      });
    }
  });

  /**
   * OAuth Callback
   * Exchange authorization code for access token
   */
  fastify.post<{ Body: CallbackBody }>('/callback', async (request, reply) => {
    const { code, state } = request.body;

    if (!code || !state) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_CALLBACK', message: 'Missing code or state' },
      });
    }

    // Validate state and get stored launch context
    const launchState = stateStore.get(state);
    if (!launchState) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Invalid or expired state' },
      });
    }
    stateStore.delete(state);

    const redirectUri = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/callback`
      : 'http://localhost:3000/callback';

    try {
      // Exchange code for token using discovered token endpoint
      const tokenResponse = await axios.post(
        launchState.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: process.env.PF_CLIENT_ID || '',
          client_secret: process.env.PF_CLIENT_SECRET || '',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      const tokenData = tokenResponse.data;

      // Decode id_token to extract fhirUser claim if present
      // The fhirUser claim contains the FHIR resource reference of the logged-in user
      // e.g., "Practitioner/abc123" or "https://fhir.server.com/Practitioner/abc123"
      let fhirUser: string | undefined = tokenData.fhirUser;
      if (!fhirUser && tokenData.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokenData.id_token.split('.');
          if (parts.length >= 2) {
            // Decode payload (second part) - handle both base64url and regular base64
            let payloadStr: string;
            try {
              payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
            } catch {
              // Fallback to regular base64 with URL-safe character replacement
              const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
              payloadStr = Buffer.from(base64, 'base64').toString('utf8');
            }
            const payload = JSON.parse(payloadStr);

            // Try different claim names (SMART spec uses fhirUser, but some servers vary)
            fhirUser = payload.fhirUser
              || payload['fhirUser']
              || payload.fhir_user
              || payload.profile  // Some OIDC providers use 'profile' for the user reference
              || payload.sub;  // 'sub' might contain the practitioner reference

            fastify.log.info({
              fhirUser,
              payloadKeys: Object.keys(payload),
              sub: payload.sub,
              profile: payload.profile,
            }, 'Decoded id_token payload');
          }
        } catch (decodeErr) {
          fastify.log.warn({ error: decodeErr }, 'Failed to decode id_token');
        }
      }

      fastify.log.info({
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        hasIdToken: !!tokenData.id_token,
        patient: tokenData.patient,
        fhirUser,
        expiresIn: tokenData.expires_in,
      }, 'Token exchange successful');

      // Store token in database (encrypted) if DATABASE_URL is configured
      let tokenId: string | null = null;
      if (process.env.DATABASE_URL) {
        try {
          // Default tenant ID for now - in production, derive from iss or client config
          const tenantId = process.env.DEFAULT_TENANT_ID || 'default-tenant';

          tokenId = await tokenService.storeToken(
            tenantId,
            null, // userFhirId - not available at this point
            tokenData.access_token,
            tokenData.refresh_token || null,
            tokenData.expires_in || 3600,
            tokenData.patient || null,
            tokenData.scope || null
          );

          fastify.log.info({ tokenId }, 'Token stored in database');
        } catch (dbError) {
          // Log but don't fail - allow session-based flow as fallback
          fastify.log.warn({ error: dbError }, 'Failed to store token in database, using session fallback');
        }
      }

      return {
        success: true,
        access_token: tokenData.access_token,
        token_type: tokenData.token_type || 'Bearer',
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        patient: tokenData.patient, // Patient ID from launch context
        fhirBaseUrl: launchState.iss, // Return the FHIR base URL for subsequent calls
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token, // Contains fhirUser claim for logged-in user
        fhirUser, // Practitioner reference extracted from id_token (e.g., "Practitioner/123")
        tokenId, // Return tokenId for future database lookups
      };
    } catch (error) {
      fastify.log.error(error, 'Token exchange failed');

      if (axios.isAxiosError(error) && error.response) {
        return reply.status(error.response.status).send({
          success: false,
          error: {
            code: 'TOKEN_EXCHANGE_FAILED',
            message: error.response.data?.error_description || error.response.data?.error || 'Token exchange failed',
          },
        });
      }

      return reply.status(500).send({
        success: false,
        error: { code: 'TOKEN_EXCHANGE_FAILED', message: 'Token exchange failed' },
      });
    }
  });

  /**
   * Token refresh endpoint
   */
  fastify.post<{ Body: { refresh_token: string; fhir_base_url: string } }>('/refresh', async (request, reply) => {
    const { refresh_token, fhir_base_url } = request.body;

    if (!refresh_token || !fhir_base_url) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Missing refresh_token or fhir_base_url' },
      });
    }

    try {
      // Discover token endpoint from the FHIR server
      const smartConfig = await discoverSmartConfiguration(fhir_base_url);

      const tokenResponse = await axios.post(
        smartConfig.token_endpoint,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: process.env.PF_CLIENT_ID || '',
          client_secret: process.env.PF_CLIENT_SECRET || '',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000,
        }
      );

      return {
        success: true,
        access_token: tokenResponse.data.access_token,
        token_type: tokenResponse.data.token_type || 'Bearer',
        expires_in: tokenResponse.data.expires_in,
        refresh_token: tokenResponse.data.refresh_token,
      };
    } catch (error) {
      fastify.log.error(error, 'Token refresh failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'REFRESH_FAILED', message: 'Token refresh failed' },
      });
    }
  });
};

export default authRoutes;
