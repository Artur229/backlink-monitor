const TZ = process.env.TZ || "Europe/Kyiv";

export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);

export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

const dateTime = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const rtf = new Intl.RelativeTimeFormat("uk", { numeric: "auto" });

export const fmtDateTime = (d: Date | null | undefined) => (d ? dateTime.format(d) : "—");
export const fmtDate = (d: Date | null | undefined) => (d ? dateOnly.format(d) : "—");

export function fmtAgo(d: Date | null | undefined, now = Date.now()): string {
  if (!d) return "ніколи";
  const s = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return "щойно";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
