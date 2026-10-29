'use strict';
// Platform-wide authenticated question and reply feed. All bytes remain behind session auth.
module.exports=function({app,db,q,one,all,auth,role}){
 db.exec(`CREATE TABLE IF NOT EXISTS platform_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 parent_id INTEGER REFERENCES platform_messages(id) ON DELETE SET NULL,
 body TEXT NOT NULL,
 client_nonce TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at TEXT,
 deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(author_id,client_nonce));
 CREATE INDEX IF NOT EXISTS idx_platform_messages_parent ON platform_messages(parent_id,id);
 CREATE TABLE IF NOT EXISTS platform_chat_reads (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 last_message_id INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
 if(!all('PRAGMA table_info(platform_messages)').some(c=>c.name==='cleared_at'))db.exec('ALTER TABLE platform_messages ADD COLUMN cleared_at TEXT');
 const clients=new Set();
 function broadcast(userId=null,data={}){for(const client of clients)if(!userId||client.userId===userId){if(!client.res.destroyed)client.res.write('event: change\ndata: '+JSON.stringify(data)+'\n\n')}}
 const maxId=()=>one('SELECT COALESCE(MAX(id),0) id FROM platform_messages').id;
 function unread(userId){const r=one('SELECT last_message_id FROM platform_chat_reads WHERE user_id=?',userId);return one('SELECT COUNT(*) n FROM platform_messages WHERE id>? AND (author_id IS NULL OR author_id<>?) AND deleted_at IS NULL',r?.last_message_id||0,userId).n}
 function view(row){if(!row)return null;return {...row,body:row.deleted_at?'':row.body,parent_body:row.parent_deleted_at?'':row.parent_body,client_nonce:undefined}}
 app.get('/api/chat/summary',auth,(req,res)=>{res.set('Cache-Control','no-store');res.json({unread:unread(req.session.user.id),latest_id:maxId()})});
 app.get('/api/chat/messages',auth,(req,res)=>{
  const before=Number(req.query.before)||0;if(before<0||!Number.isSafeInteger(before))return res.status(400).json({error:'مؤشر الرسائل غير صحيح.'});
  const rows=all(`SELECT m.id,m.author_id,m.parent_id,m.body,m.created_at,m.deleted_at,
  COALESCE(u.display_name,'حساب سابق') author_name,COALESCE(u.role,'trainee') author_role,
  p.body parent_body,p.deleted_at parent_deleted_at,COALESCE(pu.display_name,'حساب سابق') parent_author
  FROM platform_messages m LEFT JOIN users u ON u.id=m.author_id
  LEFT JOIN platform_messages p ON p.id=m.parent_id LEFT JOIN users pu ON pu.id=p.author_id
  WHERE m.cleared_at IS NULL AND (?=0 OR m.id<?) ORDER BY m.id DESC LIMIT 61`,before,before);
  const hasMore=rows.length>60;res.set('Cache-Control','no-store');res.json({messages:rows.slice(0,60).reverse().map(view),has_more:hasMore,latest_id:maxId(),unread:unread(req.session.user.id)});
 });
 app.post('/api/chat/messages',auth,(req,res)=>{
  const body=String(req.body.body||'').trim(),nonce=String(req.body.client_nonce||''),parent=req.body.parent_id?Number(req.body.parent_id):null,u=req.session.user;
  if(!body||body.length>2000)return res.status(400).json({error:'اكتب رسالة من حرف واحد إلى 2000 حرف.'});
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(nonce))return res.status(400).json({error:'معرف الإرسال غير صحيح. أعد فتح الشات.'});
  const prior=one('SELECT id FROM platform_messages WHERE author_id=? AND client_nonce=?',u.id,nonce);if(prior)return res.json({ok:true,id:prior.id});
  if(parent&&(!Number.isSafeInteger(parent)||!one('SELECT id FROM platform_messages WHERE id=? AND deleted_at IS NULL',parent)))return res.status(400).json({error:'الرسالة المطلوب الرد عليها حُذفت أو لم تعد موجودة.'});
  try{const r=q('INSERT INTO platform_messages(author_id,parent_id,body,client_nonce) VALUES(?,?,?,?)',u.id,parent,body,nonce);broadcast();res.status(201).json({ok:true,id:r.lastInsertRowid})}catch(e){console.error('Chat save failed:',e.message);res.status(500).json({error:'تعذر حفظ الرسالة. يمكنك إعادة المحاولة.'})}
 });
 app.post('/api/chat/read',auth,(req,res)=>{
  const through=Number(req.body.through_id);if(!Number.isSafeInteger(through)||through<0)return res.status(400).json({error:'مؤشر القراءة غير صحيح.'});
  const id=Math.min(through,maxId()),u=req.session.user.id,prior=one('SELECT last_message_id FROM platform_chat_reads WHERE user_id=?',u);
  if(id>(prior?.last_message_id||0)){q(`INSERT INTO platform_chat_reads(user_id,last_message_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_message_id=MAX(last_message_id,excluded.last_message_id),updated_at=CURRENT_TIMESTAMP`,u,id);broadcast(u)}
  res.json({ok:true,unread:unread(u)});
 });
 app.post('/api/chat/clear',auth,role('admin'),(req,res)=>{
  const through=Number(req.body.through_id);
  if(req.body.confirmation!=='CLEAR_CHAT'||!Number.isSafeInteger(through)||through<0)return res.status(400).json({error:'يلزم تأكيد مسح المحادثات.'});
  const cutoff=Math.min(through,maxId());
  const result=q("UPDATE platform_messages SET body='',deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),deleted_by=?,cleared_at=CURRENT_TIMESTAMP WHERE id<=? AND cleared_at IS NULL",req.session.user.id,cutoff);
  broadcast(null,{cleared_through:cutoff});res.json({ok:true,cleared:result.changes,through_id:cutoff});
 });
 app.delete('/api/chat/messages/:id',auth,role('admin'),(req,res)=>{
  const id=Number(req.params.id),m=one('SELECT id,deleted_at FROM platform_messages WHERE id=?',id);if(!m)return res.status(404).json({error:'الرسالة غير موجودة.'});
  if(!m.deleted_at){q("UPDATE platform_messages SET body='',deleted_at=CURRENT_TIMESTAMP,deleted_by=? WHERE id=?",req.session.user.id,id);broadcast(null,{deleted_id:id})}
  res.json({ok:true});
 });
 app.get('/api/chat/events',auth,(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.write('retry: 3000\nevent: ready\ndata: {}\n\n');
  const client={res,userId:req.session.user.id};clients.add(client);const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n')},20000);heartbeat.unref?.();
  req.on('close',()=>{clearInterval(heartbeat);clients.delete(client)});
 });
};
