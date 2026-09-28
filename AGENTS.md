<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Serenity Hue · Invoices — guide for coding agents

Read `README.md` for what the app does and `docs/SETUP.md` for accounts/keys. This file is how to work on it.

## What it is

A Next.js 16 app that reads a UK shop owner's Gmail, finds purchase invoices, files the real ones in
Dropbox by month (`/Invoices/<year>/<MM - Month>/`), and lists purchases whose invoice she must fetch
herself ("To get"). It is used by one person; the accountant reads `invoice_log.csv` in Dropbox.

**Guiding rule: only a document that *is* the invoice goes to Dropbox.** A receipt/invoice with an
amount (even £0) is an invoice. A confirmation without an amount, an unpaid payment request, or a
"your bill is ready, log in" email is **To get**. Nothing that might be a purchase is silently dropped.

## Pipeline (per email)

`src/lib/sync.ts` → `processEmail` in `src/lib/pipeline.ts`:

1. `gmail.ts` `getEmail` – parse message, body text (HTML → text), attachment list.
2. `jev.ts` `classifyEmail` – Jev (OpenRouter Decisions API, `typesafe/jev-1.13`) answers:
   `category` (form of the email), `payment_status` (paid / payment_requested / bill_on_website /
   no_purchase) and `invoice_attachment` (which attachment). If unsure and there's an attachment,
   `llama.ts` `parseText` reads it cheaply and Jev is asked again.
3. `jev.ts` `routeEmail` – ignored / invoice (with form + `unpaid`) / unclear. Her past decisions for the
   sender domain (`history.ts`) are context for Jev and a tie-breaker for unclear emails.
4. `pipeline.ts` `createInvoiceFromEmail` → `storeInvoice` – LlamaExtract (`llama.ts`) reads the document;
   `validate.ts` `notesFor` adds notes; then **saved** (file uploaded, `dropbox.ts`) or **to_get**
   (no file; reason in `notes`: `bill_on_website` | `no_invoice_in_email` | `payment_request`).
5. After the run: `validate.ts` `resolveDuplicates` (one purchase = one record), then
   `filing.ts` `writeInvoiceLogs`.

Manual uploads (`src/app/api/upload/route.ts`) go straight to `storeInvoice` (always saved), then the same
tidy-up. UI actions are server actions in `src/app/actions.ts`.

## Data (`src/db/schema.ts`, Postgres via Drizzle)

- `emails` – one light row per Gmail message: status `processing | invoice | ignored | error`, Jev answers,
  `decided_by` (`jev` | `owner` – owner rows are the learning signal). Body text only kept for invoices.
- `invoices` – status `saved | to_get`; `notes` holds both display notes and to-get reasons (labels in
  `src/lib/labels.ts`); Dropbox path/link.
- `connections` – OAuth refresh tokens for Google and Dropbox.

Schema changes: edit `schema.ts`, then `npm run db:push`. For renames/data changes write explicit SQL
(`docker exec -i serenity-hue-db psql -U serenity -d serenity_hue`), since `push` may drop columns.

## Rules for changes

- **No per-supplier rules.** Classification and extraction must stay general (it has to work on the
  client's suppliers, not the dev's inbox). Improve Jev criteria / LlamaExtract schema descriptions or the
  general routing/dedupe rules instead. Verify with `npm run test:uk` (must stay 16/16) and
  `npm run test:pdfs -- <folder>` on real PDFs.
- **Never remove data permanently.** Removal = file to Dropbox's deleted files + email to Ignored
  (`filing.ts` `discardInvoice`).
- **Keep emails as received** – don't strip or rewrite email content; only change how it's displayed.
- **Only record notes she or the accountant can act on** (see `NOTE_LABELS`); don't add review queues.
- UI uses **shadcn components only** (style `base-nova`, built on **Base UI**, not Radix): use the
  `render` prop instead of `asChild`; `Select`'s `onValueChange` gives `string | null`.
- Server-only modules import `"server-only"`. Scripts therefore run with
  `tsx --conditions=react-server --env-file=.env.local` (use the `npm run` scripts).
- Money is stored as `numeric` strings; format with `formatMoney` (fixed 2 decimals – Node and browsers
  disagree otherwise and hydration breaks).
- Next 16: `params`/`searchParams`/`cookies()` are async; `RouteContext<"/path">` / `PageProps<"/">` are
  generated types (`npx next typegen`). Check `node_modules/next/dist/docs/` before using a Next API.
- When writing code through shell heredocs/JS templates, **check regex escapes survived** (`\d`, `\s`,
  `\uXXXX` have been stripped before); prefer the Edit tool for lines with backslashes.
- Secrets live only in `.env.local` (git-ignored). Never commit keys, tokens, or the OAuth client JSON.

## Commands

```bash
npm run dev            # app on http://localhost:3000 (auto-sync every AUTO_SYNC_MINUTES)
npm run typecheck && npm run lint && npm run build
npm run db:up          # Postgres in Docker (localhost:5434)
npm run db:push        # apply schema.ts
npm run test:uk        # Jev routing on 16 UK-style emails (no DB/Gmail needed, uses OpenRouter)
npm run test:pdfs -- "<folder with PDFs + invoice_log.csv>"   # extraction accuracy, writes nothing
npm run jev:eval       # re-ask Jev about stored emails, shows what would change, writes nothing
npm run dropbox:rebuild  # re-file all invoices into month folders + rewrite invoice_log.csv
```

To re-process emails after changing classification/extraction: delete their `invoices` rows (and Dropbox
files) and `emails` rows, then trigger a sync (`POST /api/sync`) – already-processed emails are skipped.

## Testing the UI with an automated browser

The page is streamed; React hydrates Suspense content lazily when the tab is hidden. Do one real click
before dispatching synthetic events (e.g. setting a file input via `DataTransfer`), otherwise handlers
won't fire and it looks like a bug.
