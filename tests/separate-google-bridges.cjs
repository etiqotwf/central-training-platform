'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /const\s+knowledgeBridge\s*=\s*require\(['\"]\.\/knowledge-bridge['\"]\)/, 'server.js must load the dedicated Knowledge bridge');

const archiveSecret = 'archive-test-secret-abcdefghijklmnopqrstuvwxyz-123456';
const knowledgeSecret = 'knowledge-test-secret-abcdefghijklmnopqrstuvwxyz-123456';
process.env.ARCHIVE_SCRIPT_URL = 'https://script.google.com/macros/s/ArchiveTest/exec';
process.env.ARCHIVE_BRIDGE_SECRET = archiveSecret;
process.env.KNOWLEDGE_SCRIPT_URL = 'https://script.google.com/macros/s/KnowledgeTest/exec';
process.env.KNOWLEDGE_BRIDGE_SECRET = knowledgeSecret;
delete process.env.PLATFORM_SCRIPT_URL;
delete process.env.PLATFORM_BRIDGE_SECRET;

const requests = [];
global.fetch = async (url, options = {}) => {
  const envelope = JSON.parse(options.body);
  const payload = JSON.parse(envelope.payload);
  const secret = String(url).includes('/KnowledgeTest/') ? knowledgeSecret : archiveSecret;
  const expected = crypto.createHmac('sha256', secret).update(envelope.payload).digest('base64');
  assert.equal(envelope.signature, expected, 'each bridge must sign with its own secret');
  requests.push({ url: String(url), payload });
  let response;
  if (payload.action === 'platformUpload') response = { success: true, id: 'archive-file-1', url: 'https://drive.google.com/file/d/archive-file-1/view' };
  else if (payload.action === 'platformDownload') response = { success: true, name: 'archive.pdf', mime: 'application/pdf', base64: Buffer.from('archive').toString('base64') };
  else if (payload.action === 'knowledgeUpload') response = { success: true, id: 'knowledge-file-1', url: 'https://drive.google.com/file/d/knowledge-file-1/view' };
  else if (payload.action === 'knowledgeDownload') response = { success: true, name: 'law.pdf', mime: 'application/pdf', base64: Buffer.from('knowledge').toString('base64') };
  else response = { success: true };
  return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

(async () => {
  const archive = require('../google-bridge');
  const knowledge = require('../knowledge-bridge');
  assert.equal(archive.configured(), true);
  assert.equal(knowledge.configured(), true);

  const a = await archive.upload('archive.pdf', 'application/pdf', Buffer.from('archive').toString('base64'));
  assert.equal(a.id, 'archive-file-1');
  const ad = await archive.download(a.id);
  assert.equal(ad.bytes.toString(), 'archive');

  const k = await knowledge.upload('law.pdf', 'application/pdf', Buffer.from('knowledge').toString('base64'));
  assert.equal(k.id, 'knowledge-file-1');
  const kd = await knowledge.download(k.id);
  assert.equal(kd.bytes.toString(), 'knowledge');

  assert(requests.some(x => x.url.includes('/ArchiveTest/') && x.payload.action === 'platformUpload'));
  assert(requests.some(x => x.url.includes('/KnowledgeTest/') && x.payload.action === 'knowledgeUpload'));
  assert(requests.every(x => x.url.includes('/ArchiveTest/') ? ['platformUpload','platformDownload'].includes(x.payload.action) : ['knowledgeUpload','knowledgeDownload'].includes(x.payload.action)));

  // Backward compatibility for existing Render setups using the former shared variable names.
  delete process.env.ARCHIVE_SCRIPT_URL;
  delete process.env.ARCHIVE_BRIDGE_SECRET;
  process.env.PLATFORM_SCRIPT_URL = 'https://script.google.com/macros/s/LegacyArchive/exec';
  process.env.PLATFORM_BRIDGE_SECRET = archiveSecret;
  assert.equal(archive.configured(), true);
  await archive.call('platformHealth');
  assert(requests.at(-1).url.includes('/LegacyArchive/'));

  console.log('PASS: archive and knowledge Apps Script bridges use separate URLs/secrets/actions; legacy archive variable names remain compatible.');
})().catch(error => { console.error(error); process.exit(1); });
