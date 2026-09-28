"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { emails, invoices } from "@/db/schema";
import { discardInvoice, refile, refreshInvoiceLogs } from "@/lib/filing";
import { reprocessAsInvoice } from "@/lib/pipeline";
import { resolveDuplicates } from "@/lib/validate";
import { deleteConnection, type Provider } from "@/lib/connections";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const amount = z
  .string()
  .nullable()
  .transform((v) => (v == null || v.trim() === "" ? null : v.replace(/[£,\s]/g, "")))
  .refine((v) => v == null || /^-?\d+(\.\d{1,2})?$/.test(v), "Must be a number");

const InvoiceFields = z.object({
  documentType: z.string().nullable(),
  supplierName: z.string().min(1, "Supplier is required"),
  supplierVatNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: date,
  dueDate: date,
  currency: z.string().nullable(),
  netAmount: amount,
  vatAmount: amount,
  grossAmount: amount,
});
export type InvoiceFieldsInput = z.input<typeof InvoiceFields>;

type Result = { ok: true } | { ok: false, error: string };

const clean = (v: string | null) => (v == null || v.trim() === "" ? null : v.trim());

/** She corrected some details: save them and keep the file named and filed to match. */
export async function saveInvoice(id: number, input: InvoiceFieldsInput): Promise<Result> {
  const normalized = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? clean(v) : v]));
  const parsed = InvoiceFields.safeParse(normalized);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  if (!parsed.data.invoiceDate) return { ok: false, error: "The invoice date is needed to file it in the right month" };

  const [saved] = await db.update(invoices).set({ ...parsed.data, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  if (!saved) return { ok: false, error: "Invoice not found" };
  try {
    await refile(saved);
  } catch (e) {
    return { ok: false, error: `Saved, but could not move the file in Dropbox: ${(e as Error).message}` };
  }
  await refreshInvoiceLogs();
  revalidatePath("/");
  return { ok: true };
}

/** Not an invoice (or not needed): remove it, send the file to Dropbox's deleted files, and move the email to Ignored. */
export async function removeInvoice(id: number): Promise<Result> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) return { ok: false, error: "Invoice not found" };
  await discardInvoice(row);
  // Her decision: Jev learns from it for future emails from this sender.
  if (row.emailId) await db.update(emails).set({ decidedBy: "owner" }).where(eq(emails.id, row.emailId));
  await refreshInvoiceLogs();
  revalidatePath("/");
  return { ok: true };
}

export async function ignoreEmail(id: string): Promise<Result> {
  await db.update(emails).set({ status: "ignored", bodyText: null, decidedBy: "owner" }).where(eq(emails.id, id));
  revalidatePath("/");
  return { ok: true };
}

export async function markEmailAsInvoice(id: string): Promise<Result> {
  try {
    await reprocessAsInvoice(id);
    await db.update(emails).set({ decidedBy: "owner" }).where(eq(emails.id, id));
    await resolveDuplicates();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  await refreshInvoiceLogs();
  revalidatePath("/");
  return { ok: true };
}

export async function disconnect(provider: Provider): Promise<Result> {
  await deleteConnection(provider);
  revalidatePath("/");
  return { ok: true };
}
