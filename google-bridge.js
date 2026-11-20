'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
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
// Resumable Drive upload: transfer the file in 8 MiB chunks, matching the British project.
async function uploadFile(filePath,name,mime,size){
 const session=await call('platformCreateUploadSession',{name,mime:mime||'application/octet-stream',size:Number(size)});
 const uploadUrl=String(session.uploadUrl||'');let parsed;
 try{parsed=new URL(uploadUrl)}catch{throw Error('لم يرجع Google Drive رابط جلسة رفع صالحًا.')}
 if(parsed.protocol!=='https:'||!/(^|\.)googleapis\.com$/.test(parsed.hostname))throw Error('رابط جلسة Google Drive غير موثوق أو غير صالح.');
 const chunkSize=8*1024*1024,handle=await fs.open(filePath,'r');
 try{let offset=0;while(offset<size){const length=Math.min(chunkSize,size-offset),buffer=Buffer.allocUnsafe(length);
  const {bytesRead}=await handle.read(buffer,0,length,offset);if(bytesRead!==length)throw Error('تعذرت قراءة جزء من الملف أثناء الرفع.');
  const end=offset+length-1;const response=await fetch(uploadUrl,{method:'PUT',headers:{'Content-Type':mime||'application/octet-stream','Content-Length':String(length),'Content-Range':`bytes ${offset}-${end}/${size}`},body:buffer,signal:AbortSignal.timeout(180000)});
  if(response.status===308){offset+=length;continue;}
  if(response.status===200||response.status===201){let file;try{file=await response.json()}catch{throw Error('استجابة إتمام رفع Google Drive غير صالحة.')}if(!file.id)throw Error('اكتمل رد Google Drive بدون معرّف الملف.');return {id:file.id,url:file.webViewLink||`https://drive.google.com/file/d/${file.id}/view`};}
  const detail=(await response.text().catch(()=>'' )).slice(0,700);throw Error(`فشل رفع Google Drive (HTTP ${response.status}): ${detail||'unknown error'}`);
 }throw Error('انتهى الرفع دون تأكيد من Google Drive.');}finally{await handle.close();}
}
async function download(id){const r=await call('platformDownload',{id});return {bytes:Buffer.from(r.base64,'base64'),mime:r.mime,name:r.name}}
module.exports={configured,call,upload,uploadFile,download};
