'use strict';
const assert = require('node:assert/strict');
const { normalize, tokens, needsArabicOcr, splitLongText, chunkExtractedDocument, rankKnowledgeChunks } = require('../ai/knowledge-workspace');

assert.equal(normalize('أحكام المناقصات ١٨٢'), 'احكام المناقصات ١٨٢');
assert(tokens('قانون المناقصات العامة رقم 182 لسنة 2018').includes('المناقصات'));
assert.equal(needsArabicOcr(''), true, 'Image-only PDFs should trigger OCR');
assert.equal(needsArabicOcr('هذا نص عربي واضح قابل للقراءة والبحث في جميع الصفحات. '.repeat(10)), false, 'Readable Arabic text should not trigger OCR');
assert.equal(needsArabicOcr(('≤∞±∏ WM‡M§‡ ¹—U—UŒ ' .repeat(100))), true, 'Legacy font-mapped Arabic PDFs should trigger OCR');
assert.equal(needsArabicOcr('This is a normal English PDF with clear embedded text. '.repeat(20)), false, 'Readable English text should not trigger Arabic OCR');

const long = ('هذا نص قانوني لاختبار تقسيم الفقرات مع الحفاظ على التداخل بين المقاطع. ').repeat(90);
const parts = splitLongText(long, 900, 120);
assert(parts.length > 2, 'Long text should split into multiple chunks');
assert(parts.every(x => x.length <= 900), 'Each chunk must stay within the configured limit');
assert(parts.join(' ').length > long.length * 0.8, 'Chunking should preserve nearly all source content');

const pages = [
  'المادة الأولى: تسري أحكام قانون تنظيم التعاقدات التي تبرمها الجهات العامة على الجهات الإدارية.',
  'المادة الثانية: لا تسري بعض الأحكام على الحالات التي نظمها قانون آخر.',
  'المادة الثالثة: تصدر اللائحة التنفيذية بقرار من الوزير المختص.'
];
const chunks = chunkExtractedDocument({ text: pages.join('\n\n'), pages }, 80);
assert(chunks.length >= 3);
assert.equal(chunks[0].page_start, 1);
assert.equal(chunks.find(x => x.content.includes('المادة الثانية')).page_start, 2);
assert(chunks.every(x => x.page_start === x.page_end));

const ranked = rankKnowledgeChunks([
  { document_id: 1, document_title: 'قانون التعاقدات', chunk_index: 1, page_start: 1, content: pages[0] },
  { document_id: 1, document_title: 'قانون التعاقدات', chunk_index: 2, page_start: 2, content: pages[1] },
  { document_id: 2, document_title: 'دليل المخازن', chunk_index: 1, page_start: 1, content: 'إجراءات استلام الأصناف وصرف المخزون.' }
], 'ما الجهات التي يسري عليها قانون تنظيم التعاقدات العامة؟', 2);
assert.equal(ranked[0].document_id, 1, 'Relevant legal text should rank first');

const representatives = rankKnowledgeChunks([
  { document_id: 1, chunk_index: 1, content: 'بداية القانون' },
  { document_id: 1, chunk_index: 2, content: 'وسط القانون' },
  { document_id: 1, chunk_index: 3, content: 'نهاية القانون' }
], 'قدم نظرة عامة على الملف', 3, { allowRepresentative: true });
assert.equal(representatives.length, 3, 'Broad analysis should choose representative chunks when no exact match exists');

console.log('V42 knowledge workspace tests passed.');
