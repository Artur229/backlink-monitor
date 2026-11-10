import { UnrecoverableError, type Job } from "bullmq";
import { GrammyError, HttpError } from "grammy";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { formatStatusAlert } from "../lib/telegram/format";
import type { AlertJobData } from "../lib/queue/queues";

/** Sends one HTML message to the team chat. */
export type SendFn = (html: string) => Promise<unknown>;

/**
 * Alerts queue consumer. Telegram outages and 429/5xx are thrown → BullMQ retries
 * with exponential backoff (10 attempts). Permanent 4xx (bad chat id, bot kicked)
 * are UnrecoverableError so a misconfiguration doesn't loop for hours.
 */
export function makeAlertProcessor(send: SendFn) {
  return async function processAlert(job: Job<AlertJobData>) {
    const d = job.data;
    let html: string;

    if (d.type === "status") {
      const link = await prisma.link.findUnique({
        where: { id: d.linkId },
        include: { checks: { orderBy: { checkedAt: "desc" }, take: 1 } },
      });
      if (!link) return { skipped: "link deleted" };
      const issues = (link.checks[0]?.issues as string[] | undefined) ?? [];
      html = formatStatusAlert(d.alert, link, issues, config.DASHBOARD_URL);
    } else if (d.type === "system") {
      html = `🛠 <b>Системне</b>: ${d.message}`;
    } else {
      html = d.text;
    }

    try {
      await send(html);
    } catch (err) {
      if (err instanceof GrammyError && err.error_code !== 429 && err.error_code < 500) {
        throw new UnrecoverableError(`Telegram ${err.error_code}: ${err.description}`);
      }
      if (err instanceof GrammyError || err instanceof HttpError) throw new Error(`Telegram unavailable: ${err.message}`);
      throw err;
    }
    return { sent: d.type };
  };
}
