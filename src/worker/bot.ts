import { QueueEvents } from "bullmq";
import { Bot, GrammyError, HttpError } from "grammy";
import { normalizeUrl } from "../lib/check/normalize";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { getStats } from "../lib/monitor/stats";
import { CHECKS, enqueueManualCheck } from "../lib/queue/queues";
import { createRedis } from "../lib/queue/redis";
import { cardUrl, esc, formatSummary, shortUrl, STATUS_LABEL } from "../lib/telegram/format";

const MAX_LINKS_PER_CHECK = 10;
const WAIT_FOR_RESULT_MS = 90_000;

/** "blog.com/page" or "https://www.blog.com/page/" → links whose donor page is that URL. */
export async function findLinksByDonor(input: string) {
  const raw = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const key = normalizeUrl(raw);
  if (!key) return null;
  const host = key.split(/[/?:]/)[0]!;
  const candidates = await prisma.link.findMany({ where: { donorUrl: { contains: host, mode: "insensitive" } } });
  return candidates.filter((l) => normalizeUrl(l.donorUrl) === key);
}

export function createBot(token: string, chatId: string) {
  const bot = new Bot(token);
  const queueEvents = new QueueEvents(CHECKS, { connection: createRedis() });

  // Private bot: only the configured team chat gets data. Others see their chat id (handy for setup).
  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) === chatId) return next();
    if (ctx.message) await ctx.reply(`Цей бот приватний. Ваш chat_id: ${ctx.chat?.id}`);
  });

  bot.command(["start", "help"], (ctx) =>
    ctx.reply(
      [
        "<b>Backlink Monitor</b>",
        "/status — коротка зведена",
        "/check &lt;url донора&gt; — перевірити посилання зараз",
        "Алерти приходять при зміні статусу, дайджест — щодня.",
      ].join("\n"),
      { parse_mode: "HTML" },
    ),
  );

  bot.command("status", async (ctx) => {
    await ctx.reply(formatSummary(await getStats()), { parse_mode: "HTML" });
  });

  bot.command("check", async (ctx) => {
    const arg = ctx.match.trim();
    if (!arg) return ctx.reply("Формат: /check https://blog-example.com/best-tips");
    const links = await findLinksByDonor(arg);
    if (links === null) return ctx.reply("Це не схоже на URL.");
    if (links.length === 0) return ctx.reply("Такої сторінки-донора немає в базі. Додайте її через імпорт CSV.");

    const batch = links.slice(0, MAX_LINKS_PER_CHECK);
    await ctx.reply(`🔎 Перевіряю ${batch.length} посилан${batch.length === 1 ? "ня" : "ь"}…`);

    const results = await Promise.all(
      batch.map(async (link) => {
        const job = await enqueueManualCheck(link.id);
        try {
          await job.waitUntilFinished(queueEvents, WAIT_FOR_RESULT_MS);
        } catch {
          return `• ${esc(shortUrl(link.targetUrl))}: ще перевіряється (результат буде в дашборді)`;
        }
        const fresh = await prisma.link.findUniqueOrThrow({
          where: { id: link.id },
          include: { checks: { orderBy: { checkedAt: "desc" }, take: 1 } },
        });
        const last = fresh.checks[0];
        const issues = ((last?.issues as string[] | undefined) ?? []).join("; ");
        const raw = last && last.status !== fresh.status ? ` (остання перевірка: ${STATUS_LABEL[last.status]})` : "";
        return `• <a href="${esc(cardUrl(config.DASHBOARD_URL, link.id))}">${esc(shortUrl(link.targetUrl))}</a>: <b>${STATUS_LABEL[fresh.status]}</b>${raw}${
          issues ? `\n  <code>${esc(issues)}</code>` : ""
        }`;
      }),
    );
    const more = links.length > batch.length ? `\n…і ще ${links.length - batch.length} не перевірялись` : "";
    await ctx.reply(`${esc(shortUrl(links[0]!.donorUrl))}\n${results.join("\n")}${more}`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.catch((err) => {
    const e = err.error;
    const what = e instanceof GrammyError ? e.description : e instanceof HttpError ? "Telegram unreachable" : String(e);
    console.error(new Date().toISOString(), `bot error on update ${err.ctx.update.update_id}:`, what);
  });

  return {
    bot,
    send: (html: string) =>
      bot.api.sendMessage(chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
    async stop() {
      await bot.stop();
      await queueEvents.close();
    },
  };
}
