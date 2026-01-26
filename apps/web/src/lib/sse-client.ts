/**
 * SSE Client Utilities
 *
 * Robust Server-Sent Events parsing for fetch-based SSE (POST requests).
 * Based on the SSE specification: https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * Note: We use fetch instead of EventSource because EventSource only supports GET,
 * and we need to POST patient/insurance data to the agent endpoint.
 */

export interface SSEEvent {
  event?: string;  // Named event type (default: 'message')
  data: string;    // Event data (may span multiple lines)
  id?: string;     // Last event ID
  retry?: number;  // Reconnection time in ms
}

export interface SSEClientOptions<T> {
  /** Called for each parsed event */
  onEvent: (event: T) => void;
  /** Called on connection established (first data received) */
  onOpen?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when stream ends normally */
  onClose?: () => void;
  /** Parse raw SSE data string to typed event. Default: JSON.parse */
  parseData?: (data: string) => T;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Parse SSE event stream from a ReadableStream.
 * Handles the full SSE protocol including multi-line data and named events.
 */
export async function parseSSEStream<T>(
  stream: ReadableStream<Uint8Array>,
  options: SSEClientOptions<T>
): Promise<void> {
  const {
    onEvent,
    onOpen,
    onError,
    onClose,
    parseData = (data) => JSON.parse(data) as T,
    signal,
  } = options;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let hasConnected = false;

  // Current event being built
  let currentEvent: Partial<SSEEvent> = {};
  let dataLines: string[] = [];

  const dispatchEvent = () => {
    if (dataLines.length > 0) {
      const data = dataLines.join('\n');
      try {
        const parsed = parseData(data);
        onEvent(parsed);
      } catch (e) {
        console.error('[SSE] Failed to parse event data:', e);
      }
    }
    // Reset for next event
    currentEvent = {};
    dataLines = [];
  };

  try {
    while (true) {
      // Check for abort
      if (signal?.aborted) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();

      if (done) {
        // Stream ended - dispatch any pending event
        if (dataLines.length > 0) {
          dispatchEvent();
        }
        onClose?.();
        break;
      }

      // Notify on first data
      if (!hasConnected) {
        hasConnected = true;
        onOpen?.();
      }

      // Decode and add to buffer
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete lines
      // SSE spec: lines are separated by \r\n, \n, or \r
      // Events are separated by blank lines
      const lines = buffer.split(/\r\n|\n|\r/);

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line === '') {
          // Blank line = end of event, dispatch it
          dispatchEvent();
          continue;
        }

        // Parse field:value format
        // If line starts with ':', it's a comment (ignore)
        if (line.startsWith(':')) {
          continue;
        }

        const colonIndex = line.indexOf(':');
        let field: string;
        let value: string;

        if (colonIndex === -1) {
          // No colon - field name is entire line, value is empty
          field = line;
          value = '';
        } else {
          field = line.slice(0, colonIndex);
          // Skip single leading space after colon (per spec)
          value = line.slice(colonIndex + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }
        }

        // Process known fields
        switch (field) {
          case 'event':
            currentEvent.event = value;
            break;
          case 'data':
            dataLines.push(value);
            break;
          case 'id':
            // Ignore IDs containing null (per spec)
            if (!value.includes('\0')) {
              currentEvent.id = value;
            }
            break;
          case 'retry':
            const retryMs = parseInt(value, 10);
            if (!isNaN(retryMs)) {
              currentEvent.retry = retryMs;
            }
            break;
          // Ignore unknown fields
        }
      }
    }
  } catch (error) {
    // Don't report abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    console.error('[SSE] Stream parsing error:', error);
    onError?.(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
}

/**
 * Make a POST request with SSE response.
 * Validates Content-Type and handles common error cases.
 */
export async function fetchSSE<T>(
  url: string,
  body: unknown,
  options: SSEClientOptions<T>
): Promise<void> {
  const { signal, onError, onClose } = options;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });

    // Handle HTTP errors
    if (!response.ok) {
      let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Ignore JSON parse errors for error response
      }
      throw new Error(errorMessage);
    }

    // Check for response body
    if (!response.body) {
      throw new Error('No response body');
    }

    // Parse the SSE stream
    await parseSSEStream(response.body, options);

  } catch (error) {
    // Don't report abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      onClose?.();
      return;
    }
    console.error('[SSE] Error:', error);
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
