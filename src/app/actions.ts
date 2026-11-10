"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { importLinksCsv, type ImportReport } from "@/lib/import/save";
import { enqueueManualCheck } from "@/lib/queue/queues";

/** "Перевірити зараз": same queue as the cron, so the per-domain limit and retries apply. */
export async function checkNow(linkId: string): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.link.findUnique({ where: { id: linkId }, select: { id: true } });
  if (!link) return { ok: false, message: "Посилання не знайдено" };
  try {
    await enqueueManualCheck(link.id);
  } catch {
    return { ok: false, message: "Черга недоступна (Redis)" };
  }
  return { ok: true, message: "У черзі" };
}

export async function refresh(path: string) {
  revalidatePath(path);
}

export type ImportState = { report?: ImportReport; error?: string; fileName?: string };

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function importCsv(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Оберіть CSV-файл" };
  if (file.size > MAX_CSV_BYTES) return { error: "Файл більший за 5 MB" };
  const report = await importLinksCsv(Buffer.from(await file.arrayBuffer()));
  revalidatePath("/");
  revalidatePath("/outreachers");
  return { report, fileName: file.name };
}
