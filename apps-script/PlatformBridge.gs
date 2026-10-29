// Deploy this as a NEW standalone Apps Script project. Execute as Me; access Anyone.
// Script Properties: PLATFORM_BRIDGE_SECRET (same as the server, >= 32 characters).
// Optional Script Property: PLATFORM_FOLDER_ID. Default is the user's platform folder.
function doPost(e) { return platformBridge_(e); }
function doGet() { return platformJson_({success:true,message:'Platform bridge ready'}); }
function platformJson_(v) { return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON); }
function platformAuthorize() {
  DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PLATFORM_FOLDER_ID') || '13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u').getName();
  MailApp.getRemainingDailyQuota();
}
function platformBridge_(e) {
  var lock;
  try {
    var envelope=JSON.parse(e.postData.contents||'{}');
    var props=PropertiesService.getScriptProperties();
    var secret=props.getProperty('PLATFORM_BRIDGE_SECRET');
    if(!secret||secret.length<32)throw new Error('Set PLATFORM_BRIDGE_SECRET with at least 32 characters in Script Properties.');
    if(typeof envelope.payload!=='string'||envelope.payload.length>12000000)throw new Error('Invalid request.');
    var expected=Utilities.base64Encode(Utilities.computeHmacSha256Signature(envelope.payload,secret,Utilities.Charset.UTF_8));
    var actual=String(envelope.signature||''),different=actual.length^expected.length;
    for(var i=0;i<expected.length;i++)different|=expected.charCodeAt(i)^(actual.charCodeAt(i)||0);
    if(different)throw new Error('Invalid signature.');
    var p=JSON.parse(envelope.payload);
    if(!p.requestId||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.requestId)||Math.abs(Date.now()-Number(p.timestamp))>300000)throw new Error('Expired or invalid request.');
    var folder=DriveApp.getFolderById(props.getProperty('PLATFORM_FOLDER_ID')||'13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u');
    if(p.action==='platformHealth')return platformJson_({success:true,folder:folder.getName(),remainingMailQuota:MailApp.getRemainingDailyQuota()});
    if(p.action==='platformDownload') {
      var f=DriveApp.getFileById(String(p.id)),parents=f.getParents(),inside=false;
      while(parents.hasNext())if(parents.next().getId()===folder.getId())inside=true;
      if(!inside)throw new Error('File is outside the platform folder.');
      if(f.getSize()>8388608)throw new Error('File exceeds 8 MB.');
      return platformJson_({success:true,name:f.getName(),mime:f.getMimeType(),base64:Utilities.base64Encode(f.getBlob().getBytes())});
    }
    if(['platformUpload','platformCredentials'].indexOf(p.action)<0)throw new Error('Unknown action.');
    lock=LockService.getScriptLock();lock.waitLock(30000);
    var cache=CacheService.getScriptCache(),key='platform:'+p.requestId,prior=cache.get(key);
    if(prior)return platformJson_(JSON.parse(prior));
    var result;
    if(p.action==='platformUpload') {
      var name=String(p.name||'file').replace(/[\\/:*?"<>|]/g,'_').slice(0,180);
      if(!/\.(docx?|xlsx?|pptx?|pdf|txt|png|jpe?g|zip)$/i.test(name))throw new Error('Unsupported file type.');
      var bytes=Utilities.base64Decode(String(p.base64||''));
      if(!bytes.length||bytes.length>8388608)throw new Error('Maximum file size is 8 MB.');
      var file=folder.createFile(Utilities.newBlob(bytes,String(p.mime||'application/octet-stream'),name));
      result={success:true,id:file.getId(),url:file.getUrl()};
    } else {
      var email=String(p.email||'').trim();
      if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)||!p.username||!p.password)throw new Error('Invalid recipient or credentials.');
      if(MailApp.getRemainingDailyQuota()<1)throw new Error('Daily email quota exhausted. Try again later.');
      var link=String(p.loginUrl||'');
      if(!/^https?:\/\//.test(link))throw new Error('Set PLATFORM_PUBLIC_URL to the platform login URL.');
      MailApp.sendEmail({to:email,subject:'بيانات الدخول إلى منصة الإدارة المركزية للتدريب',name:'الإدارة المركزية للتدريب',body:'مرحباً '+String(p.name||'')+'\n\nتم تجهيز حسابك على منصة التدريب.\nرابط الدخول: '+link+'\nاسم المستخدم: '+p.username+'\nكلمة المرور: '+p.password+'\n\nاحتفظ ببياناتك ولا تشاركها مع الآخرين.\nإدارة الإدارة المركزية للتدريب'});
      result={success:true,sent:true};
    }
    cache.put(key,JSON.stringify(result),21600);
    return platformJson_(result);
  } catch(error) { return platformJson_({success:false,error:String(error.message||error)}); }
  finally { if(lock&&lock.hasLock())lock.releaseLock(); }
}
