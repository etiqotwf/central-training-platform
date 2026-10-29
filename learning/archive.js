'use strict';
module.exports=function({app,auth,role,wrap}){
 const ROOT=String(process.env.ARCHIVE_DRIVE_FOLDER_ID||'1BWu9yqqD27CcZtB-iZ3BNKlxp24r6pEH').trim();
 const FOLDER='application/vnd.google-apps.folder';
 let client=null,cache=null,cacheAt=0;
 function drive(){
  if(client)return client;
  const fs=require('fs'),key=process.env.GOOGLE_SERVICE_ACCOUNT_FILE||'/etc/secrets/google-service-account.json';
  if(!fs.existsSync(key))throw Object.assign(Error('ملف حساب Google غير مهيأ على الخادم.'),{status:503});
  const {google}=require('googleapis');
  client=google.drive({version:'v3',auth:new google.auth.GoogleAuth({keyFile:key,scopes:['https://www.googleapis.com/auth/drive.readonly']})});
  return client;
 }
 async function children(parent){
  const out=[];let pageToken;
  do{
   const r=await drive().files.list({q:`'${parent}' in parents and trashed=false`,fields:'nextPageToken,files(id,name,mimeType,webViewLink,createdTime,modifiedTime,size,thumbnailLink,iconLink)',orderBy:'folder,name_natural',pageSize:1000,pageToken,supportsAllDrives:true,includeItemsFromAllDrives:true});
   out.push(...(r.data.files||[]));pageToken=r.data.nextPageToken;
  }while(pageToken);
  return out;
 }
 async function snapshot(force=false){
  if(!force&&cache&&Date.now()-cacheAt<5*60*1000)return cache;
  const rootMeta=(await drive().files.get({fileId:ROOT,fields:'id,name,webViewLink,createdTime,modifiedTime',supportsAllDrives:true})).data;
  const nodes={},all=[];let queue=[{id:ROOT,depth:0}];
  while(queue.length){
   const batch=queue.splice(0,8);
   const lists=await Promise.all(batch.map(x=>children(x.id).then(items=>({parent:x,...x,items}))));
   for(const x of lists){
    nodes[x.id]=x.items.map(f=>({...f,isFolder:f.mimeType===FOLDER,parentId:x.id}));
    for(const f of nodes[x.id]){all.push(f);if(f.isFolder&&x.depth<7)queue.push({id:f.id,depth:x.depth+1})}
   }
   if(all.length>5000)break;
  }
  const folders=all.filter(x=>x.isFolder),files=all.filter(x=>!x.isFolder);
  const byYear={},byMonth={};
  for(const f of folders){const d=new Date(f.createdTime||f.modifiedTime||0);if(!Number.isFinite(d.getTime()))continue;const y=String(d.getFullYear()),m=`${y}-${String(d.getMonth()+1).padStart(2,'0')}`;byYear[y]=(byYear[y]||0)+1;byMonth[m]=(byMonth[m]||0)+1}
  cache={root:rootMeta,rootId:ROOT,nodes,stats:{folders:folders.length,files:files.length,total:all.length,years:Object.entries(byYear).sort((a,b)=>a[0].localeCompare(b[0])).map(([label,count])=>({label,count})),months:Object.entries(byMonth).sort((a,b)=>a[0].localeCompare(b[0])).slice(-24).map(([label,count])=>({label,count})),updatedAt:new Date().toISOString()}};cacheAt=Date.now();return cache;
 }
 app.get('/api/archive',auth,role('admin','trainer'),wrap(async(req,res)=>{res.set('Cache-Control','private, max-age=120');res.json(await snapshot(req.query.refresh==='1'))}));
};
