'use strict';

// Deterministic, on-server document search and extraction engine.
// This module deliberately has no dependency on an LLM, model provider, or API key.

const STOP_WORDS = new Set((
  'من في على الى عن مع ثم او و هو هي هذا هذه ذلك تلك التي الذي ما ماذا كيف لماذا متى اين هل لم لن لا قد كان كانت يكون تكون يتم تم كل بعض عند بين بعد قبل ضمن خلال فقط ايضا اي ان بأن إن اذا حيث لهم لها منه منها فيه فيها الي اليه بها لها به ذلك هناك هنا مثل كما وهو وهي'.split(/\s+/)
));

const SYNONYMS = new Map([
  ['مناقصه', ['مناقصات', 'ممارسة', 'تعاقد']],
  ['مناقصات', ['مناقصه', 'ممارسة', 'تعاقد']],
  ['تعاقد', ['تعاقدات', 'عقد', 'عقود']],
  ['عقد', ['تعاقد', 'تعاقدات', 'عقود']],
  ['جهة', ['جهات', 'ادارية']],
  ['جهات', ['جهة', 'ادارية']],
  ['مده', ['فترة', 'اجل', 'ايام', 'شهر']],
  ['مدة', ['فترة', 'اجل', 'ايام', 'شهر']],
  ['تأمين', ['تامين', 'ضمان', 'كفالة']],
  ['تامين', ['تأمين', 'ضمان', 'كفالة']],
  ['جزاء', ['غرامة', 'غرامات', 'عقوبة']],
  ['غرامة', ['جزاء', 'جزاءات', 'عقوبة']],
  ['اختصاص', ['اختصاصات', 'مسؤولية', 'مهام']],
  ['اختصاصات', ['اختصاص', 'مسؤولية', 'مهام']]
]);

