export interface FetchWithRetryOptions {
  /** Abort a single attempt after this many milliseconds. */
  timeoutMs: number;
  /** Extra attempts after the first one. */
  retries?: number;
  /**
   * When false, only 429 responses are retried: the request was rejected before it ran, so repeating it
   * cannot create a duplicate. Use false for non-idempotent calls such as creating a GitHub comment.
   */
  retryUnsafe?: boolean;
  /** Base delay for exponential backoff. */
  baseDelayMs?: number;
  /** Upper bound for any single wait, including a server-provided Retry-After. */
  maxDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * fetch with a per-attempt timeout and bounded retries with exponential backoff.
 * Network errors and timeouts are retried only when `retryUnsafe` is true, because the server may
 * already have processed the request.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: FetchWithRetryOptions): Promise<Response> {
  const retries = options.retries ?? 2;
  const retryUnsafe = options.retryUnsafe ?? true;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= retries;
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
    } catch (error) {
      if (isLastAttempt || !retryUnsafe) {
        throw error;
      }

      await sleep(backoff);
      continue;
    }

    const retryable = response.status === 429 || (retryUnsafe && RETRYABLE_STATUS.has(response.status));
    if (!retryable || isLastAttempt) {
      return response;
    }

    // Drain the body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);
    await sleep(Math.min(maxDelayMs, retryAfterMs(response) ?? backoff));
  }
}
