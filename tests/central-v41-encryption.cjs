'use strict';
require('./sqlite-test-adapter.cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
const db = require('../db');
process.env.NODE_ENV = 'test';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'central-mock';
process.env.GOOGLE_SERVICE_ACCOUNT_FILE = __filename;
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = '';
process.env.DATA_ENCRYPTION_KEY = 'central-v41-encryption-test-key';
const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
const columns = table => db.prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name);
const sheetData = new Map(names.map(name => [name, [columns(name)]]));
const parsed = range => {
  const match = String(range).match(/^'((?:[^']|'')+)'!/);
  return match ? match[1].replaceAll("''", "'") : String(range).split('!')[0];
};
const api = {
  spreadsheets: {
    get: async () => ({ data: { sheets: [...sheetData.keys()].map((title, index) => ({ properties: { title, sheetId: index + 1 } })) } }),
    batchUpdate: async ({ requestBody }) => {
      for (const request of requestBody.requests || []) if (request.addSheet) sheetData.set(request.addSheet.properties.title, []);
      return { data: { replies: (requestBody.requests || []).map(request => request.addSheet ? { addSheet: { properties: request.addSheet.properties } } : {}) } };
    },
    values: {
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(range => ({ values: sheetData.get(parsed(range)) || [] })) } }),
      update: async ({ range, requestBody }) => { sheetData.set(parsed(range), requestBody.values || []); return { data: {} }; },
      batchUpdate: async ({ requestBody }) => { for (const item of requestBody.data || []) sheetData.set(parsed(item.range), item.values || []); return { data: {} }; },
      batchClear: async ({ requestBody }) => { for (const range of requestBody.ranges || []) { const title = parsed(range); sheetData.set(title, sheetData.get(title) || []); } return { data: {} }; }
    }
  }
};
Module._load = function (name, ...args) { if (name === 'googleapis') return { google: { auth: { GoogleAuth: class {} }, sheets: () => api } }; return load.call(this, name, ...args); };
const store = require('../scripts/live-google-sheets-sync');
Module._load = load;

(async () => {
  const userCols = columns('users');
  sheetData.set('users', [userCols, userCols.map(column => ({ id: 1, username: 'central-admin', password_hash: 'hash-value', role: 'admin', display_name: 'Central Admin' })[column] ?? '')]);
  const courseCols = columns('courses');
  sheetData.set('courses', [courseCols, courseCols.map(column => ({ id: 7, title: 'Central Course' })[column] ?? '')]);
  await store.initializeGoogleSheetsStore();
  assert.equal(db.prepare('SELECT username FROM users WHERE id=1').get().username, 'central-admin');
  assert.equal(store.getStorageEncryptionStatus().encrypted, true);
  const savedUserRow = sheetData.get('users')[1];
  const usernameIndex = sheetData.get('users')[0].indexOf('username');
  assert.match(savedUserRow[usernameIndex], /^enc:v1:/, 'Google Sheets values must remain encrypted at rest');
  await store.setStorageEncryption(false);
  assert.equal(store.getStorageEncryptionStatus().encrypted, false);
  assert.equal(sheetData.get('users')[1][usernameIndex], 'central-admin', 'turning encryption off persists a readable snapshot');
  console.log('Central V41 encryption compatibility test passed.');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