const ARTICLE_WORDS_RAW = [
  ['الاولى', '1'], ['الاول', '1'], ['الأولى', '1'], ['الثانية', '2'], ['الثاني', '2'],
  ['الثالثة', '3'], ['الثالث', '3'], ['الرابعة', '4'], ['الرابع', '4'],
  ['الخامسة', '5'], ['الخامس', '5'], ['السادسة', '6'], ['السادس', '6'],
  ['السابعة', '7'], ['السابع', '7'], ['الثامنة', '8'], ['الثامن', '8'],
  ['التاسعة', '9'], ['التاسع', '9'], ['الحادية', '1'], ['الثانية', '2'], ['الثالثة', '3'], ['الرابعة', '4'], ['الخامسة', '5'], ['السادسة', '6'], ['السابعة', '7'], ['الثامنة', '8'], ['التاسعة', '9'], ['العاشرة', '10'], ['العاشر', '10'],
  ['الحادية عشرة', '11'], ['الحادي عشر', '11'], ['الثانية عشرة', '12'], ['الثاني عشر', '12'],
  ['الثالثة عشرة', '13'], ['الثالث عشر', '13'], ['الرابعة عشرة', '14'], ['الرابع عشر', '14'],
  ['الخامسة عشرة', '15'], ['الخامس عشر', '15'], ['السادسة عشرة', '16'], ['السادس عشر', '16'],
  ['السابعة عشرة', '17'], ['السابع عشر', '17'], ['الثامنة عشرة', '18'], ['الثامن عشر', '18'],
  ['التاسعة عشرة', '19'], ['التاسع عشر', '19'], ['العشرون', '20'], ['العشرين', '20'],
  ['الثلاثون', '30'], ['الثلاثين', '30'], ['الاربعون', '40'], ['الاربعين', '40'],
  ['الخمسون', '50'], ['الخمسين', '50'], ['الستون', '60'], ['الستين', '60'],
  ['السبعون', '70'], ['السبعين', '70'], ['الثمانون', '80'], ['الثمانين', '80'], ['التسعون', '90'], ['التسعين', '90']
];

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[“”"'`]/g, '')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTICLE_WORDS = new Map(ARTICLE_WORDS_RAW.map(([word, number]) => [normalize(word), number]));
function articleWordNumber(raw) {
  const normalized = normalize(raw);
  const direct = ARTICLE_WORDS.get(normalized);
  if (direct) return direct;
  const parts = normalized.split(/\s+/);
  if (parts.length === 2) {
    const first = ARTICLE_WORDS.get(parts[0]);
    const secondWord = parts[1].replace(/^و/, '');
    const second = ARTICLE_WORDS.get(secondWord);
    if (first && second && Number(second) >= 20) return String(Number(first) + Number(second));
  }
  return null;
}

function lightStem(token) {
  let word = token;
  for (const prefix of ['وال', 'بال', 'كال', 'فال', 'لل', 'ال']) {
    if (word.startsWith(prefix) && word.length - prefix.length >= 4) {
      word = word.slice(prefix.length);
      break;
    }
  }
  for (const suffix of ['يات', 'اتهم', 'ات', 'ون', 'ين', 'كما', 'هما', 'هم', 'هن', 'ها', 'كم', 'نا', 'ية', 'يه', 'ه', 'ة', 'ي']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  return word;
}

function tokenize(value) {
  return (normalize(value).match(/[\p{L}\p{N}%]{2,}/gu) || [])
    .filter(token => !STOP_WORDS.has(token));
}

function expandQueryTokens(query) {
  const output = new Map();
  for (const token of tokenize(query)) {
    output.set(token, Math.max(output.get(token) || 0, 1));
    const stem = lightStem(token);
    if (stem && stem !== token) output.set(stem, Math.max(output.get(stem) || 0, 0.45));
    for (const synonym of SYNONYMS.get(token) || []) {
      output.set(synonym, Math.max(output.get(synonym) || 0, 0.32));
    }
  }
  return output;
}

function splitLongText(text, maxChars = 2800, overlap = 220) {
  const source = String(text || '').trim();
  if (!source) return [];
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maxChars);
    if (end < source.length) {
      const floor = start + Math.floor(maxChars * 0.65);
      const candidates = ['\n', '؛', '。', '. ', '،', ' '].map(mark => source.lastIndexOf(mark, end));
      const cut = Math.max(...candidates);
      if (cut >= floor) end = cut + 1;
    }
    const part = source.slice(start, end).trim();
    if (part) parts.push(part);
    if (end >= source.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return parts;
}

function chunkExtractedDocument(extracted, maxChars = 2200) {
  const chunks = [];
  const pages = Array.isArray(extracted?.pages) ? extracted.pages : [];
  if (pages.length) {
    pages.forEach((pageText, pageIndex) => {
      for (const part of splitLongText(pageText, maxChars, 180)) {
        chunks.push({ chunk_index: chunks.length + 1, page_start: pageIndex + 1, page_end: pageIndex + 1, content: part });
      }
    });
  } else {
    const text = String(extracted?.text || '');
    const paragraphs = text.split(/\n\s*\n/g).map(x => x.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      if (!buffer.trim()) return;
      for (const part of splitLongText(buffer, maxChars, 180)) chunks.push({ chunk_index: chunks.length + 1, page_start: null, page_end: null, content: part });
      buffer = '';
    };
    for (const paragraph of paragraphs.length ? paragraphs : [text]) {
      if (paragraph.length > maxChars) {
        flush();
        for (const part of splitLongText(paragraph, maxChars, 180)) chunks.push({ chunk_index: chunks.length + 1, page_start: null, page_end: null, content: part });
      } else if (!buffer) buffer = paragraph;
      else if (buffer.length + paragraph.length + 2 <= maxChars) buffer += '\n\n' + paragraph;
      else { flush(); buffer = paragraph; }
    }
    flush();
  }
  return chunks;
}

function countTokens(value) {
  const counts = new Map();
  for (const token of tokenize(value)) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function articleNumbers(text) {
  const normalized = normalize(text);
  const results = [];
  const regex = /(?:الماده|ماده)\s*(?:رقم\s*)?\(?\s*([0-9]{1,3}|[\p{L}]{3,}(?:\s+(?:عشره?|وال(?:عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون)))?)\s*\)?/gu;
  for (const match of normalized.matchAll(regex)) {
    const raw = match[1].trim();
    const number = articleWordNumber(raw) || (/^\d+$/.test(raw) ? String(Number(raw)) : null);
    if (number && !results.includes(number)) results.push(number);
  }
  return results;
}

function parseArticleTarget(query) {
  const normalized = normalize(query);
  const match = normalized.match(/(?:الماده|ماده)\s*(?:رقم\s*)?\(?\s*([0-9]{1,3}|[\p{L}]{3,}(?:\s+(?:عشره?|وال(?:عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون)))?)/u);
  if (!match) return null;
  const raw = match[1].trim();
  return articleWordNumber(raw) || (/^\d+$/.test(raw) ? String(Number(raw)) : null);
}

const corpusCache = new WeakMap();
function prepareCorpus(chunks) {
  const cached = corpusCache.get(chunks);
  if (cached) return cached;
  const df = new Map();
  const docs = chunks.map(chunk => {
    const content = normalize(chunk.content);
    const title = normalize(chunk.document_title || chunk.title || '');
    const termCounts = countTokens(chunk.content);
    const stemCounts = new Map();
    const searchable = new Set(termCounts.keys());
    for (const [token, count] of termCounts) {
      const stem = lightStem(token);
      if (stem) { stemCounts.set(stem, (stemCounts.get(stem) || 0) + count); searchable.add(stem); }
    }
    for (const term of searchable) df.set(term, (df.get(term) || 0) + 1);
    const titleTokens = new Set(tokenize(title));
    const length = Math.max(1, [...termCounts.values()].reduce((sum, n) => sum + n, 0));
    return { chunk, content, title, termCounts, stemCounts, searchable, titleTokens, length };
  });
  const index = { docs, df, averageLength: docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length), total: Math.max(1, docs.length) };
  corpusCache.set(chunks, index);
  return index;
}

function rankKnowledgeChunks(chunks, query, limit = 8, options = {}) {
  const expanded = expandQueryTokens(query);
  const baseTokens = [...new Set(tokenize(query))];
  const targetArticle = parseArticleTarget(query);
  const phrase = normalize(query);
  if (!expanded.size && !targetArticle && !options.allowRepresentative) return [];

  const { docs, df, averageLength: avgLength, total } = prepareCorpus(chunks);

  const ranked = docs.map((doc, index) => {
    let score = 0;
    for (const [term, weight] of expanded) {
      const tf = doc.termCounts.get(term) || doc.stemCounts.get(term) || 0;
      if (!tf && !doc.title.includes(term)) continue;
      const idf = Math.log(1 + (total - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
      const k1 = 1.45, b = 0.72;
      const bm25 = tf ? idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / Math.max(1, avgLength)))) : 0;
      score += bm25 * weight;
      if (doc.title.includes(term) || doc.titleTokens.has(term)) score += 1.8 * weight;
    }
    if (phrase.length >= 8 && doc.content.includes(phrase)) score += 9;
    if (targetArticle) {
      const numbers = articleNumbers(doc.chunk.content);
      if (numbers.includes(targetArticle)) score += 14;
      else if (baseTokens.some(t => /^\d+$/.test(t))) score -= 2;
    }
    const matched = baseTokens.filter(token => doc.searchable.has(token) || doc.searchable.has(lightStem(token))).length;
    const phraseMatched = phrase.length >= 8 && doc.content.includes(phrase);
    const articleMatched = targetArticle && articleNumbers(doc.chunk.content).includes(targetArticle);
    const minMatched = baseTokens.length >= 4 ? 2 : 1;
    if (matched < minMatched && !phraseMatched && !articleMatched) score = 0;
    if (baseTokens.length > 1) score *= 0.75 + 0.25 * (matched / baseTokens.length);
    return { ...doc.chunk, score, _index: index, _matched: matched };
  }).filter(row => row.score > 0.08).sort((a, b) => b.score - a.score || a._index - b._index);

  if (!ranked.length && options.allowRepresentative) {
    const groups = new Map();
    for (const chunk of chunks) {
      const key = String(chunk.document_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chunk);
    }
    const sample = [];
    for (const group of groups.values()) {
      const indexes = [...new Set([0, Math.floor((group.length - 1) / 2), group.length - 1])];
      for (const i of indexes) { if (group[i]) sample.push({ ...group[i], score: 0, _index: sample.length, _matched: 0 }); }
      if (sample.length >= limit) break;
    }
    return sample.slice(0, limit).map(({ score, _index, _matched, ...chunk }) => chunk);
  }

  const output = [], usedPages = new Map();
  for (const row of ranked) {
    const key = `${row.document_id}:${row.page_start || 'text'}`;
    const n = usedPages.get(key) || 0;
    if (n >= 2) continue;
    usedPages.set(key, n + 1);
    output.push(row);
    if (output.length >= limit) break;
  }
  const seen = new Set(output.map(row => row.id || `${row.document_id}:${row.chunk_index}`));
  if (output.length < limit) for (const row of ranked) {
    const key = row.id || `${row.document_id}:${row.chunk_index}`;
    if (seen.has(key)) continue;
    output.push(row); seen.add(key);
    if (output.length >= limit) break;
  }
  return output.map(({ score, _index, _matched, ...chunk }) => chunk);
}

function splitSentences(text) {
  return String(text || '').replace(/\r/g, '\n')
    .split(/(?<=[.!؟?؛])\s+|\n+/u)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 25);
}

function sentenceScore(sentence, query) {
  const terms = [...new Set(tokenize(query))];
  const body = normalize(sentence);
  let score = 0;
  for (const term of terms) {
    if (body.includes(term)) score += 1 + Math.min(2, (body.split(term).length - 1) * 0.35);
    else if (body.includes(lightStem(term))) score += 0.35;
  }
  return score;
}

function mostRelevantSentences(chunks, query, limit = 14) {
  const seen = new Set(), rows = [];
  chunks.forEach((chunk, chunkIndex) => {
    for (const sentence of splitSentences(chunk.content)) {
      const key = normalize(sentence).slice(0, 240);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ sentence, chunk, score: sentenceScore(sentence, query), chunkIndex });
    }
  });
  return rows.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex).slice(0, limit);
}

