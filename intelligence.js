'use strict';
module.exports=function({app,db,q,one,all,auth}){
 db.exec(`CREATE TABLE IF NOT EXISTS intelligence_feedback(
   id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,page TEXT NOT NULL,action TEXT NOT NULL,reward REAL NOT NULL,
   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`);
 const n=(sql,...p)=>Number(one(sql,...p)?.n||0);
 const safe=(fn,fallback=0)=>{try{return fn()}catch{return fallback}};
 const labels={dashboard:'الرئيسية',courses:'الدورات',trainees:'المتدربون',trainers:'المدربون',attendance:'الحضور',applications:'طلبات الالتحاق',tasks:'المهام',assignments:'الواجبات',tests:'الاختبارات',sessions:'الجلسات','learning-progress':'الإنجاز','sheet-exams':'الأرشيف','sheet-evaluations':'قواعد البيانات','course-gallery':'معرض الدورات',library:'المكتبة','training-plan':'الخطة التدريبية',reports:'التقارير',payments:'الدفعات',programs:'البرامج','my-programs':'برامجي',notifications:'الإشعارات'};
 function facts(page){
  const common={courses:safe(()=>n('SELECT count(*) n FROM courses')),trainees:safe(()=>n('SELECT count(*) n FROM trainees')),trainers:safe(()=>n('SELECT count(*) n FROM trainers'))};
  const f={...common};
  if(['dashboard','attendance','courses','trainees'].includes(page)){f.enrollments=safe(()=>n('SELECT count(*) n FROM enrollments'));f.attendance=safe(()=>n('SELECT count(*) n FROM attendance'))}
  if(['dashboard','applications'].includes(page))f.pending_applications=safe(()=>n("SELECT count(*) n FROM course_applications WHERE lower(status) IN ('pending','new','قيد المراجعة','جديد')"));
  if(['tasks','assignments','tests','dashboard'].includes(page))f.activities=safe(()=>n('SELECT count(*) n FROM training_activities'));
  if(['tests','learning-progress'].includes(page))f.attempts=safe(()=>n('SELECT count(*) n FROM assessment_attempts'));
  if(['sheet-evaluations','sheet-exams'].includes(page))f.data_sources=safe(()=>n('SELECT count(*) n FROM external_sheet_sources'));
  if(page==='library')f.resources=safe(()=>n('SELECT count(*) n FROM library_resources'));
  if(['learning-path','learning-lab','dashboard'].includes(page)){f.adaptive_completed=safe(()=>n("SELECT count(*) n FROM adaptive_sessions WHERE stage='complete'"));f.reward_samples=safe(()=>n("SELECT count(*) n FROM adaptive_sessions WHERE stage='complete' AND reward_eligible=1"));}
  return f;
 }
 const strategies={
  risk:{title:'كشف الاستثناءات والمخاطر',icon:'⚠',text:'ابدأ بالحالات غير المكتملة أو المتأخرة قبل مراجعة السجلات الطبيعية.'},
  quality:{title:'جودة البيانات والنتائج',icon:'◎',text:'راجع الاكتمال والتوزيعات والقيم الشاذة قبل اتخاذ قرار إداري.'},
  action:{title:'الإجراء التالي الأفضل',icon:'➜',text:'حوّل القراءة إلى إجراء محدد قابل للقياس ثم راقب نتيجته.'}
 };
 function choose(page,f){
  const rows=all('SELECT action,avg(reward) score,count(*) n FROM intelligence_feedback WHERE page=? GROUP BY action',page),scores=Object.fromEntries(rows.map(r=>[r.action,{score:Number(r.score),n:Number(r.n)}]));
  const total=rows.reduce((a,r)=>a+Number(r.n),0);let action='action',reason='قواعد تشغيلية قابلة للتفسير';
  if((f.pending_applications||0)>0)action='risk';else if(page==='sheet-evaluations'||page==='sheet-exams')action='quality';else if(['attendance','learning-progress','tests'].includes(page))action='risk';
  if(total>=10){const ranked=Object.keys(strategies).map(k=>({k,score:scores[k]?.score??0,n:scores[k]?.n||0})).sort((a,b)=>b.score-a.score||b.n-a.n);if(ranked[0]){action=ranked[0].k;reason='Contextual bandit مبسط تعلم من تقييمات الاستخدام لهذه القائمة'}}
  return {action,reason,samples:total,...strategies[action]};
 }
 function recommendations(page,f){const out=[];
  if(f.pending_applications>0)out.push(`يوجد ${f.pending_applications} طلب التحاق يحتاج مراجعة؛ ابدأ بالأقدم أو غير المكتمل.`);
  if(page==='attendance')out.push(f.enrollments?`قارن الحضور بعدد التسجيلات (${f.enrollments}) وحدد الغياب المتكرر قبل التواصل.`:'ابدأ بتجميع سجل حضور كافٍ قبل الاستنتاج.');
  if(page==='trainees')out.push(`استخدم سجل الدورات والاختبارات والحضور لتكوين صورة أداء لكل متدرب، وليس درجة منفردة.`);
  if(page==='trainers')out.push('قارن عبء التدريب، نتائج المتدربين، وتقييمات البرامج معاً قبل تقييم أداء المدرب.');
  if(page==='courses')out.push(`لديك ${f.courses} دورة؛ راقب التسجيل والحضور والاختبارات والتقييمات لكل دورة كمسار واحد.`);
  if(['tasks','assignments'].includes(page))out.push('رتّب الأولوية حسب موعد الاستحقاق، نسبة التسليم، والحالات التي تحتاج مراجعة بشرية.');
  if(page==='tests'||page==='learning-progress')out.push(`نتائج المحاولات المسجلة: ${f.attempts||0}. استخدم التحسن عبر الزمن وتوزيع الأخطاء، لا المتوسط وحده.`);
  if(page==='sheet-evaluations')out.push('اختر مؤشرات المقارنة بنفسك من الرسم؛ افحص الاكتمال والتوزيع قبل تفسير الفروق.');
  if(page==='sheet-exams')out.push('إحصاءات الأرشيف تحسب مجلدات الدورات في المستوى الأول فقط؛ المجلدات الأعمق للتصفح ولا تدخل المقارنة.');
  if(page==='course-gallery')out.push('استخدم التصنيف والعناوين المستخرجة لتجميع الدورات، مع إبقاء المنشور والصورة الأصلية كدليل مرجعي.');
  if(page==='library')out.push(`المكتبة تحتوي ${f.resources||0} مرجعاً؛ اربط المراجع بالدورات لتقوية الاسترجاع الموجّه RAG.`);
  if(page==='dashboard')out.push('استخدم اللوحة كإنذار مبكر: طلبات معلقة، نقص حضور، نشاط تدريبي، ثم انتقل للقائمة التي تحتاج إجراء.');
  if(!out.length)out.push('حلّل الحالات غير الطبيعية أولاً، ثم اختر إجراءً قابلاً للقياس وسجّل النتيجة لتحسين التوصيات القادمة.');
  return out.slice(0,3)}
 app.get('/api/intelligence/page/:page',auth,(req,res)=>{const page=String(req.params.page||'dashboard').slice(0,60),f=facts(page),decision=choose(page,f);res.json({page,label:labels[page]||page,facts:f,decision,recommendations:recommendations(page,f),engines:{heuristic:{active:true,role:'تنبيهات وتشخيص تشغيلي فوري'},bandit:{active:true,mode:decision.samples>=10?'learned':'warmup',samples:decision.samples,role:'يتعلم من تقييم مفيد/غير مفيد لاختيار نمط التوصية'},adaptive_rl:{active:true,role:'Contextual Bandit داخل مسار التعلم التكيفي'},dqn:{active:true,mode:'shadow_only',role:'Double-DQN تجريبي Offline؛ لا يتحكم في المتدربين قبل التحقق'}}});});
 app.post('/api/intelligence/feedback',auth,(req,res)=>{const page=String(req.body.page||'').slice(0,60),action=String(req.body.action||'').slice(0,30),reward=Number(req.body.reward);if(!page||!strategies[action]||![-1,1].includes(reward))return res.status(400).json({error:'تقييم غير صحيح.'});q('INSERT INTO intelligence_feedback(user_id,page,action,reward) VALUES(?,?,?,?)',req.session.user.id,page,action,reward);res.json({ok:true});});
};
