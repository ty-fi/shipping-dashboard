# Shipping Dashboard — Session Context

## Current State

The project is fully built and pushed to GitHub. The dashboard UI works (confirmed via mockup). The backend logic is written. **One step remains to go live: redeploy Code.gs with updated access settings and paste the URL into index.html.**

---

## Architecture

```
Gmail ──scan──► Google Sheet ◄──poll── 17track API
                     │
              Apps Script (Code.gs)
              JSON API endpoints
                     │
              fetch() from browser
                     │
         GitHub Pages (index.html)
    https://ty-fi.github.io/shipping-dashboard/
```

**Why two pieces?**
Apps Script needs Google account access (Gmail, Sheets, 17track). The HTML is a static page that calls `?action=getData` and renders the result. These are now cleanly separated: Apps Script is the backend, GitHub Pages is the frontend.

---

## Repos

| Repo | URL |
|------|-----|
| GitHub | https://github.com/ty-fi/shipping-dashboard |
| GitHub Pages | https://ty-fi.github.io/shipping-dashboard/ |
| Local | `~/claude-projects/shipping-dashboard/` |

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Production dashboard — uses `fetch()` to call Apps Script. Set `SCRIPT_URL` here. |
| `mockup.html` | Local dev version with fake sample data. Open directly in browser to iterate on UI. |
| `Code.gs` | Apps Script backend — paste into script.google.com editor. |
| `Clasp-Deployment-Guide.md` | How to use clasp to push code from git instead of copy-pasting. |
| `README.md` | Full setup guide. |
| `Stylesheet.html` | Legacy — no longer used. CSS is now inlined in index.html. |

---

## What Still Needs to Be Done

### Step 1 — Redeploy Code.gs with new access setting

The Apps Script deployment must be changed from **"Only myself"** to **"Anyone, even anonymous"** so that `fetch()` calls from GitHub Pages can reach it without authentication.

In the Apps Script editor:
1. **Deploy → Manage deployments → Edit (pencil) → New version**
2. Change **Who has access** to: **Anyone, even anonymous**
3. Click **Deploy**
4. Copy the new `/exec` URL

### Step 2 — Paste the URL into index.html

Open `index.html` and replace the placeholder at the top of the `<script>` block:

```javascript
var SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
```

Then commit and push:

```bash
cd ~/claude-projects/shipping-dashboard
git add index.html
git commit -m "Set Apps Script URL"
git push
```

GitHub Pages will update within ~30 seconds.

### Step 3 — Verify it works

Open https://ty-fi.github.io/shipping-dashboard/ — it should show the loading spinner and then either:
- Your shipments (if `scanEmails()` has been run and found something), or
- "No active shipments" empty state

If you see **"Could not reach Apps Script"**: the deployment access setting is still wrong — it must be "Anyone, even anonymous", not "Only myself".

---

## Apps Script Status

The Google Sheet and triggers were set up in a previous session (`setup()` was run successfully). The time-based triggers exist:
- `scanEmails` — every 6 hours
- `updateAllTracking` — every 1 hour

Run `scanEmails()` manually once after redeploying to immediately pull in the last 14 days of shipping emails.

---

## Key Technical Decisions

| Decision | Why |
|----------|-----|
| GitHub Pages for HTML | Apps Script web app deployment was producing a blank white page — cause never isolated. GitHub Pages is simpler and more reliable for static HTML. |
| `fetch()` instead of `google.script.run` | `google.script.run` only works when the HTML is served *by* Apps Script. External pages use plain HTTP fetch. |
| "Anyone, even anonymous" deployment | Required for cross-origin `fetch()` from GitHub Pages. The Apps Script URL is effectively a secret URL — no personal data beyond tracking numbers is exposed. |
| CSS inlined in index.html | Removing the `<?!= ?>` scriptlet include eliminated one failure point (the scriptlet was suspected in the blank-page issue). |
| All JS in ES5 style | `var`/`function` syntax avoids any sandbox compatibility issues when the code is also pasted into Apps Script's `Index.html`. |

---

## Known Issues / History

- **Blank white page from Apps Script web app** — never resolved. Tried: removing `XFrameOptionsMode.DENY`, switching from `createTemplateFromFile` to `createHtmlOutputFromFile`, inlining CSS, rewriting JS to ES5. All failed. Bypassed entirely by moving to GitHub Pages.
- `google.script.run` field name bugs (fixed): `trackingNumber` → `trackingNum`, `events` → `eventHistory`
- clasp is installed on this machine (via Nodist) but `clasp open` subcommand is not available in the installed version.

---

## Quick Reference

```bash
# Push code changes to GitHub (triggers GitHub Pages rebuild)
git add -A && git commit -m "msg" && git push

# Push code to Apps Script editor (requires clasp login first)
clasp push

# Publish a new Apps Script deployment version
clasp deploy --description "msg"

# Test without redeploying (latest saved code)
# Change /exec to /dev in the Apps Script URL
```
