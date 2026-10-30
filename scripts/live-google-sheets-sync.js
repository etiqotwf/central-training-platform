'use strict';
/** Google Sheets is the durable data store. SQLite is an in-memory query engine only. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { google } = require('googleapis');
const db = require('../db');

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || (process.env.NODE_ENV === 'production' ? '/etc/secrets/google-service-account.json' : '');
const configured = Boolean(spreadsheetId && keyFile && fs.existsSync(keyFile));
let sheets;
let timer = null;
let running = false;
let rerun = false;
let lastErrorAt = 0;
let dirty = false;
let writeVersion = 0;
let persistedVersion = 0;
let persistenceError = null;
let refreshTimer = null;
let refreshRunning = false;
const REFRESH_INTERVAL_MS = Math.max(3000, Number(process.env.GOOGLE_SHEETS_REFRESH_INTERVAL_MS || 5000));
const quoteSheet = name => `'${name.replaceAll("'", "''")}'`;
const ENCRYPTION_PREFIX = 'enc:v1:';
const encryptionSecret = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
const encryptionKey = encryptionSecret ? crypto.createHash('sha256').update(encryptionSecret, 'utf8').digest() : null;
let storageEncrypted = Boolean(encryptionKey);
const safeCell = value => value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
function encryptCell(value) {
  const plain = safeCell(value);
  if (!plain || !encryptionKey || !storageEncrypted) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_PREFIX + [iv, tag, encrypted].map(x => x.toString('base64url')).join('.');
}
function decryptCell(value) {
  if (typeof value !== 'string' || !value.startsWith(ENCRYPTION_PREFIX)) return value;
  if (!encryptionKey) throw new Error('Encrypted Google Sheets data found but DATA_ENCRYPTION_KEY is not configured.');
  try {
    const [iv64, tag64, data64] = value.slice(ENCRYPTION_PREFIX.length).split('.');
    if (!iv64 || !tag64 || !data64) throw new Error('invalid encrypted cell');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new Error('Unable to decrypt Google Sheets data. Verify DATA_ENCRYPTION_KEY has not changed.');
  }
}

function getSheets() {
  if (!configured) throw new Error('Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_FILE.');
  if (!sheets) {
    const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    sheets = google.sheets({ version: 'v4', auth });
  }
  return sheets;
}
function getTables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
}
function schemaColumns(table) {
  return db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all().map(c => c.name);
}

async function ensureSheetsExist(api, tables) {
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets || []).map(s => s.properties.title));
  const additions = tables.filter(t => !existing.has(t)).map(title => ({ addSheet: { properties: { title } } }));
  if (additions.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: additions } });
  // One batched header read regardless of table count. Same additive schema behavior.
  const headerResult = tables.length ? await api.spreadsheets.values.batchGet({
    spreadsheetId, ranges: tables.map(table => `${quoteSheet(table)}!1:1`), valueRenderOption: 'UNFORMATTED_VALUE'
  }) : { data: { valueRanges: [] } };
  for (const [index, table] of tables.entries()) {
    const headers = headerResult.data.valueRanges?.[index]?.values?.[0] || [];
    const expected = schemaColumns(table);
    if (!headers.length) {
      await api.spreadsheets.values.update({ spreadsheetId, range: `${quoteSheet(table)}!A1`, valueInputOption: 'RAW', requestBody: { values: [expected] } });
      continue;
    }
    const missing = expected.filter(col => !headers.includes(col));
    if (missing.length) {
      const startColumn = headers.length + 1;
      const colLetters = n => { let out = ''; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };
      await api.spreadsheets.values.update({ spreadsheetId, range: `${quoteSheet(table)}!${colLetters(startColumn)}1`, valueInputOption: 'RAW', requestBody: { values: [missing] } });
    }
  }
}

async function loadSheetsIntoMemory({ createMissing = false } = {}) {
  const loadVersion = writeVersion;
  const api = getSheets();
  const tables = getTables();
  if (createMissing) await ensureSheetsExist(api, tables);
  const result = await api.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: tables.map(t => `${quoteSheet(t)}!A:ZZ`),
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  // Never overwrite writes made while the asynchronous refresh was in flight.
  if (!createMissing && (dirty || writeVersion !== loadVersion)) return;
  const byTable = new Map((result.data.valueRanges || []).map((r, i) => [tables[i], r.values || []]));
  // Google Sheets is authoritative. Replace the in-memory query cache as one transaction,
  // so deleted rows in Sheets are removed from the platform on the next refresh.
  db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      for (const table of [...tables].reverse()) db.exec(`DELETE FROM "${table.replaceAll('"', '""')}"`);
      for (const table of tables) {
        const values = byTable.get(table) || [];
        if (values.length < 2) continue;
        const columnInfo = db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all();
        const expected = columnInfo.map(c => c.name);
        const headers = values[0].map(v => String(v));
        const usable = expected.filter(c => headers.includes(c));
        if (!usable.length) continue;
        const sqlCols = usable.map(c => `"${c.replaceAll('"', '""')}"`).join(',');
        const placeholders = usable.map(() => '?').join(',');
        const insert = db.prepare(`INSERT OR REPLACE INTO "${table.replaceAll('"', '""')}" (${sqlCols}) VALUES (${placeholders})`);
        for (const row of values.slice(1)) {
          if (!row || row.every(v => v === '' || v === null || v === undefined)) continue;
          insert.run(...usable.map(col => {
            const ix = headers.indexOf(col);
            if (ix < 0 || row[ix] === undefined || row[ix] === '') {
              const definition=columnInfo.find(c=>c.name===col);
              if(definition.notnull && definition.dflt_value!==null) return db.prepare('SELECT '+definition.dflt_value+' AS value').get().value;
              if(definition.notnull && /TEXT/i.test(definition.type)) return '';
              return null;
            }
            const value = decryptCell(row[ix]);
            return typeof value === 'object' ? JSON.stringify(value) : value;
          }));
        }
      }
    });
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

async function initializeGoogleSheetsStore() {
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw new Error('Google Sheets is required in production. Configure GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_FILE (Render secret file path).');
    console.warn('[Google Sheets] Not configured; local development will use an empty in-memory database.');
    return;
  }
  await loadSheetsIntoMemory({ createMissing: true });
  // Persist the chosen at-rest mode in the database so it survives Render restarts.
  const modeRow = db.prepare("SELECT control_value FROM platform_control WHERE control_key='storage_encrypted'").get();
  if (modeRow) storageEncrypted = modeRow.control_value !== '0';
  else db.prepare("INSERT OR REPLACE INTO platform_control(control_key,control_value,updated_at) VALUES('storage_encrypted',?,CURRENT_TIMESTAMP)").run(storageEncrypted ? '1' : '0');
  console.log(`[Google Sheets] Loaded authoritative data for ${getTables().length} tables. At-rest mode: ${storageEncrypted ? 'encrypted' : 'decrypted'}.`);
  // One-time/continuous migration: when encryption is enabled, immediately rewrite the authoritative
  // snapshot so existing plaintext rows become AES-256-GCM ciphertext at rest in Google Sheets.
  if (encryptionKey) {
    dirty = true; writeVersion += 1;
    await syncNow();
    if (persistenceError) throw new Error('Encrypted Google Sheets migration failed.');
  }
  // Poll external edits/deletions. Skip while local writes are waiting to be uploaded,
  // otherwise a refresh could overwrite a just-created course before it reaches Sheets.
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (dirty || running || refreshRunning) return;
    refreshRunning = true;
    loadSheetsIntoMemory().catch(err => {
      const now = Date.now();
      if (now - lastErrorAt > 10000) console.error('[Google Sheets] REFRESH ERROR:', err.message);
      lastErrorAt = now;
    }).finally(() => { refreshRunning = false; });
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref();
}

function scheduleGoogleSheetsSync() {
  dirty = true;
  writeVersion += 1;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') console.error('[Google Sheets] Write could not be persisted: Sheets configuration is missing.');
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow().catch(() => {}); }, 500);
  if (timer.unref) timer.unref();
}
async function syncNow() {
  if (!configured) return;
  if (running) { rerun = true; return; }
  running = true;
  const syncVersion = writeVersion;
  try {
    const api = getSheets();
    const tables = getTables();
    await ensureSheetsExist(api, tables);
    // Build a consistent full snapshot before replacing any tabs.
    const payload = tables.map(table => {
      const columns = schemaColumns(table);
      const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
      return { table, values: [columns, ...rows.map(row => columns.map(c => encryptCell(row[c])))] };
    });
    const ranges = payload.map(p => `${quoteSheet(p.table)}!A:ZZ`);
    if (ranges.length) await api.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges } });
    const updates = payload.map(p => ({ range: `${quoteSheet(p.table)}!A1`, majorDimension: 'ROWS', values: p.values }));
    if (updates.length) await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: updates } });
    persistedVersion = Math.max(persistedVersion, syncVersion);
    persistenceError = null;
    if (writeVersion === syncVersion) dirty = false;
    console.log(`[Google Sheets] Persisted ${tables.length} tables.`);
  } catch (err) {
    const now = Date.now();
    persistenceError = err;
    if (now - lastErrorAt > 10000) console.error('[Google Sheets] PERSISTENCE ERROR:', err.message);
    lastErrorAt = now;
  } finally {
    running = false;
    if (rerun) { rerun = false; scheduleGoogleSheetsSync(); }
  }
}
// Used by acknowledged worker claims/results: do not acknowledge before the snapshot is durable.
async function flushGoogleSheetsWrites() {
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw Error('Google Sheets persistence is not configured.');
    return;
  }
  const target = writeVersion, deadline = Date.now() + 25000;
  if (timer) { clearTimeout(timer); timer = null; }
  while (persistedVersion < target) {
    if (Date.now() > deadline) throw Error('Persistence acknowledgement timed out.');
    if (!running) {
      await syncNow();
      if (persistenceError) throw Error('Google Sheets persistence failed.');
    } else await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function setStorageEncryption(enabled) {
  if (enabled && !encryptionKey) throw new Error('DATA_ENCRYPTION_KEY is not configured.');
  storageEncrypted = Boolean(enabled);
  db.prepare("INSERT OR REPLACE INTO platform_control(control_key,control_value,updated_at) VALUES('storage_encrypted',?,CURRENT_TIMESTAMP)").run(storageEncrypted ? '1' : '0');
  dirty = true; writeVersion += 1;
  await syncNow();
  if (persistenceError) throw persistenceError;
  return { encrypted: storageEncrypted };
}
function getStorageEncryptionStatus(){ return { encrypted: storageEncrypted, configured: Boolean(encryptionKey) }; }
module.exports = { flushGoogleSheetsWrites, initializeGoogleSheetsStore, scheduleGoogleSheetsSync, syncNow, refreshFromGoogleSheets: loadSheetsIntoMemory, setStorageEncryption, getStorageEncryptionStatus };
