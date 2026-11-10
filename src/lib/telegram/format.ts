import type { Alert, StoredStatus } from "../monitor/transition";
import type { Stats } from "../monitor/stats";

/** Telegram HTML parse mode: only &, <, > need escaping (plus quotes inside href). */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** https://www.blog-example.com/best-tips/ → blog-example.com/best-tips */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const TITLES: Record<string, string> = {
  lost: "❗ Посилання зникло",
  page_gone: "❗ Сторінку-донора видалено",
  nofollow: "⚠️ Посилання стало nofollow",
  noindex: "⚠️ Сторінку закрито від індексації",
  anchor_changed: "ℹ️ Змінився анкор",
  ok: "✅ Посилання знову працює",
};

export const STATUS_LABEL: Record<StoredStatus, string> = {
  pending: "очікує",
  ok: "ok",
  lost: "зникло",
  page_gone: "сторінку видалено",
  nofollow: "nofollow",
  noindex: "noindex",
  anchor_changed: "інший анкор",
  blocked: "blocked",
  error: "error",
};

export interface AlertLink {
  id: string;
  donorUrl: string;
  targetUrl: string;
  outreacher: string | null;
  priceUsd: number | null;
}

export const cardUrl = (dashboardUrl: string, id: string) => `${dashboardUrl.replace(/\/$/, "")}/links/${id}`;

/** «❗ Посилання зникло: blog-example.com/best-tips → my-site.com. Аутричер: Olha. Заплачено: $150» + card link */
export function formatStatusAlert(alert: Alert, link: AlertLink, issues: string[], dashboardUrl: string): string {
  const title = TITLES[alert.to] ?? `Статус: ${alert.to}`;
  const who = [
    link.outreacher ? `Аутричер: ${esc(link.outreacher)}` : null,
    link.priceUsd != null ? `Заплачено: ${usd(link.priceUsd)}` : null,
  ].filter(Boolean);
  const lines = [`<b>${title}</b>: ${esc(shortUrl(link.donorUrl))} → ${esc(shortUrl(link.targetUrl))}`];
  if (who.length) lines.push(`${who.join(". ")}.`);
  const details = issues.filter((i) => !/^after \d+ attempts$/.test(i));
  if (details.length && alert.to !== "ok") lines.push(`Деталі: <code>${esc(details.join("; "))}</code>`);
  if (alert.from !== "pending" && alert.from !== alert.to) {
    lines.push(`Було: ${STATUS_LABEL[alert.from]} → стало: ${STATUS_LABEL[alert.to]}`);
  }
  lines.push(`<a href="${esc(cardUrl(dashboardUrl, link.id))}">Картка в дашборді</a>`);
  return lines.join("\n");
}

export function formatSummary(s: Stats): string {
  return [
    `Усього посилань: <b>${s.total}</b>`,
    `✅ ok: ${s.ok}   ❗ проблемних: ${s.problems}   🚫 blocked/error: ${s.unreachable}${s.pending ? `   ⏳ очікує: ${s.pending}` : ""}`,
    `💰 Під ризиком: <b>${usd(s.atRiskUsd)}</b>`,
  ].join("\n");
}

export interface DigestItem {
  donorUrl: string;
  status: StoredStatus;
  outreacher: string | null;
  priceUsd: number | null;
}

/** Daily digest: summary + the most expensive problems + unreachable donors (those never alert on their own). */
export function formatDigest(
  date: string,
  s: Stats,
  problems: DigestItem[],
  unreachable: DigestItem[],
  dashboardUrl: string,
  limit = 10,
): string {
  const item = (l: DigestItem) =>
    `• ${esc(shortUrl(l.donorUrl))} — ${STATUS_LABEL[l.status]}${l.priceUsd != null ? `, ${usd(l.priceUsd)}` : ""}${l.outreacher ? ` (${esc(l.outreacher)})` : ""}`;
  const section = (title: string, items: DigestItem[]) => {
    const more = items.length > limit ? `\n…і ще ${items.length - limit}` : "";
    return `\n<b>${title}</b>\n${items.slice(0, limit).map(item).join("\n")}${more}`;
  };

  const parts = [`<b>📊 Дайджест за ${date}</b>`, formatSummary(s)];
  if (problems.length) parts.push(section("Проблемні (дорожчі першими):", problems));
  if (unreachable.length) parts.push(section("Не вдалося перевірити:", unreachable));
  if (!problems.length && !unreachable.length && s.total) parts.push("\nУсі посилання на місці 👌");
  parts.push(`\n<a href="${esc(dashboardUrl)}">Відкрити дашборд</a>`);
  return parts.join("\n");
}
