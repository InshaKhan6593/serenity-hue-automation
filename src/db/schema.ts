import {
  pgTable,
  text,
  timestamp,
  jsonb,
  real,
  numeric,
  serial,
  integer,
  date,
  index,
} from "drizzle-orm/pg-core";

/** OAuth connections (one row per provider). */
export const connections = pgTable("connections", {
  provider: text("provider").primaryKey(), // "google" | "dropbox"
  accountEmail: text("account_email"),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AttachmentInfo = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
};

export type EmailStatus = "processing" | "invoice" | "ignored" | "error";

/**
 * Light record of every email Jev has seen. Body text is only kept for
 * emails Jev thinks are invoices; ignored emails are re-fetched from Gmail on demand.
 */
export const emails = pgTable(
  "emails",
  {
    id: text("id").primaryKey(), // Gmail message id
    threadId: text("thread_id"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    attachments: jsonb("attachments").$type<AttachmentInfo[]>().default([]).notNull(),
    bodyText: text("body_text"),
    category: text("category"), // Jev category
    confidence: real("confidence"),
    jevAnswers: jsonb("jev_answers"),
    status: text("status").$type<EmailStatus>().notNull(),
    // "owner" once she has corrected or confirmed it; those decisions teach Jev about this sender.
    decidedBy: text("decided_by").$type<"jev" | "owner">().default("jev").notNull(),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("emails_status_idx").on(t.status), index("emails_received_idx").on(t.receivedAt)],
);

/**
 * saved: a real invoice/receipt, filed in Dropbox.
 * to_get: we know about a purchase but the email isn't the invoice (bill on a website, confirmation with no
 * amount, unpaid payment request); she has to get the invoice herself. The reason is in `notes`.
 */
export type InvoiceStatus = "saved" | "to_get";
export type VatLine = { rate: number; net: number; vat: number };

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    source: text("source").$type<"email" | "manual">().notNull(),
    documentType: text("document_type"), // invoice | receipt | credit_note | proforma | bill_notice
    supplierName: text("supplier_name"),
    supplierVatNumber: text("supplier_vat_number"),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date"),
    dueDate: date("due_date"),
    currency: text("currency"),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
    grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }),
    vatBreakdown: jsonb("vat_breakdown").$type<VatLine[]>(),
    originalInvoiceNumber: text("original_invoice_number"),
    portalUrl: text("portal_url"),
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>(),
    status: text("status").$type<InvoiceStatus>().notNull(),
    notes: jsonb("notes").$type<string[]>().default([]).notNull(),
    fileName: text("file_name"),
    dropboxPath: text("dropbox_path"),
    dropboxUrl: text("dropbox_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invoices_status_idx").on(t.status), index("invoices_date_idx").on(t.invoiceDate)],
);

export type Email = typeof emails.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
