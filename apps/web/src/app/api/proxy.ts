/**
 * API Proxy Utilities
 *
 * Properly forwards requests to the backend API with:
 * - Cookie header forwarding (request)
 * - Set-Cookie header forwarding (response)
 * - Location header forwarding for redirects (does NOT follow redirects)
 */

function getApiUrl(): string {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error('API_URL environment variable is required');
  }
  return apiUrl;
}

/**
 * Forward a request to the backend API.
 * Does NOT follow redirects - returns them to the browser.
 */
export async function proxyRequest(
  request: Request,
  path: string
): Promise<Response> {
  const method = request.method;
  const cookie = request.headers.get('cookie') || '';
  const contentType = request.headers.get('content-type') || 'application/json';

  const headers: Record<string, string> = {
    'cookie': cookie,
    'content-type': contentType,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    redirect: 'manual', // CRITICAL: Don't follow redirects
  };

  // Forward body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      fetchOptions.body = await request.text();
    } catch {
      // No body
    }
  }

  const response = await fetch(`${getApiUrl()}${path}`, fetchOptions);

  // Build response headers
  const responseHeaders = new Headers();

  // Forward content-type
  const respContentType = response.headers.get('content-type');
  if (respContentType) {
    responseHeaders.set('content-type', respContentType);
  }

  // Forward Location header for redirects
  const location = response.headers.get('location');
  if (location) {
    responseHeaders.set('location', location);
  }

  // Forward Set-Cookie headers (multiple methods for compatibility)
  let setCookieHeaders: string[] = [];

  if (typeof response.headers.getSetCookie === 'function') {
    setCookieHeaders = response.headers.getSetCookie();
  }

  if (setCookieHeaders.length === 0) {
    const allSetCookies: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        allSetCookies.push(value);
      }
    });
    if (allSetCookies.length > 0) {
      setCookieHeaders = allSetCookies;
    }
  }

  if (setCookieHeaders.length === 0) {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      setCookieHeaders = [setCookie];
    }
  }

  for (const c of setCookieHeaders) {
    responseHeaders.append('set-cookie', c);
  }

  // Get response body (empty for redirects)
  let body: string | null = null;
  if (response.status !== 302 && response.status !== 301) {
    body = await response.text();
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

/**
 * Proxy a streaming SSE response.
 */
export async function proxySSE(
  request: Request,
  path: string
): Promise<Response> {
  const cookie = request.headers.get('cookie') || '';
  const contentType = request.headers.get('content-type') || 'application/json';
  // CRITICAL: Forward Accept header - @fastify/sse requires this to set up SSE context
  const accept = request.headers.get('accept') || 'text/event-stream';

  let body: string | undefined;
  try {
    body = await request.text();
  } catch {
    // No body
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'cookie': cookie,
      'content-type': contentType,
      'accept': accept,
    },
    body,
  });

  if (!response.ok) {
    return new Response(await response.text(), {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
      },
    });
  }

  // Stream the SSE response
  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'text/event-stream');
  responseHeaders.set('cache-control', 'no-cache');
  responseHeaders.set('connection', 'keep-alive');

  // Forward Set-Cookie if present
  let setCookieHeaders: string[] = [];
  if (typeof response.headers.getSetCookie === 'function') {
    setCookieHeaders = response.headers.getSetCookie();
  }
  for (const c of setCookieHeaders) {
    responseHeaders.append('set-cookie', c);
  }

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}
