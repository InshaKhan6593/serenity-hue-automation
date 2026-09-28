import "server-only";
import { eq, sql } from "drizzle-orm";
import type { gmail_v1 } from "googleapis";
import { db } from "@/db";
import { emails, invoices, type Invoice } from "@/db/schema";
import { candidateAttachments, downloadAttachment, getEmail, gmailClient, type ParsedEmail } from "./gmail";
import { classifyEmail, CONFIDENCE_THRESHOLD, routeEmail, type Category } from "./jev";
import { extractBillNotice, extractInvoice, parseText, type BillNotice, type ExtractedInvoice } from "./llama";
import { notesFor } from "./validate";
import { folderFor, invoiceFileName, sharedLink, uploadFile } from "./dropbox";
import { emailToPdf } from "./email-pdf";
import { ownerHistory } from "./history";

const money = (n: number | null | undefined) => (n == null ? null : n.toFixed(2));

/** Classify one Gmail message with Jev: possible purchases become invoice rows, the rest go to Ignored. */
export async function processEmail(gmail: gmail_v1.Gmail, id: string) {
  const email = await getEmail(gmail, id);
  const base = {
    id,
    threadId: email.threadId,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    subject: email.subject,
    receivedAt: email.receivedAt,
    attachments: email.attachments,
  };
  await db
    .insert(emails)
    .values({ ...base, status: "processing", attempts: 1 })
    .onConflictDoUpdate({ target: emails.id, set: { status: "processing", error: null, attempts: sql`${emails.attempts} + 1` } });

  try {
    // A previous attempt may have been interrupted after creating an invoice row.
    await db.delete(invoices).where(eq(invoices.emailId, id));
    const candidates = candidateAttachments(email.attachments);
    const history = await ownerHistory(email.fromEmail);
    const input = { ...email, attachments: candidates, ownerHistory: history?.text };
    let jev = await classifyEmail(input);

    // Unsure and there's a document we haven't looked inside: read it cheaply and ask again.
    if (jev.probability < CONFIDENCE_THRESHOLD && candidates.length) {
      const doc = candidates[jev.attachmentIndex ?? 0];
      try {
        const buf = await downloadAttachment(gmail, id, doc.attachmentId);
        const attachmentText = await parseText(buf, doc.filename);
        if (attachmentText.trim()) jev = await classifyEmail({ ...input, attachmentText });
      } catch {
        // Parsing is only a helper; fall through with the first answer.
      }
    }

    const route = routeEmail(jev, candidates.length > 0, history);
    const common = { category: jev.category, confidence: jev.probability, jevAnswers: jev.raw };

    if (route.to === "ignored") {
      await db.update(emails).set({ ...common, status: "ignored", bodyText: null }).where(eq(emails.id, id));
      return;
    }

    // Unsure emails are still recorded (noted "Check") so nothing that might be a purchase is hidden.
    const unsure = route.to === "unclear";
    const category: Exclude<Category, "not_invoice"> =
      route.to === "invoice" ? route.category : jev.category !== "not_invoice" ? jev.category : candidates.length ? "invoice_attached" : "invoice_in_body";
    await db.update(emails).set({ ...common, status: "invoice", bodyText: email.bodyText }).where(eq(emails.id, id));
    const attachment = jev.attachmentIndex != null ? candidates[jev.attachmentIndex] : undefined;
    await createInvoiceFromEmail(gmail, email, category, attachment?.attachmentId, {
      notes: unsure ? ["unsure"] : [],
      unpaid: route.to === "invoice" && route.unpaid,
    });
  } catch (e) {
    await db.update(emails).set({ status: "error", error: (e as Error).message.slice(0, 1000) }).where(eq(emails.id, id));
    throw e;
  }
}

const emailText = (email: ParsedEmail) =>
  `From: ${email.fromName ?? ""} <${email.fromEmail ?? ""}>\nSubject: ${email.subject ?? ""}\nDate: ${email.receivedAt.toISOString().slice(0, 10)}\n\n${email.bodyText}`;

/**
 * Turns a purchase email into either a saved invoice (the email or its attachment IS the invoice: filed in
 * Dropbox) or a "to get" item (bill on a website, confirmation without the invoice, unpaid payment request).
 */
