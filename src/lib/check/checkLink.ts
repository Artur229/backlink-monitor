import { config } from "../config";
import { analyzePage, type ExpectedLink } from "./analyze";
import { fetchPage, type FetchOptions, type FetchResult } from "./fetch";
import { browserHeaders } from "./headers";
import type { CheckStatus } from "./status";

export interface CheckResult {
  status: CheckStatus;
  issues: string[];
  httpCode: number | null;
  finalUrl: string | null;
  durationMs: number;
  proxy: string | null;
}

export interface CheckDeps {
  fetch?: (url: string, opts: FetchOptions) => Promise<FetchResult>;
  fetchOptions?: Partial<FetchOptions>;
}

/**
 * One check of one link: GET the donor page and decide the status.
 * Retries and proxy rotation are added around this in step 4.
 */
export async function checkLink(link: ExpectedLink, deps: CheckDeps = {}): Promise<CheckResult> {
  const doFetch = deps.fetch ?? fetchPage;
  const res = await doFetch(link.donorUrl, {
    timeoutMs: config.TIMEOUT_MS,
    maxBodyBytes: config.MAX_BODY_BYTES,
    maxRedirects: config.MAX_REDIRECTS,
    headers: browserHeaders(),
    ...deps.fetchOptions,
  });

  if (!res.ok) {
    return {
      status: "error",
      issues: [`${res.kind}: ${res.message}`],
      httpCode: res.httpCode ?? null,
      finalUrl: res.finalUrl ?? null,
      durationMs: res.durationMs,
      proxy: null,
    };
  }

  const { status, issues } = analyzePage(res, link);
  return { status, issues, httpCode: res.httpCode, finalUrl: res.finalUrl, durationMs: res.durationMs, proxy: null };
}
