'use strict';

const crypto = require('node:crypto');

function config() {
  return {
    url: String(process.env.KNOWLEDGE_SCRIPT_URL || '').trim(),
    secret: String(process.env.KNOWLEDGE_BRIDGE_SECRET || '')
  };
}

function configured() {
  const c = config();
  return Boolean(c.url && c.secret);
}

async function call(action, data = {}, requestId = crypto.randomUUID()) {
  const c = config();
  if (!c.url || !c.secret) {
    throw new Error('أضف KNOWLEDGE_SCRIPT_URL وKNOWLEDGE_BRIDGE_SECRET لربط تخزين مكتبة المعرفة.');
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.url)) {
    throw new Error('KNOWLEDGE_SCRIPT_URL يجب أن يكون رابط نشر Google Apps Script وينتهي بـ /exec.');
  }

  const payload = JSON.stringify({ action, ...data, requestId, timestamp: Date.now() });
  const signature = crypto.createHmac('sha256', c.secret).update(payload).digest('base64');
  const response = await fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, signature }),
    redirect: 'follow',
    signal: AbortSignal.timeout(90000)
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('استجابة سكريبت مكتبة المعرفة غير صحيحة. راجع نشر Web App ورابط /exec.');
  }
  if (!response.ok || !result.success) throw new Error(result.error || 'فشلت عملية تخزين مكتبة المعرفة.');
  return result;
}

async function upload(name, mime, base64) {
  const result = await call('knowledgeUpload', { name, mime, base64 });
  return { id: result.id, url: result.url };
}

async function download(id) {
  const result = await call('knowledgeDownload', { id });
  return { bytes: Buffer.from(result.base64, 'base64'), mime: result.mime, name: result.name };
}

module.exports = { configured, call, upload, download };
