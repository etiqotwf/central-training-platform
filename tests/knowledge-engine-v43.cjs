'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../ai/knowledge-engine');

// Guardrail: the knowledge chat route must remain independent of LLM providers.
const aiIndex = fs.readFileSync(path.join(__dirname, '..', 'ai', 'index.js'), 'utf8');
const chatStart = aiIndex.indexOf("app.post('/api/ai/knowledge/chat'");
const chatEnd = aiIndex.indexOf(' function sourcePayload', chatStart);
assert(chatStart >= 0 && chatEnd > chatStart, 'Knowledge chat route should exist');
const chatRoute = aiIndex.slice(chatStart, chatEnd);
assert(!/\binvoke\s*\(/.test(chatRoute), 'Knowledge chat must not invoke an LLM');
assert(!/provider\.|OPENAI_API_KEY|chat\/completions|embeddings/i.test(chatRoute), 'Knowledge route must not call external model services');
assert(chatRoute.includes('answerKnowledgeQuestion') && chatRoute.includes('rankKnowledgeChunks'), 'Knowledge route must use the deterministic engine');

assert.equal(engine.normalize('أحكام المناقصات ١٨٢ لسنة ٢٠١٨'), 'احكام المناقصات 182 لسنه 2018');
assert.equal(engine.parseArticleTarget('ما نص المادة ١١؟'), '11');
assert.equal(engine.parseArticleTarget('ما نص المادة الحادية والسبعون؟'), '71');
assert.deepEqual(engine.articleNumbers('مادة (١١): يجب على الجهة الإدارية...'), ['11']);
assert.deepEqual(engine.articleNumbers('المادة الحادية عشرة: نص قانوني'), ['11']);

const fixtures = [
  { id: 1, document_id: 1, document_title: 'قانون تنظيم التعاقدات', original_name: 'law.pdf', chunk_index: 1, page_start: 1, page_end: 1, content: 'المادة الأولى: يعمل بأحكام القانون المرافق في شأن تنظيم التعاقدات التي تبرمها الجهات العامة. وتسري أحكامه على الجهات التي تضمها الموازنة العامة للدولة ووحدات الجهاز الإداري.' },
  { id: 2, document_id: 1, document_title: 'قانون تنظيم التعاقدات', original_name: 'law.pdf', chunk_index: 2, page_start: 11, page_end: 11, content: 'المادة الحادية عشرة: يجب على الجهة الإدارية التحقق من توافر الاعتماد المالي قبل البدء في إجراءات الطرح. ويجب أن يكون التعاقد في حدود الاعتماد المالي.' },
  { id: 3, document_id: 1, document_title: 'قانون تنظيم التعاقدات', original_name: 'law.pdf', chunk_index: 3, page_start: 12, page_end: 12, content: 'المادة السادسة عشرة: تحدد السلطة المختصة مبلغ التأمين المؤقت، ويجب ألا يجاوز النسبة المقررة من القيمة التقديرية للعملية.' },
  { id: 4, document_id: 2, document_title: 'اللائحة التنفيذية', original_name: 'rules.pdf', chunk_index: 1, page_start: 4, page_end: 4, content: 'تلتزم الجهة المختصة بإعلان إجراءات التعاقد خلال المدة المحددة في اللائحة التنفيذية.' }
];

const hits = engine.rankKnowledgeChunks(fixtures, 'ما الجهات التي تسري عليها أحكام قانون تنظيم التعاقدات؟', 4);
assert(hits.length > 0);
assert.equal(hits[0].id, 1, 'The matching statutory scope should rank first');
const articleHits = engine.rankKnowledgeChunks(fixtures, 'ما نص المادة ١١ عن الاعتماد المالي؟', 4);
assert(articleHits.some(x => x.id === 2), 'Article number and financial terms should retrieve the requested article');

const answer = engine.answerKnowledgeQuestion({ question: 'ما الجهات التي يسري عليها القانون؟', mode: 'question', hits, allChunks: fixtures });
assert(answer.grounded);
assert(answer.answer.includes('صفحة 1'));
assert.equal(answer.citations[0].id, '1');
assert.equal(answer.engine, 'rule-based-bm25');
assert.equal(engine.extractEntities(fixtures).articles.length > 0, true);

const analysis = engine.answerKnowledgeQuestion({ question: 'الاعتماد المالي وإجراءات الطرح', mode: 'analysis', hits: articleHits, allChunks: fixtures });
assert(analysis.answer.includes('الالتزامات والمحظورات') || analysis.answer.includes('النصوص الأكثر ارتباطاً'));

const compare = engine.answerKnowledgeQuestion({ question: 'إجراءات التعاقد', mode: 'compare', hits: fixtures.slice(1), allChunks: fixtures });
assert(compare.answer.includes('مقارنة نصية بين المستندات'));

console.log('V43 deterministic knowledge engine tests passed.');
