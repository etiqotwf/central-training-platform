// Run with Node 22.13+; built-in SQLite avoids native addon requirements in this test.
const {DatabaseSync}=require('node:sqlite');
const Module=require('module'),original=Module._load;
Module._load=function(n,...args){if(n==='better-sqlite3')return class{constructor(){this.db=new DatabaseSync(':memory:')}pragma(s){this.db.exec('PRAGMA '+s)}exec(s){return this.db.exec(s)}prepare(s){return this.db.prepare(s)}};return original.call(this,n,...args)};
const db=require('../db');Module._load=original;
const express=require('express'),assert=require('node:assert/strict');
const q=(s,...a)=>db.prepare(s).run(...a),one=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a);
const app=express();app.use(express.json({limit:'12mb'}));app.use((req,res,next)=>{const id=Number(req.headers['x-test-user']||1);req.session={user:one('SELECT * FROM users WHERE id=?',id)};next()});
const auth=(req,res,next)=>req.session.user?next():res.sendStatus(401),role=(...roles)=>(req,res,next)=>roles.includes(req.session.user.role)?next():res.sendStatus(403);
require('../activity-workflow')({app,db,q,one,all,auth,role,uploadApplicationAttachment:async()=>{throw Error('Unexpected Drive call')}});
for(const [id,r] of [[1,'admin'],[2,'trainee'],[3,'trainee'],[4,'trainer']])q('INSERT INTO users(id,username,password_hash,role,display_name) VALUES(?,?,?,?,?)',id,'u'+id,'hash',r,'User '+id);
q("INSERT INTO trainees(id,name,user_id) VALUES(1,'Student A',2),(2,'Student B',3)");q("INSERT INTO trainers(id,name,user_id) VALUES(1,'Trainer',4)");q("INSERT INTO courses(id,title,trainer_id) VALUES(1,'ICDL',1),(2,'Other',NULL)");q('INSERT INTO enrollments(course_id,trainee_id) VALUES(1,1),(1,2)');
const server=app.listen(0,'127.0.0.1',async()=>{const base='http://127.0.0.1:'+server.address().port;async function call(url,user=1,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-test-user':String(user)},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data}}
try{
 let r=await call('/api/work/activities/tasks',1,{title:'ICDL Session 1',course_id:1,status:'نشط',trainee_ids:[1],use_icdl:true});assert.equal(r.status,201);const id=r.data.id;
 r=await call('/api/work/activities/tasks',2);assert.equal(r.data.length,1);assert.match(r.data[0].file_name,/docx$/);const file=r.data[0].file_id;
 assert.equal((await call('/api/work/activities/tasks',3)).data.length,0);
 assert.equal((await call(`/api/work/${id}/file/${file}`,3)).status,403);
 assert.equal((await call(`/api/work/${id}/file/${file}`,2)).status,200);
 assert.equal((await call(`/api/work/${id}/submit`,2,{})).status,400);
 r=await call(`/api/work/${id}/submit`,2,{answer:'1. B\n2. C',file:{name:'answer.txt',data:Buffer.from('My answer').toString('base64')}});assert.equal(r.status,201);const sid=r.data.id;
 r=await call(`/api/work/${id}/submissions`);assert.equal(r.data[0].answer,'1. B\n2. C');const answerFile=r.data[0].file_id;
 assert.equal((await call(`/api/work/${id}/file/${answerFile}`,3)).status,403);
 assert.equal((await call(`/api/work/${id}/review/${sid}`,1,{grade:101})).status,400);
 assert.equal((await call(`/api/work/${id}/review/${sid}`,4,{grade:90,feedback:'Excellent'})).status,200);
 r=await call('/api/work/activities/tasks',2);assert.equal(r.data[0].my_submission.grade,90);
 assert.equal((await call(`/api/work/${id}/submit`,3,{answer:'No access'})).status,403);
 q("UPDATE training_activities SET status='مغلق' WHERE id=?",id);assert.equal((await call(`/api/work/${id}/submit`,2,{answer:'Closed'})).status,400);
 q("UPDATE training_activities SET status='نشط',due_date='2000-01-01' WHERE id=?",id);assert.equal((await call(`/api/work/${id}/submit`,2,{answer:'Late'})).status,400);
 q("UPDATE training_activities SET status='مسودة' WHERE id=?",id);assert.equal((await call('/api/work/activities/tasks',2)).data.length,0);
 assert.equal((await call('/api/work/activities/tasks',1,{title:'Everyone',course_id:1,status:'نشط'})).status,201);assert.equal((await call('/api/work/activities/tasks',3)).data.length,1);
 assert.equal((await call('/api/work/activities/tasks',2,{title:'Unauthorized',course_id:1,status:'نشط'})).status,403);
 console.log('PASS: attachments, targeting, submissions, history, review, grades, permissions, drafts, deadlines and course-wide publication');
}catch(e){console.error(e);process.exitCode=1}finally{server.close()}});
