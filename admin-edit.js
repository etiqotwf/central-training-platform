'use strict';
module.exports=function({app,db,q,one,all,auth,role}){
 if(!all('PRAGMA table_info(courses)').some(c=>c.name==='display_number'))db.exec("ALTER TABLE courses ADD COLUMN display_number TEXT DEFAULT ''");
 const types={courses:{table:'courses',fields:['title','description','trainer_id','starts_on','ends_on','capacity','public_registration_enabled','display_number']},sessions:{table:'sessions',fields:['title','course_id','starts_at','duration','platform','url']},batches:{table:'training_batches',fields:['title','course_id','code','starts_on','ends_on','notes']},activities:{table:'training_activities',fields:['title','description','course_id','due_date','status','external_url','trainee_ids','submission_type']},library:{table:'library_resources',fields:['title','description','kind','course_id']},'training-plans':{table:'training_plans',fields:['title','description','url']},applications:{table:'course_applications',fields:['applicant_name','email','phone','course_id','admin_note']}};
 const reject=m=>{throw Object.assign(Error(m),{status:400})};
 function get(req){const spec=types[req.params.type];if(!spec)throw Object.assign(Error('نوع السجل غير صحيح.'),{status:404});const item=one(`SELECT * FROM ${spec.table} WHERE id=?`,Number(req.params.id));if(!item)throw Object.assign(Error('السجل غير موجود.'),{status:404});return {spec,item}}
 function fail(res,e){res.status(e.status||500).json({error:e.status?e.message:'تعذر حفظ التعديل.'})}
 app.get('/api/admin/edit/:type/:id',auth,role('admin'),(req,res)=>{try{const {item}=get(req);res.json(item)}catch(e){fail(res,e)}});
 app.put('/api/admin/edit/:type/:id',auth,role('admin'),async(req,res)=>{try{
  const {spec,item}=get(req),body=req.body,merged={...item};
  for(const field of spec.fields)if(Object.hasOwn(body,field))merged[field]=body[field];
  if(req.params.type==='applications'&&item.status==='approved')reject('الطلب مقبول بالفعل؛ عدّل بيانات المتدرب من قسم المتدربين.');
  for(const field of spec.fields){
   if(['course_id','trainer_id'].includes(field)){const value=merged[field];merged[field]=value===null||value===''?null:Number(value);if(merged[field]&&(!Number.isInteger(merged[field])||!one(`SELECT id FROM ${field==='course_id'?'courses':'trainers'} WHERE id=?`,merged[field])))reject('اختر دورة أو محاضراً موجوداً.');}
   else if(['capacity','duration'].includes(field)){merged[field]=Number(merged[field]);if(!Number.isInteger(merged[field])||merged[field]<(field==='duration'?1:0)||merged[field]>100000)reject('القيمة العددية غير صحيحة.');}
   else if(field==='public_registration_enabled')merged[field]=[true,1,'1','true'].includes(merged[field])?1:0;
   else if(field!=='trainee_ids'){merged[field]=String(merged[field]??'').trim();if(merged[field].length>20000)reject('أحد الحقول يتجاوز الطول المسموح.');}
  }
  if(spec.fields.includes('title')&&!merged.title)reject('العنوان مطلوب.');
  if(spec.fields.includes('title')&&merged.title.length>180)reject('العنوان يجب ألا يتجاوز 180 حرفاً.');
  for(const field of ['starts_on','ends_on','due_date'])if(spec.fields.includes(field)&&merged[field]&&(!/^\d{4}-\d{2}-\d{2}$/.test(merged[field])||!Number.isFinite(Date.parse(merged[field]+'T00:00:00Z'))))reject('أدخل تاريخاً صحيحاً.');
  if(merged.starts_on&&merged.ends_on&&merged.ends_on<merged.starts_on)reject('تاريخ النهاية يجب ألا يسبق البداية.');
  if(req.params.type==='courses'&&merged.capacity>0&&merged.capacity<one('SELECT COUNT(*) n FROM enrollments WHERE course_id=?',item.id).n)reject('العدد المستهدف أقل من عدد المسجلين الفعلي.');
  if(req.params.type==='sessions'&&(!merged.course_id||!merged.starts_at||!Number.isFinite(Date.parse(merged.starts_at))))reject('اختر الدورة وحدد موعد الجلسة.');
  for(const field of ['url','external_url'])if(spec.fields.includes(field)&&merged[field]&&!/^https?:\/\//i.test(merged[field]))reject('الرابط يجب أن يبدأ بـ https:// أو http://');
  if(req.params.type==='training-plans'&&!merged.url)reject('الرابط مطلوب.');
  if(req.params.type==='applications'&&(!merged.applicant_name||!merged.course_id||!/^\S+@\S+\.\S+$/.test(merged.email)))reject('أكمل الاسم والبريد والدورة.');
  if(req.params.type==='activities'){
   if(!['نشط','مسودة','قيد التنفيذ','مكتمل','مغلق','active','completed','closed'].includes(merged.status))reject('الحالة غير صحيحة.');
   if(['tasks','assignments'].includes(item.kind)){
    if(!merged.course_id)reject('اختر دورة للمهمة.');
    let selected;try{selected=Array.isArray(merged.trainee_ids)?merged.trainee_ids:JSON.parse(merged.trainee_ids||'[]')}catch{reject('قائمة المتدربين غير صحيحة.');}
    if(!Array.isArray(selected))reject('قائمة المتدربين غير صحيحة.');
    selected=[...new Set(selected.map(Number))];for(const id of selected)if(!one('SELECT id FROM enrollments WHERE course_id=? AND trainee_id=?',merged.course_id,id))reject('المستهدفون يجب أن يكونوا مسجلين في الدورة المحددة.');
    merged.trainee_ids=JSON.stringify(selected);
    if(!['ملف مرفق','نص داخل المنصة','ملف أو نص'].includes(merged.submission_type))reject('نوع التسليم غير صحيح.');
   }else merged.trainee_ids=typeof merged.trainee_ids==='string'?merged.trainee_ids:'[]';
  }
  const fields=[...spec.fields];
  if(req.params.type==='activities'&&(body.file||body.remove_file||body.use_icdl)){
   if(!['tasks','assignments'].includes(item.kind))reject('رفع المرفق متاح للمهام والواجبات.');
   let file=body.file;if(body.use_icdl)file={name:'ICDL_Session_1_Study_Notes_and_Practice_Worksheet.docx',data:require('fs').readFileSync(require('path').join(__dirname,'assets','ICDL_Session_1_Study_Notes_and_Practice_Worksheet.docx')).toString('base64')};
   merged.file_id=file?await app.locals.saveActivityFile(file):null;fields.push('file_id');
  }
  q(`UPDATE ${spec.table} SET ${fields.map(f=>f+'=?').join(',')} WHERE id=?`,...fields.map(f=>merged[f]),item.id);
  res.json({ok:true,message:'تم حفظ التعديلات بنجاح.'});
 }catch(e){fail(res,e)}});
};
