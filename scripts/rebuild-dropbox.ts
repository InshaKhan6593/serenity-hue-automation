/**
 * Re-files every saved invoice into /Invoices/<year>/<MM - Month>/ with the standard file name,
 * removes folders left empty, and rewrites invoice_log.csv. Safe to run any time.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/rebuild-dropbox.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { emails, invoices } from "../src/db/schema";
import { DROPBOX_ROOT, deleteFile, listFolder } from "../src/lib/dropbox";
import { refile, writeInvoiceLogs } from "../src/lib/filing";

async function main() {
  // Every saved invoice needs a date to have a month folder: fall back to the email's date.
  const undated = await db
    .select({ id: invoices.id, receivedAt: emails.receivedAt })
    .from(invoices)
    .leftJoin(emails, eq(invoices.emailId, emails.id))
    .where(and(isNull(invoices.invoiceDate), eq(invoices.status, "saved")));
  for (const u of undated) {
    const date = (u.receivedAt ?? new Date()).toISOString().slice(0, 10);
    await db.update(invoices).set({ invoiceDate: date }).where(eq(invoices.id, u.id));
  }

  const rows = await db.select().from(invoices).where(eq(invoices.status, "saved"));
  for (const r of rows) {
    const moved = await refile(r);
    if (moved.dropboxPath !== r.dropboxPath) console.log(`moved  ${r.dropboxPath}\n    →  ${moved.dropboxPath}`);
  }

  // Remove folders that no longer hold any file (deepest first). They go to Dropbox's deleted files.
  const entries = await listFolder(DROPBOX_ROOT, true);
  const files = entries.filter((e) => e[".tag"] === "file").map((e) => e.path_lower);
  const folders = entries.filter((e) => e[".tag"] === "folder").sort((a, b) => b.path_lower.length - a.path_lower.length);
  for (const f of folders) {
    if (!files.some((p) => p.startsWith(f.path_lower + "/"))) {
      await deleteFile(f.path_display);
      console.log(`removed empty folder ${f.path_display}`);
    }
  }

  await writeInvoiceLogs();
  console.log(`done: ${rows.length} invoices, log rewritten`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
