require('./sqlite-test-adapter.cjs');
const assert=require('assert/strict'),Module=require('module'),db=require('../db');
// New submission columns deliberately contain blank cells after a Sheets round trip.
db.exec(`CREATE TABLE activity_submissions(id INTEGER PRIMARY KEY,activity_id INTEGER,trainee_id INTEGER,answer TEXT NOT NULL DEFAULT '',feedback TEXT NOT NULL DEFAULT '',submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),cols=t=>db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);
const data=Object.fromEntries(tables.map(t=>[t,[cols(t)]]));data.activity_submissions.push(cols('activity_submissions').map(c=>({id:1,activity_id:7,trainee_id:2,answer:'',feedback:'',submitted_at:'2026-10-24 12:00:00'}[c])));
let release;let waiting=false;
const api={spreadsheets:{values:{batchGet:async()=>{if(waiting)await new Promise(r=>release=r);return {data:{valueRanges:tables.map(t=>({values:data[t]}))}}}}}};
const old=Module._load;Module._load=function(n,...args){if(n==='googleapis')return {google:{auth:{GoogleAuth:class{}},sheets:()=>api}};return old.call(this,n,...args)};
process.env.GOOGLE_SHEETS_SPREADSHEET_ID='test';process.env.GOOGLE_SERVICE_ACCOUNT_FILE=__filename;
const sync=require('../scripts/live-google-sheets-sync');Module._load=old;
(async()=>{await sync.refreshFromGoogleSheets();const row=db.prepare('SELECT * FROM activity_submissions').get();assert.equal(row.answer,'');assert.equal(row.feedback,'');waiting=true;const refresh=sync.refreshFromGoogleSheets();await new Promise(r=>setImmediate(r));db.prepare("UPDATE activity_submissions SET answer='local edit' WHERE id=1").run();sync.scheduleGoogleSheetsSync();release();await refresh;assert.equal(db.prepare('SELECT answer FROM activity_submissions').get().answer,'local edit');console.log('PASS Sheets: blank required text defaults survive reload; in-flight refresh does not overwrite local writes.');process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
