import "server-only";
import type { AttachmentInfo } from "@/db/schema";

const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";

/** Below this probability the email goes to Review instead of being auto-routed. */
export const CONFIDENCE_THRESHOLD = 0.8;

// Any purchase the inbox owner made counts (food, travel, software, supplies...): she decides later
// whether it's a business cost, so Jev must not drop receipts for looking "personal".
export const CATEGORIES = {
  invoice_attached:
    "A receipt, invoice or bill for something the inbox owner bought or paid for (any seller, any kind of purchase), and the document is attached to the email as a file (PDF, image or document).",
  invoice_in_body:
    "The email itself is a receipt, order confirmation with the amount paid, booking/ticket purchase confirmation, or invoice for something the inbox owner bought or paid for (any seller: shops, restaurants, food delivery, airlines, software, subscriptions). It states what was bought and/or the amount paid or due, and no invoice file is attached.",
  invoice_link_only:
    "A seller or utility says a bill, invoice or statement is ready, but the document is neither attached nor shown in the email; you must log in to an account or click a link to view or download it.",
  credit_note:
    "A credit note or refund confirmation from a seller reducing the amount paid for an earlier purchase.",
  not_invoice:
    "No purchase was made or paid for in this email: marketing, newsletters, promotions and discount codes, shipping or delivery tracking without prices, failed or declined payments, subscription or trial reminders with no charge, sales made BY the inbox owner's own shop to its customers (Shopify or TikTok Shop new-order notifications), platform payout notices, account, login or security notices, verification codes, invitations and conversations.",
} as const;

export type Category = keyof typeof CATEGORIES;

// Separate from the category (which is about the *form* of the email): this is about whether money actually moved.
export const PAYMENT_STATUSES = {
  paid:
    "A receipt, invoice or order confirmation for something the owner bought or subscribed to: payment confirmation, 'thanks for your order' with an order summary, a paid ticket or booking, a subscription started or renewed. This includes free or £0/$0 orders and plans when the email is a receipt or order summary.",
  payment_requested:
    "The owner is asked to pay and there is no confirmation it was paid yet: an invoice or bill with an amount due, a 'pay now' or 'complete your payment' message, bank-transfer details to pay, a request for payment, or a booking reserved until payment is made.",
  bill_on_website:
    "A bill, invoice or statement is ready but not included in the email; the owner has to log in to an account or website to see or download it.",
  no_purchase:
    "Nothing was bought or charged: promotions, newsletters, reminders that a subscription will end, requests to add or update a card or payment details to keep a subscription or trial (even if they show an estimated bill), failed or declined payments, trial reminders ('your trial ends soon', 'your trial has ended'), welcome or onboarding emails with no order summary, account, login or security emails, delivery tracking, or sales to the owner's own customers.",
} as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;

type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export type JevResult = {
  category: Category;
  probability: number;
  attachmentIndex: number | null;
  /** Did money move? paid / payment requested / bill waiting on a website / no purchase, with Jev's probability. */
  payment: { status: PaymentStatus; probability: number };
  raw: unknown;
};

export type JevInput = {
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string;
  attachments: AttachmentInfo[];
  attachmentText?: string;
  /** What the owner decided about earlier emails from the same sender, e.g. "3 invoices, 0 not invoices". */
  ownerHistory?: string;
};

const MAX_BODY_CHARS = 12_000;

