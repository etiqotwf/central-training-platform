'use strict';
/**
 * Google Sheets durable store with recovery guards.
 * Safety properties:
 * - Refuses to load from a wrong/empty spreadsheet in production.
 * - Validates core tabs and user data BEFORE touching the in-memory database.
 * - Never clears live sheet data before a successful replacement write.
 * - Writes row-count metadata so stale trailing rows are not re-imported.
 * - Blocks unexpected large data shrink unless explicitly allowed by an operator.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { google } = require('googleapis');
const db = require('../db');

const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
const META_SHEET = '_platform_sync_meta';
const CORE_TABLES = ['users', 'courses', 'trainees', 'trainers', 'enrollments'];
const ALLOW_EMPTY_BOOTSTRAP = String(process.env.GOOGLE_SHEETS_ALLOW_EMPTY_BOOTSTRAP || '').toLowerCase() === 'true';
const ALLOW_BULK_DELETE = String(process.env.GOOGLE_SHEETS_ALLOW_BULK_DELETE || '').toLowerCase() === 'true';
const REFRESH_INTERVAL_MS = Math.max(10000, Number(process.env.GOOGLE_SHEETS_REFRESH_INTERVAL_MS || 30000));

function resolveCredential() {
  const rawJson = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const credentials = JSON.parse(rawJson);
      if (!credentials.client_email || !credentials.private_key) throw new Error('JSON must contain client_email and private_key.');
      credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
      return { credentials, source: 'GOOGLE_SERVICE_ACCOUNT_JSON' };
    } catch (error) {
      return { error: `GOOGLE_SERVICE_ACCOUNT_JSON is invalid: ${error.message}` };
    }
  }

  const base64 = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  if (base64) {
    try {
      const credentials = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      if (!credentials.client_email || !credentials.private_key) throw new Error('JSON must contain client_email and private_key.');
      credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
      return { credentials, source: 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64' };
    } catch (error) {
      return { error: `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is invalid: ${error.message}` };
    }
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || (process.env.NODE_ENV === 'production' ? '/etc/secrets/google-service-account.json' : '');
  if (keyFile && fs.existsSync(keyFile)) return { keyFile, source: 'GOOGLE_SERVICE_ACCOUNT_FILE' };
  if (keyFile) return { error: `Google service-account file does not exist at the configured path: ${keyFile}` };
  return { error: 'Set GOOGLE_SERVICE_ACCOUNT_JSON (recommended on Railway), GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, or GOOGLE_SERVICE_ACCOUNT_FILE.' };
}

const credential = resolveCredential();
const configured = Boolean(spreadsheetId && !credential.error && (credential.credentials || credential.keyFile));
let sheets;
let timer = null;
let running = false;
let rerun = false;
let dirty = false;
let initialized = false;
let writeVersion = 0;
let persistedVersion = 0;
let persistenceError = null;
let lastErrorAt = 0;
let refreshTimer = null;
let refreshRunning = false;
let lastLoadedAt = null;
let lastSyncedAt = null;
let lastLoadedCounts = new Map();
let lastPhysicalRowCounts = new Map();
let lastLoadedRecordCount = 0;

const quoteSheet = name => `'${String(name).replaceAll("'", "''")}'`;
const safeCell = value => value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
const escapeIdent = value => String(value).replaceAll('"', '""');

// Central Training at-rest encryption: retain the existing AES-256-GCM format.
const ENCRYPTION_PREFIX = 'enc:v1:';
const encryptionSecret = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
const encryptionKey = encryptionSecret ? crypto.createHash('sha256').update(encryptionSecret, 'utf8').digest() : null;
let storageEncrypted = Boolean(encryptionKey);
function encryptCell(value) {
  const plain = safeCell(value);
  if (!plain || !encryptionKey || !storageEncrypted) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_PREFIX + [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}
function decryptCell(value) {
  if (typeof value !== 'string' || !value.startsWith(ENCRYPTION_PREFIX)) return value;
  if (!encryptionKey) throw new Error('Encrypted Google Sheets data found but DATA_ENCRYPTION_KEY is not configured.');
  try {
    const [iv64, tag64, data64] = value.slice(ENCRYPTION_PREFIX.length).split('.');
    if (!iv64 || !tag64 || !data64) throw new Error('Invalid encrypted cell.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt Google Sheets data. Verify DATA_ENCRYPTION_KEY has not changed.');
  }
}


function getSheets() {
  if (!configured) {
    const details = credential.error || (!spreadsheetId ? 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.' : 'Google service-account credentials are missing.');
    throw new Error(details);
  }
  if (!sheets) {
    const options = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };
    if (credential.credentials) options.credentials = credential.credentials;
    else options.keyFile = credential.keyFile;
    const auth = new google.auth.GoogleAuth(options);
    sheets = google.sheets({ version: 'v4', auth });
  }
  return sheets;
}

function getTables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
}
function schemaColumns(table) {
  return db.prepare(`PRAGMA table_info("${escapeIdent(table)}")`).all().map(c => c.name);
}
function populatedRows(values, keyColumn) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(v => String(v));
  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex < 0) return [];
  return values.slice(1).filter(row => row && String(row[keyIndex] ?? '').trim() !== '');
}

async function readSpreadsheetMeta(api) {
  const response = await api.spreadsheets.get({ spreadsheetId });
  return new Map((response.data.sheets || []).map(s => [s.properties.title, s.properties]));
}

async function validateCoreSheets(api, sheetMap) {
  const missing = CORE_TABLES.filter(table => !sheetMap.has(table));
  if (missing.length) {
    throw new Error(`Google Sheets protection: required tabs are missing (${missing.join(', ')}). No data was changed. Check GOOGLE_SHEETS_SPREADSHEET_ID.`);
  }

  const ranges = CORE_TABLES.map(table => `${quoteSheet(table)}!A1:ZZ200`);
  const response = await api.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE' });
  const coreValues = new Map(CORE_TABLES.map((table, index) => [table, response.data.valueRanges?.[index]?.values || []]));
  const requirements = {
    users: ['id', 'username', 'role'],
    courses: ['id', 'title'],
    trainees: ['id', 'name'],
    trainers: ['id', 'name'],
    enrollments: ['id', 'course_id', 'trainee_id']
  };
  for (const [table, requiredHeaders] of Object.entries(requirements)) {
    const headers = (coreValues.get(table)[0] || []).map(v => String(v));
    const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
    if (missingHeaders.length) {
      throw new Error(`Google Sheets protection: tab '${table}' has unexpected headers (missing ${missingHeaders.join(', ')}). No data was changed.`);
    }
  }

  const users = populatedRows(coreValues.get('users'), 'username');
  if (!users.length && !ALLOW_EMPTY_BOOTSTRAP) {
    throw new Error('Google Sheets protection: the users tab has no user records. Startup was stopped to prevent loading an empty/wrong spreadsheet. Verify the restored spreadsheet ID before continuing.');
  }
  return { coreValues, usersCount: users.length };
}

async function ensureSheetsExist(api, tables, sheetMap) {
  // Core tabs are validated before any schema changes or new tabs are created.
  await validateCoreSheets(api, sheetMap);

  const missingOptional = tables.filter(table => !sheetMap.has(table) && !CORE_TABLES.includes(table));
  if (missingOptional.length) {
    const requests = missingOptional.map(title => ({ addSheet: { properties: { title } } }));
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    for (const table of missingOptional) sheetMap.set(table, { title: table });
  }

  const ranges = tables.filter(table => sheetMap.has(table)).map(table => `${quoteSheet(table)}!1:1`);
  const headerResult = ranges.length ? await api.spreadsheets.values.batchGet({
    spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE'
  }) : { data: { valueRanges: [] } };

  for (const [index, table] of tables.entries()) {
    const headers = headerResult.data.valueRanges?.[index]?.values?.[0] || [];
    const expected = schemaColumns(table);
    if (!headers.length) {
      // Only empty optional/new tabs reach this point. Core tabs were validated above.
      if (CORE_TABLES.includes(table)) throw new Error(`Google Sheets protection: core tab '${table}' unexpectedly has no header.`);
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(table)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [expected] }
      });
      continue;
    }
    const headerStrings = headers.map(v => String(v));
    const missing = expected.filter(col => !headerStrings.includes(col));
    if (missing.length) {
      const colLetters = n => {
        let out = '';
        while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
        return out;
      };
      const startColumn = headerStrings.length + 1;
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheet(table)}!${colLetters(startColumn)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [missing] }
      });
    }
  }
}

async function ensureMetaSheet(api, sheetMap) {
  if (sheetMap.has(META_SHEET)) return;
  const result = await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: META_SHEET, hidden: true } } }] }
  });
  const added = result.data.replies?.[0]?.addSheet?.properties;
  sheetMap.set(META_SHEET, added || { title: META_SHEET });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheet(META_SHEET)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['table', 'row_count', 'sync_version', 'saved_at']] }
  });
}

function parseMetaRows(values) {
  const counts = new Map();
  if (!values || values.length < 2) return counts;
  const headers = values[0].map(v => String(v));
  const tableIndex = headers.indexOf('table');
  const countIndex = headers.indexOf('row_count');
  if (tableIndex < 0 || countIndex < 0) return counts;
  for (const row of values.slice(1)) {
    const table = String(row[tableIndex] || '');
    const count = Number(row[countIndex]);
    if (table && Number.isSafeInteger(count) && count >= 1) counts.set(table, count);
  }
  return counts;
}

async function loadSheetsIntoMemory({ createMissing = false } = {}) {
  const loadVersion = writeVersion;
  const api = getSheets();
  const tables = getTables();
  let sheetMap = await readSpreadsheetMeta(api);
  if (createMissing) {
    await ensureSheetsExist(api, tables, sheetMap);
    sheetMap = await readSpreadsheetMeta(api);
  }

  // Runtime refreshes never overwrite local writes that are waiting to be persisted.
  if (!createMissing && (dirty || writeVersion !== loadVersion)) return;
  const missing = CORE_TABLES.filter(table => !sheetMap.has(table));
  if (missing.length) throw new Error(`Google Sheets protection: required tabs missing (${missing.join(', ')}).`);

  const readTables = tables.filter(table => sheetMap.has(table));
  const ranges = readTables.map(table => `${quoteSheet(table)}!A:ZZ`);
  const hasMeta = sheetMap.has(META_SHEET);
  if (hasMeta) ranges.push(`${quoteSheet(META_SHEET)}!A:D`);
  const result = ranges.length ? await api.spreadsheets.values.batchGet({
    spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE'
  }) : { data: { valueRanges: [] } };
  // Re-check after the network read too: a write may begin while batchGet is in flight.
  if (!createMissing && (dirty || writeVersion !== loadVersion)) return;

  const byTable = new Map(readTables.map((table, index) => [table, result.data.valueRanges?.[index]?.values || []]));
  const metaValues = hasMeta ? result.data.valueRanges?.[readTables.length]?.values || [] : [];
  const declaredCounts = parseMetaRows(metaValues);
  const physicalCounts = new Map();
  const effectiveCounts = new Map();
  const preparedTables = new Map();

  // Prepare and validate every table before clearing any row in the in-memory DB.
  for (const table of tables) {
    const physical = byTable.get(table) || [];
    physicalCounts.set(table, physical.length);
    let values = physical;
    const declared = declaredCounts.get(table);
    if (declared !== undefined) {
      if (declared > physical.length) {
        throw new Error(`Google Sheets protection: tab '${table}' is shorter than its saved row-count marker (${physical.length}/${declared}). No in-memory data was replaced.`);
      }
      values = physical.slice(0, declared);
    }
    effectiveCounts.set(table, Math.max(0, values.length - 1));

    if (!values.length) {
      preparedTables.set(table, { values: [], columns: schemaColumns(table), rows: [] });
      continue;
    }
    const columnInfo = db.prepare(`PRAGMA table_info("${escapeIdent(table)}")`).all();
    const expected = columnInfo.map(c => c.name);
    const headers = values[0].map(v => String(v));
    const usable = expected.filter(c => headers.includes(c));
    if (CORE_TABLES.includes(table) && !usable.length) throw new Error(`Google Sheets protection: tab '${table}' has no compatible columns.`);
    const rows = values.slice(1).filter(row => row && row.some(v => v !== '' && v !== null && v !== undefined));
    preparedTables.set(table, { values, columns: expected, usable, columnInfo, headers, rows });
  }

  const usersData = preparedTables.get('users');
  const userHeaders = usersData?.headers || [];
  const usernameIndex = userHeaders.indexOf('username');
  const validUsers = (usersData?.rows || []).filter(row => usernameIndex >= 0 && String(row[usernameIndex] ?? '').trim() !== '');
  if (!validUsers.length && !ALLOW_EMPTY_BOOTSTRAP) {
    throw new Error('Google Sheets protection: zero users were loaded. The current Google Sheet was rejected; the in-memory database was not cleared.');
  }

  const totalRecords = [...effectiveCounts.values()].reduce((sum, count) => sum + count, 0);
  const tx = db.transaction(() => {
    for (const table of [...tables].reverse()) db.exec(`DELETE FROM "${escapeIdent(table)}"`);
    for (const table of tables) {
      const prepared = preparedTables.get(table);
      if (!prepared || !prepared.values.length || !prepared.usable?.length) continue;
      const usable = prepared.usable;
      const sqlCols = usable.map(c => `"${escapeIdent(c)}"`).join(',');
      const placeholders = usable.map(() => '?').join(',');
      const insert = db.prepare(`INSERT OR REPLACE INTO "${escapeIdent(table)}" (${sqlCols}) VALUES (${placeholders})`);
      for (const row of prepared.rows) {
        insert.run(...usable.map(col => {
          const ix = prepared.headers.indexOf(col);
          if (ix < 0 || row[ix] === undefined || row[ix] === '') {
            const definition = prepared.columnInfo.find(c => c.name === col);
            if (definition.notnull && definition.dflt_value !== null) return db.prepare('SELECT ' + definition.dflt_value + ' AS value').get().value;
            if (definition.notnull && /TEXT/i.test(definition.type)) return '';
            return null;
          }
          const value = decryptCell(row[ix]);
          return typeof value === 'object' ? JSON.stringify(value) : value;
        }));
      }
    }
  });

  db.pragma('foreign_keys = OFF');
  try { tx(); }
  finally { db.pragma('foreign_keys = ON'); }

  lastLoadedCounts = effectiveCounts;
  lastPhysicalRowCounts = physicalCounts;
  lastLoadedRecordCount = totalRecords;
  lastLoadedAt = new Date().toISOString();
  initialized = true;
}

function buildPayload(tables) {
  return tables.map(table => {
    const columns = schemaColumns(table);
    const rows = db.prepare(`SELECT * FROM "${escapeIdent(table)}"`).all();
    return { table, values: [columns, ...rows.map(row => columns.map(c => encryptCell(row[c]))) ] };
  });
}

function checkSnapshotSafety(payload) {
  const userTable = payload.find(p => p.table === 'users');
  const userIndex = userTable?.values?.[0]?.indexOf('username') ?? -1;
  const userCount = userIndex < 0 ? 0 : userTable.values.slice(1).filter(row => String(row[userIndex] ?? '').trim() !== '').length;
  if (!userCount && !ALLOW_EMPTY_BOOTSTRAP) {
    throw new Error('Google Sheets write blocked: the in-memory snapshot contains zero users. This is a safety lock; no Google Sheet data was changed.');
  }

  const currentTotal = payload.reduce((sum, p) => sum + Math.max(0, p.values.length - 1), 0);
  if (lastLoadedRecordCount >= 20 && currentTotal < lastLoadedRecordCount * 0.5 && !ALLOW_BULK_DELETE) {
    throw new Error(`Google Sheets write blocked: record count dropped unexpectedly from ${lastLoadedRecordCount} to ${currentTotal}. Review the database first. For an intentional bulk deletion only, set GOOGLE_SHEETS_ALLOW_BULK_DELETE=true temporarily.`);
  }
  return { currentTotal };
}

async function scheduleTailCleanup(api, payload) {
  const ranges = [];
  for (const item of payload) {
    const oldCount = lastPhysicalRowCounts.get(item.table) || 0;
    const newCount = item.values.length;
    if (oldCount > newCount) ranges.push(`${quoteSheet(item.table)}!A${newCount + 1}:ZZ${oldCount}`);
  }
  if (!ranges.length) return;
  try {
    // Tail cleanup happens only AFTER the replacement write and row-count metadata succeeded.
    await api.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges } });
    for (const item of payload) lastPhysicalRowCounts.set(item.table, item.values.length);
  } catch (error) {
    // The app will still ignore stale tail rows using _platform_sync_meta.row_count.
    console.warn('[Google Sheets] Tail cleanup warning (new snapshot is already saved):', error.message);
  }
}

function scheduleGoogleSheetsSync() {
  // Track writes even during an in-flight refresh so a read cannot overwrite local changes.
  dirty = true;
  writeVersion += 1;
  if (!initialized) {
    if (process.env.NODE_ENV === 'production') console.error('[Google Sheets] Write queued but blocked until authoritative Sheets data has loaded.');
    return;
  }
  if (!configured) {
    if (process.env.NODE_ENV === 'production') console.error('[Google Sheets] Write could not be persisted: configuration is missing.');
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow().catch(() => {}); }, 700);
  if (timer.unref) timer.unref();
}

async function syncNow() {
  if (!configured) throw new Error(credential.error || 'Google Sheets is not configured.');
  if (!initialized) throw new Error('Google Sheets sync blocked: authoritative data has not been loaded.');
  if (running) { rerun = true; return; }
  running = true;
  const syncVersion = writeVersion;
  try {
    const api = getSheets();
    const tables = getTables();
    const sheetMap = await readSpreadsheetMeta(api);
    const missing = tables.filter(table => !sheetMap.has(table));
    if (missing.length) throw new Error(`Google Sheets write blocked: tabs disappeared (${missing.join(', ')}).`);
    await ensureMetaSheet(api, sheetMap);

    const payload = buildPayload(tables);
    const { currentTotal } = checkSnapshotSafety(payload);
    const savedAt = new Date().toISOString();
    const metaValues = [
      ['table', 'row_count', 'sync_version', 'saved_at'],
      ...payload.map(item => [item.table, item.values.length, syncVersion, savedAt])
    ];
    const updates = payload.map(item => ({ range: `${quoteSheet(item.table)}!A1`, majorDimension: 'ROWS', values: item.values }));
    // Metadata is updated in the same batch request and written last. Reads use it to ignore old trailing rows.
    updates.push({ range: `${quoteSheet(META_SHEET)}!A1`, majorDimension: 'ROWS', values: metaValues });
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });

    lastLoadedRecordCount = currentTotal;
    lastLoadedCounts = new Map(payload.map(item => [item.table, item.values.length - 1]));
    persistedVersion = Math.max(persistedVersion, syncVersion);
    persistenceError = null;
    lastSyncedAt = savedAt;
    if (writeVersion === syncVersion) dirty = false;

    await scheduleTailCleanup(api, payload);
    console.log(`[Google Sheets] Safely saved ${tables.length} tables (${currentTotal} records); no pre-write clear was performed.`);
  } catch (error) {
    persistenceError = error;
    const now = Date.now();
    if (now - lastErrorAt > 10000) console.error('[Google Sheets] PERSISTENCE ERROR:', error.message);
    lastErrorAt = now;
    throw error;
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; syncNow().catch(() => {}); }, 100);
      if (timer.unref) timer.unref();
    }
  }
}

async function initializeGoogleSheetsStore() {
  if (!spreadsheetId || !configured) {
    const reason = !spreadsheetId ? 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.' : credential.error;
    if (!['development', 'test'].includes(String(process.env.NODE_ENV || '').toLowerCase())) {
      throw new Error(`Google Sheets is required outside explicit local development/test mode. ${reason}`);
    }
    console.warn('[Google Sheets] Not configured; explicit local development/test mode is using an empty in-memory database.');
    return;
  }

  const api = getSheets();
  const tables = getTables();
  const sheetMap = await readSpreadsheetMeta(api);
  // ensureSheetsExist begins by validating core tabs and user rows before any schema changes.
  await ensureSheetsExist(api, tables, sheetMap);
  await loadSheetsIntoMemory();
  if (!initialized) throw new Error('Google Sheets startup validation did not complete.');

  // Central's persistent encryption flag is stored in platform_control and follows the restored sheet.
  // An encrypted data set without its key stops startup rather than silently loading unusable data.
  const modeRow = db.prepare("SELECT control_value FROM platform_control WHERE control_key='storage_encrypted'").get();
  if (modeRow) {
    storageEncrypted = String(modeRow.control_value) !== '0';
    if (storageEncrypted && !encryptionKey) {
      throw new Error('Encrypted Google Sheets data requires DATA_ENCRYPTION_KEY. Startup stopped to protect existing data.');
    }
  } else {
    storageEncrypted = Boolean(encryptionKey);
    db.prepare("INSERT OR REPLACE INTO platform_control(control_key,control_value,updated_at) VALUES('storage_encrypted',?,CURRENT_TIMESTAMP)").run(storageEncrypted ? '1' : '0');
    // With encryption enabled, migrate the just-loaded plaintext snapshot through the guarded writer.
    // Without encryption, let the next normal write persist the new control row; do not rewrite on boot.
    if (storageEncrypted) {
      dirty = true;
      writeVersion += 1;
      await syncNow();
      if (persistenceError) throw new Error('Unable to persist the initial Google Sheets encryption mode.');
    }
  }

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (dirty || running || refreshRunning || !initialized) return;
    refreshRunning = true;
    loadSheetsIntoMemory().catch(error => {
      const now = Date.now();
      if (now - lastErrorAt > 10000) console.error('[Google Sheets] REFRESH ERROR:', error.message);
      lastErrorAt = now;
    }).finally(() => { refreshRunning = false; });
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref();

  console.log(`[Google Sheets] Loaded and validated ${lastLoadedRecordCount} records across ${tables.length} tables.`);
}

async function flushGoogleSheetsWrites() {
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw Error(credential.error || 'Google Sheets persistence is not configured.');
    return;
  }
  if (!initialized) throw Error('Google Sheets persistence is unavailable because authoritative data was not loaded.');
  const target = writeVersion;
  const deadline = Date.now() + 30000;
  if (timer) { clearTimeout(timer); timer = null; }
  while (persistedVersion < target) {
    if (Date.now() > deadline) throw Error('Persistence acknowledgement timed out.');
    if (!running) {
      try { await syncNow(); }
      catch (error) { throw Error(`Google Sheets persistence failed: ${error.message}`); }
      if (persistenceError) throw Error(`Google Sheets persistence failed: ${persistenceError.message}`);
    } else await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function setStorageEncryption(enabled) {
  const next = Boolean(enabled);
  if (next && !encryptionKey) throw new Error('DATA_ENCRYPTION_KEY is not configured.');
  if (!initialized) throw new Error('Google Sheets must be loaded before changing storage encryption.');
  storageEncrypted = next;
  db.prepare("INSERT OR REPLACE INTO platform_control(control_key,control_value,updated_at) VALUES('storage_encrypted',?,CURRENT_TIMESTAMP)").run(storageEncrypted ? '1' : '0');
  dirty = true;
  writeVersion += 1;
  await flushGoogleSheetsWrites();
  if (persistenceError) throw persistenceError;
  return { encrypted: storageEncrypted };
}
function getStorageEncryptionStatus() {
  return { encrypted: storageEncrypted, configured: Boolean(encryptionKey) };
}

function getGoogleSheetsStatus() {
  const maskedId = spreadsheetId ? `${spreadsheetId.slice(0, 5)}…${spreadsheetId.slice(-4)}` : '';
  return {
    configured,
    initialized,
    credentialSource: credential.source || null,
    spreadsheetId: maskedId,
    tableCount: initialized ? getTables().length : 0,
    loadedRecordCount: lastLoadedRecordCount,
    loadedAt: lastLoadedAt,
    lastSyncedAt,
    dirty,
    pendingWriteVersion: writeVersion,
    persistedWriteVersion: persistedVersion,
    storageEncryption: { encrypted: storageEncrypted, configured: Boolean(encryptionKey) },
    lastError: persistenceError ? persistenceError.message : null
  };
}

module.exports = {
  flushGoogleSheetsWrites,
  getGoogleSheetsStatus,
  initializeGoogleSheetsStore,
  scheduleGoogleSheetsSync,
  syncNow,
  refreshFromGoogleSheets: loadSheetsIntoMemory,
  setStorageEncryption,
  getStorageEncryptionStatus
};
