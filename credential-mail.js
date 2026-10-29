'use strict';
const crypto=require('crypto'),bridge=require('./google-bridge');
module.exports=function({app,db,q,one,all,auth,role}){
 const cols=all('PRAGMA table_info(trainees)').map(c=>c.name);
 for(const n of ['credential_email_status','credential_email_error','credential_email_sent_at','credential_email_fingerprint'])if(!cols.includes(n))db.exec(`ALTER TABLE trainees ADD COLUMN ${n} TEXT DEFAULT ''`);
 const active=new Map();
 async function deliver(id,{force=false}={}){
  if(active.has(id))return active.get(id);
  const work=(async()=>{
   const t=one('SELECT t.*,u.username,u.password_display FROM trainees t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=?',id);
   if(!t)return {email_sent:false,email_status:'missing',message:'المتدرب غير موجود.'};
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify([t.email,t.username,t.password_display])).digest('hex');
   if(!force&&t.credential_email_status==='sent'&&t.credential_email_fingerprint===fingerprint)return {email_sent:true,email_status:'sent',message:'بيانات الدخول أُرسلت إلى البريد الإلكتروني.'};
   try{
    if(!t.email||!t.username||!t.password_display)throw Error('يلزم بريد صحيح وحساب دخول وكلمة مرور محفوظة لإرسال البيانات.');
    if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(t.email))throw Error('البريد الإلكتروني غير صحيح.');
    await bridge.call('platformCredentials',{email:t.email,name:t.name,username:t.username,password:t.password_display,loginUrl:process.env.PLATFORM_PUBLIC_URL||''},force?crypto.randomUUID():`mail_${id}_${fingerprint}`);
    q("UPDATE trainees SET credential_email_status='sent',credential_email_error='',credential_email_sent_at=CURRENT_TIMESTAMP,credential_email_fingerprint=? WHERE id=?",fingerprint,id);
    return {email_sent:true,email_status:'sent',message:'تم إرسال بيانات الدخول إلى بريد المتدرب.'};
   }catch(e){const message=String(e.message).slice(0,500);q("UPDATE trainees SET credential_email_status='failed',credential_email_error=? WHERE id=?",message,id);return {email_sent:false,email_status:'failed',message:'تم حفظ الحساب، لكن لم يُرسل البريد: '+message}}
  })();active.set(id,work);try{return await work}finally{active.delete(id)}
 }
 app.post('/api/trainees/:id/send-credentials',auth,role('admin'),async(req,res)=>{const id=Number(req.params.id);if(!one('SELECT id FROM trainees WHERE id=?',id))return res.status(404).json({error:'المتدرب غير موجود.'});res.json(await deliver(id,{force:true}))});
 app.get('/api/admin/google-status',auth,role('admin'),async(req,res)=>{try{res.json(await bridge.call('platformHealth'))}catch(e){res.status(503).json({error:e.message})}});
 return {deliver};
};
