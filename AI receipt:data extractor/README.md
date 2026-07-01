# SheetScan — AI receipt/data extractor for Google Sheets

Paste text or upload a receipt/invoice photo → Gemini pulls out the fields →
clean rows land in your sheet.

## Files
- `Code.gs` — menu, sidebar trigger, Gemini API call, writing rows, usage limit
- `Sidebar.html` — the sidebar UI
- `appsscript.json` — manifest (kept to narrow, non-restricted OAuth scopes on purpose)

## Setup (15–20 minutes)

**1. Create the project**
- Open a Google Sheet (a new one is fine).
- Extensions → Apps Script.
- Delete the default `Code.gs` content, paste in this project's `Code.gs`.
- Click the `+` next to Files → HTML → name it exactly `Sidebar` → paste in `Sidebar.html`.

**2. Add the manifest**
- Click the gear icon (Project Settings) → check "Show appsscript.json manifest file in editor".
- Open `appsscript.json` in the file list → replace its contents with this project's `appsscript.json`.

**3. Get a free Gemini API key**
- Go to aistudio.google.com → "Get API key" → create one. No credit card required.

**4. Store the key**
- Back in the Apps Script editor, pick `setApiKey` from the function dropdown in the toolbar → click Run.
- First run asks you to authorize the script — approve it (it's your own script, requesting only
  the scopes in the manifest).
- A prompt pops up in the Sheet — paste your API key there.

**5. Test it**
- Refresh the Google Sheet tab.
- A "SheetScan" menu should appear → "Open extractor".
- Paste something like: `Uber ride $23.40 on June 3, Staples printer paper $18.20 on June 5`
- Click "Extract to sheet" → two clean rows should appear, with headers added automatically.
- Try the photo upload with any receipt image too.

**6. Adjust it to your niche**
- Edit `buildPrompt()` in `Code.gs` — swap the fields/categories for whatever you're actually
  extracting: invoices, leads, resumes, survey responses. The extraction logic doesn't change,
  only this prompt.
- Adjust `FREE_DAILY_LIMIT` if you want a different free-tier cutoff.

## Next steps (once the core loop works)

- **Fastest way to get real users:** share this as a "make a copy of this template" Sheet —
  the same low-friction distribution model a lot of indie Notion/Sheets tools use. It validates
  demand before you invest time in a full Marketplace listing.
- **Payments:** `isPro` in `checkUsageLimit()` is currently a manual stub. Wire it to Stripe
  Checkout + a small webhook (a second, separate Apps Script Web App deployment can receive the
  webhook and flip the flag) once you're ready to charge.
- **Publishing to the Google Workspace Marketplace:** the listed-add-on framework layers a
  card-based UI on top of what's here and changes more often than the core Sheets API — check
  developers.google.com/workspace/add-ons for the current setup when you get to that step. Keep
  OAuth scopes as narrow as they are here; broader ones trigger a paid annual security review.

## Notes
- Model is set to `gemini-3.5-flash`. If Google renames or retires it, check
  ai.google.dev/gemini-api/docs/models and swap the `MODEL` constant in `Code.gs`.
- The free Gemini tier is generous but not infinite. If you outgrow it, enable billing on a
  *separate* Google Cloud project so your dev/test setup keeps its free quota intact.
