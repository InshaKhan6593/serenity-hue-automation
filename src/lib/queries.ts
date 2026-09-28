import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { emails, invoices } from "@/db/schema";
import { getConnection } from "./connections";

export type InvoiceRow = Omit<typeof invoices.$inferSelect, "createdAt" | "updatedAt"> & {
  emailSubject: string | null;
  emailFrom: string | null;
};

export type EmailRow = {
  id: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: string;
  category: string | null;
  confidence: number | null;
  status: string;
  error: string | null;
};

function monthRange(month: string | null) {
  if (!month) return null;
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

const toEmailRow = (e: typeof emails.$inferSelect): EmailRow => ({
  id: e.id,
  fromName: e.fromName,
  fromEmail: e.fromEmail,
  subject: e.subject,
  receivedAt: e.receivedAt.toISOString(),
  category: e.category,
  confidence: e.confidence,
  status: e.status,
  error: e.error,
});

export async function loadDashboard(month: string | null) {
  const range = monthRange(month);

  const selectInvoices = (status: "saved" | "to_get") =>
    db
      .select({ invoice: invoices, emailSubject: emails.subject, emailFrom: emails.fromEmail })
      .from(invoices)
      .leftJoin(emails, eq(invoices.emailId, emails.id))
      .where(
        and(
          eq(invoices.status, status),
          // Invoices still to get always show, whatever month is picked, so none get forgotten.
          range && status === "saved" ? and(gte(invoices.invoiceDate, range.start), lt(invoices.invoiceDate, range.end)) : undefined,
        ),
      )
      .orderBy(desc(invoices.invoiceDate), desc(invoices.id));

  const emailDateFilter = range
    ? and(gte(emails.receivedAt, new Date(range.start)), lt(emails.receivedAt, new Date(range.end)))
    : undefined;

  const [saved, toGet, failedEmails, ignored, [{ ignoredTotal }], google, dropbox] = await Promise.all([
    selectInvoices("saved"),
    selectInvoices("to_get"),
    // Emails that failed to process after several tries: she opens them and decides.
    db
      .select()
      .from(emails)
      .where(and(eq(emails.status, "error"), gte(emails.attempts, 3)))
      .orderBy(desc(emails.receivedAt)),
    db.select().from(emails).where(and(eq(emails.status, "ignored"), emailDateFilter)).orderBy(desc(emails.receivedAt)).limit(500),
    db
      .select({ ignoredTotal: sql<number>`count(*)::int` })
      .from(emails)
      .where(and(eq(emails.status, "ignored"), emailDateFilter)),
    getConnection("google"),
    getConnection("dropbox"),
  ]);

  const mapInvoice = ({ invoice, emailSubject, emailFrom }: (typeof saved)[number]): InvoiceRow => {
    const { createdAt, updatedAt, ...rest } = invoice;
    void createdAt;
    void updatedAt;
    return { ...rest, emailSubject, emailFrom };
  };

  return {
    saved: saved.map(mapInvoice),
    toGet: toGet.map(mapInvoice),
    failedEmails: failedEmails.map(toEmailRow),
    ignored: ignored.map(toEmailRow),
    ignoredTotal,
    connections: {
      google: google ? { email: google.accountEmail } : null,
      dropbox: dropbox ? { email: dropbox.accountEmail } : null,
    },
  };
}

/** Months from the sync start up to the current month, newest first ("2026-09"). */
export function monthOptions(start: string) {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  while (y > sy || (y === sy && m >= sm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}
