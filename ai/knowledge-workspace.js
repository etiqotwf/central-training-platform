'use strict';

const STOP_WORDS = new Set((
  'من في على الى إلى عن مع ثم أو او و هو هي هذا هذه ذلك تلك التي الذي ما ماذا كيف لماذا متى أين اين هل لم لن لا قد كان كانت يكون تكون يتم تم كل بعض عند بين بعد قبل ضمن خلال فقط أيضا اي أي ذلك هناك هنا مثل اذا إذا ان أن إن بأن التي الذي الذين اللاتي هذا هذه تلك هذاك كما حيث ذلك وهو وهي لهم لها منه منها فيه فيها'.split(/\s+/)
));

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[ـًٌٍَُِّْ]/g, '');
}


function needsArabicOcr(value) {
  const text = String(value || '').trim();
  if (text.length < 120) return true;
  const letters = (text.match(/[\p{L}]/gu) || []).length;
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const brokenGlyphs = (text.match(/[≤≥√‡œËÊôù¡≈ÆÎ∫≠◊]/g) || []).length;
  return letters > 300 && arabic / Math.max(1, letters) < 0.12 && brokenGlyphs > 20;
}

function tokens(value) {
  return (normalize(value).match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter(word => !STOP_WORDS.has(word));
}

function splitLongText(text, maxChars = 2800, overlap = 220) {
  const source = String(text || '').trim();
  if (!source) return [];
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maxChars);
    if (end < source.length) {
      const floor = start + Math.floor(maxChars * 0.68);
      const candidates = [source.lastIndexOf('\n', end), source.lastIndexOf('。', end), source.lastIndexOf('. ', end), source.lastIndexOf(' ', end)];
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
        chunks.push({
          chunk_index: chunks.length + 1,
          page_start: pageIndex + 1,
          page_end: pageIndex + 1,
          content: part
        });
      }
    });
  } else {
    const text = String(extracted?.text || '');
    const paragraphs = text.split(/\n\s*\n/g).map(x => x.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      if (!buffer.trim()) return;
      for (const part of splitLongText(buffer, maxChars, 180)) {
        chunks.push({ chunk_index: chunks.length + 1, page_start: null, page_end: null, content: part });
      }
      buffer = '';
    };
    for (const paragraph of paragraphs.length ? paragraphs : [text]) {
      if (paragraph.length > maxChars) {
        flush();
        for (const part of splitLongText(paragraph, maxChars, 180)) {
          chunks.push({ chunk_index: chunks.length + 1, page_start: null, page_end: null, content: part });
        }
      } else if (!buffer) buffer = paragraph;
      else if (buffer.length + paragraph.length + 2 <= maxChars) buffer += '\n\n' + paragraph;
      else { flush(); buffer = paragraph; }
    }
    flush();
  }
  return chunks;
}

function rankKnowledgeChunks(chunks, question, limit = 8, options = {}) {
  const queryTokens = [...new Set(tokens(question))];
  const phrase = normalize(question).trim();
  const documentFrequency = new Map();
  for (const chunk of chunks) {
    const seen = new Set(tokens(chunk.content));
    for (const token of seen) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const count = Math.max(1, chunks.length);
  const ranked = chunks.map((chunk, index) => {
    const body = normalize(chunk.content);
    const title = normalize(chunk.document_title || chunk.title || '');
    let score = 0;
    for (const token of queryTokens) {
      const frequency = body.split(token).length - 1;
      if (frequency) {
        const idf = Math.log(1 + count / (1 + (documentFrequency.get(token) || 0)));
        score += idf * Math.min(4, frequency);
      }
      if (title.includes(token)) score += 2.5;
    }
    if (phrase.length >= 8 && body.includes(phrase)) score += 10;
    return { ...chunk, score, _index: index };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a._index - b._index);

  const representative = () => {
    const groups = new Map();
    for (const chunk of chunks) {
      const key = String(chunk.document_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chunk);
    }
    const output = [];
    const orderedGroups = [...groups.values()];
    for (const group of orderedGroups) {
      const indexes = [...new Set([0, Math.floor((group.length - 1) / 3), Math.floor((group.length - 1) * 2 / 3), group.length - 1])];
      for (const index of indexes) {
        if (group[index]) output.push(group[index]);
        if (output.length >= limit) break;
      }
      if (output.length >= limit) break;
    }
    return output.slice(0, limit);
  };

  if (options.preferRepresentative) return representative();
  if (!ranked.length) return options.allowRepresentative ? representative() : [];

  // Avoid returning adjacent chunks from the same page when other relevant pages exist.
  const output = [], pageCounts = new Map();
  for (const chunk of ranked) {
    const key = `${chunk.document_id}:${chunk.page_start || 'text'}`;
    const used = pageCounts.get(key) || 0;
    if (used >= 2) continue;
    pageCounts.set(key, used + 1);
    const { score, _index, ...clean } = chunk;
    output.push(clean);
    if (output.length >= limit) break;
  }
  if (output.length < limit) {
    const used = new Set(output.map(x => x.id));
    for (const chunk of ranked) {
      if (used.has(chunk.id)) continue;
      const { score, _index, ...clean } = chunk;
      output.push(clean);
      if (output.length >= limit) break;
    }
  }
  return output;
}

module.exports = { normalize, tokens, needsArabicOcr, splitLongText, chunkExtractedDocument, rankKnowledgeChunks };