const CATEGORY_RULES = [
  ['الهدف والنطاق', /يهدف|الغرض|تسري احكام|تسري أحكام|يعمل باحكام|يعمل بأحكام|ينظم|تنظيم التعاقدات/],
  ['الإجراءات والاختصاصات', /اجراء|اجراءات|مناقص|ممارس|لجنه|لجنة|طرح|اعلان|فتح المظاريف|البت في|اختصاص/],
  ['الالتزامات والمحظورات', /يجب|يتعين|تلتزم|يلتزم|لا يجوز|يحظر|يلزم|على الجهه|على الجهة/],
  ['المدد والمواعيد', /مده|مدة|ايام|أيام|يوم|شهر|سنه|سنة|خلال|قبل|بعد|ثلاثين|ستين|تسعين/],
  ['الاستثناءات والحالات الخاصة', /استثناء|لا تسري|عدا|الا في|إلا في|يجوز|الحالات العاجله|العاجلة/],
  ['القيم والتأمينات', /قيمه|قيمة|جنيه|نسبه|نسبة|تامين|تأمين|ضمان|اعتماد مالي|الاعتماد المالي/]
];

function extractEntities(chunks) {
  const output = { articles: [], dates: [], amounts: [], percentages: [] };
  const add = (key, value, chunk) => {
    const normalizedValue = String(value).trim();
    if (!normalizedValue || output[key].some(x => x.value === normalizedValue && x.document_id === chunk.document_id && x.page === chunk.page_start)) return;
    output[key].push({ value: normalizedValue, chunk_id: chunk.id, document_id: chunk.document_id, document_title: chunk.document_title, page: chunk.page_start, chunk_index: chunk.chunk_index });
  };
  for (const chunk of chunks) {
    for (const n of articleNumbers(chunk.content)) add('articles', `المادة ${n}`, chunk);
    const text = String(chunk.content || '');
    const datePatterns = [/(?:بتاريخ|في|من)\s*([0-9٠-٩]{1,2}[\/.-][0-9٠-٩]{1,2}[\/.-][0-9٠-٩]{2,4})/gu, /([0-9٠-٩]{1,2}\s+(?:يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)\s+[0-9٠-٩]{4})/gu, /(سنة\s+[0-9٠-٩]{4})/gu];
    for (const pattern of datePatterns) for (const match of text.matchAll(pattern)) add('dates', match[1] || match[0], chunk);
    for (const match of text.matchAll(/([0-9٠-٩][0-9٠-٩,٬٫.]*)\s*(جنيه(?:اً|ا)?|جنيه|ألف جنيه|مليون جنيه)/gu)) add('amounts', match[0], chunk);
    for (const match of text.matchAll(/([0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?)\s*[%٪]/gu)) add('percentages', match[0], chunk);
  }
  for (const key of Object.keys(output)) output[key] = output[key].slice(0, 40);
  return output;
}

function formatCitation(chunk) {
  const page = chunk.page_start ? (chunk.page_start === chunk.page_end ? `صفحة ${chunk.page_start}` : `الصفحات ${chunk.page_start}–${chunk.page_end}`) : `المقطع ${chunk.chunk_index}`;
  return `【${chunk.document_title || chunk.original_name || 'مستند'} · ${page}】`;
}

function answerKnowledgeQuestion({ question, mode = 'question', hits = [], allChunks = [] }) {
  if (!hits.length) return { answer: 'لم أعثر على مقاطع مرتبطة بالسؤال في المستندات المحددة. جرّب استخدام مصطلح وارد في المستند أو رقم المادة، أو وسّع نطاق البحث.', citations: [], follow_up: 'جرّب البحث بكلمة أو رقم مادة محدد.', grounded: false, intent: mode };
  let citationChunks = hits.slice(0, 8);
  if (mode === 'extract' && allChunks.length) {
    const entities = extractEntities(allChunks);
    const entityChunkIds = [...new Set(Object.values(entities).flat().map(x => Number(x.chunk_id)).filter(Number.isInteger))];
    const byId = new Map(allChunks.map(chunk => [Number(chunk.id), chunk]));
    for (const id of entityChunkIds) { const chunk = byId.get(id); if (chunk && !citationChunks.some(x => Number(x.id) === id)) citationChunks.push(chunk); if (citationChunks.length >= 10) break; }
  }
  const citations = citationChunks.slice(0, 10).map((chunk, index) => ({ id: String(chunk.id), number: index + 1, document_id: chunk.document_id, title: chunk.document_title, file_name: chunk.original_name, page_start: chunk.page_start, page_end: chunk.page_end, section: chunk.chunk_index, excerpt: String(chunk.content || '').slice(0, 1200) }));
  const blocks = [];
  const sentenceRows = mostRelevantSentences(hits, question, mode === 'summary' ? 18 : 12);
  const excerptBlock = rows => rows.map((row, index) => `${index + 1}. ${row.sentence}\n   ${formatCitation(row.chunk)}`).join('\n\n');

  if (mode === 'summary') {
    blocks.push('ملخص استخراجي للمستندات المختارة');
    blocks.push('يعتمد هذا الملخص على المقاطع المسترجعة آلياً، وليس على صياغة أو استنتاج لغوي حر من نموذج ذكاء اصطناعي.');
    blocks.push(excerptBlock(sentenceRows.slice(0, 12)));
  } else if (mode === 'analysis') {
    blocks.push('تحليل منظم قائم على النصوص المسترجعة');
    for (const [label, pattern] of CATEGORY_RULES) {
      const rows = sentenceRows.filter(row => pattern.test(normalize(row.sentence))).slice(0, 3);
      if (rows.length) blocks.push(`${label}\n${excerptBlock(rows)}`);
    }
    if (blocks.length === 2) blocks.push('لم تظهر مؤشرات نصية كافية لتصنيف النتائج ضمن المحاور القياسية. النصوص الأكثر ارتباطاً بالسؤال:\n' + excerptBlock(sentenceRows.slice(0, 8)));
  } else if (mode === 'extract') {
    blocks.push('نتائج الاستخراج المنظم');
    const entities = extractEntities(allChunks.length ? allChunks : hits);
    const entityLabels = [['articles', 'المواد القانونية'], ['dates', 'التواريخ والسنوات'], ['amounts', 'القيم والمبالغ'], ['percentages', 'النسب المئوية']];
    for (const [key, label] of entityLabels) {
      const values = entities[key];
      if (values.length) blocks.push(`${label}\n${values.map(x => `• ${x.value} — ${x.document_title || 'مستند'}${x.page ? `، صفحة ${x.page}` : ''}`).join('\n')}`);
    }
    blocks.push('النصوص الأقرب لسؤالك\n' + excerptBlock(sentenceRows.slice(0, 8)));
  } else if (mode === 'compare') {
    const grouped = new Map();
    for (const hit of hits) {
      const key = String(hit.document_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(hit);
    }
    if (grouped.size < 2) {
      blocks.push('لم يتم اختيار مستندين مختلفين؛ لذلك لا أستطيع وصف النتائج بأنها مقارنة بين وثيقتين.');
      blocks.push('المواضع ذات الصلة داخل المستند الحالي:\n' + excerptBlock(sentenceRows.slice(0, 8)));
    } else {
      blocks.push('مقارنة نصية بين المستندات المختارة');
      for (const group of grouped.values()) {
        blocks.push(`${group[0].document_title || group[0].original_name}\n${excerptBlock(mostRelevantSentences(group, question, 4))}`);
      }
      blocks.push('ملاحظة: المقارنة هنا تعرض أوجه النصوص التي استرجعها محرك البحث؛ ولا تستنتج تعارضاً قانونياً أو أولوية بين وثيقتين ما لم ينص المصدر صراحة على ذلك.');
    }
  } else {
    const article = parseArticleTarget(question);
    blocks.push(article ? `نتائج البحث عن المادة ${article}` : 'النصوص الأكثر ارتباطاً بسؤالك');
    blocks.push(excerptBlock(sentenceRows.slice(0, 8)));
    blocks.push('طريقة الإجابة: محرك برمجي للبحث والاستخراج؛ النصوص المعروضة مقتبسة من المستندات مع مواضعها، ولا توجد صياغة حرة أو استنتاج غير مسنود.');
  }

  const followUps = {
    question: 'هل تريد استخراج المواد أو المدد أو الاستثناءات المرتبطة بهذا الموضوع؟',
    summary: 'هل تريد تحليلاً تفصيلياً للالتزامات والاستثناءات؟',
    analysis: 'هل تريد استخراج أرقام المواد والمدد والقيم الواردة في النتائج؟',
    extract: 'هل تريد عرض النص الكامل للمادة المرتبطة بهذه البيانات؟',
    compare: 'هل تريد تضييق المقارنة إلى موضوع أو مادة محددة؟'
  };
  return { answer: blocks.filter(Boolean).join('\n\n'), citations, follow_up: followUps[mode] || followUps.question, grounded: true, intent: mode, engine: 'rule-based-bm25' };
}

module.exports = {
  normalize,
  tokenize,
  lightStem,
  expandQueryTokens,
  splitLongText,
  chunkExtractedDocument,
  rankKnowledgeChunks,
  parseArticleTarget,
  articleNumbers,
  extractEntities,
  answerKnowledgeQuestion
};
