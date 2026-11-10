import { DelayedError, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { checkLink, type CheckResult } from "../lib/check/checkLink";
import type { ExpectedLink } from "../lib/check/analyze";
import { config } from "../lib/config";
import { prisma } from "../lib/db";
import { transition, type LinkState } from "../lib/monitor/transition";
import { getProxyPool } from "../lib/proxy";
import { acquireDomainSlot, domainOf } from "../lib/queue/domainLimiter";
import { getQueues, type CheckJobData } from "../lib/queue/queues";
import type { CheckStatus } from "../lib/check/status";

export interface ProcessorDeps {
  redis: Redis;
  check?: (link: ExpectedLink) => Promise<CheckResult>;
  random?: () => number;
}

export function makeCheckProcessor(deps: ProcessorDeps) {
  const check = deps.check ?? ((l: ExpectedLink) => checkLink(l));
  const random = deps.random ?? Math.random;

  return async function processCheck(job: Job<CheckJobData>, token?: string) {
    const link = await prisma.link.findUnique({ where: { id: job.data.linkId } });
    if (!link) return { skipped: "link deleted" };

    // 1 request / PER_DOMAIN_DELAY per donor domain. Busy → reschedule, don't block a worker slot.
    const waitMs = await acquireDomainSlot(deps.redis, domainOf(link.donorUrl), config.PER_DOMAIN_DELAY_MS);
    if (waitMs > 0) {
      await job.moveToDelayed(Date.now() + waitMs + Math.round(random() * config.PER_DOMAIN_DELAY_MS), token);
      throw new DelayedError();
    }

    const result = await check({ donorUrl: link.donorUrl, targetUrl: link.targetUrl, anchor: link.anchor });

    // All proxies dead: don't record a fake error; the job waits until a proxy is back.
    if (result.allProxiesDown) {
      const backIn = Math.max(getProxyPool().msUntilAvailable(), 60_000);
      await job.moveToDelayed(Date.now() + backIn, token);
      throw new DelayedError();
    }

    const prev: LinkState = {
      status: link.status,
      failStreak: link.failStreak,
      lastConclusiveStatus: link.lastConclusiveStatus as CheckStatus | null,
    };
    const t = transition(prev, result.status);
    const now = new Date();
    const { alerts, checks } = getQueues();

    // Alert is enqueued BEFORE the DB write with a jobId derived from this check job:
    // if we crash in between, the re-run computes the same alert and BullMQ dedups it.
    if (t.alert) {
      await alerts.add("status", { type: "status", linkId: link.id, alert: t.alert }, { jobId: `alert_${job.id}` });
    }

    await prisma.$transaction([
      prisma.check.create({
        data: {
          linkId: link.id,
          checkedAt: now,
          httpCode: result.httpCode,
          finalUrl: result.finalUrl,
          status: result.status,
          issues: result.issues,
          proxy: result.proxy,
          durationMs: result.durationMs,
        },
      }),
      prisma.link.update({
        where: { id: link.id },
        data: {
          status: t.next.status,
          failStreak: t.next.failStreak,
          lastConclusiveStatus: t.next.lastConclusiveStatus,
          lastCheckedAt: now,
          ...(t.statusChanged ? { statusChangedAt: now } : {}),
        },
      }),
    ]);

    if (t.scheduleConfirm) {
      await checks.add("check", { linkId: link.id, reason: "confirm" }, { jobId: `${job.id}_confirm`, delay: config.CONFIRM_DELAY_MS, priority: 5 });
    }

    return { status: result.status, shown: t.next.status, alert: t.alert, confirm: t.scheduleConfirm };
  };
}
