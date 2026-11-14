'use strict';
const { parentPort, workerData } = require('worker_threads');

const MAX_PDF_PAGES = 300;
const MAX_TEXT_CHARS = 500000;

(async () => {
  const bytes = Buffer.from(workerData.data, 'base64');
  const ext = String(workerData.ext || '').toLowerCase();
  let text = '';

  if (ext === 'txt') {
    text = bytes.toString('utf8');
  } else if (ext === 'docx') {
    const result = await require('mammoth').extractRawText({ buffer: bytes });
    text = result.value || '';
  } else if (ext === 'pdf') {
    const result = await require('pdf-parse')(bytes);
    if (result.numpages > MAX_PDF_PAGES) {
      const error = new Error('too many pages');
      error.code = 'TOO_MANY_PAGES';
      throw error;
    }
    text = result.text || '';
  }

  text = String(text).replace(/\u0000/g, '').trim();
  if (text.length > MAX_TEXT_CHARS) {
    const error = new Error('extracted text is too long');
    error.code = 'TOO_MUCH_TEXT';
    throw error;
  }

  parentPort.postMessage({ text, chars: text.length });
})().catch(error => {
  parentPort.postMessage({ error: true, code: error && error.code ? error.code : 'READ_FAILED' });
});
