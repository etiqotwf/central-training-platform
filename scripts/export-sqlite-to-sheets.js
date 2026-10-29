/* One-time, non-destructive export of every application table from SQLite to Google Sheets.
 * This does NOT switch the live application to Sheets. Run only against a backup first.
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { google } = require('googleapis');

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '/etc/secrets/google-service-account.json';
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const dbFile = process.env.SQLITE_FILE || path.join(dataDir, 'training.sqlite');
if (!spreadsheetId) throw new Error('Set GOOGLE_SHEETS_SPREADSHEET_ID.');
if (!fs.existsSync(keyFile)) throw new Error(`Google service-account key file not found: ${keyFile}`);
if (!fs.existsSync(dbFile)) throw new Error(`SQLite database not found: ${dbFile}`);

const db = new Database(dbFile, { readonly: true, fileMustExist: true });
const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const safeCell = v => v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));

async function main() {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((spreadsheet.data.sheets || []).map(s => s.properties.title));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  const addRequests = tables.filter(t => !existing.has(t)).map(title => ({ addSheet: { properties: { title } } }));
  if (addRequests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: addRequests } });

  // All data is read before any target sheet is cleared. The export is intentionally explicit.
  const payload = tables.map(table => {
    const columns = db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all().map(c => c.name);
    const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
    return { table, values: [columns, ...rows.map(row => columns.map(c => safeCell(row[c]))) ] };
  });
  const clearRanges = payload.map(p => `'${p.table.replaceAll("'", "''")}'!A:ZZ`);
  if (clearRanges.length) await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: clearRanges } });
  const data = payload.filter(p => p.values.length).map(p => ({ range: `'${p.table.replaceAll("'", "''")}'!A1`, majorDimension: 'ROWS', values: p.values }));
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  console.log(`Export complete: ${tables.length} tables written to spreadsheet ${spreadsheetId}.`);
  console.log('This is a one-time export only; the live app still uses SQLite.');
  db.close();
}
main().catch(err => { console.error('Export failed:', err.message); try { db.close(); } catch {} process.exitCode = 1; });
