// Routing test on UK-style emails modelled on the client's real inbox (see invoice_log.csv). Uses Jev only.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/uk-cases.mts
import { classifyEmail, routeEmail } from "../src/lib/jev";

const pdf = (name: string) => [{ attachmentId: "x", filename: name, mimeType: "application/pdf", size: 60_000, inline: false }];
type Case = { expect: string; fromName: string; fromEmail: string; subject: string; bodyText: string; attachments?: ReturnType<typeof pdf> };

const cases: Case[] = [
  { expect: "invoice", fromName: "Kilsby Williams", fromEmail: "accounts@kilsbywilliams.co.uk", subject: "VAT Invoice 94532/1", bodyText: "Dear Shabina, thank you for your payment. Please find attached your VAT invoice 94532/1 for professional services. Kind regards, Accounts", attachments: pdf("Invoice_94532-1.pdf") },
  { expect: "to_get:payment_request", fromName: "Kilsby Williams", fromEmail: "accounts@kilsbywilliams.co.uk", subject: "Request for payment 94963", bodyText: "Dear Shabina, please find attached our request for payment RFP 94963 for £120.00. A VAT invoice will be issued once payment is received. Bank: Lloyds 30-00-00 12345678.", attachments: pdf("RFP_94963.pdf") },
  { expect: "to_get:bill_on_website", fromName: "Three", fromEmail: "noreply@three.co.uk", subject: "Your Three bill is ready", bodyText: "Hi Shabina, your latest bill for your broadband is ready. Log in to My3 to view and download your bill. It'll be collected by Direct Debit on 20 August.", attachments: [] },
  { expect: "to_get:bill_on_website", fromName: "Valda Energy", fromEmail: "billing@valdaenergy.com", subject: "Your gas bill is ready to view", bodyText: "Your latest gas statement is now available in your online account. Sign in at valdaenergy.com/account to see it.", attachments: [] },
  { expect: "to_get:payment_request", fromName: "Alibaba.com", fromEmail: "notice@alibaba.com", subject: "Order 289191555501024516: please complete payment", bodyText: "Your order has been placed. Total US $186.40. Please pay now to confirm your order: Pay now. Orders not paid within 24 hours are cancelled.", attachments: [] },
  { expect: "ignored", fromName: "Envato", fromEmail: "billing@envato.com", subject: "Payment failed - your subscription has been cancelled", bodyText: "We couldn't process the payment for your Envato Elements subscription. Your subscription has been cancelled. Update your card to reactivate.", attachments: [] },
  { expect: "invoice", fromName: "DHL Express", fromEmail: "noreply@dhl.com", subject: "Your DHL Duty/VAT invoice AVD3328247", bodyText: "Import charges have been paid for shipment 1209455520 from MAKINGCOSMETICS INC. Your customs duty/VAT invoice is attached for your records.", attachments: pdf("AVD3328247.pdf") },
  { expect: "invoice", fromName: "Canva", fromEmail: "no-reply@canva.com", subject: "Your Canva Pro receipt", bodyText: "Thanks for your payment. Receipt 04980-49846760. Canva Pro monthly. Amount paid £13.00. Date 21 Aug 2026. Paid with Visa ending 4242.", attachments: [] },
  { expect: "invoice", fromName: "Aromantic", fromEmail: "orders@aromantic.co.uk", subject: "Aromantic order 346374 - invoice", bodyText: "Thank you for your order. Your invoice is attached. Order total £34.51 inc VAT.", attachments: pdf("Invoice-346374.pdf") },
  { expect: "ignored", fromName: "Amazon.co.uk", fromEmail: "shipment-tracking@amazon.co.uk", subject: "Your Amazon.co.uk order has been dispatched", bodyText: "Your package is on the way. Track your package. Arriving Thursday.", attachments: [] },
  { expect: "invoice", fromName: "Amazon.co.uk", fromEmail: "auto-confirm@amazon.co.uk", subject: "Your Amazon.co.uk order of 'Glass dropper bottles 30ml'", bodyText: "Thank you for your order. Order #206-1234567-1234567. Glass dropper bottles 30ml x 2 £18.98. Postage £0.00. Order total £18.98 (includes VAT £3.16). Paid by Visa.", attachments: [] },
  { expect: "ignored", fromName: "Shopify", fromEmail: "store+123@t.shopifyemail.com", subject: "[Serenity Hue] Order #1052 placed by Emma W.", bodyText: "Emma W. placed order #1052 for £42.00. Fulfil the order in Shopify admin.", attachments: [] },
  { expect: "invoice", fromName: "Shopify", fromEmail: "billing@shopify.com", subject: "Your Shopify bill for Serenity Hue", bodyText: "Your bill for 01 Aug - 31 Aug has been paid. Basic plan £25.00, apps £9.00, VAT £6.80. Total charged £40.80. Invoice #412345678 attached.", attachments: pdf("Shopify-invoice-412345678.pdf") },
  { expect: "ignored", fromName: "TikTok Shop", fromEmail: "seller@tiktok.com", subject: "Your settlement for 15-21 Sept is on the way", bodyText: "Your payout of £312.40 for orders settled between 15-21 Sept will arrive in your bank in 1-3 days.", attachments: [] },
  { expect: "invoice", fromName: "Royal Mail", fromEmail: "noreply@royalmail.com", subject: "Your Click & Drop receipt", bodyText: "Thank you for your purchase. 12 x Tracked 48 labels £41.40 (VAT exempt). Receipt RM-883201. Paid by card.", attachments: [] },
  { expect: "ignored", fromName: "Canva", fromEmail: "marketing@canva.com", subject: "New autumn templates for your brand", bodyText: "Fresh designs for your autumn launch. Try Canva Pro free for 30 days.", attachments: [] },
];

let pass = 0;
for (const c of cases) {
  const atts = c.attachments ?? [];
  const j = await classifyEmail({ ...c, attachments: atts, receivedAt: new Date("2026-08-20") });
  const r = routeEmail(j, atts.length > 0);
  // What the app will do with it (amount check happens after extraction, not tested here).
  const got =
    r.to === "ignored" ? "ignored" : r.to === "invoice" && r.category === "invoice_link_only" ? "to_get:bill_on_website" : r.to === "invoice" && r.unpaid ? "to_get:payment_request" : r.to === "unclear" ? "invoice(check)" : "invoice";
  const ok = got === c.expect || (c.expect === "invoice" && got === "invoice(check)");
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${c.expect.padEnd(22)} got ${got.padEnd(22)} | ${c.fromName}: ${c.subject}`);
}
console.log(`\n${pass}/${cases.length} correct`);
process.exit(0);
