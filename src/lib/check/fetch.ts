import { request, type Dispatcher } from "undici";
import type { PageResponse } from "./analyze";

export interface FetchOptions {
  timeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
  headers?: Record<string, string>;
  /** undici dispatcher, e.g. a ProxyAgent (step 4) */
  dispatcher?: Dispatcher;
}

export type NetworkErrorKind = "timeout" | "dns" | "tls" | "network" | "proxy" | "too_many_redirects" | "not_html";

export type FetchResult =
  | ({ ok: true; durationMs: number; redirects: string[] } & PageResponse)
  | { ok: false; kind: NetworkErrorKind; message: string; durationMs: number; httpCode?: number; finalUrl?: string };

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

/** One GET of the donor page, following up to `maxRedirects` redirects manually so every hop is visible. */
export async function fetchPage(url: string, opts: FetchOptions): Promise<FetchResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const redirects: string[] = [];
  let current = url;

  try {
    for (;;) {
      const res = await request(current, {
        method: "GET",
        headers: opts.headers,
        dispatcher: opts.dispatcher,
        signal,
        headersTimeout: opts.timeoutMs,
        bodyTimeout: opts.timeoutMs,
      });

      const headers = res.headers as Record<string, string | string[] | undefined>;

      if (REDIRECT_CODES.has(res.statusCode)) {
        await res.body.dump();
        const location = first(headers["location"]);
        if (!location) {
          return { ok: false, kind: "network", message: `HTTP ${res.statusCode} without Location`, durationMs: elapsed(), httpCode: res.statusCode };
        }
        if (redirects.length >= opts.maxRedirects) {
          return {
            ok: false,
            kind: "too_many_redirects",
            message: `more than ${opts.maxRedirects} redirects`,
            durationMs: elapsed(),
            httpCode: res.statusCode,
            finalUrl: current,
          };
        }
        current = new URL(location, current).href;
        redirects.push(current);
        continue;
      }

      const contentType = first(headers["content-type"]) ?? "";
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      if (isSuccess && contentType && !HTML_TYPES.test(contentType)) {
        await res.body.dump();
        return {
          ok: false,
          kind: "not_html",
          message: `Content-Type ${contentType.split(";")[0]}`,
          durationMs: elapsed(),
          httpCode: res.statusCode,
          finalUrl: current,
        };
      }

      const { bytes, truncated } = await readLimited(res.body, opts.maxBodyBytes);
      return {
        ok: true,
        httpCode: res.statusCode,
        finalUrl: current,
        headers,
        html: decode(bytes, contentType),
        truncated,
        redirects,
        durationMs: elapsed(),
      };
    }
  } catch (err) {
    const { kind, message } = classifyError(err, signal);
    return { ok: false, kind, message, durationMs: elapsed(), finalUrl: current };
  }
}

async function readLimited(body: Dispatcher.ResponseData["body"], limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = chunk as Buffer;
    if (size + buf.length > limit) {
      chunks.push(buf.subarray(0, limit - size));
      body.destroy(); // stop downloading the rest
      return { bytes: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

/** Charset from Content-Type, then <meta charset>, else UTF-8. */
function decode(bytes: Buffer, contentType: string): string {
  let charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) {
    const head = bytes.subarray(0, 4096).toString("latin1");
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME"]);
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"]);

export function classifyError(err: unknown, signal?: AbortSignal): { kind: NetworkErrorKind; message: string } {
  // undici often wraps the real socket error in `cause`
  const chain: { code?: string; name?: string; message?: string }[] = [];
  for (let e = err as { cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    chain.push(e as (typeof chain)[number]);
  }
  const codes = chain.map((e) => e.code ?? "");
  const message = chain.map((e) => e.message).filter(Boolean).at(-1) ?? String(err);

  if (signal?.aborted || chain.some((e) => e.name === "TimeoutError") || codes.some((c) => TIMEOUT_CODES.has(c))) {
    return { kind: "timeout", message: "timeout" };
  }
  if (codes.includes("UND_ERR_PRX_CONN") || chain.some((e) => /proxy/i.test(e.message ?? ""))) {
    return { kind: "proxy", message };
  }
  if (codes.some((c) => DNS_CODES.has(c))) return { kind: "dns", message };
  if (codes.some((c) => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c))) return { kind: "tls", message };
  return { kind: "network", message };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
