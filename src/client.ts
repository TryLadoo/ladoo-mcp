import type { paths } from "./generated/openapi.js";
import { API_VERSION, DEFAULT_BASE_URL, VERSION } from "./version.js";

type Method = "get" | "post" | "patch" | "put" | "delete";
type Op<P extends keyof paths, M extends Method> = paths[P][M];

/** Paths that have an operation for method `M`. */
export type PathsFor<M extends Method> = {
  [P in keyof paths]: [Op<P, M>] extends [undefined] ? never : P;
}[keyof paths];

type PathParams<O> = O extends { parameters: { path: infer X } } ? X : never;
type QueryParams<O> = O extends { parameters: { query?: infer Q } } ? Q : never;
type JsonBody<O> = O extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;
type JsonResponse<O> = O extends { responses: infer R }
  ? {
      [C in keyof R]: C extends 200 | 201 | 202
        ? R[C] extends { content: { "application/json": infer J } }
          ? J
          : undefined
        : never;
    }[keyof R]
  : never;

export type RequestOptions<O> = ([PathParams<O>] extends [never] ? { path?: undefined } : { path: PathParams<O> }) & {
  query?: QueryParams<O>;
  body?: JsonBody<O>;
  /** Sent as `Idempotency-Key` on POSTs. One is generated when left out, and reused on retries. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type Response<P extends keyof paths, M extends Method> = JsonResponse<Op<P, M>>;

export interface LadooClientOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  apiVersion?: string;
  /** Retries for 429s, 5xx responses and network errors. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 30 000. */
  timeoutMs?: number;
  /** The longest `Retry-After` worth waiting for inside one tool call, in seconds. Default 10. */
  maxRetryAfterSeconds?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

/** An error response from the Ladoo API, in its documented `{ error: { code, message } }` shape. */
export class LadooApiError extends Error {
  override readonly name = "LadooApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | undefined,
    readonly requestId: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message);
  }
}

export class MissingApiKeyError extends Error {
  override readonly name = "MissingApiKeyError";
  constructor() {
    super(
      "LADOO_API_KEY is not set. Create a key in Ladoo under Settings → Developers and add it to this server's environment.",
    );
  }
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

/**
 * A small typed client for the parts of the Ladoo API this server uses.
 * Paths, parameters and responses are typed from the OpenAPI snapshot in `openapi/`.
 */
export class LadooClient {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: string;
  readonly #apiVersion: string;
  readonly #maxRetries: number;
  readonly #timeoutMs: number;
  readonly #maxRetryAfter: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #userAgent: string;

  constructor(options: LadooClientOptions) {
    this.#apiKey = options.apiKey?.trim() || undefined;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#apiVersion = options.apiVersion ?? API_VERSION;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRetryAfter = options.maxRetryAfterSeconds ?? 10;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#userAgent = options.userAgent ?? `ladoo-mcp/${VERSION}`;
  }

  get hasApiKey(): boolean {
    return this.#apiKey !== undefined;
  }

  get<P extends PathsFor<"get">>(path: P, options?: RequestOptions<Op<P, "get">>): Promise<Response<P, "get">> {
    return this.request("GET", path, options);
  }

  post<P extends PathsFor<"post">>(path: P, options?: RequestOptions<Op<P, "post">>): Promise<Response<P, "post">> {
    return this.request("POST", path, options);
  }

  patch<P extends PathsFor<"patch">>(path: P, options?: RequestOptions<Op<P, "patch">>): Promise<Response<P, "patch">> {
    return this.request("PATCH", path, options);
  }

  async request<T>(
    method: string,
    template: string,
    options: {
      path?: Record<string, string | number> | undefined;
      query?: object | undefined;
      body?: unknown;
      idempotencyKey?: string | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<T> {
    if (!this.#apiKey) throw new MissingApiKeyError();

    const url = new URL(this.#baseUrl + expandPath(template, options.path));
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "Ladoo-Version": this.#apiVersion,
      "User-Agent": this.#userAgent,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    if (method === "POST") headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();

    for (let attempt = 0; ; attempt++) {
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(this.#timeoutMs)])
        : AbortSignal.timeout(this.#timeoutMs);
      let response: globalThis.Response;
      try {
        response = await this.#fetch(url, { method, headers, body, signal });
      } catch (error) {
        if (options.signal?.aborted || attempt >= this.#maxRetries) throw error;
        await this.#sleep(backoff(attempt));
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const error = await toApiError(response);
      const waitSeconds = error.retryAfterSeconds;
      const canWait = waitSeconds === undefined || waitSeconds <= this.#maxRetryAfter;
      if (!RETRYABLE(response.status) || attempt >= this.#maxRetries || !canWait) throw error;
      await this.#sleep(waitSeconds !== undefined ? waitSeconds * 1000 : backoff(attempt));
    }
  }
}

function expandPath(template: string, params: Record<string, string | number> | undefined): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === "") throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(value));
  });
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

async function toApiError(response: globalThis.Response): Promise<LadooApiError> {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const error = (payload as { error?: Record<string, unknown> } | undefined)?.error;
  const code = typeof error?.code === "string" ? error.code : `http_${response.status}`;
  const message =
    typeof error?.message === "string" ? error.message : `Ladoo API answered ${response.status} ${response.statusText}`;
  const details =
    error?.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : undefined;
  const requestId = typeof error?.request_id === "string" ? error.request_id : undefined;
  return new LadooApiError(response.status, code, message, details, requestId, retryAfter);
}