export async function createInvoiceFromEmail(
  gmail: gmail_v1.Gmail,
  email: ParsedEmail,
  category: Category,
  attachmentId?: string,
  { notes = [], unpaid = false }: { notes?: string[]; unpaid?: boolean } = {},
) {
  const emailDate = email.receivedAt.toISOString().slice(0, 10);

  if (category === "invoice_link_only") {
    let notice: BillNotice | null = null;
    try {
      notice = (await extractBillNotice(emailText(email))).data;
    } catch {
      /* still list it to upload */
    }
    await db.insert(invoices).values({
      emailId: email.id,
      source: "email",
      documentType: "bill_notice",
      supplierName: notice?.supplierName ?? email.fromName ?? email.fromEmail,
      invoiceDate: notice?.billDate && ISO_DATE.test(notice.billDate) ? notice.billDate : emailDate,
      grossAmount: money(notice?.amountDue),
      portalUrl: notice?.portalUrl ?? null,
      status: "to_get",
      notes: ["bill_on_website", ...notes],
    });
    return;
  }

  const candidates = candidateAttachments(email.attachments);
  const attachment =
    candidates.find((a) => a.attachmentId === attachmentId) ??
    (category !== "invoice_in_body" ? candidates.find((a) => a.mimeType === "application/pdf") ?? candidates[0] : undefined);

  if (attachment) {
    const document = await downloadAttachment(gmail, email.id, attachment.attachmentId);
    await storeInvoice({
      emailId: email.id,
      source: "email",
      document,
      ext: attachment.filename.split(".").pop()?.toLowerCase() || "pdf",
      extractInput: { content: document, filename: attachment.filename },
      isCreditNote: category === "credit_note",
      fallback: { supplierName: email.fromName ?? email.fromEmail, date: emailDate },
      notes,
      unpaid,
      requireAmount: true,
    });
  } else {
    // Receipt written in the email itself: save the email as a PDF, read the details from its text.
    await storeInvoice({
      emailId: email.id,
      source: "email",
      document: await emailToPdf(email),
      ext: "pdf",
      extractInput: { content: Buffer.from(emailText(email), "utf8"), filename: "email.txt" },
      isCreditNote: category === "credit_note",
      fallback: { supplierName: email.fromName ?? email.fromEmail, date: emailDate },
      notes,
      unpaid,
      requireAmount: true,
      bodyOnly: true,
    });
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read the details, then: a real invoice (has an amount, isn't an unpaid request) is filed in its month folder
 * in Dropbox; otherwise it's recorded as "to get" with the reason and no file. For email documents and uploads.
 */
export async function storeInvoice(opts: {
  emailId: string | null;
  source: "email" | "manual";
  document: Buffer;
  ext: string;
  extractInput: { content: Buffer; filename: string };
  isCreditNote?: boolean;
  /** Used when the document doesn't say: the email's sender and date, or the upload date. */
  fallback: { supplierName?: string | null; date: string };
  existingId?: number;
  notes?: string[];
  /** Jev says it's a payment request, not a receipt. */
  unpaid?: boolean;
  /** From email: without an amount it's a confirmation, not the invoice. (Her own uploads are always kept.) */
  requireAmount?: boolean;
  /** The "document" is the email text itself, so if it can't be read there's nothing worth filing. */
  bodyOnly?: boolean;
}) {
  let data: ExtractedInvoice | null = null;
  let confidence: Record<string, number> = {};
  const notes: string[] = [...(opts.notes ?? [])];

  try {
    const res = await extractInvoice(opts.extractInput.content, opts.extractInput.filename);
    data = res.data;
    confidence = res.confidence;
  } catch (e) {
    notes.push("extraction_failed");
    console.error("[extract]", (e as Error).message);
  }

  if (data) {
    if (opts.isCreditNote || data.documentType === "credit_note") {
      data.documentType = "credit_note";
      const neg = (n: number | null) => (n == null ? n : -Math.abs(n));
      data.netAmount = neg(data.netAmount);
      data.vatAmount = neg(data.vatAmount);
      data.grossAmount = neg(data.grossAmount) ?? data.grossAmount;
      data.vatBreakdown = data.vatBreakdown.map((l) => ({ rate: l.rate, net: -Math.abs(l.net), vat: -Math.abs(l.vat) }));
    }
    notes.push(...(await notesFor(data)));
  }

  const invoiceDate = data?.invoiceDate && ISO_DATE.test(data.invoiceDate) ? data.invoiceDate : opts.fallback.date;
  const details = {
    supplierName: data?.supplierName || opts.fallback.supplierName || "Unknown",
    invoiceNumber: data?.invoiceNumber?.replace(/^[#\s]+/, "") || null,
    // No currency printed (common on UK invoices): assume the business's own currency, when there's an amount.
    currency: data?.currency?.toUpperCase() ?? (data?.grossAmount != null ? (process.env.DEFAULT_CURRENCY ?? "GBP") : null),
    grossAmount: money(data?.grossAmount),
  };

  const getReason = opts.unpaid
    ? "payment_request"
    : (opts.requireAmount && data && data.grossAmount == null) || (!data && opts.bodyOnly)
      ? "no_invoice_in_email"
      : null;

  if (getReason) {
    // Not the invoice itself: list it to get, keep the details we found, don't file anything.
    const toGet = {
      ...details,
      emailId: opts.emailId,
      source: opts.source,
      documentType: data?.documentType ?? null,
      invoiceDate,
      status: "to_get" as const,
      notes: [...new Set([getReason, ...notes.filter((n) => !["amount_not_shown", "vat_not_shown", "extraction_failed"].includes(n))])],
      updatedAt: new Date(),
    };
    const [row] = opts.existingId
      ? await db.update(invoices).set(toGet).where(eq(invoices.id, opts.existingId)).returning()
      : await db.insert(invoices).values(toGet).returning();
    return row as Invoice;
  }

  const uploaded = await uploadFile(`${folderFor(invoiceDate)}/${invoiceFileName({ ...details, invoiceDate }, opts.ext)}`, opts.document);

  const values = {
    ...details,
    emailId: opts.emailId,
    source: opts.source,
    documentType: data?.documentType ?? null,
    supplierVatNumber: data?.supplierVatNumber ?? null,
    invoiceDate,
    dueDate: data?.dueDate && ISO_DATE.test(data.dueDate) ? data.dueDate : null,
    netAmount: money(data?.netAmount),
    vatAmount: money(data?.vatAmount),
    vatBreakdown: data?.vatBreakdown ?? null,
    originalInvoiceNumber: data?.originalInvoiceNumber ?? null,
    fieldConfidence: confidence,
    status: "saved" as const,
    notes: [...new Set(notes)],
    fileName: uploaded.path.split("/").pop()!,
    dropboxPath: uploaded.path,
    dropboxUrl: await sharedLink(uploaded.path),
    updatedAt: new Date(),
  };

  if (opts.existingId) {
    const [row] = await db.update(invoices).set(values).where(eq(invoices.id, opts.existingId)).returning();
    return row as Invoice;
  }
  const [row] = await db.insert(invoices).values(values).returning();
  return row as Invoice;
}

/** She marked an ignored email as an invoice: pick the best path from what the email contains. */
export async function reprocessAsInvoice(emailId: string, notes: string[] = []) {
  const gmail = await gmailClient();
  const email = await getEmail(gmail, emailId);
  const [row] = await db.select().from(emails).where(eq(emails.id, emailId));
  const candidates = candidateAttachments(email.attachments);

  const answers = row?.jevAnswers as { invoice_attachment?: { choice?: string } } | null;
  const idx = answers?.invoice_attachment?.choice?.startsWith("att_") ? Number(answers.invoice_attachment.choice.slice(4)) : null;
  const attachmentId = idx != null ? candidates[idx]?.attachmentId : undefined;

  const category: Category =
    row?.category === "invoice_link_only" || row?.category === "credit_note"
      ? row.category
      : candidates.length
        ? "invoice_attached"
        : "invoice_in_body";

  await db.update(emails).set({ status: "invoice", bodyText: email.bodyText }).where(eq(emails.id, emailId));
  await createInvoiceFromEmail(gmail, email, category, attachmentId, { notes });
}
