# Setup guide

Step by step, from a fresh machine to invoices appearing in Dropbox. Allow about 30 minutes.

## 0. Prerequisites

- **Node.js 20.9+** (22 recommended) and npm
- **Docker Desktop** (for the Postgres database)
- The Gmail account that receives the invoices, and the Dropbox account they should go to

```bash
git clone https://github.com/InshaKhan6593/serenity-hue-automation.git
cd serenity-hue-automation
npm install
cp .env.example .env.local
```

Every key below goes into **`.env.local`**. It is git-ignored; never commit it or paste keys into chat/issues.

---

## 1. Google (Gmail read access)

1. Go to <https://console.cloud.google.com>, create a project (e.g. *Serenity Hue*).
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform → Branding**: app name `Serenity Hue Invoices`, support email = your email.
   **Audience**: *External*. **Contact information**: your email. Create.
4. **Audience → Test users → Add users**: add the Gmail address that receives the invoices.
5. **Data Access → Add or remove scopes**: tick `https://www.googleapis.com/auth/gmail.readonly` → Update → Save.
6. **Clients → Create client**:
   - Application type: **Web application**
   - **Authorized redirect URIs** (not *JavaScript origins*): `http://localhost:3000/api/auth/google/callback`
   - Create, then **Download JSON** (the secret is only shown once).
7. In `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   ```

> While the app is in **Testing**, Google expires the connection after **7 days**. For real use, set
> **Audience → Publishing status → In production**. Unverified is fine for a single user; she'll see a
> "Google hasn't verified this app" screen once and clicks *Continue*.

## 2. Dropbox

1. Go to <https://www.dropbox.com/developers/apps> → **Create app**.
2. **Scoped access** → **App folder** (the app can only see its own folder) → name it (e.g. `SerenityHueInvoices`).
3. **Permissions** tab: tick `files.metadata.read`, `files.metadata.write`, `files.content.read`,
   `files.content.write`, `sharing.read`, `sharing.write` → **Submit**. (Do this before connecting.)
4. **Settings** tab → **OAuth 2 → Redirect URIs** → add `http://localhost:3000/api/auth/dropbox/callback`.
5. Copy **App key** and **App secret** into `.env.local`:
   ```
   DROPBOX_APP_KEY=...
   DROPBOX_APP_SECRET=...
   DROPBOX_REDIRECT_URI=http://localhost:3000/api/auth/dropbox/callback
   ```
   Don't use the "Generate access token" button; the app gets a long-lived token itself when you click
   *Connect Dropbox*.

Files will appear in Dropbox under **Apps → <app name> → Invoices**.

## 3. OpenRouter (Jev, the email sorter)

1. <https://openrouter.ai> → **Keys** → create a key. Set a small **credit limit** on it (Jev costs
   fractions of a penny per thousand emails).
2. `.env.local`: `OPENROUTER_API_KEY=sk-or-...`

## 4. LlamaCloud (LlamaExtract, the invoice reader)

1. <https://cloud.llamaindex.ai> → **API Keys** → create. The free plan includes 10,000 credits a month,
   which is plenty for tens of invoices a month (~25 credits per page).
2. `.env.local`: `LLAMA_CLOUD_API_KEY=llx-...`

## 5. Database

```bash
npm run db:up      # Postgres 17 in Docker on localhost:5434 (data kept in a Docker volume)
npm run db:push    # create/update the tables from src/db/schema.ts
```

`DATABASE_URL` in `.env.example` already matches the Docker container. If port 5434 is taken, change it
in both `docker-compose.yml` and `DATABASE_URL`.

## 6. Optional settings

```
SYNC_START_DATE=2026-07-01   # first day to collect invoices from
AUTO_SYNC_MINUTES=15         # how often Gmail is checked (0 = only when "Sync emails" is clicked)
DEFAULT_CURRENCY=GBP         # used when a document has an amount but prints no currency
```

## 7. Run it

```bash
npm run dev
```

Open <http://localhost:3000>:

1. **Connect Gmail**: sign in with the invoice inbox and **tick the box to allow reading email**
   (if it's left unticked the app says so and asks again).
2. **Connect Dropbox** → Allow.
3. **Sync emails**. The first run goes back to `SYNC_START_DATE` and takes roughly 1–2 seconds per email.

## 8. Check it works

```bash
npm run test:uk                                              # Jev routing on UK-style emails (expects 16/16)
npm run test:pdfs -- "C:/path/to/folder/with/pdfs"           # extraction on real PDFs vs invoice_log.csv
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Request had insufficient authentication scopes" | Reconnect Gmail and tick the email permission box |
| "Access blocked: app has not completed verification" | Add the Gmail address under *Audience → Test users* |
| Gmail stops working after a week | Set the Google app to *In production* (see step 1) |
| "Quota exceeded … units per minute" in logs | Harmless: the app waits and retries automatically |
| "LlamaCloud job timed out" | Occasional service slowness; it retries once. Re-sync picks up anything left |
| Files not appearing in Dropbox | Check the Dropbox *Permissions* were submitted before connecting; reconnect if not |
| Port 3000 or 5434 in use | Stop the other app, or change the port (Google/Dropbox redirect URIs must match) |
