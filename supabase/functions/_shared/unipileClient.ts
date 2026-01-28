/**
 * Centralized Unipile API Client
 * Features:
 * - Retry with exponential backoff
 * - Respect Retry-After header for 429
 * - Correlation ID per request
 * - Structured error handling
 * - Configurable timeout
 */

import { createLogger, Logger } from "./log.ts";

// ============= CONFIGURATION =============

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

// ============= TYPES =============

export interface UnipileClientConfig {
  dsn: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
}

export interface UnipileRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | FormData;
  query?: Record<string, string | string[]>;
  timeoutMs?: number;
  skipRetry?: boolean;
}

export interface UnipileResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers: Headers;
}

export class UnipileHttpError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly body: string;
  public readonly correlationId: string;
  public readonly isSessionError: boolean;
  public readonly requiresReconnect: boolean;

  constructor(
    status: number,
    url: string,
    body: string,
    correlationId: string
  ) {
    super(`Unipile API error: HTTP ${status} - ${url}`);
    this.name = 'UnipileHttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.correlationId = correlationId;
    
    // Detect session/checkpoint issues
    const lowerBody = body.toLowerCase();
    this.isSessionError = 
      status === 401 ||
      status === 403 ||
      lowerBody.includes('session_mismatch') ||
      lowerBody.includes('action_required') ||
      lowerBody.includes('checkpoint') ||
      lowerBody.includes('no_client_session') ||
      lowerBody.includes('account not found') ||
      lowerBody.includes('disconnected');
    
    this.requiresReconnect = this.isSessionError;
  }
}

// ============= CLIENT =============

