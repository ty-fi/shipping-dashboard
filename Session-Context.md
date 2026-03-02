# Shipping Dashboard — Session Context

## What we did this session

- **Got the dashboard live** — https://ty-fi.github.io/shipping-dashboard/ is fully working
- Diagnosed the root cause of the spinner-never-resolving bug:
  - CORS error on the client was a red herring — it was caused by a server-side exception
  - `SpreadsheetApp.openById()` was throwing because `SHEET_ID` was still the placeholder `'YOUR_GOOGLE_SHEET_ID_HERE'`
  - After filling in real values, the error persisted due to stale/incomplete OAuth — fixed by going to `myaccount.google.com/permissions`, revoking the app's access, and re-authorizing via `setup()`
- **Fixed eBay false-positive**: eBay item numbers (12 digits) were being captured as FedEx tracking numbers. Fix: skip text-based regex patterns when sender is eBay; URL-based extraction still runs.
- **Fixed `addManualTracking` duplicate behavior**: previously returned an error if tracking number already existed. Now: if a label is provided, updates the description on the existing row instead. Useful for relabeling Informed Delivery entries.
- Both Code.gs fixes committed and pushed to GitHub (`3a7b174`). Still need to be applied to Apps Script via `clasp push` or copy-paste.

---

## Current State

- **Dashboard**: live and working at https://ty-fi.github.io/shipping-dashboard/
- **Apps Script backend**: deployed, authorized, triggers running (`scanEmails` every 6h, `updateAllTracking` every 1h)
- **Code.gs in repo**: has two new fixes (eBay + manual tracking) that are NOT yet in Apps Script — need to push
- **eBay packages**: will no longer create false-positive rows once fix is applied; Informed Delivery will handle USPS tracking for those packages
- **Item names for eBay packages**: not solved — accepted limitation. Use "+ Add Tracking" with a label as the workaround.

---

## Next Steps

1. **Apply Code.gs fixes to Apps Script**: run `clasp push` from the project folder, or copy-paste `Code.gs` into the script editor
2. **Clean up stale eBay rows**: manually delete any existing rows in the Shipments sheet where the "tracking number" is a 12-digit eBay item number (e.g. `317888899265`)
3. **Test the description-update flow**: try adding a tracking number that already exists via "+ Add Tracking" with a label — should update the description rather than error
4. **Consider suppressing Informed Delivery emails from the Gmail scan query**: they're usually duplicative; the existing deduplication by tracking number handles most cases but doesn't help when the eBay false-positive pre-fills the slot (now fixed)

---

## Key Decisions / Gotchas

| Topic | Detail |
|-------|--------|
| CORS error = server error | "CORS missing allow origin" from Apps Script always means the script threw an exception — CORS headers are only added to successful responses. Debug the script side, not the fetch side. |
| OAuth stale grant | If Apps Script runs without prompting for authorization but still fails on `SpreadsheetApp`, the OAuth grant is incomplete. Fix: revoke at `myaccount.google.com/permissions` and re-run `setup()`. |
| SHEET_ID format | Must be the string between `/d/` and `/edit` in the Sheet URL — no slashes, no extra characters. |
| eBay emails | Subject is always "Your package is now with its carrier!" — no USPS tracking number in body. Real tracking number requires clicking through to eBay. |
| Item name / tracking number linkage | eBay email has item name; Informed Delivery email has tracking number. No shared key between them — not feasibly linkable. Accepted limitation. |
| `addManualTracking` with duplicate | Now updates description if label provided; returns error only if no label. Frontend may still show old error message UI — worth checking. |
| clasp push vs copy-paste | clasp is installed via Nodist. `clasp open` subcommand not available. Use `/dev` URL to test without redeploying; `/exec` for stable version. |
| GitHub Pages → Apps Script | Must deploy Apps Script as "Anyone, even anonymous" — fetch() from GitHub Pages requires no auth. |

---

## Architecture

```
Gmail ──scan──► Google Sheet ◄──poll── 17track API
                     │
              Apps Script (Code.gs)
              JSON API (?action=getData / addTracking)
                     │
              fetch() from browser
                     │
         GitHub Pages (index.html)
    https://ty-fi.github.io/shipping-dashboard/
```

## Quick Reference

```bash
# Apply Code.gs changes to Apps Script
clasp push

# Publish a new Apps Script deployment version
clasp deploy --description "msg"

# Push frontend changes
git add -A && git commit -m "msg" && git push

# Test without redeploying (latest saved code, not deployed version)
# Use /dev instead of /exec in the Apps Script URL
```

---

## Previous Session History

- **Prior to this session**: full build completed (Code.gs, index.html, mockup.html). Dashboard UI confirmed working via mockup. GitHub Pages enabled. Script URL updated. Deployment permissions changed. Dashboard was live but spinner never resolved.
- **Blank white page issue (earlier)**: Apps Script web app was serving the HTML — produced blank page. Never isolated root cause. Bypassed by moving to GitHub Pages + fetch(). CSS inlined, JS rewritten to ES5, switched from `createTemplateFromFile` to `createHtmlOutputFromFile`.
