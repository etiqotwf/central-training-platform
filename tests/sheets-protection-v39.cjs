require('./sqlite-test-adapter.cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
const db = require('../db');

process.env.NODE_ENV = 'test';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'mock-spreadsheet';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = __filename;
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = '';

const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
const cols = table => db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
const sheets = new Map();
for (const table of tableNames) sheets.set(table, [cols(table)]);
let usersRows = [];
let clearCalls = 0;
let batchUpdateCalls = 0;
let order = [];
const parseRange = range => {
  const m = String(range).match(/^'((?:[^']|'')+)'!/);
  return m ? m[1].replaceAll("''", "'") : String(range).split('!')[0];
};
const api = {
  spreadsheets: {
    get: async () => ({ data: { sheets: [...sheets.keys()].map((title, i) => ({ properties: { title, sheetId: i + 1 } })) } }),
    batchUpdate: async ({ requestBody }) => {
      for (const request of requestBody.requests || []) {
        if (request.addSheet) sheets.set(request.addSheet.properties.title, []);
      }
      return { data: { replies: (requestBody.requests || []).map(r => r.addSheet ? { addSheet: { properties: r.addSheet.properties } } : {}) } };
    },
    values: {
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(range => {
        const title = parseRange(range);
        if (title === 'users' && usersRows.length) return { values: [cols('users'), ...usersRows] };
        return { values: sheets.get(title) || [] };
      }) } }),
      update: async ({ range, requestBody }) => {
        const title = parseRange(range);
        sheets.set(title, requestBody.values || []);
        return { data: {} };
      },
      batchUpdate: async ({ requestBody }) => {
        batchUpdateCalls++;
        order.push('write');
        for (const item of requestBody.data || []) {
          const title = parseRange(item.range);
          sheets.set(title, item.values || []);
        }
        return { data: {} };
      },
      batchClear: async () => {
        clearCalls++;
        order.push('clear');
        return { data: {} };
      }
    }
  }
};
Module._load = function (name, ...args) {
  if (name === 'googleapis') return { google: { auth: { GoogleAuth: class {} }, sheets: () => api } };
  return load.call(this, name, ...args);
};
const store = require('../scripts/live-google-sheets-sync');
Module._load = load;

(async () => {
  // A local sentinel proves a bad/empty remote sheet is rejected before DB replacement.
  db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES('local-sentinel','hash','admin','Local')").run();
  await assert.rejects(() => store.initializeGoogleSheetsStore(), /users tab has no user records/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username='local-sentinel'").get().n, 1);

  // Retry with a valid restored Sheet. Core tabs and valid headers are present.
  const userColumns = cols('users');
  usersRows = [userColumns.map(name => ({
    id: 1, username: 'restored-admin', password_hash: 'hash', password_display: '', role: 'admin',
    display_name: 'Restored Admin', created_at: '2026-01-01 00:00:00'
  })[name] ?? '')];
  const courseColumns = cols('courses');
  sheets.set('courses', [courseColumns, courseColumns.map(name => ({ id: 10, title: 'Restored Course', created_at: '2026-01-01 00:00:00' })[name] ?? '')]);
  await store.initializeGoogleSheetsStore();
  assert.equal(db.prepare("SELECT username FROM users WHERE id=1").get().username, 'restored-admin');
  assert.equal(db.prepare("SELECT title FROM courses WHERE id=10").get().title, 'Restored Course');

  // Persist a legitimate change. No clear is allowed before the replacement batch succeeds.
  db.prepare("INSERT INTO courses(title) VALUES('Second Course')").run();
  store.scheduleGoogleSheetsSync();
  await store.flushGoogleSheetsWrites();
  assert.equal(batchUpdateCalls, 1);
  assert.equal(clearCalls, 0);
  assert.equal(order[0], 'write');
  assert.ok(sheets.has('_platform_sync_meta'));
  assert.equal(store.getGoogleSheetsStatus().initialized, true);
  assert.ok(store.getGoogleSheetsStatus().loadedRecordCount >= 2);
  console.log('PASS V39 Sheets protection: empty/wrong data rejected before DB replacement; restored core data loads; writes use one batch with row-count metadata and no pre-write clear.');
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
