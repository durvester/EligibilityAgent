/**
 * Auth Callback Route Handler
 *
 * Proxies the OAuth callback to the backend, then extracts the session token
 * from the response body and sets it as an HTTP-only cookie.
 *
 * This approach is necessary because Set-Cookie header forwarding through
 * fetch() in Node.js is unreliable.
 */

import { cookies } from 'next/headers';

function getApiUrl(): string {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error('API_URL environment variable is required');
  }
  return apiUrl;
}

export async function POST(request: Request) {
  // Get request body
  let body: string | undefined;
  try {
    body = await request.text();
  } catch {
    // No body
  }

  // Proxy to backend
  const response = await fetch(`${getApiUrl()}/auth/callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body,
  });

  // Parse response
  const data = await response.json();

  // If successful and contains session token, set cookie
  if (response.ok && data.success && data._sessionToken) {
    const cookieStore = await cookies();
    const opts = data._cookieOptions || {};

    // Set the session cookie
    cookieStore.set(opts.name || 'eligibility_session', data._sessionToken, {
      httpOnly: opts.httpOnly ?? true,
      secure: opts.secure ?? process.env.NODE_ENV === 'production',
      sameSite: opts.sameSite || 'strict',
      path: opts.path || '/',
      maxAge: opts.maxAge || 900,
      // Note: domain is intentionally omitted - let browser use request origin
    });

    console.log('[AUTH CALLBACK] Cookie set successfully:', {
      name: opts.name || 'eligibility_session',
      hasToken: !!data._sessionToken,
      tokenLength: data._sessionToken?.length,
      maxAge: opts.maxAge || 900,
    });

    // Remove internal fields from response to client
    const { _sessionToken, _cookieOptions, ...clientData } = data;

    return new Response(JSON.stringify(clientData), {
      status: response.status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  // Error or no session - return as-is
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      'content-type': 'application/json',
    },
  });
}
