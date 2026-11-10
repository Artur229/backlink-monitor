/**
 * Captcha / anti-bot challenge detection. We never solve captchas, only recognize
 * them so the link becomes `blocked` instead of a false `lost`.
 */

/** Markers of a full-page challenge: the page IS the challenge, real content is not there. */
const CHALLENGE_MARKERS: [string, RegExp][] = [
  ["cf-chl", /cf-chl|cf_chl_/i],
  ["challenge-platform", /\/cdn-cgi\/challenge-platform\//i],
  ["Just a moment", /<title>\s*Just a moment\.{0,3}\s*<\/title>/i],
  ["cf-browser-verification", /cf-browser-verification/i],
  ["Cloudflare Attention Required", /Attention Required!\s*\|\s*Cloudflare/i],
  ["Incapsula", /_Incapsula_Resource|Incapsula incident ID/i],
  ["DDoS-Guard", /ddos-guard/i],
];

/** Captcha widgets: also used legitimately in contact/comment forms on normal pages. */
const WIDGET_MARKERS: [string, RegExp][] = [
  ["g-recaptcha", /g-recaptcha|www\.google\.com\/recaptcha/i],
  ["hcaptcha", /h-captcha|hcaptcha\.com/i],
  ["turnstile", /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i],
];

/** A page with a captcha widget and less visible text than this is treated as a captcha wall. */
const THIN_PAGE_CHARS = 2000;

export interface Challenge {
  marker: string;
  /** true = the whole page is a challenge; false = a widget on an otherwise normal page */
  fullPage: boolean;
}

export function detectChallenge(
  html: string,
  headers: Record<string, string | string[] | undefined>,
  visibleTextLength: number,
): Challenge | null {
  const mitigated = [headers["cf-mitigated"]].flat().some((v) => v?.toLowerCase() === "challenge");
  if (mitigated) return { marker: "cf-mitigated: challenge", fullPage: true };

  for (const [name, re] of CHALLENGE_MARKERS) if (re.test(html)) return { marker: name, fullPage: true };
  for (const [name, re] of WIDGET_MARKERS) {
    if (re.test(html)) return { marker: name, fullPage: visibleTextLength < THIN_PAGE_CHARS };
  }
  return null;
}