export function createUnipileClient(config: UnipileClientConfig) {
  const { dsn, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_MAX_RETRIES } = config;
  const baseUrl = `https://${dsn}/api/v1`;
  const logger = config.logger || createLogger('unipile-client');

  /**
   * Calculate delay with exponential backoff
   */
  function getBackoffDelay(attempt: number, retryAfterHeader?: string | null): number {
    // Respect Retry-After header if present
    if (retryAfterHeader) {
      const retryAfterSeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS);
      }
    }
    
    // Exponential backoff with jitter
    const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
  }

  /**
   * Check if error is retryable
   */
  function isRetryable(status: number, body: string): boolean {
    // Retry on rate limit
    if (status === 429) return true;
    
    // Retry on server errors
    if (status >= 500 && status < 600) return true;
    
    // Don't retry on auth errors (need reconnect)
    if (status === 401 || status === 403) return false;
    
    // Don't retry on client errors
    if (status >= 400 && status < 500) return false;
    
    return false;
  }

  /**
   * Make a request to Unipile API
   */
  async function request<T = unknown>(
    path: string,
    options: UnipileRequestOptions = {}
  ): Promise<UnipileResponse<T>> {
    const {
      method = 'GET',
      body,
      query,
      timeoutMs: requestTimeout = timeoutMs,
      skipRetry = false,
    } = options;

    // Build URL
    const url = new URL(`${baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, v));
        } else {
          url.searchParams.set(key, value);
        }
      }
    }

    // Prepare headers
    const headers: HeadersInit = {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
      'X-Correlation-ID': logger.correlationId,
    };

    // Prepare body
    let requestBody: BodyInit | undefined;
    if (body) {
      if (body instanceof FormData) {
        requestBody = body;
        // Don't set Content-Type for FormData - browser sets it with boundary
      } else {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      }
    }

    let lastError: Error | null = null;
    const maxAttempts = skipRetry ? 1 : maxRetries;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

      try {
        logger.debug(`Request attempt ${attempt + 1}/${maxAttempts}`, {
          method,
          url: url.toString(),
          hasBody: !!body,
        });

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: requestBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json().catch(() => ({})) as T;
          logger.info(`Request successful`, {
            method,
            path,
            status: response.status,
            attempt: attempt + 1,
          });
          return {
            ok: true,
            status: response.status,
            data,
            headers: response.headers,
          };
        }

        // Handle error response
        const errorBody = await response.text().catch(() => '');
        
        logger.warn(`Request failed`, {
          method,
          path,
          status: response.status,
          attempt: attempt + 1,
          body: errorBody.substring(0, 500),
        });

        // Check if retryable
        if (!skipRetry && isRetryable(response.status, errorBody) && attempt < maxAttempts - 1) {
          const delay = getBackoffDelay(attempt, response.headers.get('Retry-After'));
          logger.info(`Retrying in ${delay}ms`, { attempt: attempt + 1, delay });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Not retryable or last attempt - throw error
        throw new UnipileHttpError(
          response.status,
          url.toString(),
          errorBody,
          logger.correlationId
        );

      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof UnipileHttpError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${requestTimeout}ms`);
          logger.warn(`Request timeout`, { method, path, attempt: attempt + 1, timeoutMs: requestTimeout });
          
          // Retry on timeout
          if (!skipRetry && attempt < maxAttempts - 1) {
            const delay = getBackoffDelay(attempt);
            logger.info(`Retrying after timeout in ${delay}ms`, { attempt: attempt + 1 });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.error(`Request error`, lastError, { method, path, attempt: attempt + 1 });
          
          // Retry on network errors
          if (!skipRetry && attempt < maxAttempts - 1) {
            const delay = getBackoffDelay(attempt);
            logger.info(`Retrying after error in ${delay}ms`, { attempt: attempt + 1 });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error('Request failed after all retries');
  }

  // ============= CONVENIENCE METHODS =============

  async function get<T = unknown>(
    path: string,
    query?: Record<string, string | string[]>,
    options?: Omit<UnipileRequestOptions, 'method' | 'query'>
  ): Promise<UnipileResponse<T>> {
    return request<T>(path, { ...options, method: 'GET', query });
  }

  async function post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | FormData,
    options?: Omit<UnipileRequestOptions, 'method' | 'body'>
  ): Promise<UnipileResponse<T>> {
    return request<T>(path, { ...options, method: 'POST', body });
  }

  async function put<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
    options?: Omit<UnipileRequestOptions, 'method' | 'body'>
  ): Promise<UnipileResponse<T>> {
    return request<T>(path, { ...options, method: 'PUT', body });
  }

  async function patch<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
    options?: Omit<UnipileRequestOptions, 'method' | 'body'>
  ): Promise<UnipileResponse<T>> {
    return request<T>(path, { ...options, method: 'PATCH', body });
  }

  async function del<T = unknown>(
    path: string,
    options?: Omit<UnipileRequestOptions, 'method'>
  ): Promise<UnipileResponse<T>> {
    return request<T>(path, { ...options, method: 'DELETE' });
  }

  return {
    request,
    get,
    post,
    put,
    patch,
    delete: del,
    correlationId: logger.correlationId,
    logger,
  };
}

export type UnipileClient = ReturnType<typeof createUnipileClient>;

// ============= FACTORY HELPER =============

/**
 * Create Unipile client from environment variables
 */
export function createUnipileClientFromEnv(loggerName?: string): UnipileClient {
  const dsn = Deno.env.get('UNIPILE_DSN');
  const apiKey = Deno.env.get('UNIPILE_API_KEY');
  const timeoutMs = parseInt(Deno.env.get('UNIPILE_TIMEOUT_MS') || '', 10) || DEFAULT_TIMEOUT_MS;
  const maxRetries = parseInt(Deno.env.get('UNIPILE_MAX_RETRIES') || '', 10) || DEFAULT_MAX_RETRIES;

  if (!dsn || !apiKey) {
    throw new Error('UNIPILE_DSN and UNIPILE_API_KEY must be set');
  }

  return createUnipileClient({
    dsn,
    apiKey,
    timeoutMs,
    maxRetries,
    logger: loggerName ? createLogger(loggerName) : undefined,
  });
}
