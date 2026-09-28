// Dry run: extract + validate every PDF in a folder and compare with invoice_log.csv. Writes nothing.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/test-pdfs.mts "<folder>"
import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { extractInvoice } from "../src/lib/llama";
import { notesFor } from "../src/lib/validate";

const root = process.argv[2];
const files: string[] = [];
const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.toLowerCase().endsWith(".pdf") && files.push(join(d, f))));
walk(root);

// Expected values from invoice_log.csv (keyed by invoice number)
const csv = readFileSync(join(root, "invoice_log.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const expected = new Map(csv.filter((c) => c[3] && c[3] !== "-").map((c) => [c[3], { date: c[1], supplier: c[2], net: c[4], vat: c[5], gross: c[6] }]));

const ukDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const n = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

await Promise.all(
  files.map(async (file, i) => {
    await new Promise((r) => setTimeout(r, i * 1500));
    const t = Date.now();
    try {
      const { data } = await extractInvoice(readFileSync(file), basename(file));
      const notes = await notesFor(data);
      const exp = [...expected.entries()].find(([k]) => (data.invoiceNumber ?? "").replace(/\s/g, "").includes(k.replace(/\s/g, "")) || k.includes(data.invoiceNumber ?? "@@"))?.[1];
      const chk = (got: string, want?: string) => (want == null || want === "" ? got : got === Number(want).toFixed(2) || got === want ? `${got} ✓` : `${got} ✗(want ${want})`);
      console.log(
        [
          `\n■ ${basename(file)}  (${Math.round((Date.now() - t) / 1000)}s)`,
          `  supplier : ${data.supplierName}   VAT no: ${data.supplierVatNumber ?? "—"}   type: ${data.documentType}`,
          `  number   : ${data.invoiceNumber ?? "—"}   date: ${chk(ukDate(data.invoiceDate), exp?.date)}   currency: ${data.currency}`,
          `  net ${chk(n(data.netAmount), exp?.net)} | VAT ${chk(n(data.vatAmount), exp?.vat)} | gross ${chk(n(data.grossAmount), exp?.gross)}`,
          `  → saved${notes.length ? "  notes: " + notes.join(", ") : ""}`,
        ].join("\n"),
      );
    } catch (e) {
      console.log(`\n■ ${basename(file)}\n  ERROR ${(e as Error).message}`);
    }
  }),
);
process.exit(0);
