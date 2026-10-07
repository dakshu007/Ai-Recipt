# Security model

SheetScan's SaaS architecture exists primarily to fix the trust problems of the
original single-script prototype, where the Gemini API key, the usage counter,
and the `isPro` flag all lived inside the user's own Apps Script project —
readable and writable by the user.

## Trust boundaries

```
 user's browser ──► Sidebar.html ──► Code.gs (Apps Script, user-controlled)
                                        │  HTTPS + Google ID token
                                        ▼
                                  SheetScan API  (server/, operator-controlled)
                                    │                     ▲
                                    │ HTTPS + API key     │ HTTPS + HMAC signature
                                    ▼                     │
                                 Gemini API             Stripe webhooks
```

Everything left of the API is untrusted: users own their copy of the add-on and
can modify it freely. Nothing security-relevant is enforced there — the add-on's
own checks (file size, https-only backend URL, cell sanitization) are UX and
defense-in-depth, not the control.

## Assets and controls

| Asset / threat | Control |
| --- | --- |
| **Gemini API key theft** | Key exists only in the server's environment (injected via a secret manager in production). It is sent upstream in the `x-goog-api-key` header, never in URLs, so it cannot leak through access logs. Clients never see it. |
| **Impersonation / anonymous use** | Every `/v1/*` call requires a Google ID token. The server verifies signature, expiry, issuer, and that `aud` is one of `ALLOWED_OAUTH_AUDIENCES` — tokens minted for other apps are rejected. Failure reasons are not disclosed to callers. |
| **Quota tampering** | Daily usage is metered server-side, keyed by the verified Google `sub`, in UTC buckets. Quota is reserved before the model call and refunded on upstream failure, so concurrent requests can't slip past the cap. Free *and* pro plans are capped. |
| **Self-service "pro"** | The plan flag lives server-side and changes only through Stripe webhook events whose `stripe-signature` HMAC verifies against `STRIPE_WEBHOOK_SECRET` (raw-body verification). Unpaid sessions don't upgrade. Plans are keyed by Google-verified email only (`email_verified: true`). |
| **Spreadsheet formula injection** (`=IMPORTXML(...)` etc. in model output, seeded via a crafted receipt) | Every string cell is sanitized server-side: control characters stripped, length capped, and cells starting with `=`, `+`, `-`, `@`, tab, or CR prefixed with `'` so Sheets/Excel treat them as literal text. The add-on applies the same guard again before writing. |
| **Prompt injection** ("ignore previous instructions" inside a receipt) | User content is delimited and declared as data in the system instruction; output is forced through Gemini's `responseSchema`, then independently re-validated and normalized (dates, amount clamps, category allowlist) before anything is returned. |
| **Abuse / DoS against the upstream key** | Per-user per-minute rate limiting (429 + `Retry-After`) in front of the daily quota; request body size capped; text length and image size/mime-type validated (base64 size computed without decoding); 30s upstream timeout. |
| **Information leakage** | Central error handler returns typed, generic errors; stack traces and upstream error bodies are logged server-side only. Config validation errors name the field, never the value. `x-powered-by` disabled, helmet headers on, `/healthz` returns `{ok:true}` only. |
| **Unsafe configuration** | The process refuses to boot on invalid config: missing key/audiences, Stripe key without webhook secret (or vice versa), or `DEV_FAKE_USER` set in production. |

## Deliberate scope limits

- The in-memory usage/entitlement stores are correct for a **single instance**.
  Before scaling horizontally or charging real money, swap them for a shared,
  persistent store (Redis/Postgres/Firestore) via the `UsageStore` /
  `EntitlementStore` interfaces — plan state must survive restarts.
- No CORS is configured **on purpose**: the add-on calls server-to-server via
  `UrlFetchApp`, so browsers get same-origin-only by default. Don't add a
  permissive CORS policy without a reason.
- Add-on OAuth scopes are kept narrow (`spreadsheets.currentonly`, container
  UI, external requests, `openid`, `email`). Broader scopes trigger Google's
  paid annual security review and expand blast radius for no benefit.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository (Security →
Advisories → "Report a vulnerability") rather than a public issue.
