import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emails } from "@/db/schema";

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? email.toLowerCase();

/**
 * What the owner has decided about earlier emails from this sender's domain (only her own corrections,
 * never Jev's guesses, so mistakes can't reinforce themselves). Jev sees it as extra context.
 */
export type OwnerHistory = { invoices: number; notInvoices: number; text: string };

export async function ownerHistory(fromEmail: string | null): Promise<OwnerHistory | undefined> {
  if (!fromEmail) return undefined;
  const [row] = await db
    .select({
      invoices: sql<number>`count(*) filter (where ${emails.status} = 'invoice')::int`,
      notInvoices: sql<number>`count(*) filter (where ${emails.status} = 'ignored')::int`,
    })
    .from(emails)
    .where(and(eq(emails.decidedBy, "owner"), sql`split_part(lower(${emails.fromEmail}), '@', 2) = ${domainOf(fromEmail)}`));
  if (!row || row.invoices + row.notInvoices === 0) return undefined;
  return {
    ...row,
    text: `The owner reviewed ${row.invoices + row.notInvoices} earlier email(s) from this sender: ${row.invoices} were invoices or receipts she needed, ${row.notInvoices} were not.`,
  };
}
