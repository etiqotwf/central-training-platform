'use strict';
const crypto=require('node:crypto');
function archiveConfig(){
 const hasDedicated=Boolean(process.env.ARCHIVE_SCRIPT_URL||process.env.ARCHIVE_BRIDGE_SECRET);
 return hasDedicated
  ? {url:String(process.env.ARCHIVE_SCRIPT_URL||'').trim(),secret:String(process.env.ARCHIVE_BRIDGE_SECRET||'')}
  : {url:String(process.env.PLATFORM_SCRIPT_URL||'').trim(),secret:String(process.env.PLATFORM_BRIDGE_SECRET||'')};
}
function configured(){const c=archiveConfig();return Boolean(c.url&&c.secret)}
async function call(action,data={},requestId=crypto.randomUUID()){
 const config=archiveConfig();
 if(!config.url||!config.secret)throw Error('أضف ARCHIVE_SCRIPT_URL وARCHIVE_BRIDGE_SECRET في إعدادات Render لربط أرشيف المنصة.');
 const url=config.url;
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw Error('ARCHIVE_SCRIPT_URL يجب أن يكون رابط نشر Apps Script وينتهي بـ /exec.');
 const payload=JSON.stringify({action,...data,requestId,timestamp:Date.now()});
 const signature=crypto.createHmac('sha256',config.secret).update(payload).digest('base64');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),redirect:'follow',signal:AbortSignal.timeout(90000)});
 let result;try{result=await r.json()}catch{throw Error('استجابة Apps Script غير صحيحة. انشر تطبيق ويب ينفذ باسمك ومتاحاً لوصول الخادم، واستخدم رابط /exec.');}
 if(!r.ok||!result.success)throw Error(result.error||'فشلت عملية Google.');return result;
}
async function upload(name,mime,base64){const r=await call('platformUpload',{name,mime,base64});return {id:r.id,url:r.url}}
async function download(id){const r=await call('platformDownload',{id});return {bytes:Buffer.from(r.base64,'base64'),mime:r.mime,name:r.name}}
module.exports={configured,call,upload,download};
