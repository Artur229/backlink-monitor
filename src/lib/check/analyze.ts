import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { detectChallenge } from "./captcha";
import { normalizeText, normalizeUrl } from "./normalize";
import { pickStatus, type CheckStatus } from "./status";

export interface ExpectedLink {
  donorUrl: string;
  targetUrl: string;
  anchor?: string | null;
}

export interface PageResponse {
  httpCode: number;
  finalUrl: string;
  /** lower-cased header names */
  headers: Record<string, string | string[] | undefined>;
  html: string;
  /** body was cut at MAX_BODY */
  truncated?: boolean;
}

export interface Analysis {
  status: CheckStatus;
  issues: string[];
}

const BLOCKED_CODES = new Set([401, 403, 429, 503]);
const GONE_CODES = new Set([404, 410]);
const BAD_REL = ["nofollow", "sponsored", "ugc"] as const;

/**
 * Pure: HTTP response + expected link → one status + issue details.
 * Network failures (timeout, DNS, TLS) are classified by the fetcher, not here.
 */
export function analyzePage(page: PageResponse, link: ExpectedLink): Analysis {
  const issues: string[] = [];
  const statuses = new Set<CheckStatus>();
  const { httpCode } = page;

  if (GONE_CODES.has(httpCode)) return { status: "page_gone", issues: [`HTTP ${httpCode}`] };

  const $ = cheerio.load(page.html);
  const visibleText = () => $("body").text().replace(/\s+/g, " ").trim().length;

  if (BLOCKED_CODES.has(httpCode)) {
    const ch = detectChallenge(page.html, page.headers, visibleText());
    return { status: "blocked", issues: [`HTTP ${httpCode}`, ...(ch ? [`captcha: ${ch.marker}`] : [])] };
  }
  if (httpCode < 200 || httpCode >= 300) return { status: "error", issues: [`HTTP ${httpCode}`] };

  if (normalizeUrl(page.finalUrl) !== normalizeUrl(link.donorUrl)) {
    issues.push(`redirected → ${page.finalUrl}`);
  }

  const baseHref = $("base[href]").first().attr("href");
  const base = resolve(baseHref, page.finalUrl) ?? page.finalUrl;

  // --- Page-level robots (meta + X-Robots-Tag) ---
  const robots = new Set<string>();
  $('meta[name="robots" i], meta[name="googlebot" i]').each((_, el) => {
    for (const d of ($(el).attr("content") ?? "").split(",")) robots.add(d.trim().toLowerCase());
  });
  for (const d of parseXRobotsTag(page.headers["x-robots-tag"])) robots.add(d);
  if (robots.has("none")) robots.add("noindex").add("nofollow");

  if (robots.has("noindex")) {
    statuses.add("noindex");
    issues.push("page noindex");
  }
  if (robots.has("nofollow")) {
    statuses.add("nofollow");
    issues.push("page nofollow");
  }

  // --- Canonical pointing elsewhere ---
  const canonical = findCanonical($, page.headers["link"]);
  if (canonical) {
    const canonicalKey = normalizeUrl(canonical, page.finalUrl);
    if (canonicalKey && canonicalKey !== normalizeUrl(page.finalUrl)) {
      statuses.add("noindex");
      issues.push(`canonical → ${resolve(canonical, page.finalUrl)}`);
    }
  }

  // --- The link itself ---
  const targetKey = normalizeUrl(link.targetUrl);
  const expectedAnchor = link.anchor ? normalizeText(link.anchor) : null;

  const candidates = $("a[href]")
    .toArray()
    .filter((el) => normalizeUrl($(el).attr("href") ?? "", base) === targetKey)
    .map((el) => describeAnchor($, el))
    .map((a) => ({ ...a, anchorOk: expectedAnchor === null || a.text === expectedAnchor }));

  if (candidates.length === 0) {
    // A 200 that is really a challenge page: we can't see the content, so it's not "lost".
    const ch = detectChallenge(page.html, page.headers, visibleText());
    if (ch?.fullPage) return { status: "blocked", issues: [`HTTP ${httpCode}`, `captcha: ${ch.marker}`] };
    if (page.truncated) {
      return { status: "error", issues: [...issues, "page larger than MAX_BODY; link not found in the downloaded part"] };
    }
    return { status: pickStatus([...statuses, "lost"]), issues: [...issues, "link not found"] };
  }

  // Several links to the target: judge by the best one (dofollow first, then matching anchor).
  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0]!;

  if (best.badRel.length) {
    statuses.add("nofollow");
    for (const r of best.badRel) issues.push(`rel=${r}`);
  }
  if (!best.anchorOk) {
    statuses.add("anchor_changed");
    issues.push(`anchor: '${best.text}' != '${expectedAnchor}'`);
  }

  return { status: pickStatus(statuses), issues };
}

function score(a: { badRel: string[]; anchorOk: boolean }): number {
  return (a.badRel.length === 0 ? 2 : 0) + (a.anchorOk ? 1 : 0);
}

function describeAnchor($: cheerio.CheerioAPI, el: Element) {
  const $a = $(el);
  const relTokens = ($a.attr("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let text = normalizeText($a.text());
  if (!text) text = normalizeText($a.find("img[alt]").first().attr("alt") ?? $a.attr("title") ?? "");
  return { text, badRel: BAD_REL.filter((r) => relTokens.includes(r)) as string[] };
}

function findCanonical($: cheerio.CheerioAPI, linkHeader: string | string[] | undefined): string | undefined {
  const tag = $("link[href]")
    .toArray()
    .find((el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  if (tag) return $(tag).attr("href");

  // HTTP header form: Link: <https://example.com/page>; rel="canonical"
  for (const h of [linkHeader].flat()) {
    const m = h?.match(/<([^>]+)>\s*;[^,]*rel="?canonical"?/i);
    if (m) return m[1];
  }
  return undefined;
}

/** Directives that take a value — not to be confused with a "botname:" prefix. */
const VALUED_DIRECTIVES = new Set(["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"]);

/**
 * X-Robots-Tag: "noindex, nofollow" | "googlebot: noindex" | "bingbot: noindex, otherbot: none".
 * Only directives for all bots or for googlebot count.
 */
export function parseXRobotsTag(header: string | string[] | undefined): string[] {
  const out: string[] = [];
  for (const value of [header].flat()) {
    if (!value) continue;
    let scope: string | null = null;
    for (const part of value.split(",")) {
      let p = part.trim().toLowerCase();
      const m = p.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
      if (m && !VALUED_DIRECTIVES.has(m[1]!)) {
        scope = m[1]!;
        p = m[2]!.trim();
      }
      if (p && (scope === null || scope === "googlebot")) out.push(p);
    }
  }
  return out;
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return null;
  }
}
