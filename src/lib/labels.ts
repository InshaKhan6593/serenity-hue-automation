/** The only notes we record: things she or the accountant actually needs to know about a saved invoice. */
export const NOTE_LABELS: Record<string, { label: string; help: string }> = {
  import_vat: {
    label: "Import VAT",
    help: "Courier/customs invoice. The accountant claims import VAT using the HMRC C79 or postponed VAT statement.",
  },
  vat_not_shown: {
    label: "VAT not shown",
    help: "This receipt doesn't show VAT. If the supplier charges VAT, download the full VAT invoice from their website.",
  },
  amount_not_shown: {
    label: "No amount",
    help: "The document doesn't show a total. Check it against the supplier's website or the bank statement.",
  },
  totals_dont_add_up: {
    label: "Totals don't add up",
    help: "Net + VAT doesn't equal the total on this document (e.g. a delivery charge or discount). Check the figures against the file.",
  },
  duplicate: {
    label: "Possible duplicate",
    help: "Same supplier and amount within a few days, but different order numbers, so it may be two separate purchases. If it's the same payment, remove one.",
  },
  unsure: {
    label: "Check",
    help: "It wasn't clear from the email whether this is a purchase. Remove it if it isn't.",
  },
  extraction_failed: {
    label: "Couldn't read",
    help: "The file is saved, but the details couldn't be read. Open it and fill them in.",
  },
};

/** Why a purchase is on the "To get" list instead of in Dropbox: what she has to do. */
export const GET_REASON_LABELS: Record<string, { label: string; help: string }> = {
  bill_on_website: {
    label: "Bill on their website",
    help: "The supplier only emailed to say the bill is ready. Log in to their website, download it and upload it here.",
  },
  no_invoice_in_email: {
    label: "No invoice in the email",
    help: "The email confirms the purchase but doesn't include the invoice or the amount. Download the invoice from your account with them.",
  },
  payment_request: {
    label: "Payment request",
    help: "This asks you to pay; it isn't a receipt. Once paid, upload the receipt (or it's added automatically when it arrives by email).",
  },
};

export const CATEGORY_LABELS: Record<string, string> = {
  invoice_attached: "Invoice (attached)",
  invoice_in_body: "Receipt in email",
  invoice_link_only: "Bill on website",
  credit_note: "Credit note",
  not_invoice: "Not an invoice",
  duplicate: "Duplicate of another invoice",
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  credit_note: "Credit note",
  proforma: "Proforma",
  import_vat: "Import VAT",
  bill_notice: "Bill notice",
};

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatMoney(value: string | null, currency: string | null = "GBP") {
  if (value == null) return "—";
  try {
    // Fixed decimals: Node and browsers disagree on the default for some currencies (e.g. PKR), which breaks hydration.
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

export function formatDate(value: string | Date | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Opens the original email in Gmail. */
export function gmailLink(messageId: string) {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}
