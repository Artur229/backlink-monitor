import { describe, expect, it } from "vitest";
import { parseLinksCsv } from "../src/lib/import/csv";

const HEADER = "donor_url,target_url,anchor,outreacher,price_usd,placed_at";

describe("parseLinksCsv", () => {
  it("parses the example from the spec", () => {
    const csv = [
      HEADER,
      "https://blog-example.com/best-tips,https://my-site.com/,best casino bonuses,Olha,150,2026-10-01",
      "https://news-example.org/review,https://my-site.com/reviews,mysite,Ivan,90,2026-10-12",
    ].join("\n");
    const r = parseLinksCsv(csv);
    expect(r.fatal).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      line: 2,
      donor_url: "https://blog-example.com/best-tips",
      target_url: "https://my-site.com/",
      anchor: "best casino bonuses",
      outreacher: "Olha",
      price_usd: 150,
      placed_at: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("accepts only required columns and empty optional fields", () => {
    const r = parseLinksCsv(`donor_url,target_url\nhttps://a.com/p,https://b.com`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.target_url).toBe("https://b.com/");
    expect(r.rows[0]!.anchor).toBeUndefined();
    expect(r.rows[0]!.price_usd).toBeUndefined();

    const r2 = parseLinksCsv(`${HEADER}\nhttps://a.com/p,https://b.com,,,,`);
    expect(r2.errors).toEqual([]);
    expect(r2.rows[0]).toMatchObject({ anchor: undefined, outreacher: undefined, price_usd: undefined, placed_at: undefined });
  });

  it("reports invalid rows with line numbers and keeps valid ones", () => {
    const csv = [
      HEADER,
      "https://ok.com/a,https://my-site.com,,,,",
      "not-a-url,https://my-site.com,,,,",
      "ftp://files.com/x,https://my-site.com,,,,",
      "https://ok.com/b,https://my-site.com,,,abc,",
      "https://ok.com/c,https://my-site.com,,,,2026-13-45",
      "https://ok.com/d,https://my-site.com,,,-5,",
      "https://ok.com/e,https://my-site.com",
      "https://ok.com/f,https://my-site.com,,,,",
    ].join("\n");
    const r = parseLinksCsv(csv);
    expect(r.rows.map((x) => x.line)).toEqual([2, 9]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.errors[0]!.message).toMatch(/donor_url/);
    expect(r.errors[2]!.message).toMatch(/price_usd/);
    expect(r.errors[3]!.message).toMatch(/placed_at/);
    expect(r.errors[5]!.message).toMatch(/expected 6 columns, got 2/);
  });

  it("handles quoted fields with commas and keeps line numbers after blank lines", () => {
    const csv = `${HEADER}\n\n"https://a.com/p","https://b.com","best, cheap tips",Olha,"$1 500",\n`;
    const r = parseLinksCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ line: 3, anchor: "best, cheap tips", price_usd: 1500 });
  });

  it("dedups the same donor+target within a file (later row wins)", () => {
    const csv = [HEADER, "https://a.com/p,https://b.com,old,,10,", "https://a.com/p,https://b.com/,new,,20,"].join("\n");
    const r = parseLinksCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ line: 3, anchor: "new", price_usd: 20 });
    expect(r.warnings[0]).toMatchObject({ line: 3 });
  });

  it("strips BOM and accepts header in any case", () => {
    const r = parseLinksCsv("﻿Donor_URL,Target_URL\nhttps://a.com,https://b.com");
    expect(r.fatal).toBeUndefined();
    expect(r.rows).toHaveLength(1);
  });

  it("fails the whole file on missing required columns or empty input", () => {
    expect(parseLinksCsv("donor_url,anchor\nhttps://a.com,x").fatal).toMatch(/target_url/);
    expect(parseLinksCsv("").fatal).toMatch(/empty/);
  });

  it("warns about unknown columns", () => {
    const r = parseLinksCsv("donor_url,target_url,notes\nhttps://a.com,https://b.com,hi");
    expect(r.rows).toHaveLength(1);
    expect(r.warnings[0]!.message).toMatch(/notes/);
  });
});
