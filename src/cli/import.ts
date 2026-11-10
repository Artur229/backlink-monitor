import { readFile } from "node:fs/promises";
import { prisma } from "../lib/db";
import { importLinksCsv } from "../lib/import/save";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import <file.csv>");
  process.exit(2);
}

try {
  const report = await importLinksCsv(await readFile(file));
  if (report.fatal) {
    console.error(`✖ Import failed: ${report.fatal}`);
    process.exitCode = 1;
  } else {
    console.log(`✔ Imported: ${report.created} new, ${report.updated} updated, ${report.errors.length} rejected`);
    for (const w of report.warnings) console.warn(`  ⚠ line ${w.line}: ${w.message}`);
    for (const e of report.errors) console.error(`  ✖ line ${e.line}: ${e.message}`);
  }
} finally {
  await prisma.$disconnect();
}
