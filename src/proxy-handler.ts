import * as http from 'http';
import * as https from 'https';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const TIMEOUT_MS = 20_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// Stripped in both directions — connection-management headers make no sense relayed
// through a second hop, `transfer-encoding`/`content-length` would corrupt a buffered
// body relayed as a fresh single write, and `content-encoding` is dropped because the
// response is buffered/decoded as raw bytes here (no zlib re-encoding) — forwarding a
// compressed body labeled with its original encoding would make the browser fail to
// (or wrongly) decode it.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
]);

export const PROXY_ERROR_HEADER = 'x-docfy-proxy-error';

interface RawRequestLike {
  body?: unknown;
  on(event: 'data' | 'end' | 'error', listener: (arg?: unknown) => void): unknown;
}

/**
 * Reads the proxy envelope from the request. Prefers an already-parsed `req.body` (Fastify
 * parses JSON bodies unconditionally as a core feature, so this is always populated there;
 * Express only populates it if a JSON body-parser middleware happened to run *before* this
 * route in the stack — not something `DocfyUiModule.setup()` can guarantee, since it's called
 * directly against the app's HTTP adapter, outside Nest's own route pipeline). Falls back to
 * reading and parsing the raw stream itself so Express works with no assumptions either way.
 */
export function readJsonBody(req: RawRequestLike): Promise<unknown> {
  if (req.body !== undefined) return Promise.resolve(req.body);

  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

export interface ProxyRequestBody {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponderLike {
  status(code: number): this;
  header(name: string, value: string): this;
  send(body: string): unknown;
}

/** Builds the allowlist of origins the proxy is permitted to forward requests to.
 * Only absolute server URLs count — see docfy-ui.module.ts for why there's no
 * implicit "same origin as this request" fallback. */
export function buildAllowedOrigins(
  servers: { url: string }[] | undefined,
  additional: string[] | undefined,
): Set<string> {
  const origins = new Set<string>();
  for (const url of [...(servers ?? []).map((s) => s.url), ...(additional ?? [])]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // Relative or malformed server URL — no safe base to resolve it against, skip.
    }
  }
  return origins;
}

function sendProxyError(res: ProxyResponderLike, status: number, error: string, message: string): void {
  res
    .status(status)
    .header(PROXY_ERROR_HEADER, error)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify({ error, message }));
}

function filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    result[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

interface ForwardResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
}

function forward(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<ForwardResult> {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    // Force uncompressed responses — the body is buffered as raw bytes below with no
    // zlib decoding, so a compressed response would otherwise come through corrupted.
    const outgoingHeaders = { ...headers, 'accept-encoding': 'identity' };
    const req = transport.request(target, { method, headers: outgoingHeaders, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let truncated = false;

      res.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_BODY_BYTES) {
          truncated = true;
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (truncated) {
          reject(new Error('Response body exceeded the proxy size limit.'));
          return;
        }
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Request to the target API timed out.')));
    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Validates and forwards a "Try it out" request to its real target, server-to-server —
 * the browser only ever talks to this same-origin endpoint, so CORS never applies.
 * Success responses are passed through transparently (real status/headers/body from the
 * target); only proxy-level failures set `X-Docfy-Proxy-Error` so the client can tell the
 * two apart.
 */
export async function handleProxyRequest(
  requestBody: unknown,
  allowedOrigins: Set<string>,
  res: ProxyResponderLike,
): Promise<void> {
  if (!requestBody || typeof requestBody !== 'object') {
    sendProxyError(res, 400, 'bad_request', 'Missing or malformed JSON body.');
    return;
  }

  const { method, url, headers, body } = requestBody as ProxyRequestBody;
  if (!method || !url) {
    sendProxyError(res, 400, 'bad_request', 'Both "method" and "url" are required.');
    return;
  }

  const upperMethod = method.toUpperCase();
  if (!ALLOWED_METHODS.has(upperMethod)) {
    sendProxyError(res, 400, 'bad_request', `Unsupported method "${method}".`);
    return;
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    sendProxyError(res, 400, 'invalid_url', `"${url}" is not a valid URL.`);
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    sendProxyError(res, 400, 'invalid_url', `Unsupported protocol "${target.protocol}".`);
    return;
  }

  if (!allowedOrigins.has(target.origin)) {
    sendProxyError(
      res,
      403,
      'origin_not_allowed',
      `"${target.origin}" is not in the allowed server list for this API. Declare it in your OpenAPI "servers" array to allow it.`,
    );
    return;
  }

  try {
    const result = await forward(target, upperMethod, filterHeaders(headers ?? {}), body);
    res.status(result.status);
    for (const [name, value] of Object.entries(filterHeaders(result.headers))) {
      res.header(name, value);
    }
    res.send(result.bodyText);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reaching the target API.';
    const isTimeout = message.includes('timed out');
    sendProxyError(res, isTimeout ? 504 : 502, isTimeout ? 'timeout' : 'network_error', message);
  }
}
