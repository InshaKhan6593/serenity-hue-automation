import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emails, invoices, type Invoice } from "@/db/schema";
import { DROPBOX_ROOT, deleteFile, folderFor, invoiceFileName, moveFile, sharedLink, uploadFile } from "./dropbox";
import { GET_REASON_LABELS, MONTH_NAMES, NOTE_LABELS } from "./labels";

/** Keeps a saved invoice's file in its month folder under its standard name (after the date or details change). */
export async function refile(inv: Invoice): Promise<Invoice> {
  if (!inv.dropboxPath || !inv.invoiceDate) return inv;
  const ext = inv.dropboxPath.split(".").pop() || "pdf";
  const target = `${folderFor(inv.invoiceDate)}/${invoiceFileName({ ...inv, invoiceDate: inv.invoiceDate }, ext)}`;
  if (inv.dropboxPath.toLowerCase() === target.toLowerCase()) return inv;
  const moved = await moveFile(inv.dropboxPath, target);
  const [row] = await db
    .update(invoices)
    .set({ dropboxPath: moved.path, fileName: moved.path.split("/").pop(), dropboxUrl: await sharedLink(moved.path), updatedAt: new Date() })
    .where(eq(invoices.id, inv.id))
    .returning();
  return row;
}

/**
 * Removes an invoice: its file goes to Dropbox's deleted files (recoverable for 30 days) and its email
 * moves to Ignored, labelled "duplicate" when that's why, so it can always be found again.
 */
export async function discardInvoice(inv: Invoice, reason: "not_invoice" | "duplicate" = "not_invoice") {
  if (inv.dropboxPath) await deleteFile(inv.dropboxPath).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, inv.id));
  if (inv.emailId) {
    await db
      .update(emails)
      .set({ status: "ignored", bodyText: null, ...(reason === "duplicate" ? { category: "duplicate" } : {}) })
      .where(eq(emails.id, inv.emailId));
  }
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Writes /Invoices/<year>/invoice_log.csv: every saved invoice, plus the invoices still to get,
 * so the accountant can see at a glance what's there and what's missing.
 */
export async function writeInvoiceLogs() {
  const rows = await db.select().from(invoices).orderBy(asc(invoices.invoiceDate), asc(invoices.id));
  const byYear = new Map<string, Invoice[]>();
  for (const r of rows) {
    const year = r.invoiceDate?.slice(0, 4) ?? String(new Date().getFullYear());
    byYear.set(year, [...(byYear.get(year) ?? []), r]);
  }

  const header = ["Month", "Invoice date", "Supplier", "Invoice no", "Currency", "Net", "VAT", "Total", "Status", "Notes", "Dropbox link"];
  for (const [year, list] of byYear) {
    const lines = list.map((r) =>
      [
        r.invoiceDate ? MONTH_NAMES[Number(r.invoiceDate.slice(5, 7)) - 1] : "",
        r.invoiceDate ? r.invoiceDate.split("-").reverse().join("/") : "",
        r.supplierName,
        r.invoiceNumber,
        r.currency,
        r.netAmount,
        r.vatAmount,
        r.grossAmount,
        r.status === "saved" ? "Saved" : "TO GET",
        [
          ...r.notes.map((n) => {
            const label = GET_REASON_LABELS[n] ?? NOTE_LABELS[n];
            return label ? `${label.label}: ${label.help}` : n;
          }),
          ...(r.portalUrl ? [`Supplier site: ${r.portalUrl}`] : []),
        ].join(" | "),
        r.dropboxUrl,
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n"; // BOM so Excel shows £ correctly
    await uploadFile(`${DROPBOX_ROOT}/${year}/invoice_log.csv`, Buffer.from(csv, "utf8"), "overwrite");
  }
}

/** Best-effort: the log is a convenience copy, it must never break the action that triggered it. */
export async function refreshInvoiceLogs() {
  try {
    await writeInvoiceLogs();
  } catch (e) {
    console.error("[invoice-log]", (e as Error).message);
  }
}
