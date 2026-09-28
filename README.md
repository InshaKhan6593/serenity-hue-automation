# Serenity Hue · Invoices

Collects the purchase invoices of **Serenity Hue** (a UK shop selling on Shopify and TikTok Shop) from Gmail,
files them in **Dropbox by month**, and lists the ones she has to fetch herself, ready for the VAT return.

- **Invoices**: every real invoice or receipt, saved as a file in Dropbox.
- **To get**: purchases where the email isn't the invoice (bill on a website, confirmation without the
  invoice, unpaid payment request). She downloads the invoice and uploads it here.
- **Ignored**: emails with no purchase in them (newsletters, promotions, account notices).

---

## What happens to each email

```
Gmail ─► 1. fetch ─► 2. Jev: is it a purchase? ─► 3. LlamaExtract: read it ─► 4. invoice or "to get"? ─► 5. tidy up
                           │ no                                                   │ invoice          │ to get
                           ▼                                                      ▼                  ▼
                        Ignored                                          Dropbox/Invoices/…     "To get" list
```

1. **Fetch** – every 15 minutes (or *Sync emails*), new Gmail messages since `SYNC_START_DATE` are read
   (read-only access). Emails already handled are skipped; failures are retried (3 tries).
2. **Classify with Jev** (TypeSafe's decision model, via OpenRouter). Two questions per email:
   - *Form*: invoice attached · receipt in the email · bill on a website · credit note · not an invoice
   - *Payment*: paid · payment requested · bill on a website · no purchase

   Either answer being ≥ 80 % sure decides; otherwise the email is still recorded with a **Check** note so
   nothing is lost. Her own past corrections for the same sender are passed to Jev and break ties
   (`src/lib/history.ts`).
3. **Extract with LlamaExtract** – supplier, VAT number, invoice number, dates, net/VAT/total, currency.
   Handles PDFs, photos and receipts written in the email body (the email is saved as a PDF).
4. **Invoice or "to get"?** – the email is kept as an invoice only if it *is* the invoice: it shows an
   amount (even £0) and isn't an unpaid request. Otherwise it goes to **To get** with the reason and no file.
5. **Tidy up** (`resolveDuplicates` in `src/lib/validate.ts`) – one purchase, one record:
   - a *To get* item is cleared when its real invoice arrives or is uploaded;
   - two emails that are certainly one purchase (same invoice number, or a "confirmed" email plus its
     numbered receipt) are merged, keeping the more complete one;
   - two that might be separate purchases are both kept, noted **Possible duplicate**.

   Then `Invoices/<year>/invoice_log.csv` is rewritten for the accountant.

Nothing is permanently deleted: removed files go to Dropbox's *Deleted files* (30 days) and removed
emails stay under **Ignored**.

## Dropbox layout

```
/Apps/<your app>/Invoices/
  2026/
    invoice_log.csv                                   ← all invoices + what's still to get
    07 - July/2026-07-20_Hankers_GLL8QL_PKR-8439.00.pdf
    08 - August/2026-08-17_Kilsby-Williams_94532-1_£480.00.pdf
```

## Notes shown on invoices

| Note | Meaning |
|---|---|
| VAT not shown | The document doesn't state VAT: get the full VAT invoice if the supplier charges VAT |
| Import VAT | Courier/customs invoice: the accountant claims it via the C79 / postponed VAT statement |
| Totals don't add up | Net + VAT ≠ total on the document |
| No amount | A document she uploaded shows no total |
| Possible duplicate | Same supplier and amount a few days apart, but maybe two purchases |
| Check | Not clear the email is a purchase |
| Couldn't read | File saved but details couldn't be read |

---

## Setup

Full step-by-step guide (Google, Dropbox, OpenRouter, LlamaCloud accounts): **[docs/SETUP.md](docs/SETUP.md)**.

```bash
npm install
cp .env.example .env.local        # fill in the keys
npm run db:up                     # Postgres in Docker (localhost:5434)
npm run db:push                   # create the tables
npm run dev                       # http://localhost:3000
```

Then **Connect Gmail** (tick the "read your email" box), **Connect Dropbox**, and **Sync emails**.

| Variable | What |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Gmail read-only OAuth client |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` / `DROPBOX_REDIRECT_URI` | Dropbox app (App folder access) |
| `OPENROUTER_API_KEY` | Jev (`typesafe/jev-1.13`) |
| `LLAMA_CLOUD_API_KEY` | LlamaExtract / LlamaParse (free plan: 10,000 credits/month) |
| `DATABASE_URL` | Postgres (the Docker one by default) |
| `SYNC_START_DATE` | First day to collect from (default `2026-07-01`) |
| `AUTO_SYNC_MINUTES` | How often to check Gmail (`0` turns it off) |
| `DEFAULT_CURRENCY` | Used when a document with an amount prints no currency (default `GBP`) |

## Checks

```bash
npm run typecheck && npm run lint && npm run build
npm run test:uk                    # Jev routing on 16 UK-style emails modelled on the client's inbox
npm run test:pdfs -- "<folder>"    # extract every PDF in a folder, compare with its invoice_log.csv (writes nothing)
npm run jev:eval                   # re-ask Jev about stored emails, show what would change (writes nothing)
npm run dropbox:rebuild            # re-file every invoice into its month folder and rewrite the log
```

## Working on the code

Coding agents (and people) should read **[AGENTS.md](AGENTS.md)** first: pipeline, data model, rules
for changes (no per-supplier rules, never delete data, keep emails as received), and gotchas.

## Code map

| Path | What |
|---|---|
| `src/lib/sync.ts` | Background sync: lists Gmail, processes new emails, then tidy-up + log |
| `src/lib/pipeline.ts` | One email → Jev → extraction → invoice or *to get* |
| `src/lib/jev.ts` | Jev questions, criteria and routing |
| `src/lib/llama.ts` | LlamaExtract schemas and calls (with retries) |
| `src/lib/validate.ts` | Notes and duplicate handling |
| `src/lib/filing.ts` | Dropbox filing, removal, `invoice_log.csv` |
| `src/lib/gmail.ts`, `dropbox.ts` | API clients (with retries) |
| `src/lib/history.ts` | Her past decisions per sender (the learning signal) |
| `src/app/actions.ts`, `src/app/api/*` | Save / remove / upload / OAuth / sync endpoints |
| `src/components/dashboard/*` | The UI (shadcn components) |
| `src/db/schema.ts` | Tables: `connections`, `emails`, `invoices` |
