import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emails, invoices } from "@/db/schema";
import { storeInvoice } from "@/lib/pipeline";
import { getConnection } from "@/lib/connections";
import { refreshInvoiceLogs } from "@/lib/filing";
import { deleteFile } from "@/lib/dropbox";
import { resolveDuplicates } from "@/lib/validate";

export const maxDuration = 300;

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

/** Manual upload: a paper invoice, or the bill for a "to upload" item. Saved into its month folder in Dropbox. */
export async function POST(req: NextRequest) {
  if (!(await getConnection("dropbox"))) return NextResponse.json({ error: "Connect Dropbox first" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Upload a PDF or a photo (JPG/PNG)" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File is larger than 20 MB" }, { status: 400 });

  const invoiceIdRaw = form.get("invoiceId");
  const existingId = invoiceIdRaw ? Number(invoiceIdRaw) : undefined;
  let existing = null;
  if (existingId) {
    [existing] = await db.select().from(invoices).where(eq(invoices.id, existingId));
    if (!existing) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const content = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const row = await storeInvoice({
    emailId: existing?.emailId ?? null,
    source: existing ? existing.source : "manual",
    document: content,
    ext,
    extractInput: { content, filename: file.name },
    // A bill she fetched keeps the date/supplier from its "bill is ready" email if the document doesn't say.
    fallback: { supplierName: existing?.supplierName, date: existing?.invoiceDate ?? new Date().toISOString().slice(0, 10) },
    existingId,
  });

  // She supplied the invoice for this email herself: Jev learns this sender sends real purchases.
  if (existing?.emailId) await db.update(emails).set({ decidedBy: "owner" }).where(eq(emails.id, existing.emailId));

  // Replacing a document: remove the old file.
  if (existing?.dropboxPath && existing.dropboxPath !== row.dropboxPath) {
    await deleteFile(existing.dropboxPath).catch(() => {});
  }
  await resolveDuplicates();
  await refreshInvoiceLogs();
  revalidatePath("/");
  return NextResponse.json({ id: row.id });
}
