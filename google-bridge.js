'use strict';
const crypto=require('node:crypto');
function configured(){return Boolean(process.env.PLATFORM_SCRIPT_URL&&process.env.PLATFORM_BRIDGE_SECRET)}
async function call(action,data={},requestId=crypto.randomUUID()){
 if(!configured())throw Error('أضف PLATFORM_SCRIPT_URL وPLATFORM_BRIDGE_SECRET في إعدادات الاستضافة ثم أعد النشر.');
 const url=process.env.PLATFORM_SCRIPT_URL;
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw Error('PLATFORM_SCRIPT_URL يجب أن يكون رابط نشر Apps Script وينتهي بـ /exec.');
 const payload=JSON.stringify({action,...data,requestId,timestamp:Date.now()});
 const signature=crypto.createHmac('sha256',process.env.PLATFORM_BRIDGE_SECRET).update(payload).digest('base64');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),redirect:'follow',signal:AbortSignal.timeout(90000)});
 let result;try{result=await r.json()}catch{throw Error('استجابة Apps Script غير صحيحة. انشر تطبيق ويب ينفذ باسمك ومتاحاً لوصول الخادم، واستخدم رابط /exec.');}
 if(!r.ok||!result.success)throw Error(result.error||'فشلت عملية Google.');return result;
}
async function upload(name,mime,base64){const r=await call('platformUpload',{name,mime,base64});return {id:r.id,url:r.url}}
async function download(id){const r=await call('platformDownload',{id});return {bytes:Buffer.from(r.base64,'base64'),mime:r.mime,name:r.name}}
module.exports={configured,call,upload,download};
