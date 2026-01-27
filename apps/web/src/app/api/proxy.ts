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

// Debug logging for cookie flow
function debugLog(context: string, data: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROXY === 'true') {
    console.log(`[PROXY DEBUG] ${context}:`, JSON.stringify(data, null, 2));
  } else {
    // In production, log to stdout for Fly.io logs
    console.log(`[PROXY] ${context}:`, JSON.stringify(data));
  }
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

  debugLog(`${method} ${path} - incoming request`, {
    hasCookie: !!cookie,
    cookieLength: cookie.length,
    // Only log first 50 chars of cookie for security
    cookiePreview: cookie ? cookie.substring(0, 50) + '...' : '(none)',
  });

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

  const apiUrl = getApiUrl();
  const fullUrl = `${apiUrl}${path}`;

  debugLog(`${method} ${path} - proxying to`, { fullUrl });

  const response = await fetch(fullUrl, fetchOptions);

  debugLog(`${method} ${path} - response status`, {
    status: response.status,
    statusText: response.statusText,
  });

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

  // Forward Set-Cookie headers - CRITICAL for auth flow
  // Try getSetCookie() first (Node.js 18.14+), then fall back to get()
  let setCookieHeaders: string[] = [];

  // Method 1: getSetCookie() - preferred, returns array
  if (typeof response.headers.getSetCookie === 'function') {
    setCookieHeaders = response.headers.getSetCookie();
    debugLog(`${method} ${path} - getSetCookie() result`, {
      count: setCookieHeaders.length,
      cookies: setCookieHeaders.map(c => c.substring(0, 80) + '...'),
    });
  }

  // Method 2: Iterate all headers (some environments need this)
  if (setCookieHeaders.length === 0) {
    const allSetCookies: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        allSetCookies.push(value);
      }
    });
    if (allSetCookies.length > 0) {
      setCookieHeaders = allSetCookies;
      debugLog(`${method} ${path} - forEach() found set-cookie`, {
        count: allSetCookies.length,
      });
    }
  }

  // Method 3: Raw header get (last resort, may miss multiple cookies)
  if (setCookieHeaders.length === 0) {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      setCookieHeaders = [setCookie];
      debugLog(`${method} ${path} - get('set-cookie') fallback`, {
        found: true,
        preview: setCookie.substring(0, 80) + '...',
      });
    }
  }

  // Append all found Set-Cookie headers
  for (const c of setCookieHeaders) {
    responseHeaders.append('set-cookie', c);
  }

  debugLog(`${method} ${path} - final response headers`, {
    hasSetCookie: setCookieHeaders.length > 0,
    setCookieCount: setCookieHeaders.length,
    contentType: respContentType,
    hasLocation: !!location,
  });

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

  debugLog(`SSE ${path} - incoming request`, {
    hasCookie: !!cookie,
    cookieLength: cookie.length,
    cookiePreview: cookie ? cookie.substring(0, 50) + '...' : '(none)',
  });

  let body: string | undefined;
  try {
    body = await request.text();
  } catch {
    // No body
  }

  const apiUrl = getApiUrl();
  const fullUrl = `${apiUrl}${path}`;

  debugLog(`SSE ${path} - proxying to`, { fullUrl });

  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'cookie': cookie,
      'content-type': contentType,
    },
    body,
  });

  debugLog(`SSE ${path} - response status`, {
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    debugLog(`SSE ${path} - error response`, {
      body: errorBody.substring(0, 200),
    });
    return new Response(errorBody, {
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
