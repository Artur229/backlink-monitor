import { prisma } from "../db";
import { parseLinksCsv, type ImportIssue, type LinkRow } from "./csv";

export interface ImportReport {
  created: number;
  updated: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  fatal?: string;
}

/** Idempotent upsert by (donorUrl, targetUrl). The CSV is the source of truth for the optional fields. */
export async function saveLinks(rows: LinkRow[]): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 };

  const existing = await prisma.link.findMany({
    where: { OR: rows.map((r) => ({ donorUrl: r.donor_url, targetUrl: r.target_url })) },
    select: { donorUrl: true, targetUrl: true },
  });
  const existingKeys = new Set(existing.map((l) => `${l.donorUrl} ${l.targetUrl}`));

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.$transaction(
      rows.slice(i, i + CHUNK).map((r) => {
        const data = {
          anchor: r.anchor ?? null,
          outreacher: r.outreacher ?? null,
          priceUsd: r.price_usd ?? null,
          placedAt: r.placed_at ?? null,
        };
        return prisma.link.upsert({
          where: { donorUrl_targetUrl: { donorUrl: r.donor_url, targetUrl: r.target_url } },
          create: { donorUrl: r.donor_url, targetUrl: r.target_url, ...data },
          update: data,
        });
      }),
    );
  }

  const updated = rows.filter((r) => existingKeys.has(`${r.donor_url} ${r.target_url}`)).length;
  return { created: rows.length - updated, updated };
}

export async function importLinksCsv(input: string | Buffer): Promise<ImportReport> {
  const parsed = parseLinksCsv(input);
  if (parsed.fatal) return { created: 0, updated: 0, errors: [], warnings: [], fatal: parsed.fatal };
  const { created, updated } = await saveLinks(parsed.rows);
  return { created, updated, errors: parsed.errors, warnings: parsed.warnings };
}
