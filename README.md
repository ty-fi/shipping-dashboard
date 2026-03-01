# Shipping Dashboard

A private Google Apps Script web app that scans Gmail for shipping emails, tracks packages via the 17track API, and presents everything in a clean dashboard — active and delivered tabs, event timelines, and a manual-add form.

No external server. Runs entirely on Google infrastructure.

---

## Architecture

```
Gmail ──scan──► Google Sheet (database) ◄──update── 17track API
                      ▲
              Manual Add Form
                      │
                  Apps Script
                  Web App (doGet)
                      │
                   Browser
      ┌─────────────────────────────┐
      │ Active Shipments | Delivered │
      │ [card] → expand → timeline  │
      └─────────────────────────────┘
```

**Files:**

| File | Purpose |
|------|---------|
| `Code.gs` | Server-side: email scan, 17track API calls, web app handler |
| `Index.html` | Dashboard UI + client-side JavaScript |
| `Stylesheet.html` | CSS (loaded via HtmlService include) |

---

## First-Time Setup

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a new blank spreadsheet
2. Name it **"Shipping Dashboard"** (or anything you like)
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`

### 2. Get a 17track API key

1. Go to [https://17track.net/en/api](https://17track.net/en/api)
2. Sign up for the free plan (no credit card required)
3. Copy your API key from the dashboard

Free tier: **200 lifetime registrations**. The script calls `stoptrack` on delivered packages to conserve quota.

### 3. Create the Apps Script project

1. Go to [https://script.google.com](https://script.google.com) → **New Project**
2. Rename the project to **"Shipping Dashboard"**
3. In the editor, you'll see a default `Code.gs` file — replace its contents with the contents of `Code.gs` from this repo
4. Click **+** (Add a file) → **HTML** → name it `Index` → paste contents of `Index.html`
5. Click **+** → **HTML** → name it `Stylesheet` → paste contents of `Stylesheet.html`

### 4. Configure API credentials

At the top of `Code.gs`, fill in the CONFIG block:

```javascript
const CONFIG = {
  SHEET_ID:          'paste-your-sheet-id-here',
  TRACKING_API_KEY:  'paste-your-17track-api-key-here',
  SHEET_NAME:        'Shipments',
};
```

### 5. Run setup()

1. In the Apps Script editor, select the function `setup` from the dropdown
2. Click **Run**
3. Authorize the required scopes when prompted:
   - Gmail (read-only)
   - Google Sheets
4. This creates the Shipments sheet and installs two time-based triggers:
   - `scanEmails` — every 6 hours
   - `updateAllTracking` — every 1 hour

### 6. Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon next to "Select type" → choose **Web App**
3. Set:
   - **Description:** Shipping Dashboard
   - **Execute as:** Me
   - **Who has access:** Only myself
4. Click **Deploy** → copy and **bookmark** the Web App URL

### 7. Initial scan

After deploying, run `scanEmails()` manually once to immediately process any recent shipping emails (the trigger won't fire until the next scheduled interval).

---

## Adding Amazon Shipments Manually

Amazon doesn't send tracking emails to secondary account holders. Use the **Add Tracking** button in the dashboard:

1. Go to [amazon.com/gp/css/order-history](https://www.amazon.com/gp/css/order-history)
2. Find the shipped order → click the tracking number
3. Paste it into the dashboard form with an optional label (e.g. "Amazon order — headphones")

Amazon uses these carrier formats:
- **USPS:** starts with `9` (22–30 digits)
- **UPS:** starts with `1Z` (18 chars)
- **Amazon Logistics:** starts with `TBA` (e.g. `TBA123456789000`)

---

## Google Sheet Schema

Sheet named **"Shipments"**:

| Col | Field | Notes |
|-----|-------|-------|
| A | Tracking Number | Primary key |
| B | Carrier | USPS / UPS / FedEx / DHL / Amazon / Unknown |
| C | Description | Cleaned email subject or manual label |
| D | Retailer | Parsed from sender address |
| E | Order Date | Email date or manual entry date |
| F | Last Status | In Transit / Out for Delivery / Delivered / etc. |
| G | Status Detail | Full latest event text |
| H | Last Location | City/State from latest event |
| I | Est. Delivery | Estimated delivery date |
| J | Last Updated | When last polled |
| K | Delivered | TRUE / FALSE |
| L | Delivered Date | Date of delivery event |
| M | Email Subject | Raw subject (blank for manual entries) |
| N | Email ID | Gmail message ID (blank for manual entries) |
| O | Event History | JSON array of all tracking events |

---

## 17track API Notes

**Base URL:** `https://api.17track.net/track/v2.2/`

| Endpoint | When called |
|----------|-------------|
| `register` | New tracking numbers (from email scan or manual add) |
| `gettrackinfo` | Hourly updates for all undelivered shipments |
| `stoptrack` | After delivery confirmed (conserves free-tier quota) |

**Batching:** `gettrackinfo` is called in batches of 40, with a 400ms pause between batches to stay within rate limits.

---

## Triggers

After `setup()` runs, you'll see these triggers in **Apps Script → Triggers**:

| Function | Frequency |
|----------|-----------|
| `scanEmails` | Every 6 hours |
| `updateAllTracking` | Every 1 hour |

You can adjust these manually in the Triggers panel.

---

## Verification Checklist

After setup, verify each component works:

- [ ] Run `setup()` → no errors, Shipments sheet created, triggers visible
- [ ] Run `scanEmails()` → new rows appear in sheet
- [ ] Run `updateAllTracking()` → status columns populate (cols F–L)
- [ ] Open web app URL → dashboard renders cards
- [ ] Expand a card → timeline shows event history
- [ ] Click "Add Tracking" → enter a tracking number → card appears
- [ ] Open URL in incognito as a different Google account → "Access denied"
- [ ] Wait for triggers to fire → check **Apps Script → Executions** log

---

## Privacy & Access

- The web app is deployed as **"Only myself"** — no one else can open the URL
- No data leaves Google (Sheet + Apps Script + Gmail all within your account)
- The 17track API receives tracking numbers only — no PII

---

## Troubleshooting

**No emails found on first scan**
- Check Gmail for recent shipping subjects. The search looks for: `shipped`, `tracking`, `delivery`, `out for delivery`, `your package`, `order confirmation` in the last 14 days.
- You can widen `SCAN_DAYS` in the CONFIG block.

**17track returns "no tracking info yet"**
- Normal for newly registered numbers. Info usually appears within a few hours of the carrier scanning the package.

**Quota concerns**
- The free tier gives 200 lifetime registrations. The `stoptrack` call on delivery keeps usage low.
- If you need higher volume, 17track paid plans start at $9/month for 100 new registrations/month.

**Triggers not firing**
- Check **Apps Script → Triggers** to confirm they exist.
- Check **Apps Script → Executions** for error logs.
- Re-run `setup()` if triggers were deleted.