/** Retries connection drops and 429/5xx responses a few times before giving up. */
async function postWithRetry(body: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) throw new Error(`Jev HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
    }
  }
}

export async function classifyEmail(input: JevInput): Promise<JevResult> {
  const state: Record<string, string> = {
    context:
      "Inbox of the owner of Serenity Hue, a UK online shop selling on Shopify and TikTok Shop. We are finding every receipt or invoice for things the owner bought, so they can be checked for VAT.",
    from: [input.fromName, input.fromEmail && `<${input.fromEmail}>`].filter(Boolean).join(" "),
    subject: input.subject ?? "",
    date: input.receivedAt.toISOString().slice(0, 10),
    attachments: input.attachments.length
      ? input.attachments.map((a, i) => `[${i}] ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB)`).join("\n")
      : "none",
    body: input.bodyText.slice(0, MAX_BODY_CHARS),
  };
  if (input.attachmentText) state.attachment_text = input.attachmentText.slice(0, 8_000);
  if (input.ownerHistory) state.owner_history_for_this_sender = input.ownerHistory;

  const questions: Record<string, unknown> = {
    category: {
      type: "choice",
      instructions: "Is this email a receipt, invoice or bill for something the inbox owner paid for, and if so in what form?",
      criteria: CATEGORIES,
    },
    payment_status: {
      type: "choice",
      instructions: "What does this email say about paying for something the inbox owner bought?",
      criteria: PAYMENT_STATUSES,
    },
  };
  if (input.attachments.length) {
    const criteria: Record<string, string> = { none: "None of the attachments is an invoice, receipt, bill or credit note." };
    input.attachments.forEach((a, i) => (criteria[`att_${i}`] = `Attachment [${i}] "${a.filename}" is the invoice, receipt, bill or credit note document.`));
    questions.invoice_attachment = {
      type: "choice",
      instructions: "Which attachment is the supplier invoice / receipt / credit note document?",
      criteria,
    };
  }

  const res = await postWithRetry(JSON.stringify({ model: JEV_MODEL, state, questions }));
  if (!res.ok) throw new Error(`Jev request failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { answers: Record<string, ChoiceAnswer> };

  const cat = json.answers.category;
  const category = (cat.choice in CATEGORIES ? cat.choice : "not_invoice") as Category;
  const att = json.answers.invoice_attachment;
  const pay = json.answers.payment_status;
  const attachmentIndex = att && att.choice.startsWith("att_") ? Number(att.choice.slice(4)) : null;

  return {
    category,
    probability: cat.probabilities?.[cat.choice] ?? cat.confidence,
    attachmentIndex,
    payment: {
      status: (pay?.choice in PAYMENT_STATUSES ? pay.choice : "no_purchase") as PaymentStatus,
      probability: pay ? pay.probabilities?.[pay.choice] ?? pay.confidence : 0,
    },
    raw: json.answers,
  };
}

export type Route =
  | { to: "invoice"; category: Exclude<Category, "not_invoice">; unpaid: boolean }
  | { to: "ignored" }
  | { to: "unclear" };

const sure = (p: number) => p >= CONFIDENCE_THRESHOLD;

/**
 * Where an email goes. Two independent Jev answers are combined: the email's form (category) and whether
 * money moved (payment). Either one being confident is enough; if neither is, it's recorded as "unclear".
 */
export function routeEmail(jev: JevResult, hasAttachments: boolean, owner?: { invoices: number; notInvoices: number }): Route {
  const pay = jev.payment;
  const unpaid = pay.status === "payment_requested" && pay.probability >= 0.5;
  const formFromPayment = (): Exclude<Category, "not_invoice"> =>
    pay.status === "bill_on_website" ? "invoice_link_only" : hasAttachments ? "invoice_attached" : "invoice_in_body";

  if (sure(jev.probability)) {
    if (jev.category !== "not_invoice") return { to: "invoice", category: jev.category, unpaid };
    // Confident "not an invoice", unless the payment answer is just as sure money moved.
    return sure(pay.probability) && pay.status !== "no_purchase" ? { to: "invoice", category: formFromPayment(), unpaid } : { to: "ignored" };
  }
  if (sure(pay.probability)) {
    if (pay.status === "no_purchase") return { to: "ignored" };
    const category = jev.category !== "not_invoice" && pay.status !== "bill_on_website" ? jev.category : formFromPayment();
    return { to: "invoice", category, unpaid };
  }
  // Both answers lean "no purchase": not worth her time.
  if (jev.category === "not_invoice" && pay.status === "no_purchase") return { to: "ignored" };
  // Still unclear: follow what she has consistently decided for this sender before (learned, not hardcoded).
  if (owner && owner.notInvoices >= 2 && owner.invoices === 0) return { to: "ignored" };
  if (owner && owner.invoices >= 2 && owner.notInvoices === 0) return { to: "invoice", category: formFromPayment(), unpaid };
  return { to: "unclear" };
}
