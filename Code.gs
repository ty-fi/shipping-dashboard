// =============================================================================
// SHIPPING DASHBOARD — Code.gs
// Google Apps Script server-side logic
//
// Setup:
//   1. Replace SHEET_ID with your Google Sheet's ID (from the URL)
//   2. Replace TRACKING_API_KEY with your 17track API key
//   3. Run setup() once to create triggers and initialize the sheet
// =============================================================================

var CONFIG = {
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  TRACKING_API_KEY: 'YOUR_17TRACK_API_KEY_HERE',
  SHEET_NAME: 'Shipments',
  API_BASE: 'https://api.17track.net/track/v2.2/',
  BATCH_SIZE: 40,          // max per gettrackinfo call
  BATCH_SLEEP_MS: 400,     // pause between batches (rate limit)
  SCAN_DAYS: 14,           // how far back to scan Gmail
};

// Column indices (1-based for getRange, 0-based for array access)
var COL = {
  TRACKING_NUM:  1,   // A
  CARRIER:       2,   // B
  DESCRIPTION:   3,   // C
  RETAILER:      4,   // D
  ORDER_DATE:    5,   // E
  LAST_STATUS:   6,   // F
  STATUS_DETAIL: 7,   // G
  LAST_LOCATION: 8,   // H
  EST_DELIVERY:  9,   // I
  LAST_UPDATED:  10,  // J
  DELIVERED:     11,  // K
  DELIVERED_DATE:12,  // L
  EMAIL_SUBJECT: 13,  // M
  EMAIL_ID:      14,  // N
  EVENT_HISTORY: 15,  // O
};

var HEADERS = [
  'Tracking Number', 'Carrier', 'Description', 'Retailer', 'Order Date',
  'Last Status', 'Status Detail', 'Last Location', 'Est. Delivery',
  'Last Updated', 'Delivered', 'Delivered Date', 'Email Subject',
  'Email ID', 'Event History'
];

// =============================================================================
// SETUP — run once
// =============================================================================

function setup() {
  // Create or verify the Shipments sheet
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    Logger.log('Created sheet: ' + CONFIG.SHEET_NAME);
  }

  // Write headers if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    // Make event history column narrow / hidden from casual view
    sheet.hideColumns(COL.EVENT_HISTORY);
    Logger.log('Headers written.');
  }

  // Delete any existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // scanEmails every 6 hours
  ScriptApp.newTrigger('scanEmails')
    .timeBased()
    .everyHours(6)
    .create();

  // updateAllTracking every 1 hour
  ScriptApp.newTrigger('updateAllTracking')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Triggers created. Setup complete.');
}

// =============================================================================
// WEB APP ENTRY POINT
// =============================================================================

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  if (action === 'getData') {
    return jsonResponse(getShipmentData());
  }

  if (action === 'addTracking') {
    var number = (e.parameter.number || '').trim().toUpperCase();
    var label  = (e.parameter.label  || '').trim();
    if (!number) {
      return jsonResponse({ error: 'Tracking number is required.' });
    }
    return jsonResponse(addManualTracking(number, label));
  }

  // Default: serve the dashboard
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Shipping Dashboard');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================================
// EMAIL SCANNING
// =============================================================================

