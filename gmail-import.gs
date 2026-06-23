/**
 * StayManager — Gmail → Google Sheet booking importer
 * ---------------------------------------------------
 * Reads Airbnb / Booking.com confirmation emails from your Gmail and writes one
 * row per booking into this spreadsheet. The StayManager app then reads the
 * sheet (published as CSV) and shows the bookings with guest name + price.
 *
 * SETUP (one time):
 *   1. Create a Google Sheet. Open Extensions → Apps Script. Paste this whole file.
 *   2. Run the function `setUp` once (top toolbar ▶). Approve the permissions it asks for
 *      (it needs to read Gmail and edit this sheet). This also schedules it to run every 15 min.
 *   3. Back in the Sheet: File → Share → Publish to web → choose this sheet → CSV → Publish.
 *      Copy that link and paste it into StayManager → 📅 Sync .ics → "Gmail auto-import".
 *
 * NOTE: email wording changes over time / by country, so the parsers below are best-effort.
 * If a booking imports with blank dates or wrong name, forward me one real email and I'll tune it.
 */

// Columns the StayManager app expects (do not rename):
var HEADER = ['UID','Source','Guest','Check-in','Check-out','Guests','Total','Phone','Email','Notes'];

// How far back to scan on each run (Gmail search is incremental via the "processed" label too).
var SEARCH_WINDOW = 'newer_than:30d';
var PROCESSED_LABEL = 'StayManager-Imported';

function setUp() {
  ensureHeader_();
  // remove old triggers for this function, then create a fresh 15-min trigger
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importBookings') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importBookings').timeBased().everyMinutes(15).create();
  importBookings(); // run immediately so you see results now
  SpreadsheetApp.getActive().toast('Set up complete — scanning your inbox…');
}

function importBookings() {
  var sheet = ensureHeader_();
  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var existingUids = getExistingUids_(sheet);

  var queries = [
    { source: 'airbnb',  q: 'from:(airbnb.com) -label:' + PROCESSED_LABEL + ' ' + SEARCH_WINDOW +
        ' (subject:(reservation confirmed) OR subject:(booking confirmed) OR subject:(instant book) OR subject:(reservation at))' },
    { source: 'booking', q: 'from:(booking.com) -label:' + PROCESSED_LABEL + ' ' + SEARCH_WINDOW +
        ' (subject:(new booking) OR subject:(new reservation) OR subject:(booking confirmation))' }
  ];

  var rows = [];
  queries.forEach(function (item) {
    GmailApp.search(item.q, 0, 50).forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        var uid = item.source + ':' + msg.getId();
        if (existingUids[uid]) return;
        var parsed = (item.source === 'airbnb') ? parseAirbnb_(msg) : parseBooking_(msg);
        if (parsed && parsed.checkIn && parsed.checkOut) {
          rows.push([uid, item.source, parsed.guest || 'Guest', parsed.checkIn, parsed.checkOut,
                     parsed.guests || '', parsed.total || '', parsed.phone || '', parsed.email || '',
                     parsed.notes || ('From: ' + msg.getSubject())]);
          existingUids[uid] = true;
        }
      });
      thread.addLabel(label); // mark whole thread processed so we don't rescan it
    });
  });

  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
}

/* ----------------------- parsers (best-effort) ----------------------- */

function parseAirbnb_(msg) {
  var subj = msg.getSubject() || '';
  var body = msg.getPlainBody() || '';
  var out = { source: 'airbnb' };

  // Guest name — common subject shapes: "Reservation confirmed - John arrives ...",
  // "Booking confirmed: John Smith", "Reservation at <listing> - John (Jul 1 – Jul 4)"
  var m = subj.match(/confirmed[:\-\s]+([A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+)?)/i) ||
          subj.match(/[-:]\s*([A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+)?)\s+arrives/i);
  if (m) out.guest = m[1].trim();

  // Dates — look for explicit check-in / checkout labels first, else first two dates found
  var ci = findLabeledDate_(body, /(check[\-\s]?in|arrival)/i);
  var co = findLabeledDate_(body, /(check[\-\s]?out|departure)/i);
  if (!ci || !co) {
    var ds = findAllDates_(body);
    if (!ci && ds[0]) ci = ds[0];
    if (!co && ds[1]) co = ds[1];
  }
  out.checkIn = ci; out.checkOut = co;

  // Payout / total
  var amt = body.match(/(?:you earn|total payout|payout|total)\D{0,12}([£$€]\s?[\d,]+(?:\.\d{2})?)/i);
  if (amt) out.total = amt[1].replace(/[^\d.]/g, '');

  var g = body.match(/(\d+)\s+guests?/i); if (g) out.guests = g[1];
  return out;
}

function parseBooking_(msg) {
  var subj = msg.getSubject() || '';
  var body = msg.getPlainBody() || '';
  var out = { source: 'booking' };

  var m = subj.match(/booking[^\-:]*[\-:]\s*([A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+)?)/i) ||
          body.match(/guest name[:\s]+([A-Z][\w'’.\-]+(?:\s+[A-Z][\w'’.\-]+)?)/i);
  if (m) out.guest = m[1].trim();

  var ci = findLabeledDate_(body, /(check[\-\s]?in|arrival)/i);
  var co = findLabeledDate_(body, /(check[\-\s]?out|departure)/i);
  if (!ci || !co) { var ds = findAllDates_(body); if (!ci) ci = ds[0]; if (!co) co = ds[1]; }
  out.checkIn = ci; out.checkOut = co;

  var amt = body.match(/(?:total|amount|price)\D{0,12}([£$€]\s?[\d,]+(?:\.\d{2})?)/i);
  if (amt) out.total = amt[1].replace(/[^\d.]/g, '');
  return out;
}

/* ----------------------- date helpers ----------------------- */

// find a date that appears shortly after a label like "Check-in"
function findLabeledDate_(body, labelRe) {
  var lines = body.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (labelRe.test(lines[i])) {
      var d = parseDate_(lines[i]) || (lines[i + 1] && parseDate_(lines[i + 1]));
      if (d) return d;
    }
  }
  return null;
}

function findAllDates_(body) {
  var out = [], re = /([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/g, m;
  while ((m = re.exec(body)) !== null) { var d = parseDate_(m[1]); if (d && out.indexOf(d) === -1) out.push(d); }
  return out;
}

function parseDate_(s) {
  if (!s) return null;
  var iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  var m = s.match(/([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(\d{4})/) ||  // Jul 1, 2026
          s.match(/(\d{1,2})\s+([A-Z][a-z]{2,8})\.?\s+(\d{4})/);       // 1 Jul 2026
  if (!m) return null;
  var d = new Date(s.replace(/(\d)(st|nd|rd|th)/, '$1'));
  if (isNaN(d)) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ----------------------- sheet helpers ----------------------- */

function ensureHeader_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1, 1).getValue()).toLowerCase() !== 'uid') {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  }
  return sheet;
}

function getExistingUids_(sheet) {
  var map = {};
  if (sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) map[r[0]] = true; });
  return map;
}
