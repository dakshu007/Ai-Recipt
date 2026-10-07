# SheetScan — AI receipt/data extractor for Google Sheets (SaaS edition)

Paste text or upload a receipt/invoice photo in a Google Sheets sidebar →
Gemini pulls out the fields → clean rows land in the sheet.

This repository is structured as a small SaaS: a thin Google Apps Script
add-on (the client) and a hardened backend API (the product). The Gemini API
key, usage metering, and plan entitlements all live server-side — users never
touch a key, and the free-tier limit can't be reset by editing script
properties. The full threat model is in [SECURITY.md](SECURITY.md).

```
addon/                          server/
  Code.gs      thin client        src/index.ts        boot + graceful shutdown
  Sidebar.html sidebar UI         src/app.ts          app factory (helmet, limits, routing)
  appsscript.json narrow scopes   src/config.ts       fail-fast env validation
                                  src/middleware/     Google ID token auth, rate limit, errors
                                  src/routes/         /v1/extract, /v1/usage, /v1/billing/webhook
                                  src/services/       Gemini client, usage store, entitlements
                                  src/lib/            request validation, output sanitization
                                  test/               43 tests (vitest + supertest)
```

## How a request flows

1. The sidebar sends text/photo to `Code.gs`, which calls the backend with the
   user's **Google identity token** (`ScriptApp.getIdentityToken()`).
2. The backend verifies the token (signature, expiry, audience), rate-limits,
   validates the payload, and checks the user's **server-side daily quota**
   (free vs. pro plan).
3. It calls Gemini with the server-held key, forces JSON via `responseSchema`,
   then re-validates and sanitizes every cell (including spreadsheet formula
   injection escaping) before responding.
4. The add-on sanitizes again and writes the rows to the active sheet.
5. Stripe webhooks (signature-verified) are the only path that flips a user
   between `free` and `pro`.

## Part 1 — Deploy the backend

Requirements: Node 20+, a Gemini API key (aistudio.google.com → "Get API key").

```bash
cd server
npm ci
cp .env.example .env      # fill in GEMINI_API_KEY and ALLOWED_OAUTH_AUDIENCES
npm test                  # 43 tests should pass
npm run dev               # local dev server on :8080
```

For local testing before the add-on exists, set `DEV_FAKE_USER=dev1:dev@example.com`
in `.env` (development only — the server refuses to boot with it in production) and:

```bash
curl -s -X POST localhost:8080/v1/extract \
  -H 'content-type: application/json' \
  -d '{"text":"Uber ride $23.40 on June 3"}'
```

**Production** (Cloud Run shown; any container host works):

```bash
cd server
gcloud run deploy sheetscan-api --source . \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars ALLOWED_OAUTH_AUDIENCES=<your-oauth-client-id>
```

- Inject `GEMINI_API_KEY` (and Stripe secrets) from a secret manager — never
  bake them into images or commit `.env` files.
- `ALLOWED_OAUTH_AUDIENCES` is the OAuth client ID of the Apps Script project
  (step below); tokens for any other app are rejected.
- The `server/Dockerfile` runs as a non-root user and ships prod deps only.

## Part 2 — Install the add-on (10 minutes)

1. Open a Google Sheet → Extensions → Apps Script.
2. Replace the default `Code.gs` with `addon/Code.gs`; add an HTML file named
   exactly `Sidebar` with the contents of `addon/Sidebar.html`.
3. Project Settings → check "Show appsscript.json manifest file in editor" →
   replace its contents with `addon/appsscript.json` (narrow scopes on purpose).
4. Project Settings → note the **GCP project OAuth client ID** — put it in the
   backend's `ALLOWED_OAUTH_AUDIENCES`. (For a standalone script, associate a
   standard GCP project first so identity tokens carry a stable audience.)
5. In the editor, run `setBackendUrl` once and paste your backend URL
   (https only — the client refuses anything else).
6. Refresh the Sheet → "SheetScan" menu → "Open extractor" → paste
   `Uber ride $23.40 on June 3, Staples paper $18.20 on June 5` → Extract.

There is **no `setApiKey` step anymore** — that's the point.

## Part 3 — Payments (optional)

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` together (the server
refuses one without the other) and point a Stripe webhook at
`POST /v1/billing/webhook` with events `checkout.session.completed` and
`customer.subscription.deleted`. A paid Checkout (matching the user's Google
account email) flips them to `pro`; subscription deletion flips them back.
Until both vars are set, billing routes aren't even mounted.

## Adjusting to your niche

- Extraction fields/categories: edit `SYSTEM_INSTRUCTION` + `RESPONSE_SCHEMA`
  in `server/src/services/gemini.ts` and the row normalization in
  `server/src/lib/sanitize.ts` (and the 4 columns in `addon/Code.gs`).
- Quotas and limits: all env vars — see `server/.env.example`.
- Model: `GEMINI_MODEL` env var (default `gemini-3.5-flash`; if it's retired,
  check ai.google.dev/gemini-api/docs/models).

## Scaling notes

- The usage/entitlement stores are in-memory: correct for one instance,
  swap for Redis/Postgres/Firestore (via the `UsageStore`/`EntitlementStore`
  interfaces) before running multiple instances or charging real money.
- Publishing to the Google Workspace Marketplace: keep the OAuth scopes as
  narrow as they are here (broader ones trigger a paid annual security
  review), and set `urlFetchWhitelist` in the manifest to your backend URL
  when you publish.
- CI (`.github/workflows/ci.yml`) runs typecheck + tests on every push/PR.
