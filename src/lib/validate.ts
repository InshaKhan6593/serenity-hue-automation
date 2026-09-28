import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, type Invoice } from "@/db/schema";
import { discardInvoice } from "./filing";
import type { ExtractedInvoice } from "./llama";

/**
 * Notes worth recording on a saved invoice. Deliberately short: the accountant checks the figures,
 * so we only flag what they can't see at a glance.
 */
export async function notesFor(data: ExtractedInvoice): Promise<string[]> {
  const notes: string[] = [];
  if (data.documentType === "import_vat") notes.push("import_vat");
  // null (not 0) means the document shows no VAT figure at all, e.g. an email receipt.
  if (data.vatAmount == null && data.grossAmount) notes.push("vat_not_shown");
  if (data.grossAmount == null) notes.push("amount_not_shown");
  const { netAmount: net, vatAmount: vat, grossAmount: gross } = data;
  if (net != null && vat != null && gross != null && Math.abs(net + vat - gross) > 0.02) notes.push("totals_dont_add_up");
  return notes;
}

// ---------------------------------------------------------------------------------------------------------
// One purchase, one record. Suppliers often send several emails for the same purchase ("order received" +
// "order complete", "subscription confirmed" + "receipt", a payment request then the receipt). The rules
// below are general, not per supplier, like Hubdoc's "same supplier, date and amount" duplicate check.
// ---------------------------------------------------------------------------------------------------------

const LEGAL_SUFFIXES = /\b(ltd|limited|plc|llc|inc|incorporated|pbc|corp|corporation|co|company|gmbh|s\.?a\.?r\.?l|sarl|bv|pty)\b\.?/g;

/** "Anthropic, PBC" → "anthropic"; "Kilsby Williams LLP" → "kilsby williams llp". */
function normaliseSupplier(name: string | null) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same supplier if the normalised names match, or one is the other plus extra words ("Viber" / "Viber Media"). */
function sameSupplier(a: Invoice, b: Invoice) {
  const x = normaliseSupplier(a.supplierName);
  const y = normaliseSupplier(b.supplierName);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && (long.startsWith(short + " ") || long.endsWith(" " + short));
}

function daysApart(a: Invoice, b: Invoice) {
  if (!a.invoiceDate || !b.invoiceDate) return Infinity;
  return Math.abs(new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime()) / 86_400_000;
}

/** Amounts agree, or one of them isn't known (a confirmation email without the total). */
function amountsCompatible(a: Invoice, b: Invoice) {
  return a.grossAmount == null || b.grossAmount == null || Number(a.grossAmount) === Number(b.grossAmount);
}

/** Higher is the better record to keep: has a file, an amount, an invoice number. */
function completeness(inv: Invoice) {
  return (inv.dropboxPath ? 8 : 0) + (inv.grossAmount != null ? 4 : 0) + (inv.invoiceNumber ? 1 : 0);
}

type Decision = { action: "removed" | "flagged"; keep: Invoice; other: Invoice; why: string };

/**
 * Runs after every sync and upload (emails from one purchase often arrive together and are processed at the
 * same moment, so this can't be decided when each is saved).
 *  1. An item on "To get" is cleared when the real invoice for it is saved (same supplier, compatible amount,
 *     within 7 days): e.g. the receipt arrives after a payment request, or she uploads the invoice.
 *  2. Two saved invoices are merged when it's certainly one purchase: same invoice number, or same supplier
 *     and amount within 3 days where only one of the two has an invoice number.
 *  3. Two saved invoices that only might be one purchase (same supplier and amount, different or no
 *     numbers) are both kept and noted "Possible duplicate", since they could be two real purchases.
 */
export async function resolveDuplicates({ dryRun = false } = {}) {
  const all = await db.select().from(invoices).orderBy(asc(invoices.id));
  const live = new Map(all.map((r) => [r.id, r]));
  const decisions: Decision[] = [];

  const remove = async (keep: Invoice, drop: Invoice, why: string) => {
    decisions.push({ action: "removed", keep, other: drop, why });
    live.delete(drop.id);
    if (!dryRun) await discardInvoice(drop, "duplicate");
  };

  // 1. "To get" items that a saved invoice (or an earlier "to get" item) already covers.
  for (const t of all.filter((r) => r.status === "to_get")) {
    const covered = [...live.values()].find(
      (s) => s.id !== t.id && sameSupplier(s, t) && amountsCompatible(s, t) && daysApart(s, t) <= 7 && (s.status === "saved" || s.id < t.id),
    );
    if (covered) await remove(covered, t, covered.status === "saved" ? "invoice received" : "same request twice");
  }

  // 2 & 3. Pairs of saved invoices.
  const saved = [...live.values()].filter((r) => r.status === "saved");
  for (let i = 0; i < saved.length; i++) {
    const a = saved[i];
    if (!live.has(a.id)) continue;
    for (const b of saved.slice(0, i)) {
      if (!live.has(b.id) || !sameSupplier(a, b)) continue;
      const sameNumber = !!a.invoiceNumber && a.invoiceNumber === b.invoiceNumber;
      const likely = amountsCompatible(a, b) && daysApart(a, b) <= 3;
      if (!sameNumber && !likely) continue;

      if (sameNumber || !a.invoiceNumber !== !b.invoiceNumber) {
        const [keep, drop] = completeness(a) > completeness(b) ? [a, b] : [b, a];
        await remove(keep, drop, sameNumber ? "same invoice number" : "confirmation + receipt");
        break;
      }
      decisions.push({ action: "flagged", keep: b, other: a, why: "same supplier and amount, different or no numbers" });
      if (!dryRun) {
        for (const inv of [a, b]) {
          const current = live.get(inv.id)!;
          if (current.notes.includes("duplicate")) continue;
          current.notes = [...current.notes, "duplicate"];
          await db.update(invoices).set({ notes: current.notes }).where(eq(invoices.id, inv.id));
        }
      }
    }
  }
  return decisions;
}