function scanEmails() {
  Logger.log('scanEmails() started');
  var existingIds      = getExistingEmailIds();
  var existingTracking = getExistingTrackingNumbers();

  var query = '(subject:tracking OR subject:shipped OR subject:"order shipped" ' +
              'OR subject:delivery OR subject:"out for delivery" OR subject:"your package" ' +
              'OR subject:"order confirmation") newer_than:' + CONFIG.SCAN_DAYS + 'd';

  var threads = GmailApp.search(query, 0, 200);
  Logger.log('Found ' + threads.length + ' threads');

  var newRows = [];
  var newTrackingNumbers = [];

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      var msgId = msg.getId();
      if (existingIds[msgId]) return; // already processed

      var subject  = msg.getSubject() || '';
      var sender   = msg.getFrom()    || '';
      var date     = msg.getDate();
      var bodyText = msg.getPlainBody() || '';
      var bodyHtml = msg.getBody()      || '';

      var found = extractTrackingNumbers(bodyText, bodyHtml);
      if (found.length === 0) return;

      var retailer = parseRetailer(sender);
      var desc     = cleanSubject(subject);

      found.forEach(function(item) {
        var tn = item.number.toUpperCase();
        if (existingTracking[tn]) return; // already have this tracking number

        existingTracking[tn] = true;
        existingIds[msgId] = true;

        newRows.push([
          tn,            // A: Tracking Number
          item.carrier,  // B: Carrier
          desc,          // C: Description
          retailer,      // D: Retailer
          date,          // E: Order Date
          'Pending',     // F: Last Status
          '',            // G: Status Detail
          '',            // H: Last Location
          '',            // I: Est. Delivery
          '',            // J: Last Updated
          'FALSE',       // K: Delivered
          '',            // L: Delivered Date
          subject,       // M: Email Subject
          msgId,         // N: Email ID
          '[]',          // O: Event History
        ]);
        newTrackingNumbers.push(tn);
      });
    });
  });

  if (newRows.length > 0) {
    appendRows(newRows);
    registerWith17Track(newTrackingNumbers);
    Logger.log('Added ' + newRows.length + ' new shipments.');
  } else {
    Logger.log('No new shipments found.');
  }
}

// --- Tracking number extraction ---

