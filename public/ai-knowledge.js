/* Central Training Platform · administrator-only document intelligence workspace */
(() => {
  const $ = selector => document.querySelector(selector);
  const state = {
    status: null,
    documents: [],
    conversations: [],
    currentConversation: null,
    messages: [],
    selectedDocuments: [],
    busy: false,
    uploading: false,
    owner: null
  };
  const request = (url, options = {}) => api(`/ai/knowledge${url}`, options);
  const modeLabels = {
    question: 'سؤال مباشر',
    summary: 'ملخص منظم',
    analysis: 'تحليل احترافي',
    extract: 'استخراج بيانات',
    compare: 'مقارنة بين النصوص'
  };
  const loading = '<div class="knowledge-loading"><span></span><span>جاري البحث في المستندات وتجهيز الإجابة…</span></div>';
  const selectedCount = () => state.selectedDocuments.length;
  const selectedLabel = () => selectedCount() ? `البحث داخل ${selectedCount()} مستند` : 'البحث داخل كل المستندات';

  function statusNotice() {
    const s = state.status || {};
    if (s.llm_required !== false) return 'تعذر التحقق من وضع محرك المعرفة المستقل. حدّث الخادم إلى إصدار محرك المعرفة البرمجي.';
    return '';
  }

  function documentCard(doc) {
    const indexed = doc.status === 'indexed';
    const selected = indexed && state.selectedDocuments.includes(Number(doc.id));
    const pages = Number(doc.page_count) ? `${doc.page_count} صفحة` : 'مستند نصي';
    const date = doc.created_at ? new Date(String(doc.created_at).replace(' ', 'T') + 'Z').toLocaleDateString('ar-EG') : '';
    return `<article class="knowledge-doc-card ${selected ? 'selected' : ''}">
      <label class="knowledge-doc-select"><input type="checkbox" data-knowledge-doc="${Number(doc.id)}" ${selected ? 'checked' : ''} ${indexed ? '' : 'disabled'}><span></span></label>
      <div class="knowledge-doc-icon">${doc.extension === 'pdf' ? 'PDF' : doc.extension.toUpperCase()}</div>
      <div class="knowledge-doc-info"><b title="${esc(doc.title)}">${esc(doc.title)}</b><small>${esc(doc.original_name)}</small><div class="knowledge-doc-meta"><span>${pages}</span><span>${Number(doc.chunk_count)} مقطع</span><span>${Number(doc.character_count).toLocaleString('ar-EG')} حرف</span></div><small>أضيف في ${esc(date)} · ${indexed ? 'مفهرس وقابل للبحث' : 'مؤرشف — غير مستخدم في البحث'}</small></div>
      <div class="knowledge-doc-actions"><a class="tiny outline" href="/api/ai/knowledge/documents/${Number(doc.id)}/download" target="_blank" rel="noopener">فتح الملف</a>${indexed ? `<button class="tiny danger" type="button" data-knowledge-remove-doc="${Number(doc.id)}">إزالة الفهرسة</button>` : '<span class="knowledge-archived-tag">مؤرشف</span>'}</div>
    </article>`;
  }

  function conversationCard(conv) {
    const active = Number(state.currentConversation) === Number(conv.id);
    const date = conv.updated_at ? new Date(String(conv.updated_at).replace(' ', 'T') + 'Z').toLocaleDateString('ar-EG') : '';
    return `<article class="knowledge-conversation-card ${active ? 'active' : ''}"><button type="button" data-knowledge-open-conversation="${Number(conv.id)}"><b>${esc(conv.title || 'محادثة جديدة')}</b><small>${Number(conv.message_count || 0)} رسالة · ${esc(date)}</small></button><button type="button" class="knowledge-delete-conversation" title="حذف المحادثة" data-knowledge-delete-conversation="${Number(conv.id)}">×</button></article>`;
  }

  function citationsHTML(citations = []) {
    if (!citations.length) return '<p class="knowledge-no-citations">لم تُرجع الإجابة إحالات محددة. تعامل معها كإجابة غير موثقة حتى تراجع المستند بنفسك.</p>';
    return `<section class="knowledge-citations"><div class="knowledge-citations-head"><b>المراجع التي استندت إليها الإجابة</b><span>${citations.length} إحالة</span></div>${citations.map((c, i) => {
      const page = c.page_start ? (c.page_start === c.page_end ? `صفحة ${c.page_start}` : `الصفحات ${c.page_start}–${c.page_end}`) : `مقطع ${c.section || i + 1}`;
      return `<details class="knowledge-citation"><summary><span>[${i + 1}]</span> ${esc(c.title || c.file_name)} · ${esc(page)}</summary><p>${esc(c.excerpt || '')}</p><a href="/api/ai/knowledge/documents/${Number(c.document_id)}/download" target="_blank" rel="noopener">فتح المستند الأصلي ↗</a></details>`;
    }).join('')}</section>`;
  }

  function messageHTML(message) {
    const isUser = message.role === 'user';
    const citations = Array.isArray(message.citations) ? message.citations : [];
    return `<article class="knowledge-message ${isUser ? 'user' : 'assistant'}"><div class="knowledge-message-label">${isUser ? 'سؤالك' : 'محرك مكتبة المعرفة'}</div><div class="knowledge-message-body">${esc(message.content || '')}</div>${!isUser ? `${citationsHTML(citations)}${message.persisted === false ? '<p class="knowledge-no-citations">تعذر تأكيد حفظ هذه المحادثة في Google Sheets. انسخ الإجابة أو اطبعها قبل مغادرة الصفحة.</p>' : ''}<div class="knowledge-message-tools"><button class="outline tiny" type="button" data-knowledge-print-message="${Number(message.id || 0)}">طباعة المحادثة PDF</button>${message.follow_up ? `<button class="outline tiny" type="button" data-knowledge-follow="${esc(message.follow_up)}">${esc(message.follow_up)}</button>` : ''}</div>` : ''}</article>`;
  }

  function chatMarkup() {
    const messages = state.messages || [];
    return messages.length ? messages.map(messageHTML).join('') : `<div class="knowledge-welcome"><div class="knowledge-welcome-icon">✦</div><h3>اسأل مستنداتك كما تسأل مساعداً خبيراً</h3><p>ارفع كتاباً أو قانوناً أو لائحة، ثم اكتب سؤالك. ستظهر الإجابة مع اسم الملف ورقم الصفحة أو المقطع الداعم.</p><div class="knowledge-prompt-examples"><button type="button" data-knowledge-prompt="لخّص المستند المحدد في نقاط تنفيذية واضحة.">لخّص المستند</button><button type="button" data-knowledge-prompt="استخرج أهم الشروط والالتزامات والاستثناءات الواردة في المستند.">استخرج الالتزامات</button><button type="button" data-knowledge-prompt="ابحث عن المواد التي تتناول إجراءات التعاقد، واذكر رقم كل مادة وصفحتها.">ابحث عن مادة محددة</button></div></div>`;
  }

  function renderWorkspace() {
    const root = $('#pageContent');
    if (!root || currentPage !== 'ai-knowledge') return;
    const notice = statusNotice();
    const storageNotice = !state.status?.storage_configured ? 'تخزين النسخ الأصلية غير مهيأ. اضبط Google Drive من متغيرات الخادم قبل رفع الملفات.' : '';
    const maxFileMb = Number(state.status?.max_file_mb) || 0;
    
    root.innerHTML = `${head('مكتبة المعرفة والتحليل الذكي', 'ارفع الملفات وابحث في محتواها بخوارزميات برمجية، واستخرج النتائج والمواد والمراجع دون استخدام نموذج لغوي.')}
      <section class="knowledge-hero"><div class="knowledge-hero-copy"><span>ADMIN KNOWLEDGE WORKSPACE</span><h2>مستنداتك تتحول إلى قاعدة معرفة قابلة للبحث</h2><p>ارفع القانون أو الكتاب أو اللائحة، ودع محرك البحث والتحليل يستخرج النصوص المطابقة ويرتبها ويوثق الصفحات والمقاطع. مساحة المعرفة هذه خاصة بالمديرين ولا تظهر للمتدربين أو المحاضرين.</p><div class="knowledge-hero-meta"><span>⚙ محرك برمجي مستقل</span><span>بدون LLM أو مفتاح نموذج</span><span>الحد الحالي: ${maxFileMb || 'غير متاح'} ميجابايت للملف</span></div></div><div class="knowledge-hero-mark">✦</div></section>
      ${notice ? `<div class="knowledge-notice" role="alert">${esc(notice)} <button class="outline tiny" type="button" data-page="ai-settings">فتح إعدادات الذكاء الاصطناعي</button></div>` : ''}
      ${storageNotice ? `<div class="knowledge-notice" role="alert">${esc(storageNotice)}</div>` : ''}
      <div class="knowledge-layout">
        <aside class="knowledge-sidebar">
          <section class="panel knowledge-upload-panel"><div class="knowledge-section-heading"><div><small>المصادر</small><h3>إضافة مستند</h3></div><span>01</span></div>
            <label class="knowledge-dropzone" for="knowledgeFile"><span class="knowledge-upload-icon">＋</span><b>اسحب الملف إلى هنا أو اختره</b><small>PDF · DOCX · TXT · MD</small><small>حتى ${maxFileMb || 0} ميجابايت · PDF حتى 300 صفحة · OCR حتى 120 صفحة · 500 ألف حرف مستخرج</small><input id="knowledgeFile" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"></label>
            <label class="knowledge-ocr-toggle"><input id="knowledgeOcrArabic" type="checkbox" checked> <span>اكتشاف PDF العربي غير المقروء وتشغيل OCR تلقائياً عند الحاجة</span></label>
            <label class="knowledge-title-field">اسم ظاهر للمستند <input id="knowledgeFileTitle" maxlength="180" placeholder="اختياري — سيُستخدم اسم الملف تلقائياً"></label>
            <p id="knowledgeUploadState" class="knowledge-upload-state" role="status">يُستخرج النص ويُفهرس على خادم المنصة. تحفظ الفهرسة في مخزن Central، والنسخة الأصلية في Google Drive.</p>
            <div class="knowledge-upload-progress" id="knowledgeUploadProgress" hidden><span></span></div>
          </section>
          <section class="panel knowledge-documents-panel"><div class="knowledge-section-heading"><div><small>قاعدة المعرفة</small><h3>المستندات المضافة</h3></div><span>${state.documents.length}</span></div><p class="knowledge-side-hint">${selectedLabel()}. اترك كل الصناديق دون تحديد للبحث في المكتبة كلها.</p><div id="knowledgeDocumentsList">${state.documents.map(documentCard).join('') || '<div class="knowledge-empty-small">لا توجد مستندات بعد. ارفع أول ملف لبدء البحث والتحليل.</div>'}</div></section>
          <section class="panel knowledge-history-panel"><div class="knowledge-section-heading"><div><small>سجل العمل</small><h3>محادثاتي</h3></div><button type="button" class="tiny outline" id="knowledgeNewConversation">＋ جديدة</button></div><div id="knowledgeConversationList">${state.conversations.map(conversationCard).join('') || '<div class="knowledge-empty-small">ستظهر محادثاتك السابقة هنا.</div>'}</div></section>
        </aside>
        <section class="knowledge-main panel"><div class="knowledge-main-head"><div><small>DOCUMENT Q&A</small><h3>اسأل الملفات وحلّلها</h3><p>الإجابات مبنية على البحث البرمجي والاستخراج المباشر من نص المستند، مع توثيق مواضع النتائج.</p></div><button class="outline" type="button" id="knowledgePrintAll" ${state.messages.length ? '' : 'disabled'}>طباعة المحادثة PDF</button></div>
          <div class="knowledge-chat-log" id="knowledgeChatLog" aria-live="polite">${chatMarkup()}</div>
          <form id="knowledgeQuestionForm" class="knowledge-composer"><div class="knowledge-compose-top"><label for="knowledgeMode">طريقة العمل</label><select id="knowledgeMode" name="mode"><option value="question">سؤال وجواب</option><option value="analysis">تحليل احترافي</option><option value="summary">ملخص منظم</option><option value="extract">استخراج معلومات</option><option value="compare">مقارنة بين النصوص</option></select><span class="knowledge-scope" id="knowledgeScope">${esc(selectedLabel())}</span></div><textarea id="knowledgeQuestion" name="question" rows="3" maxlength="3000" placeholder="اكتب سؤالك عن الملفات… مثال: ما الشروط والمستندات المطلوبة للتعاقد؟" required></textarea><div class="knowledge-composer-footer"><small>تتم المعالجة داخل خادم المنصة دون إرسال المحتوى إلى نموذج لغوي خارجي ودون مفتاح API.</small><button class="primary" type="submit" id="knowledgeSend" ${notice || !state.documents.length ? 'disabled' : ''}>إرسال السؤال ✦</button></div><p class="error" id="knowledgeChatError" role="alert"></p></form>
        </section>
      </div>
      <div class="knowledge-security-note"><b>الخصوصية والمصادر:</b> هذه المكتبة متاحة لحساب المدير فقط. تُحفظ النصوص المستخرجة كمقاطع في قاعدة بيانات المنصة المتزامنة مع Google Sheets، وتخضع لتشفير التخزين إذا كان مفتاح تشفير Central مفعّلاً. لا ترفع مفاتيح API أو كلمات مرور أو بيانات شخصية غير لازمة.</div>`;
    bindWorkspace();
  }

  async function refreshLists() {
    const [status, documents, conversations] = await Promise.all([
      request('/status'), request('/documents'), request('/conversations')
    ]);
    state.status = status;
    state.documents = documents;
    state.conversations = conversations;
    state.selectedDocuments = state.selectedDocuments.filter(id => state.documents.some(d => Number(d.id) === Number(id) && d.status === 'indexed'));
  }

  async function loadConversation(id) {
    const result = await request(`/conversations/${Number(id)}`);
    state.currentConversation = result.conversation.id;
    state.messages = result.messages || [];
    renderWorkspace();
    const log = $('#knowledgeChatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function createConversation() {
    const result = await request('/conversations', { method: 'POST', body: JSON.stringify({ title: 'محادثة جديدة' }) });
    state.currentConversation = result.id;
    state.messages = [];
    await refreshLists();
    renderWorkspace();
  }

  async function uploadDocument(file) {
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt', 'md'].includes(extension)) throw new Error('الأنواع المدعومة: PDF وDOCX وTXT وMD.');
    const maxMb = Number(state.status?.max_file_mb) || 0;
    if (!maxMb) throw new Error('تخزين الملفات غير مهيأ على الخادم.');
    if (file.size > maxMb * 1024 * 1024) throw new Error(`الحد الأقصى الحالي ${maxMb} ميجابايت. فعّل حساب خدمة Google Drive للملفات الأكبر.`);
    if (!file.size) throw new Error('الملف فارغ.');
    state.uploading = true;
    const input = $('#knowledgeFile'), status = $('#knowledgeUploadState'), progress = $('#knowledgeUploadProgress');
    const button = $('#knowledgeSend');
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    if (progress) progress.hidden = false;
    if (status) status.textContent = 'جارٍ قراءة الملف واستخراج النص وفهرسته… قد يستغرق ذلك وقتاً حسب حجم المستند.';
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('تعذرت قراءة الملف من الجهاز.'));
        reader.readAsDataURL(file);
      });
      const result = await request('/documents', { method: 'POST', body: JSON.stringify({ name: file.name, title: $('#knowledgeFileTitle')?.value.trim() || '', mimeType: file.type || 'application/octet-stream', ocrArabic: !!$('#knowledgeOcrArabic')?.checked, data: dataUrl }) });
      state.documents = await request('/documents');
      state.selectedDocuments = [Number(result.id)];
      if (status) status.textContent = `تمت إضافة «${result.title}» وفهرسته بنجاح: ${Number(result.page_count).toLocaleString('ar-EG')} صفحة، ${Number(result.chunks).toLocaleString('ar-EG')} مقطع، ${Number(result.characters).toLocaleString('ar-EG')} حرف.${result.ocr_used ? ' تمت معالجة الصفحات باستخدام OCR عربي/إنجليزي.' : ''}`;
      if ($('#knowledgeFileTitle')) $('#knowledgeFileTitle').value = '';
      if (input) input.value = '';
      renderWorkspace();
      showMessage('تمت إضافة المستند إلى مكتبة المعرفة الذكية.');
    } finally {
      state.uploading = false;
      if (input) input.disabled = false;
      if (progress) progress.hidden = true;
    }
  }

  async function sendQuestion(form) {
    if (state.busy) return;
    const textarea = form.elements.question, question = textarea.value.trim();
    if (!question) return;
    if (!state.documents.length) throw new Error('أضف مستنداً واحداً على الأقل قبل السؤال.');
    state.busy = true;
    const send = $('#knowledgeSend'), error = $('#knowledgeChatError'), log = $('#knowledgeChatLog');
    if (send) send.disabled = true;
    if (error) error.textContent = '';
    const userMessage = { role: 'user', content: question };
    state.messages.push(userMessage);
    log.innerHTML = chatMarkup() + loading;
    log.scrollTop = log.scrollHeight;
    try {
      if (!state.currentConversation) await createConversation();
      const result = await request('/chat', { method: 'POST', body: JSON.stringify({ conversation_id: state.currentConversation, question, mode: form.elements.mode.value, document_ids: state.selectedDocuments }) });
      state.currentConversation = result.conversation_id;
      state.messages.push({ role: 'assistant', content: result.answer, citations: result.citations || [], follow_up: result.follow_up || '', mode: result.mode, model: result.model, persisted: result.persisted !== false });
      textarea.value = '';
      await refreshLists();
      renderWorkspace();
      const currentLog = $('#knowledgeChatLog'); if (currentLog) { currentLog.scrollTop = currentLog.scrollHeight; }
    } catch (err) {
      const currentError = $('#knowledgeChatError'); if (currentError) currentError.textContent = err.message;
      // Reload from the server so the UI stays consistent if the user message was already persisted.
      const currentLog = $('#knowledgeChatLog');
      if (state.currentConversation) {
        try { const c = await request(`/conversations/${state.currentConversation}`); state.messages = c.messages || []; if (currentLog) currentLog.innerHTML = chatMarkup(); }
        catch { state.messages.pop(); if (currentLog) currentLog.innerHTML = chatMarkup(); }
      } else { state.messages.pop(); if (currentLog) currentLog.innerHTML = chatMarkup(); }
    } finally {
      state.busy = false;
      const currentSend = $('#knowledgeSend'); if (currentSend) currentSend.disabled = !state.documents.length || !!statusNotice();
    }
  }

  function printReport(messages) {
    const rows = (messages || []).filter(m => m.role === 'assistant' || m.role === 'user');
    if (!rows.length) return showMessage('لا توجد إجابات لطباعة تقرير عنها.');
    const body = rows.map((m, i) => {
      const isUser = m.role === 'user';
      const citations = (m.citations || []).map((c, n) => {
        const page = c.page_start ? (c.page_start === c.page_end ? `صفحة ${c.page_start}` : `الصفحات ${c.page_start}–${c.page_end}`) : `مقطع ${c.section || n + 1}`;
        return `<li><b>[${n + 1}] ${esc(c.title || c.file_name)}</b> — ${esc(page)}<p>${esc(c.excerpt || '')}</p></li>`;
      }).join('');
      return `<section class="print-entry ${isUser ? 'print-question' : 'print-answer'}"><h2>${isUser ? 'السؤال' : 'الإجابة والتحليل'} ${i + 1}</h2><div>${esc(m.content || '')}</div>${citations ? `<h3>المصادر والإحالات</h3><ol>${citations}</ol>` : ''}</section>`;
    }).join('');
    const popup = window.open('', '_blank');
    if (!popup) return showMessage('اسمح بفتح النوافذ المنبثقة لطباعة التقرير PDF.');
    popup.opener = null;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير مكتبة المعرفة الذكية</title><style>
      @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#182f2a;line-height:1.9;margin:0}header{border-bottom:3px solid #1b5a48;padding:0 0 16px;margin-bottom:22px}header .eyebrow{font-size:11px;letter-spacing:1px;color:#9b752c;font-weight:bold}h1{font-size:23px;margin:5px 0;color:#174b3d}header p{margin:0;color:#64756e;font-size:12px}.print-entry{padding:17px 0;border-bottom:1px solid #dce5df;break-inside:avoid}.print-entry h2{font-size:17px;color:#1c5947;margin:0 0 10px}.print-question{background:#f5f4ed;padding:14px;margin:15px 0;border-radius:8px}.print-answer>div{white-space:pre-wrap;font-size:14px}.print-entry h3{font-size:13px;margin:14px 0 5px}.print-entry ol{padding-right:22px}.print-entry li{margin:8px 0;font-size:12px}.print-entry li p{margin:3px 0;color:#52645d;white-space:pre-wrap}.foot{margin-top:24px;padding-top:10px;border-top:1px solid #dce5df;color:#75827d;font-size:10px}@media print{button{display:none}}
    </style></head><body><header><span class="eyebrow">CENTRAL TRAINING PLATFORM · KNOWLEDGE AI</span><h1>تقرير مكتبة المعرفة والتحليل الذكي</h1><p>تاريخ الطباعة: ${esc(new Date().toLocaleString('ar-EG'))} · المستخدم: ${esc(me?.display_name || '')}</p></header>${body}<div class="foot">تم إنشاء التقرير من المستندات المفهرسة داخل المنصة. الإحالات تشير إلى الصفحات/المقاطع المسترجعة، ويجب مراجعة النص الأصلي في القرارات الرسمية.</div><script>window.onload=()=>{setTimeout(()=>window.print(),350)};</script></body></html>`);
    popup.document.close();
  }

  function bindWorkspace() {
    const fileInput = $('#knowledgeFile');
    if (fileInput) fileInput.onchange = async e => {
      const file = e.target.files?.[0];
      try { await uploadDocument(file); }
      catch (err) { const status = $('#knowledgeUploadState'); if (status) status.textContent = err.message; if (fileInput) fileInput.value = ''; }
    };
    const dropzone = document.querySelector('.knowledge-dropzone');
    if (dropzone) {
      dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('drag-active'); };
      dropzone.ondragleave = () => dropzone.classList.remove('drag-active');
      dropzone.ondrop = async e => { e.preventDefault(); dropzone.classList.remove('drag-active'); const file = e.dataTransfer?.files?.[0]; try { await uploadDocument(file); } catch (err) { const status = $('#knowledgeUploadState'); if (status) status.textContent = err.message; } };
    }
    const form = $('#knowledgeQuestionForm');
    if (form) form.onsubmit = async e => { e.preventDefault(); try { await sendQuestion(form); } catch (err) { const node = $('#knowledgeChatError'); if (node) node.textContent = err.message; } };
  }

  document.addEventListener('change', e => {
    if (e.target.matches('[data-knowledge-doc]')) {
      const id = Number(e.target.dataset.knowledgeDoc);
      state.selectedDocuments = e.target.checked ? [...new Set([...state.selectedDocuments, id])] : state.selectedDocuments.filter(x => x !== id);
      renderWorkspace();
    }
  });

  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-knowledge-new],[data-knowledge-open-conversation],[data-knowledge-delete-conversation],[data-knowledge-remove-doc],[data-knowledge-follow],[data-knowledge-prompt],[data-knowledge-print-message]');
    if (!button) return;
    try {
      if (button.hasAttribute('data-knowledge-new')) return await createConversation();
      if (button.hasAttribute('data-knowledge-open-conversation')) return await loadConversation(button.dataset.knowledgeOpenConversation);
      if (button.hasAttribute('data-knowledge-delete-conversation')) {
        const id = Number(button.dataset.knowledgeDeleteConversation);
        if (!confirm('حذف هذه المحادثة ورسائلها؟')) return;
        await request(`/conversations/${id}`, { method: 'DELETE' });
        await refreshLists();
        if (Number(state.currentConversation) === id) { state.currentConversation = null; state.messages = []; }
        return renderWorkspace();
      }
      if (button.hasAttribute('data-knowledge-remove-doc')) {
        const id = Number(button.dataset.knowledgeRemoveDoc);
        if (!confirm('إزالة فهرسة هذا المستند من مكتبة المعرفة؟ ستظل النسخة الأصلية محفوظة في مساحة الملفات.')) return;
        await request(`/documents/${id}`, { method: 'DELETE' });
        state.selectedDocuments = state.selectedDocuments.filter(x => x !== id);
        await refreshLists();
        renderWorkspace();
        return showMessage('تمت إزالة فهرسة المستند.');
      }
      if (button.hasAttribute('data-knowledge-follow')) { $('#knowledgeQuestion').value = button.dataset.knowledgeFollow; $('#knowledgeQuestion').focus(); return; }
      if (button.hasAttribute('data-knowledge-prompt')) { $('#knowledgeQuestion').value = button.dataset.knowledgePrompt; $('#knowledgeQuestion').focus(); return; }
      if (button.hasAttribute('data-knowledge-print-message')) return printReport(state.messages);
    } catch (err) { showMessage(err.message); }
  });

  document.addEventListener('click', e => {
    if (e.target.closest('#knowledgePrintAll')) printReport(state.messages);
  });

  window.AIKnowledge = {
    page: async () => {
      if (me?.role !== 'admin') return '<section class="panel"><h2>غير مسموح</h2><p>مكتبة المعرفة متاحة لحساب المدير فقط.</p></section>';
      if (state.owner !== me.id) { state.owner = me.id; state.currentConversation = null; state.messages = []; state.selectedDocuments = []; }
      await refreshLists();
      if (state.currentConversation && !state.messages.length) {
        try { const c = await request(`/conversations/${state.currentConversation}`); state.messages = c.messages || []; } catch { state.currentConversation = null; }
      }
      if (!state.currentConversation && state.conversations.length) {
        const c = await request(`/conversations/${state.conversations[0].id}`);
        state.currentConversation = c.conversation.id;
        state.messages = c.messages || [];
      }
      return `<div class="knowledge-root">${head('مكتبة المعرفة والتحليل الذكي', 'ارفع الملفات وابحث في محتواها بخوارزميات برمجية، واستخرج النتائج والمواد والمراجع دون استخدام نموذج لغوي.')}</div>`;
    },
    bind: () => {
      // Replace the temporary heading with the complete workspace after data has loaded.
      renderWorkspace();
    }
  };
})();
