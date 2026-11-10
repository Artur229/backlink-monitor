/**
 * URL normalization for comparing links. Two URLs that differ only by
 * http/https, `www.`, a trailing slash, utm_* / tracking params, default port,
 * fragment or query-param order are treated as the same page.
 *
 * Returns a comparison key, NOT a fetchable URL.
 */

const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|gclid|fbclid|yclid|msclkid|_ga|mc_cid|mc_eid|ref_src)$/i;

export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw.trim(), base) : new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";

  let path = u.pathname.replace(/\/{2,}/g, "/");
  // Treat /index.html and /index.php like the directory itself
  path = path.replace(/\/index\.(html?|php)$/i, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") path = "";

  // Port is dropped: http:80 / https:443 differ only by protocol, which we ignore anyway.
  const port = u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : "";

  return `${host}${port}${path}${query}`;
}

export function sameUrl(a: string, b: string, base?: string): boolean {
  const na = normalizeUrl(a, base);
  return na !== null && na === normalizeUrl(b, base);
}

/** Lowercase, collapse all whitespace (incl. nbsp) — for anchor comparison. */
export function normalizeText(s: string): string {
  return s.replace(/[\s ​]+/g, " ").trim().toLowerCase();
}
