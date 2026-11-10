import { parse } from "csv-parse/sync";
import { z } from "zod";

/** Pure CSV → validated rows. No DB access, so it is shared by the CLI and the dashboard. */

export const REQUIRED_COLUMNS = ["donor_url", "target_url"] as const;
export const OPTIONAL_COLUMNS = ["anchor", "outreacher", "price_usd", "placed_at"] as const;
const KNOWN_COLUMNS = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const httpUrl = z.url({ protocol: /^https?$/, normalize: true, error: "invalid URL (must be http/https)" });

const optionalText = z.preprocess(emptyToUndefined, z.string().max(500).optional());

export const linkRowSchema = z.object({
  donor_url: httpUrl,
  target_url: httpUrl,
  anchor: optionalText,
  outreacher: optionalText,
  price_usd: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      // Accept "150", "$150", "1 500", "150.00"
      return typeof s === "string" ? Number(s.replace(/[$\s]/g, "")) : s;
    },
    z
      .number({ error: "must be a number" })
      .nonnegative("must be >= 0")
      .transform((n) => Math.round(n))
      .optional(),
  ),
  placed_at: z.preprocess(
    emptyToUndefined,
    z.iso
      .date({ error: "must be a date YYYY-MM-DD" })
      .transform((s) => new Date(`${s}T00:00:00Z`))
      .optional(),
  ),
});

export type LinkRow = z.output<typeof linkRowSchema>;

export interface ImportIssue {
  /** 1-based line number in the file (header is line 1) */
  line: number;
  message: string;
}

export interface ParseResult {
  rows: (LinkRow & { line: number })[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Set when the whole file is unusable (bad header, broken quoting) */
  fatal?: string;
}

export function parseLinksCsv(input: string | Buffer): ParseResult {
  const result: ParseResult = { rows: [], errors: [], warnings: [] };

  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(input, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
    }) as unknown as typeof records;
  } catch (e) {
    result.fatal = `CSV is malformed: ${(e as Error).message}`;
    return result;
  }

  const [headerRec, ...dataRecs] = records;
  if (!headerRec) {
    result.fatal = "file is empty";
    return result;
  }

  const header = headerRec.record.map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    result.fatal = `missing required column(s): ${missing.join(", ")}`;
    return result;
  }
  const unknown = header.filter((h) => h && !KNOWN_COLUMNS.has(h));
  if (unknown.length) {
    result.warnings.push({ line: headerRec.info.lines, message: `ignored unknown column(s): ${unknown.join(", ")}` });
  }

  const seen = new Map<string, number>();

  for (const { record, info } of dataRecs) {
    const line = info.lines;
    if (record.length !== header.length) {
      result.errors.push({ line, message: `expected ${header.length} columns, got ${record.length}` });
      continue;
    }

    const obj = Object.fromEntries(header.map((h, i) => [h, record[i]]));
    const parsed = linkRowSchema.safeParse(obj);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");
      result.errors.push({ line, message });
      continue;
    }

    const key = `${parsed.data.donor_url} ${parsed.data.target_url}`;
    const prevLine = seen.get(key);
    if (prevLine !== undefined) {
      // Same key twice in one file: the later row wins, like a re-import would.
      result.rows = result.rows.filter((r) => r.line !== prevLine);
      result.warnings.push({ line, message: `duplicate of line ${prevLine}; this row is used` });
    }
    seen.set(key, line);
    result.rows.push({ ...parsed.data, line });
  }

  return result;
}
