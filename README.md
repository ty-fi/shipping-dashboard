# Shipping Dashboard

A personal package-tracking dashboard. The frontend is hosted on GitHub Pages. The backend runs on Google Apps Script — it scans Gmail for shipping emails, polls the 17track API for status updates, and stores everything in a Google Sheet. The dashboard fetches data from Apps Script via a plain JSON API.

## Architecture

```
Gmail ──scan──► Google Sheet ◄──poll── 17track API
                     │
              Apps Script (JSON API)
                     │
              fetch() from browser
                     │
              GitHub Pages (index.html)
```

**Why two pieces?**
Apps Script handles everything that needs Google account access: reading Gmail, writing to Sheets, calling 17track. The HTML is just a static page that calls `?action=getData` and renders the result — no server required.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Dashboard UI (GitHub Pages) — set `SCRIPT_URL` before deploying |
| `mockup.html` | Local dev version with fake data — open directly in browser, no setup needed |
| `Code.gs` | Apps Script backend — paste into script.google.com |
| `Clasp-Deployment-Guide.md` | How to use clasp to sync this repo with Apps Script |

`Stylesheet.html` is a legacy file from an earlier attempt to serve the UI from Apps Script itself. It is no longer used.

---

## Setup

### 1. Apps Script backend

**Create the Google Sheet**

1. Go to [sheets.google.com](https://sheets.google.com) → new blank spreadsheet
2. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`SHEET_ID`**`/edit`

**Get a 17track API key**

Sign up at [17track.net/en/api](https://17track.net/en/api) (free, no credit card).
Free tier: 200 lifetime registrations. The script calls `stoptrack` on delivery to conserve quota.

**Create the Apps Script project**

1. Go to [script.google.com](https://script.google.com) → New Project → rename it "Shipping Dashboard"
2. Replace the contents of `Code.gs` with the `Code.gs` from this repo
3. Fill in the CONFIG block at the top:

```javascript
var CONFIG = {
  SHEET_ID:         'your-sheet-id-here',
  TRACKING_API_KEY: 'your-17track-key-here',   // never commit real keys
  SHEET_NAME:       'Shipments',
};
```

4. Select `setup` from the function dropdown → click **Run** → authorize Gmail + Sheets scopes
5. This creates the Shipments sheet and installs two triggers:
   - `scanEmails` — every 6 hours
   - `updateAllTracking` — every 1 hour

**Deploy as Web App (JSON API only)**

1. Click **Deploy** → **New deployment** → type: **Web App**
2. Set:
   - Execute as: **Me**
   - Who has access: **Anyone, even anonymous** ← required for fetch() to work from GitHub Pages
3. Click **Deploy** → copy the URL

**Run the first scan**

Select `scanEmails` → **Run** to immediately process the last 14 days of shipping emails.

---

### 2. GitHub Pages frontend

**Set your Apps Script URL**

Open `index.html` and replace the placeholder at the top of the `<script>` block:

```javascript
var SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
```

**Enable GitHub Pages**

In the GitHub repo: **Settings → Pages → Source → Deploy from branch → main → / (root) → Save**

Your dashboard will be live at `https://ty-fi.github.io/shipping-dashboard/`.

---

## Adding Packages Manually

Use **+ Add Tracking** for packages where the shipping email doesn't contain a tracking number:

**Amazon (shared account)**
1. Go to [amazon.com/gp/css/order-history](https://www.amazon.com/gp/css/order-history)
2. Find the shipped order → copy the tracking number

**eBay**
eBay shipping emails ("Your package is now with its carrier!") do not include the carrier tracking number — only the eBay item number. To track an eBay package:
1. Go to your eBay order → **Track package** → copy the carrier tracking number
2. Click **+ Add Tracking** in the dashboard and paste it with a label (e.g. "eBay — blue headphones")

**Relabeling an existing entry**
If a package was already picked up from a generic email (e.g. USPS Informed Delivery) and has a poor description, click **+ Add Tracking**, enter the same tracking number with a better label — it will update the description on the existing entry rather than creating a duplicate.

Carrier formats:
- **USPS:** starts with `9` (22–30 digits)
- **UPS:** starts with `1Z`
- **Amazon Logistics:** starts with `TBA`

---

## Google Sheet Schema

Sheet named **"Shipments"** (created automatically by `setup()`):

| Col | Field | Notes |
|-----|-------|-------|
| A | Tracking Number | Primary key |
| B | Carrier | USPS / UPS / FedEx / DHL / Amazon / Unknown |
| C | Description | Cleaned email subject or manual label |
| D | Retailer | Parsed from sender domain |
| E | Order Date | Email date or manual entry date |
| F | Last Status | In Transit / Out for Delivery / Delivered / etc. |
| G | Status Detail | Full latest event text |
| H | Last Location | City/State from latest event |
| I | Est. Delivery | Estimated delivery date from 17track |
| J | Last Updated | Timestamp of last poll |
| K | Delivered | TRUE / FALSE |
| L | Delivered Date | Date of delivery event |
| M | Email Subject | Raw subject (blank for manual entries) |
| N | Email ID | Gmail message ID (blank for manual entries) |
| O | Event History | JSON array of all tracking events |

---

## Troubleshooting

**Dashboard shows "Could not reach Apps Script"**
- Make sure the deployment is set to **"Anyone, even anonymous"** — not "Only myself"
- Check that `SCRIPT_URL` in `index.html` ends in `/exec`, not `/dev`

**No emails found on first scan**
- The search covers the last 14 days. Adjust `SCAN_DAYS` in the CONFIG block if needed.
- Subjects scanned: `shipped`, `tracking`, `delivery`, `out for delivery`, `your package`, `order confirmation`

**17track shows no info yet**
- Normal for newly registered numbers. Usually appears within a few hours of the first carrier scan.

**`SpreadsheetApp` error / spinner never resolves**
This usually means the OAuth authorization is incomplete. Apps Script won't re-prompt if *any* prior authorization exists, even a partial one.
1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Find the Apps Script app → **Remove Access**
3. Back in the script editor: select `setup` → **Run** → authorize all scopes when prompted (Gmail + Sheets)

**Triggers not firing**
- Check **Apps Script → Triggers** to confirm they exist
- Check **Apps Script → Executions** for error logs
- Re-run `setup()` to reinstall triggers

**Quota**
- Free tier: 200 lifetime registrations. `stoptrack` is called on delivery to keep usage low.
- Paid plans start at $9/month for 100 new registrations/month.