function extractTrackingNumbers(bodyText, bodyHtml) {
  var results = [];
  var seen = {};

  function add(number, carrier) {
    var key = number.toUpperCase();
    if (!seen[key]) {
      seen[key] = true;
      results.push({ number: key, carrier: carrier });
    }
  }

  // Parse URLs from HTML body
  var urlPatterns = [
    { re: /ups\.com\/track[^"'\s]*[?&]tracknum=([A-Z0-9]+)/gi,        carrier: 'UPS'   },
    { re: /fedex\.com\/[^"'\s]*[?&]tracknumbers?=([A-Z0-9]+)/gi,      carrier: 'FedEx' },
    { re: /usps\.com\/track[^"'\s]*[?&]tLabels=([A-Z0-9%]+)/gi,       carrier: 'USPS'  },
    { re: /dhl\.com\/[^"'\s]*[?&]AWB=([A-Z0-9]+)/gi,                  carrier: 'DHL'   },
    { re: /amazon\.com\/progress-tracker\/[^"'\s]*[?&]shipmentId=(TBA\d+US?)/gi, carrier: 'Amazon' },
  ];
  urlPatterns.forEach(function(p) {
    var m;
    while ((m = p.re.exec(bodyHtml)) !== null) {
      var tn = decodeURIComponent(m[1]).toUpperCase();
      add(tn, p.carrier);
    }
  });

  // Regex patterns against plain text body
  var textPatterns = [
    { re: /\b(9[0-9]{21,27})\b/g,       carrier: 'USPS'   },
    { re: /\b(1Z[A-Z0-9]{16})\b/gi,     carrier: 'UPS'    },
    { re: /\b([0-9]{20,22})\b/g,         carrier: 'FedEx'  }, // FedEx door tag / 20-22 digit
    { re: /\b([0-9]{15})\b/g,            carrier: 'FedEx'  }, // FedEx 15-digit
    { re: /\b([0-9]{12})\b/g,            carrier: 'FedEx'  }, // FedEx 12-digit (check last to avoid USPS collision)
    { re: /\bTBA\d{12}US?\b/gi,          carrier: 'Amazon' },
  ];
  textPatterns.forEach(function(p) {
    var m;
    while ((m = p.re.exec(bodyText)) !== null) {
      add(m[1] || m[0], p.carrier);
    }
  });

  return results;
}

function parseRetailer(sender) {
  // Extract domain from sender address  e.g. "Amazon <ship@amazon.com>" → "Amazon"
  var domainMap = {
    'amazon': 'Amazon', 'ebay': 'eBay', 'etsy': 'Etsy',
    'walmart': 'Walmart', 'target': 'Target', 'bestbuy': 'Best Buy',
    'bhphotovideo': 'B&H', 'newegg': 'Newegg', 'chewy': 'Chewy',
    'wayfair': 'Wayfair', 'homedepot': 'Home Depot', 'lowes': "Lowe's",
  };
  var lower = sender.toLowerCase();
  for (var key in domainMap) {
    if (lower.indexOf(key) !== -1) return domainMap[key];
  }
  // Fall back to raw domain
  var m = sender.match(/@([\w.-]+)/);
  return m ? m[1] : 'Unknown';
}

function cleanSubject(subject) {
  return subject
    .replace(/^(re|fw|fwd):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// =============================================================================
// 17TRACK API INTEGRATION
// =============================================================================

function registerWith17Track(trackingNumbers) {
  if (!trackingNumbers || trackingNumbers.length === 0) return;
  Logger.log('Registering ' + trackingNumbers.length + ' numbers with 17track');

  // Register in batches of BATCH_SIZE
  for (var i = 0; i < trackingNumbers.length; i += CONFIG.BATCH_SIZE) {
    var batch = trackingNumbers.slice(i, i + CONFIG.BATCH_SIZE);
    var payload = batch.map(function(tn) { return { number: tn }; });

    try {
      var resp = apiCall17Track('register', payload);
      Logger.log('register response: ' + JSON.stringify(resp));
    } catch (err) {
      Logger.log('17track register error: ' + err);
    }

    if (i + CONFIG.BATCH_SIZE < trackingNumbers.length) {
      Utilities.sleep(CONFIG.BATCH_SLEEP_MS);
    }
  }
}

function updateAllTracking() {
  Logger.log('updateAllTracking() started');
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('No shipments to update.'); return; }

  // Collect active (non-delivered) rows
  var activeRows = [];
  for (var r = 1; r < data.length; r++) {
    var delivered = data[r][COL.DELIVERED - 1];
    if (delivered === true || delivered === 'TRUE') continue;
    activeRows.push({ rowIndex: r + 1, trackingNum: data[r][COL.TRACKING_NUM - 1] });
  }

  if (activeRows.length === 0) { Logger.log('All shipments delivered.'); return; }
  Logger.log('Polling ' + activeRows.length + ' active shipments');

  // Build lookup: trackingNum → rowIndex
  var rowMap = {};
  activeRows.forEach(function(item) { rowMap[item.trackingNum] = item.rowIndex; });

  var numbers = activeRows.map(function(r) { return r.trackingNum; });

  for (var i = 0; i < numbers.length; i += CONFIG.BATCH_SIZE) {
    var batch = numbers.slice(i, i + CONFIG.BATCH_SIZE);
    var payload = batch.map(function(tn) { return { number: tn }; });

    try {
      var resp = apiCall17Track('gettrackinfo', payload);
      if (resp && resp.data && resp.data.accepted) {
        resp.data.accepted.forEach(function(item) {
          updateShipmentRow(sheet, rowMap[item.number], item);
        });
      }
    } catch (err) {
      Logger.log('17track gettrackinfo error: ' + err);
    }

    if (i + CONFIG.BATCH_SIZE < numbers.length) {
      Utilities.sleep(CONFIG.BATCH_SLEEP_MS);
    }
  }
}

function updateShipmentRow(sheet, rowIndex, trackData) {
  if (!rowIndex) return;

  var events     = trackData.track && trackData.track.z1 || [];
  var latestInfo = trackData.track && trackData.track.z0 && trackData.track.z0[0] || null;
  var estDelivery = trackData.track && trackData.track.b12 || '';
  var trackStatus = trackData.track && trackData.track.e || 0; // 40 = delivered

  var lastStatus  = '';
  var statusDetail = '';
  var lastLocation = '';
  var deliveredDate = '';
  var isDelivered = false;

  if (latestInfo) {
    lastStatus   = translateStatus(latestInfo.z || '');
    statusDetail = latestInfo.a || '';
    lastLocation = [latestInfo.c, latestInfo.d].filter(Boolean).join(', ');
  }

  // 17track status code 40 = delivered
  if (trackStatus === 40 || (lastStatus && lastStatus.toLowerCase().indexOf('delivered') !== -1)) {
    isDelivered = true;
    deliveredDate = latestInfo && latestInfo.a ? latestInfo.a : new Date().toISOString();
  }

  // Build event history array for timeline
  var eventHistory = (events || []).map(function(ev) {
    return {
      status:   translateStatus(ev.z || ''),
      detail:   ev.a || '',
      location: [ev.c, ev.d].filter(Boolean).join(', '),
      time:     ev.a || '',           // 17track puts datetime in field 'a' for z0, date in 'b'
      date:     ev.b || '',
    };
  });

  var now = new Date();

  // Write updated values
  var row = sheet.getRange(rowIndex, 1, 1, 15).getValues()[0];
  row[COL.LAST_STATUS   - 1] = lastStatus;
  row[COL.STATUS_DETAIL - 1] = statusDetail;
  row[COL.LAST_LOCATION - 1] = lastLocation;
  row[COL.EST_DELIVERY  - 1] = estDelivery;
  row[COL.LAST_UPDATED  - 1] = now;
  row[COL.DELIVERED     - 1] = isDelivered ? 'TRUE' : 'FALSE';
  row[COL.DELIVERED_DATE- 1] = deliveredDate;
  row[COL.EVENT_HISTORY - 1] = JSON.stringify(eventHistory);

  sheet.getRange(rowIndex, 1, 1, 15).setValues([row]);

  // Stop tracking delivered packages to conserve quota
  if (isDelivered) {
    try {
      apiCall17Track('stoptrack', [{ number: row[COL.TRACKING_NUM - 1] }]);
      Logger.log('stoptrack sent for ' + row[COL.TRACKING_NUM - 1]);
    } catch (err) {
      Logger.log('stoptrack error: ' + err);
    }
  }
}

function translateStatus(code) {
  // 17track event type codes → human strings
  var map = {
    '0':  'Shipment Info Received',
    '10': 'In Transit',
    '20': 'Out for Delivery',
    '30': 'Failed Attempt',
    '40': 'Delivered',
    '50': 'Exception / Issue',
    '60': 'Expired',
  };
  return map[String(code)] || code || 'Unknown';
}

function apiCall17Track(endpoint, payload) {
  var url = CONFIG.API_BASE + endpoint;
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { '17token': CONFIG.TRACKING_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200) {
    throw new Error('17track ' + endpoint + ' returned HTTP ' + code + ': ' + text);
  }
  return JSON.parse(text);
}

// =============================================================================
// MANUAL TRACKING ENTRY
// =============================================================================

function addManualTracking(number, label) {
  var existingTracking = getExistingTrackingNumbers();
  if (existingTracking[number]) {
    return { error: 'Tracking number ' + number + ' is already being tracked.' };
  }

  var carrier  = guessCarrierFromNumber(number);
  var desc     = label || 'Manual entry';
  var now      = new Date();

  var newRow = [
    number,    // A
    carrier,   // B
    desc,      // C
    'Manual',  // D: Retailer
    now,       // E: Order Date
    'Pending', // F: Last Status
    '',        // G
    '',        // H
    '',        // I
    '',        // J: Last Updated
    'FALSE',   // K: Delivered
    '',        // L
    '',        // M: Email Subject
    '',        // N: Email ID (blank = manual)
    '[]',      // O: Event History
  ];

  appendRows([newRow]);
  registerWith17Track([number]);

  Logger.log('Manual tracking added: ' + number);
  return {
    success: true,
    shipment: rowToObject(newRow),
  };
}

function guessCarrierFromNumber(tn) {
  if (/^1Z[A-Z0-9]{16}$/i.test(tn))    return 'UPS';
  if (/^TBA\d+US?$/i.test(tn))          return 'Amazon';
  if (/^9[0-9]{21,27}$/.test(tn))       return 'USPS';
  if (/^[0-9]{12}$/.test(tn))           return 'FedEx';
  if (/^[0-9]{15}$/.test(tn))           return 'FedEx';
  if (/^[0-9]{20,22}$/.test(tn))        return 'FedEx';
  return 'Unknown';
}

// =============================================================================
// DATA ACCESS
// =============================================================================

function getShipmentData() {
  var sheet = getSheet();
  if (!sheet) return { active: [], delivered: [], error: 'Sheet not found — run setup() first.' };
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { active: [], delivered: [] };

  var active    = [];
  var delivered = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = rowToObject(row);
    if (obj.delivered === 'TRUE' || obj.delivered === true) {
      delivered.push(obj);
    } else {
      active.push(obj);
    }
  }

  // Sort active: out for delivery first, then in transit, then pending
  var statusOrder = { 'Out for Delivery': 0, 'Delivered': 1, 'In Transit': 2, 'Failed Attempt': 3, 'Pending': 4, 'Shipment Info Received': 5 };
  active.sort(function(a, b) {
    var oa = statusOrder[a.lastStatus] !== undefined ? statusOrder[a.lastStatus] : 99;
    var ob = statusOrder[b.lastStatus] !== undefined ? statusOrder[b.lastStatus] : 99;
    return oa - ob;
  });

  // Sort delivered: most recent first
  delivered.sort(function(a, b) {
    return new Date(b.deliveredDate || 0) - new Date(a.deliveredDate || 0);
  });

  return { active: active, delivered: delivered };
}

function rowToObject(row) {
  var eventHistory = [];
  try { eventHistory = JSON.parse(row[COL.EVENT_HISTORY - 1] || '[]'); } catch (e) {}

  return {
    trackingNum:   row[COL.TRACKING_NUM   - 1],
    carrier:       row[COL.CARRIER        - 1],
    description:   row[COL.DESCRIPTION    - 1],
    retailer:      row[COL.RETAILER       - 1],
    orderDate:     row[COL.ORDER_DATE     - 1] ? String(row[COL.ORDER_DATE - 1]) : '',
    lastStatus:    row[COL.LAST_STATUS    - 1],
    statusDetail:  row[COL.STATUS_DETAIL  - 1],
    lastLocation:  row[COL.LAST_LOCATION  - 1],
    estDelivery:   row[COL.EST_DELIVERY   - 1] ? String(row[COL.EST_DELIVERY - 1]) : '',
    lastUpdated:   row[COL.LAST_UPDATED   - 1] ? String(row[COL.LAST_UPDATED - 1]) : '',
    delivered:     row[COL.DELIVERED      - 1],
    deliveredDate: row[COL.DELIVERED_DATE - 1] ? String(row[COL.DELIVERED_DATE - 1]) : '',
    emailSubject:  row[COL.EMAIL_SUBJECT  - 1],
    emailId:       row[COL.EMAIL_ID       - 1],
    eventHistory:  eventHistory,
  };
}

// =============================================================================
// SHEET HELPERS
// =============================================================================

function getSheet() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
}

function appendRows(rows) {
  var sheet = getSheet();
  rows.forEach(function(row) { sheet.appendRow(row); });
}

function getExistingEmailIds() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  var map   = {};
  for (var r = 1; r < data.length; r++) {
    var id = data[r][COL.EMAIL_ID - 1];
    if (id) map[id] = true;
  }
  return map;
}

function getExistingTrackingNumbers() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  var map   = {};
  for (var r = 1; r < data.length; r++) {
    var tn = (data[r][COL.TRACKING_NUM - 1] || '').toUpperCase();
    if (tn) map[tn] = true;
  }
  return map;
}

// =============================================================================
// CARRIER TRACKING URLS (for dashboard links)
// =============================================================================

function getCarrierUrl(carrier, trackingNum) {
  var urls = {
    'USPS':   'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + trackingNum,
    'UPS':    'https://www.ups.com/track?tracknum=' + trackingNum,
    'FedEx':  'https://www.fedex.com/fedextrack/?tracknumbers=' + trackingNum,
    'DHL':    'https://www.dhl.com/en/express/tracking.html?AWB=' + trackingNum,
    'Amazon': 'https://www.amazon.com/progress-tracker/package/?shipmentId=' + trackingNum,
  };
  return urls[carrier] || 'https://www.google.com/search?q=' + encodeURIComponent(trackingNum + ' tracking');
}
