require('dotenv').config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const db = require("./db");
const { initializeGoogleSheetsStore, scheduleGoogleSheetsSync, flushGoogleSheetsWrites, setStorageEncryption, getStorageEncryptionStatus, getGoogleSheetsStatus } = require("./scripts/live-google-sheets-sync");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || (production ? "" : "local-development-secret-change-before-deploy");
if (production && SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be set to a random value of at least 32 characters in production.");
  process.exit(1);
}

app.disable("x-powered-by");
if (production) app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "british.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: production, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, "public")));

const q = (sql, ...params) => {
  const result = db.prepare(sql).run(...params);
  // Mirror all writes through the existing query helper; debounced to coalesce multi-step operations.
  if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) scheduleGoogleSheetsSync();
  return result;
};
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const clean = v => String(v ?? "").trim();
const validRole = role => ["admin", "trainer", "trainee"].includes(role);

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "يلزم تسجيل الدخول." });
  next();
}
function role(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(req.session.user ? 403 : 401).json({ error: "ليس لديك صلاحية لتنفيذ هذا الإجراء." });
    }
    next();
  };
}
function safeUser(u) { return { id: u.id, username: u.username, role: u.role, display_name: u.display_name }; }
function required(body, keys) {
  const missing = keys.filter(k => !clean(body[k]));
  return missing.length ? `الحقول المطلوبة: ${missing.join("، ")}` : null;
}
function handleError(res, err) {
  if (String(err.message).includes("UNIQUE constraint failed")) return res.status(409).json({ error: "القيمة موجودة بالفعل." });
  console.error(err);
  return res.status(500).json({ error: "حدث خطأ داخلي. راجع سجل الخادم." });
}


const CONTROL_MODULES = [
  ['dashboard','الرئيسية'],['reports','التقارير والإحصائيات'],['courses','الدورات والبرامج'],['people','المتدربون والمحاضرون'],
  ['attendance','الحضور'],['sessions','البث المباشر'],['activities','المهام والواجبات والاختبارات'],['evaluations','التقييمات'],
  ['library','المكتبة والخطة التدريبية'],['archive','الأرشيف وقواعد البيانات'],['gallery','معرض الدورات'],['ai','الذكاء الاصطناعي'],
  ['notifications','التواصل والإشعارات'],['applications','طلبات الترشح'],['certificates','الشهادات'],['settings','إعدادات المدير']
];
const moduleForApi = pathName => {
  const p=String(pathName||'');
  if (/^\/(dashboard|reports)/.test(p)) return 'reports';
  if (/^\/(courses|programs|payments)/.test(p)) return 'courses';
  if (/^\/(trainees|trainers|users)/.test(p)) return 'people';
  if (/^\/attendance/.test(p)) return 'attendance';
  if (/^\/sessions/.test(p)) return 'sessions';
  if (/^\/(tasks|assignments|tests)/.test(p)) return 'activities';
  if (/evaluation|rating/.test(p)) return 'evaluations';
  if (/^\/(library|training-plan)/.test(p)) return 'library';
  if (/^\/(archive|sheet-)/.test(p)) return 'archive';
  if (/^\/facebook-courses/.test(p)) return 'gallery';
  if (/^\/(ai|adaptive|learning-path|learning-lab)/.test(p)) return 'ai';
  if (/^\/(notifications|chat)/.test(p)) return 'notifications';
  if (/^\/applications/.test(p)) return 'applications';
  if (/^\/certificates/.test(p)) return 'certificates';
  return null;
};
function masterPasswordOk(input){
  const expected=String(process.env.MASTER_ADMIN_PASSWORD||'');
  const actual=String(input||'');
  if(expected.length<12 || actual.length!==expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function requireMaster(req,res,next){
  if(!req.session.user || req.session.user.role!=='admin') return res.status(403).json({error:'هذه الوظيفة متاحة للمدير فقط.'});
  if(req.session.masterControlUntil && req.session.masterControlUntil>Date.now()) return next();
  return res.status(403).json({error:'يلزم فتح صلاحيات التحكم الرئيسية بكلمة المرور.'});
}
function permissionEnabled(moduleKey,userRole){
  if(!moduleKey) return true;
  const row=one('SELECT enabled FROM platform_permissions WHERE module_key=? AND role=?',moduleKey,userRole);
  return !row || Number(row.enabled)===1;
}
// Enforce module switches on the API as well as the interface. The temporarily unlocked master administrator bypasses switches.
app.use('/api',(req,res,next)=>{
  if(!req.session.user || /^\/(setup|setup-status|login|logout|me|public|master-control|platform-permissions|storage-encryption|contact-message)/.test(req.path)) return next();
  if(req.session.user.role==='admin' && req.session.masterControlUntil>Date.now()) return next();
  const moduleKey=moduleForApi(req.path);
  if(moduleKey && !permissionEnabled(moduleKey,req.session.user.role)) return res.status(403).json({error:'تم إيقاف صلاحية هذا القسم لحسابك بواسطة مدير التحكم.'});
  next();
});

app.post('/api/master-control/unlock',auth,role('admin'),(req,res)=>{
  req.session.masterAttempts=(req.session.masterAttempts||0)+1;
  if(req.session.masterAttempts>8) return res.status(429).json({error:'محاولات كثيرة. سجّل الخروج ثم أعد المحاولة لاحقًا.'});
  if(!masterPasswordOk(req.body?.password)) return res.status(403).json({error:'كلمة مرور التحكم غير صحيحة.'});
  req.session.masterAttempts=0; req.session.masterControlUntil=Date.now()+20*60*1000;
  res.json({ok:true,unlockedUntil:req.session.masterControlUntil});
});
app.post('/api/master-control/lock',auth,role('admin'),(req,res)=>{delete req.session.masterControlUntil;res.json({ok:true})});
app.get('/api/storage-encryption',auth,role('admin'),(req,res)=>res.json(getStorageEncryptionStatus()));
app.post('/api/storage-encryption',auth,requireMaster,async(req,res)=>{
  try{const out=await setStorageEncryption(Boolean(req.body?.encrypted));res.json({ok:true,...out,message:out.encrypted?'تم تشفير بيانات الجداول في مصدر التخزين.':'تم فك تشفير بيانات الجداول في مصدر التخزين، والمنصة مستمرة في العمل بصورة طبيعية.'})}
  catch(e){handleError(res,e)}
});
app.get('/api/platform-permissions',auth,(req,res)=>{
  const rows=all('SELECT module_key,role,enabled FROM platform_permissions');
  res.json({modules:CONTROL_MODULES.map(([key,label])=>({key,label})),permissions:rows,masterUnlocked:!!(req.session.masterControlUntil>Date.now())});
});
app.put('/api/platform-permissions',auth,requireMaster,(req,res)=>{
  const moduleKey=clean(req.body?.module_key),targetRole=clean(req.body?.role),enabled=req.body?.enabled?1:0;
  if(!CONTROL_MODULES.some(([k])=>k===moduleKey)||!validRole(targetRole)) return res.status(400).json({error:'صلاحية غير صحيحة.'});
  q(`INSERT INTO platform_permissions(module_key,role,enabled,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(module_key,role) DO UPDATE SET enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP`,moduleKey,targetRole,enabled);
  res.json({ok:true,module_key:moduleKey,role:targetRole,enabled:!!enabled});
});
app.get('/api/platform-bridge-health',auth,role('admin'),async(req,res)=>{
  try{
    const result=await googleBridge.call('platformHealth');
    res.json({ok:true,bridge:true,folder:result.folder||'',remainingMailQuota:result.remainingMailQuota});
  }catch(e){
    console.error('Platform bridge health failed:',e.message);
    res.status(503).json({error:'تعذر الاتصال بخدمة Google: '+String(e.message).slice(0,300)});
  }
});

app.post('/api/contact-message',auth,async(req,res)=>{
  const email=clean(req.body?.email).toLowerCase(),subject=clean(req.body?.subject),message=clean(req.body?.message);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'اكتب بريدًا إلكترونيًا صحيحًا ليتم الرد عليك.'});
  if(message.length<10 || message.length>5000) return res.status(400).json({error:'اكتب رسالة واضحة من 10 إلى 5000 حرف.'});
  try{
    const senderName=clean(req.session.user.display_name||req.session.user.username)||'مستخدم المنصة';
    await googleBridge.call('platformContact',{replyTo:email,email,name:senderName,displayName:senderName,subject:subject.slice(0,160)||'استفسار من منصة الإدارة المركزية للتدريب',message});
    res.json({ok:true,message:'تم إرسال رسالتك بنجاح. سيقوم فريق وحدة التطوير والذكاء الاصطناعي بالرد على بريدك الإلكتروني في أقرب وقت ممكن.'});
  }catch(e){console.error('Contact message failed:',e.message);res.status(503).json({error:'تعذر إرسال الرسالة حاليًا: '+String(e.message).slice(0,300)})}
});


const googleBridge = require('./google-bridge');
const knowledgeBridge = require('./knowledge-bridge');
const credentialMail = require('./credential-mail')({app,db,q,one,all,auth,role});
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID || "13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u";
async function uploadApplicationAttachment(name, mimeType, base64) {
  if (googleBridge.configured()) return googleBridge.upload(name,mimeType,base64);
  if (process.env.NODE_ENV === 'production') throw new Error('فعّل ربط Apps Script بإضافة PLATFORM_SCRIPT_URL وPLATFORM_BRIDGE_SECRET لرفع الملفات من حسابك الشخصي.');
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || (process.env.NODE_ENV === "production" ? "/etc/secrets/google-service-account.json" : "");
  if (!keyFile || !fs.existsSync(keyFile)) throw new Error("رفع المرفقات إلى Google Drive غير مهيأ: تحقق من GOOGLE_SERVICE_ACCOUNT_FILE.");
  const { google } = require("googleapis");
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  const drive = google.drive({ version: "v3", auth });
  const bytes = Buffer.from(base64, "base64");
  const safeName = String(name || "attachment").replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  const result = await drive.files.create({
    requestBody: { name: `${Date.now()}_${safeName}`, mimeType: mimeType || "application/octet-stream", parents: [DRIVE_FOLDER_ID] },
    media: { mimeType: mimeType || "application/octet-stream", body: require("stream").Readable.from(bytes) },
    fields: "id,name,webViewLink"
  });
  return { id: result.data.id, url: result.data.webViewLink || `https://drive.google.com/file/d/${result.data.id}/view` };
}

// Public course catalog for the landing-page training plan and nomination panel.
app.get("/api/public/courses", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(all(`SELECT c.id, c.title, c.description, c.starts_on, c.ends_on, c.capacity, c.display_number,
    t.name AS trainer_name,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS trainee_count
    FROM courses c LEFT JOIN trainers t ON t.id=c.trainer_id WHERE COALESCE(c.public_registration_enabled,1)=1
    ORDER BY CASE WHEN c.starts_on IS NULL OR c.starts_on='' THEN 1 ELSE 0 END, c.starts_on, c.created_at DESC`));
});

// Public nomination request: saved for review by the platform administrator.
app.post("/api/public/applications", async (req, res) => {
  const err = required(req.body, ["applicantName", "email", "phone", "course_id"]);
  if (err) return res.status(400).json({ error: "يرجى استكمال الاسم والبريد والهاتف واختيار الدورة." });
  const courseId = Number(req.body.course_id);
  if (!Number.isInteger(courseId) || courseId < 1) return res.status(400).json({ error: "اختر دورة تدريبية صحيحة." });
  const course = one("SELECT id,title,capacity,public_registration_enabled FROM courses WHERE id=?", courseId);
  if (!course || Number(course.public_registration_enabled) !== 1) return res.status(404).json({ error: "الدورة المختارة غير متاحة للتسجيل حاليًا." });
  const name = clean(req.body.applicantName), email = clean(req.body.email).toLowerCase(), phone = clean(req.body.phone);
  if (name.length < 4) return res.status(400).json({ error: "اكتب الاسم بالكامل." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "البريد الإلكتروني غير صحيح." });
  if (phone.length < 8) return res.status(400).json({ error: "رقم الهاتف غير مكتمل." });
  const duplicate = one("SELECT id,status FROM course_applications WHERE course_id=? AND (lower(email)=? OR phone=?) AND status IN ('pending','approved')", courseId, email, phone);
  if (duplicate) return res.status(409).json({ error: duplicate.status === "pending" ? "لديك طلب سابق لهذه الدورة وما زال قيد المراجعة." : "تم تسجيل طلبك لهذه الدورة من قبل." });
  const enrolled = one(`SELECT e.id FROM enrollments e JOIN trainees t ON t.id=e.trainee_id WHERE e.course_id=? AND (lower(t.email)=? OR t.phone=?)`, courseId, email, phone);
  if (enrolled) return res.status(409).json({ error: "أنت مسجل بالفعل في هذه الدورة." });
  let attachmentName = "", attachmentMime = "", attachmentData = "";
  if (req.body.attachment_data) {
    const match = String(req.body.attachment_data).match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: "صيغة الملف المرفق غير صحيحة." });
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 50 * 1024 * 1024) return res.status(413).json({ error: "الحد الأقصى لحجم المرفق 50 ميجابايت." });
    attachmentName = clean(req.body.attachment_name).slice(0,180);
    attachmentMime = match[1].slice(0,100);
    try {
      const uploaded = await uploadApplicationAttachment(attachmentName, attachmentMime, match[2]);
      attachmentData = `drive:${uploaded.id}`;
    } catch (uploadErr) {
      console.error("Application attachment upload failed:", uploadErr.message);
      return res.status(503).json({ error: "تعذر رفع الملف إلى Google Drive. راجع ربط Apps Script من إعدادات المدير ثم حاول مرة أخرى." });
    }
  }
  const result = q("INSERT INTO course_applications(applicant_name,email,phone,attachment_name,attachment_mime,attachment_data,course_id) VALUES(?,?,?,?,?,?,?)", name, email, phone, attachmentName, attachmentMime, attachmentData, courseId);
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: "تم استلام طلبك بنجاح، وسيظهر لدى إدارة المعهد لمراجعته." });
});
app.get("/api/applications", auth, role("admin"), (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(all(`SELECT a.id,a.applicant_name,a.email,a.phone,a.attachment_name,a.attachment_mime,CASE WHEN COALESCE(a.attachment_data,'')<>'' THEN 1 ELSE 0 END AS has_attachment,a.course_id,a.status,a.trainee_id,a.admin_note,a.created_at,a.updated_at,c.title AS course_title,t.name AS trainee_name FROM course_applications a JOIN courses c ON c.id=a.course_id LEFT JOIN trainees t ON t.id=a.trainee_id ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.created_at DESC`));
});
app.delete("/api/applications/:id", auth, role("admin"), (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({error:"رقم الطلب غير صحيح."});
  const appRow = one("SELECT id, attachment_data FROM course_applications WHERE id=?", id);
  if (!appRow) return res.status(404).json({error:"طلب الترشيح غير موجود."});
  q("DELETE FROM course_applications WHERE id=?", id);
  res.json({ok:true, message:"تم حذف طلب الترشيح من المنصة."});
});
app.patch("/api/courses/:id/public-registration", auth, role("admin"), (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({error:"رقم الدورة غير صحيح."});
  const course = one("SELECT id FROM courses WHERE id=?", id);
  if (!course) return res.status(404).json({error:"الدورة غير موجودة."});
  const enabled = req.body.enabled ? 1 : 0;
  q("UPDATE courses SET public_registration_enabled=? WHERE id=?", enabled, id);
  res.json({ok:true, enabled:!!enabled, message:enabled ? "تم إظهار الدورة في خطة الدورات والتسجيل." : "تم إخفاء الدورة من خطة الدورات والتسجيل."});
});
app.get("/api/applications/:id/attachment", auth, role("admin"), async (req,res)=>{
  const a=one("SELECT attachment_name,attachment_mime,attachment_data FROM course_applications WHERE id=?",Number(req.params.id));
  if(!a||!a.attachment_data)return res.status(404).json({error:"لا يوجد ملف مرفق لهذا الطلب."});
  if (String(a.attachment_data).startsWith("drive:")) {
    try {
      if(googleBridge.configured()) { const file=await googleBridge.download(String(a.attachment_data).slice(6)); res.attachment(a.attachment_name||file.name);return res.send(file.bytes); }
      const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || (process.env.NODE_ENV === "production" ? "/etc/secrets/google-service-account.json" : "");
      if (!keyFile || !fs.existsSync(keyFile)) return res.status(503).json({error:"إعداد Google Drive غير متاح على الخادم."});
      const { google } = require("googleapis");
      const authClient = new google.auth.GoogleAuth({keyFile,scopes:["https://www.googleapis.com/auth/drive.readonly"]});
      const drive = google.drive({version:"v3",auth:authClient});
      const fileId = String(a.attachment_data).slice(6);
      const response = await drive.files.get({fileId,alt:"media"},{responseType:"stream"});
      res.set("Content-Type",a.attachment_mime||"application/octet-stream");
      res.set("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(a.attachment_name||"attachment")}`);
      return response.data.pipe(res);
    } catch (err) {
      console.error("Application attachment download failed:",err.message);
      return res.status(502).json({error:"تعذر تحميل المرفق من Google Drive. تحقق من صلاحيات حساب الخدمة."});
    }
  }
  const match=String(a.attachment_data).match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/);
  if(!match)return res.status(404).json({error:"تعذر قراءة الملف المرفق."});
  const bytes=Buffer.from(match[2],"base64");
  res.set("Content-Type",a.attachment_mime||match[1]);
  res.set("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(a.attachment_name||'attachment')}`);
  res.send(bytes);
});
function makeTraineeUsername(name, id) {
  const map = {ا:'a',أ:'a',إ:'e',آ:'a',ب:'b',ت:'t',ث:'th',ج:'g',ح:'h',خ:'kh',د:'d',ذ:'z',ر:'r',ز:'z',س:'s',ش:'sh',ص:'s',ض:'d',ط:'t',ظ:'z',ع:'a',غ:'gh',ف:'f',ق:'q',ك:'k',ل:'l',م:'m',ن:'n',ه:'h',و:'w',ي:'y',ى:'a',ة:'h'};
  let base = [...String(name || '').toLowerCase()].map(ch => map[ch] || ch).join('').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'').slice(0,12);
  if (base.length < 3) base = 'trainee';
  let candidate = `${base}${id}`.slice(0,30), n = 1;
  while (one('SELECT id FROM users WHERE username=?', candidate)) candidate = `${base}${id}${n++}`.slice(0,32);
  return candidate;
}
function makeStrongPassword() {
  const crypto = require('crypto');
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789', symbols = '!@#$%*-_';
  const pool = upper + lower + digits + symbols;
  const bytes = crypto.randomBytes(20);
  const chars = [upper, lower, digits, symbols].map(set => set[bytes[0] % set.length]);
  for (let i=1;i<16;i++) chars.push(pool[bytes[i] % pool.length]);
  for (let i=chars.length-1;i>0;i--) { const j=bytes[(i+4)%bytes.length]%(i+1); [chars[i],chars[j]]=[chars[j],chars[i]]; }
  return chars.join('');
}
app.patch("/api/applications/:id", auth, role("admin"), async (req, res) => {
  const id = Number(req.params.id), status = clean(req.body.status);
  if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "إجراء غير صالح." });
  const application = one("SELECT * FROM course_applications WHERE id=?", id);
  if (!application) return res.status(404).json({ error: "طلب الترشح غير موجود." });
  if (application.status === "approved") return res.status(409).json({ error: "تم قبول هذا الطلب بالفعل." });
  if (status === "rejected") { q("UPDATE course_applications SET status='rejected', updated_at=CURRENT_TIMESTAMP WHERE id=?", id); return res.json({ ok: true, message: "تم رفض الطلب." }); }
  const course = one("SELECT id,title,capacity FROM courses WHERE id=?", application.course_id);
  if (!course) return res.status(404).json({ error: "الدورة لم تعد موجودة." });
  const count = one("SELECT COUNT(*) AS n FROM enrollments WHERE course_id=?", course.id).n;
  if (course.capacity > 0 && count >= course.capacity) return res.status(409).json({ error: "اكتمل العدد المستهدف للدورة، لا يمكن قبول طلب جديد." });
  const existingTrainee = one("SELECT id,user_id FROM trainees WHERE lower(email)=? OR phone=? ORDER BY id LIMIT 1", application.email.toLowerCase(), application.phone);
  let generated = null, traineeId = null, userId = null;
  try {
    const tx = db.transaction(() => {
      let trainee = one("SELECT id,user_id FROM trainees WHERE lower(email)=? OR phone=? ORDER BY id LIMIT 1", application.email.toLowerCase(), application.phone);
      if (!trainee) { const tr = q("INSERT INTO trainees(name,phone,email,department) VALUES(?,?,?,'')", application.applicant_name, application.phone, application.email); trainee = { id: tr.lastInsertRowid, user_id:null }; }
      traineeId = trainee.id;
      if (!trainee.user_id) {
        const username = makeTraineeUsername(application.applicant_name, trainee.id);
        const password = makeStrongPassword();
        const result = q("INSERT INTO users(username,password_hash,password_display,role,display_name) VALUES(?,?,?,'trainee',?)", username, bcrypt.hashSync(password, 12), password, application.applicant_name);
        userId = result.lastInsertRowid;
        q("UPDATE trainees SET user_id=? WHERE id=?", userId, trainee.id);
        generated = { username, password };
      }
      q("INSERT OR IGNORE INTO enrollments(course_id,trainee_id) VALUES(?,?)", course.id, trainee.id);
      q("UPDATE course_applications SET status='approved', trainee_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", trainee.id, id);
    });
    tx();
    const message = generated
      ? "تم قبول الطلب وإنشاء حساب المتدرب وتسجيله في الدورة. بيانات الدخول محفوظة في ملف المتدرب داخل لوحة الإدارة."
      : "تم قبول الطلب وربط المتدرب الموجود بالدورة؛ الحساب موجود بالفعل ولم يتم إنشاء كلمة مرور جديدة.";
    const delivery=await credentialMail.deliver(traineeId);
    res.json({ok:true,trainee_id:traineeId,...delivery,message:message+' '+delivery.message});
  } catch (e) { handleError(res, e); }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/admin/google-sheets-status", auth, role("admin"), (req, res) => { res.set("Cache-Control", "no-store"); res.json(getGoogleSheetsStatus()); });
app.get("/api/setup-status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ needsSetup: one("SELECT COUNT(*) AS n FROM users").n === 0, setupKeyRequired: production });
});
app.post("/api/setup", async (req, res) => {
  if (production && (!process.env.SETUP_KEY || String(req.body.setup_key || "") !== process.env.SETUP_KEY)) {
    return res.status(403).json({ error: "رمز الإعداد غير صحيح. راجع متغير SETUP_KEY في إعدادات الاستضافة." });
  }
  if (one("SELECT COUNT(*) AS n FROM users").n !== 0) return res.status(403).json({ error: "تم إعداد المدير بالفعل." });
  const err = required(req.body, ["username", "password", "display_name"]);
  if (err) return res.status(400).json({ error: err });
  const username = clean(req.body.username);
  const password = String(req.body.password);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: "اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو . _ -" });
  if (password.length < 12) return res.status(400).json({ error: "اجعل كلمة المرور 12 حرفًا على الأقل." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = q("INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)", username, hash, "admin", clean(req.body.display_name));
    req.session.user = { id: result.lastInsertRowid, username, role: "admin", display_name: clean(req.body.display_name) };
    res.json({ user: req.session.user });
  } catch (e) { handleError(res, e); }
});
app.post("/api/login", async (req, res) => {
  const username = clean(req.body.username);
  const password = String(req.body.password || "");
  const u = one("SELECT * FROM users WHERE username = ?", username);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "تعذر إنشاء جلسة دخول." });
    req.session.user = safeUser(u);
    res.json({ user: req.session.user });
  });
});
app.post("/api/logout", auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.post("/api/admin/password", auth, role("admin"), async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 12) return res.status(400).json({ error: "كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا." });
  const user = one("SELECT id,password_hash FROM users WHERE id=? AND role='admin'", req.session.user.id);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة." });
  q("UPDATE users SET password_hash=? WHERE id=?", await bcrypt.hash(newPassword, 12), user.id);
  res.json({ ok: true });
});
app.get("/api/me", auth, (req, res) => res.json({ user: req.session.user }));

app.get("/api/dashboard", auth, (req, res) => {
  const u = req.session.user;
  let courses, sessions;
  if (u.role === "trainer") {
    const trainer = one("SELECT id FROM trainers WHERE user_id=?", u.id);
    courses = trainer ? all(`SELECT c.*, t.name AS trainer_name, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS trainee_count
      FROM courses c LEFT JOIN trainers t ON c.trainer_id=t.id WHERE c.trainer_id=? ORDER BY c.created_at DESC`, trainer.id) : [];
    sessions = trainer ? all("SELECT s.*, c.title AS course_title FROM sessions s JOIN courses c ON c.id=s.course_id WHERE c.trainer_id=? ORDER BY s.starts_at", trainer.id) : [];
  } else if (u.role === "trainee") {
    // enrollments.trainee_id refers to trainees.id, not users.id.
    const trainee = one("SELECT id FROM trainees WHERE user_id=?", u.id);
    courses = trainee ? all(`SELECT c.*, t.name AS trainer_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS trainee_count
      FROM courses c JOIN enrollments en ON en.course_id=c.id
      LEFT JOIN trainers t ON c.trainer_id=t.id
      WHERE en.trainee_id=? ORDER BY c.created_at DESC`, trainee.id) : [];
    sessions = trainee ? all(`SELECT s.id,s.title,s.course_id,s.starts_at,s.duration,s.platform,s.url,s.created_at,s.description,s.session_number,s.difficulty_level,s.learning_goal,c.title AS course_title
      FROM sessions s JOIN courses c ON c.id=s.course_id
      JOIN enrollments en ON en.course_id=c.id
      WHERE en.trainee_id=? AND (COALESCE(s.workflow_source,'')<>'book' OR EXISTS(SELECT 1 FROM training_activities a WHERE a.session_id=s.id AND a.workflow_source='book' AND a.workflow_state='approved'))
      ORDER BY s.starts_at`, trainee.id) : [];
  } else {
    courses = all(`SELECT c.*, t.name AS trainer_name, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) AS trainee_count
      FROM courses c LEFT JOIN trainers t ON c.trainer_id=t.id ORDER BY c.created_at DESC`);
    sessions = all("SELECT s.*, c.title AS course_title FROM sessions s JOIN courses c ON c.id=s.course_id ORDER BY s.starts_at");
  }
  const stats = u.role === "admin" ? {
    courses: one("SELECT COUNT(*) n FROM courses").n,
    trainees: one("SELECT COUNT(*) n FROM trainees").n,
    trainers: one("SELECT COUNT(*) n FROM trainers").n,
    sessions: one("SELECT COUNT(*) n FROM sessions").n
  } : { courses: courses.length, trainees: u.role === "admin" ? one("SELECT COUNT(*) n FROM trainees").n : null, trainers: null, sessions: sessions.length };
  res.json({ stats, courses, sessions });
});

app.get("/api/trainees", auth, (req, res) => {
  const u = req.session.user;
  if (u.role === "admin") return res.json(all("SELECT t.id,t.name,t.phone,t.email,t.department,t.user_id,u.username,u.password_display,t.credential_email_status,t.credential_email_error,t.credential_email_sent_at FROM trainees t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.name"));
  if (u.role === "trainer") {
    const trainer = one("SELECT id FROM trainers WHERE user_id=?", u.id);
    if (!trainer) return res.json([]);
    return res.json(all(`SELECT DISTINCT t.id,t.name,t.phone,t.email,t.department,t.user_id FROM trainees t
      JOIN enrollments e ON e.trainee_id=t.id JOIN courses c ON c.id=e.course_id WHERE c.trainer_id=? ORDER BY t.name`, trainer.id));
  }
  const trainee = one("SELECT id FROM trainees WHERE user_id=?", u.id);
  if (!trainee) return res.json([]);
  return res.json(all("SELECT id,name,department FROM trainees WHERE id=?", trainee.id));
});
app.post("/api/trainees", auth, role("admin"), async (req, res) => {
  const err = required(req.body, ["name"]);
  if (err) return res.status(400).json({ error: err });
  const username = clean(req.body.username) || makeTraineeUsername(clean(req.body.name),Date.now());
  const password = String(req.body.password || "") || makeStrongPassword();
  if (username && (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || password.length < 12)) {
    return res.status(400).json({ error: "لإنشاء حساب للمتدرب: اسم مستخدم صالح وكلمة مرور 12 حرفًا على الأقل." });
  }
  try {
    let userId = null;
    if (username) {
      const hash = await bcrypt.hash(password, 12);
      const user = q("INSERT INTO users(username,password_hash,password_display,role,display_name) VALUES(?,?,?,?,?)", username, hash, password, "trainee", clean(req.body.name));
      userId = user.lastInsertRowid;
    }
    const result = q("INSERT INTO trainees(name,phone,email,department,user_id) VALUES(?,?,?,?,?)", clean(req.body.name), clean(req.body.phone), clean(req.body.email), clean(req.body.department), userId);
    const delivery=userId?await credentialMail.deliver(result.lastInsertRowid):{message:'تم حفظ المتدرب بدون حساب دخول.'};
    res.status(201).json({...one("SELECT id,name,phone,email,department,user_id FROM trainees WHERE id=?",result.lastInsertRowid),...delivery});
  } catch (e) { handleError(res, e); }
});
app.put("/api/trainees/:id", auth, role("admin"), async (req, res) => {
  const id=Number(req.params.id), name=clean(req.body.name), username=clean(req.body.username), password=String(req.body.password||"");
  if(!name) return res.status(400).json({error:"اسم المتدرب مطلوب."});
  if(username && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({error:"اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو . _ -"});
  try {
    const t=one("SELECT * FROM trainees WHERE id=?",id); if(!t)return res.status(404).json({error:"المتدرب غير موجود."});
    if(username && one("SELECT id FROM users WHERE username=? AND id<>COALESCE(?, -1)",username,t.user_id)) return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل."});
    if(password && password.length<12) return res.status(400).json({error:"كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا."});
    const tx=db.transaction(()=>{
      q("UPDATE trainees SET name=?,phone=?,email=?,department=? WHERE id=?",name,clean(req.body.phone),clean(req.body.email),clean(req.body.department),id);
      if(t.user_id){
        if(!username) throw new Error("USERNAME_REQUIRED");
        if(password) q("UPDATE users SET username=?,password_hash=?,password_display=?,display_name=? WHERE id=?",username,bcrypt.hashSync(password,12),password,name,t.user_id);
        else q("UPDATE users SET username=?,display_name=? WHERE id=?",username,name,t.user_id);
      } else if(username){
        if(!password || password.length<12) throw new Error("PASSWORD_REQUIRED");
        const u=q("INSERT INTO users(username,password_hash,password_display,role,display_name) VALUES(?,?,?,?,?)",username,bcrypt.hashSync(password,12),password,"trainee",name);
        q("UPDATE trainees SET user_id=? WHERE id=?",u.lastInsertRowid,id);
      }
    }); tx(); const updated=one('SELECT user_id FROM trainees WHERE id=?',id);const delivery=updated.user_id?await credentialMail.deliver(id):{message:'تم حفظ بيانات المتدرب.'};res.json({ok:true,...delivery});
  } catch(e){if(e.message==="USERNAME_REQUIRED")return res.status(400).json({error:"اكتب اسم المستخدم أو اترك حساب الدخول كما هو بإبقاء الحقل الحالي."});if(e.message==="PASSWORD_REQUIRED")return res.status(400).json({error:"لإنشاء حساب جديد أدخل كلمة مرور لا تقل عن 12 حرفًا."});handleError(res,e)}
});
app.delete("/api/trainees/:id", auth, role("admin"), (req, res) => {
  const id=Number(req.params.id); const t=one("SELECT id,user_id FROM trainees WHERE id=?",id);
  if(!t) return res.status(404).json({error:"المتدرب غير موجود."});
  const tx=db.transaction(()=>{q("DELETE FROM trainees WHERE id=?",id); if(t.user_id) q("DELETE FROM users WHERE id=?",t.user_id);}); tx(); res.json({ ok: true });
});

app.get("/api/trainers", auth, role("admin"), (req, res) => res.json(all("SELECT t.id,t.name,t.specialty,t.phone,t.email,t.user_id,u.username FROM trainers t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.name")));
app.put("/api/trainers/:id", auth, role("admin"), async (req, res) => {
  const id=Number(req.params.id), name=clean(req.body.name), username=clean(req.body.username), password=String(req.body.password||"");
  if(!name)return res.status(400).json({error:"اسم المحاضر مطلوب."});
  if(username && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username))return res.status(400).json({error:"اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا أو . _ -"});
  try{
    const t=one("SELECT * FROM trainers WHERE id=?",id);if(!t)return res.status(404).json({error:"المحاضر غير موجود."});
    if(username && one("SELECT id FROM users WHERE username=? AND id<>COALESCE(?, -1)",username,t.user_id))return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل."});
    if(password && password.length<12)return res.status(400).json({error:"كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا."});
    const tx=db.transaction(()=>{
      q("UPDATE trainers SET name=?,specialty=?,phone=?,email=? WHERE id=?",name,clean(req.body.specialty),clean(req.body.phone),clean(req.body.email),id);
      if(t.user_id){if(!username)throw new Error("USERNAME_REQUIRED");if(password)q("UPDATE users SET username=?,password_hash=?,password_display=?,display_name=? WHERE id=?",username,bcrypt.hashSync(password,12),password,name,t.user_id);else q("UPDATE users SET username=?,display_name=? WHERE id=?",username,name,t.user_id)}
      else if(username){if(!password||password.length<12)throw new Error("PASSWORD_REQUIRED");const u=q("INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)",username,bcrypt.hashSync(password,12),"trainer",name);q("UPDATE trainers SET user_id=? WHERE id=?",u.lastInsertRowid,id)}
    });tx();res.json({ok:true});
  }catch(e){if(e.message==="USERNAME_REQUIRED")return res.status(400).json({error:"أدخل اسم المستخدم للحساب الحالي."});if(e.message==="PASSWORD_REQUIRED")return res.status(400).json({error:"لإنشاء حساب جديد أدخل كلمة مرور لا تقل عن 12 حرفًا."});handleError(res,e)}
});
app.delete("/api/trainers/:id", auth, role("admin"), (req,res)=>{
 const id=Number(req.params.id), t=one("SELECT id,user_id FROM trainers WHERE id=?",id); if(!t)return res.status(404).json({error:"المحاضر غير موجود."});
 const tx=db.transaction(()=>{q("UPDATE courses SET trainer_id=NULL WHERE trainer_id=?",id);q("DELETE FROM trainers WHERE id=?",id);if(t.user_id)q("DELETE FROM users WHERE id=?",t.user_id)});tx();res.json({ok:true});
});
app.post("/api/trainers", auth, role("admin"), async (req, res) => {
  const err = required(req.body, ["name"]);
  if (err) return res.status(400).json({ error: err });
  const username = clean(req.body.username);
  const password = String(req.body.password || "");
  if (username && (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || password.length < 12)) {
    return res.status(400).json({ error: "لإنشاء حساب للمحاضر: اسم مستخدم صالح وكلمة مرور 12 حرفًا على الأقل." });
  }
  try {
    let userId = null;
    if (username) {
      const hash = await bcrypt.hash(password, 12);
      const user = q("INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)", username, hash, "trainer", clean(req.body.name));
      userId = user.lastInsertRowid;
    }
    const result = q("INSERT INTO trainers(name,specialty,phone,email,user_id) VALUES(?,?,?,?,?)", clean(req.body.name), clean(req.body.specialty), clean(req.body.phone), clean(req.body.email), userId);
    res.status(201).json(one("SELECT id,name,specialty,phone,email,user_id FROM trainers WHERE id=?", result.lastInsertRowid));
  } catch (e) { handleError(res, e); }
});

// Per-course image gallery. Images are stored in the same persistent upload volume as library files.
db.exec(`CREATE TABLE IF NOT EXISTS course_gallery_images (
 id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 uploaded_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
function courseAccess(req, courseId){const u=req.session.user;if(u.role==='admin')return true;if(u.role==='trainer'){const t=one('SELECT id FROM trainers WHERE user_id=?',u.id);return !!(t&&one('SELECT id FROM courses WHERE id=? AND trainer_id=?',courseId,t.id));}const t=one('SELECT id FROM trainees WHERE user_id=?',u.id);return !!(t&&one('SELECT id FROM enrollments WHERE course_id=? AND trainee_id=?',courseId,t.id));}
app.get('/api/courses/:id/gallery',auth,(req,res)=>{const id=Number(req.params.id);if(!courseAccess(req,id))return res.sendStatus(403);res.json(all('SELECT id,course_id,original_name,mime_type,size_bytes,created_at FROM course_gallery_images WHERE course_id=? ORDER BY id DESC',id));});
app.post('/api/courses/:id/gallery',auth,role('admin','trainer'),(req,res)=>{const id=Number(req.params.id);if(!courseAccess(req,id))return res.sendStatus(403);const data=String(req.body.data||'');const m=data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!m)return res.status(400).json({error:'اختر صورة JPG أو PNG أو WEBP أو GIF.'});const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>12*1024*1024)return res.status(413).json({error:'الحد الأقصى للصورة 12 ميجابايت.'});const ext={ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}[m[1]];const name=`course-${id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;fs.writeFileSync(path.join(uploadDir,name),bytes,{flag:'wx'});const r=q('INSERT INTO course_gallery_images(course_id,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES(?,?,?,?,?,?)',id,path.basename(clean(req.body.name)||`course-image${ext}`),name,m[1],bytes.length,req.session.user.id);res.status(201).json({id:r.lastInsertRowid,ok:true});});
app.get('/api/courses/:id/gallery/:imageId/file',auth,(req,res)=>{const id=Number(req.params.id);if(!courseAccess(req,id))return res.sendStatus(403);const r=one('SELECT * FROM course_gallery_images WHERE id=? AND course_id=?',Number(req.params.imageId),id);if(!r)return res.sendStatus(404);const f=path.join(uploadDir,path.basename(r.stored_name));if(!fs.existsSync(f))return res.sendStatus(404);res.type(r.mime_type).sendFile(f);});
app.get('/api/courses/:id/gallery/:imageId/download',auth,(req,res)=>{const id=Number(req.params.id);if(!courseAccess(req,id))return res.sendStatus(403);const r=one('SELECT * FROM course_gallery_images WHERE id=? AND course_id=?',Number(req.params.imageId),id);if(!r)return res.sendStatus(404);const f=path.join(uploadDir,path.basename(r.stored_name));if(!fs.existsSync(f))return res.sendStatus(404);res.download(f,r.original_name);});
app.delete('/api/courses/:id/gallery/:imageId',auth,role('admin','trainer'),(req,res)=>{const id=Number(req.params.id);if(!courseAccess(req,id))return res.sendStatus(403);const r=one('SELECT * FROM course_gallery_images WHERE id=? AND course_id=?',Number(req.params.imageId),id);if(!r)return res.sendStatus(404);fs.rmSync(path.join(uploadDir,path.basename(r.stored_name)),{force:true});q('DELETE FROM course_gallery_images WHERE id=?',r.id);res.json({ok:true});});

app.get("/api/courses", auth, (req, res) => {
  const u = req.session.user;
  if (u.role === "admin") return res.json(all(`SELECT c.*,t.name AS trainer_name,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) trainee_count
    FROM courses c LEFT JOIN trainers t ON t.id=c.trainer_id ORDER BY c.created_at DESC`));
  if (u.role === "trainer") {
    const t = one("SELECT id FROM trainers WHERE user_id=?", u.id);
    return res.json(t ? all(`SELECT c.*,t.name AS trainer_name,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) trainee_count
      FROM courses c LEFT JOIN trainers t ON t.id=c.trainer_id WHERE c.trainer_id=?`, t.id) : []);
  }
  const t = one("SELECT id FROM trainees WHERE user_id=?", u.id);
  return res.json(t ? all(`SELECT c.*,tr.name AS trainer_name,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id) trainee_count
    FROM courses c JOIN enrollments en ON en.course_id=c.id LEFT JOIN trainers tr ON tr.id=c.trainer_id WHERE en.trainee_id=?`, t.id) : []);
});
app.post("/api/courses", auth, role("admin"), (req, res) => {
  const err = required(req.body, ["title"]);
  if (err) return res.status(400).json({ error: err });
  try {
    const result = q("INSERT INTO courses(title,description,trainer_id,starts_on,ends_on,capacity,public_registration_enabled) VALUES(?,?,?,?,?,?,?)",
      clean(req.body.title), clean(req.body.description), req.body.trainer_id ? Number(req.body.trainer_id) : null,
      clean(req.body.starts_on), clean(req.body.ends_on), Number(req.body.capacity) || 0, req.body.public_registration_enabled === false || req.body.public_registration_enabled === "false" || req.body.public_registration_enabled === "0" ? 0 : 1);
    res.status(201).json(one("SELECT * FROM courses WHERE id=?", result.lastInsertRowid));
  } catch (e) { handleError(res, e); }
});
app.patch("/api/courses/:id/links", auth, role("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "رقم الدورة غير صحيح." });
  const course = one("SELECT id FROM courses WHERE id=?", id);
  if (!course) return res.status(404).json({ error: "الدورة غير موجودة." });
  const testUrl = clean(req.body.test_url);
  const evaluationUrl = clean(req.body.evaluation_url);
  const testPassword = String(req.body.test_password ?? "").trim();
  const testEnabled = req.body.test_enabled === true || req.body.test_enabled === 1 || req.body.test_enabled === "1" || req.body.test_enabled === "true" ? 1 : 0;
  const evaluationEnabled = req.body.evaluation_enabled === true || req.body.evaluation_enabled === 1 || req.body.evaluation_enabled === "1" || req.body.evaluation_enabled === "true" ? 1 : 0;
  const validUrl = value => !value || (() => { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol); } catch { return false; } })();
  if (!validUrl(testUrl) || !validUrl(evaluationUrl)) return res.status(400).json({ error: "يرجى إدخال رابط صحيح يبدأ بـ http:// أو https://." });
  if (testEnabled && !testUrl) return res.status(400).json({ error: "أضف رابط الاختبار قبل تفعيله." });
  if (evaluationEnabled && !evaluationUrl) return res.status(400).json({ error: "أضف رابط تقييم الدورة قبل تفعيله." });
  if (testPassword.length > 128) return res.status(400).json({ error: "كلمة مرور الاختبار طويلة جدًا (الحد 128 حرفًا)." });
  try {
    q("UPDATE courses SET test_url=?, test_enabled=?, test_password=?, evaluation_url=?, evaluation_enabled=? WHERE id=?",
      testUrl, testEnabled, testPassword, evaluationUrl, evaluationEnabled, id);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, message: "تم حفظ روابط الدورة وإعدادات الإتاحة." });
  } catch (e) { handleError(res, e); }
});
app.delete("/api/courses/:id", auth, role("admin"), (req, res) => { q("DELETE FROM courses WHERE id=?", Number(req.params.id)); res.json({ ok: true }); });
app.post("/api/courses/:id/enroll", auth, role("admin"), (req, res) => {
  const err = required(req.body, ["trainee_id"]); if (err) return res.status(400).json({ error: err });
  try { q("INSERT INTO enrollments(course_id,trainee_id) VALUES(?,?)", Number(req.params.id), Number(req.body.trainee_id)); res.status(201).json({ ok: true }); }
  catch(e) { handleError(res,e); }
});

app.get("/api/sessions", auth, (req, res) => {
  const u = req.session.user;
  if (u.role === "admin") return res.json(all("SELECT s.*,c.title course_title FROM sessions s JOIN courses c ON c.id=s.course_id ORDER BY s.starts_at"));
  if (u.role === "trainer") {
    const t=one("SELECT id FROM trainers WHERE user_id=?",u.id); return res.json(t?all("SELECT s.*,c.title course_title FROM sessions s JOIN courses c ON c.id=s.course_id WHERE c.trainer_id=? ORDER BY s.starts_at",t.id):[]);
  }
  const t=one("SELECT id FROM trainees WHERE user_id=?",u.id); return res.json(t?all("SELECT s.id,s.title,s.course_id,s.starts_at,s.duration,s.platform,s.url,s.created_at,s.description,s.session_number,s.difficulty_level,s.learning_goal,c.title course_title FROM sessions s JOIN courses c ON c.id=s.course_id JOIN enrollments e ON e.course_id=c.id WHERE e.trainee_id=? AND (COALESCE(s.workflow_source,'')<>'book' OR EXISTS(SELECT 1 FROM training_activities a WHERE a.session_id=s.id AND a.workflow_source='book' AND a.workflow_state='approved')) ORDER BY s.starts_at",t.id):[]);
});
app.post("/api/sessions", auth, role("admin","trainer"), (req, res) => {
  const err = required(req.body, ["title","course_id","starts_at","platform"]);
  if (err) return res.status(400).json({ error: err });
  if (req.body.url && !/^https?:\/\//i.test(clean(req.body.url))) return res.status(400).json({ error: "رابط الاجتماع يجب أن يبدأ بـ http:// أو https://" });
  if(req.session.user.role==="trainer"){const trainer=one("SELECT id FROM trainers WHERE user_id=?",req.session.user.id);if(!trainer||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",Number(req.body.course_id),trainer.id))return res.status(403).json({error:"يمكنك جدولة جلسات دوراتك فقط."});}
  try {
    const result=q("INSERT INTO sessions(title,course_id,starts_at,duration,platform,url) VALUES(?,?,?,?,?,?)",
      clean(req.body.title),Number(req.body.course_id),clean(req.body.starts_at),Number(req.body.duration)||60,clean(req.body.platform),clean(req.body.url));
    res.status(201).json(one("SELECT * FROM sessions WHERE id=?",result.lastInsertRowid));
  } catch(e){handleError(res,e);}
});
app.get("/api/courses/:id/enrolled", auth, role("admin","trainer"), (req,res)=>{
  const courseId=Number(req.params.id);
  const u=req.session.user;
  if(u.role==="trainer"){
    const t=one("SELECT id FROM trainers WHERE user_id=?",u.id);
    if(!t||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",courseId,t.id))return res.status(403).json({error:"هذه الدورة ليست ضمن دوراتك."});
  }
  res.json(all("SELECT tr.id,tr.name,tr.phone FROM trainees tr JOIN enrollments e ON e.trainee_id=tr.id WHERE e.course_id=? ORDER BY tr.name",courseId));
});
app.delete("/api/courses/:id/enrolled/:traineeId", auth, role("admin"), (req,res)=>{
  const courseId=Number(req.params.id), traineeId=Number(req.params.traineeId);
  if(!Number.isInteger(courseId)||courseId<1||!Number.isInteger(traineeId)||traineeId<1) return res.status(400).json({error:"رقم الدورة أو المتدرب غير صحيح."});
  const enrollment=one("SELECT id FROM enrollments WHERE course_id=? AND trainee_id=?",courseId,traineeId);
  if(!enrollment) return res.status(404).json({error:"المتدرب غير مسجل في هذه الدورة."});
  q("DELETE FROM enrollments WHERE course_id=? AND trainee_id=?",courseId,traineeId);
  res.json({ok:true,message:"تم إلغاء تسجيل المتدرب من هذه الدورة فقط."});
});
require('./activity-workflow')({app,db,q,one,all,auth,role,uploadApplicationAttachment});
app.get("/api/activities/:kind", auth, (req,res)=>{
  if(req.params.kind==="tests")return res.redirect(307,"/api/learning/tests");
  if (["tasks","assignments"].includes(req.params.kind)) return res.redirect(307,"/api/work/activities/"+req.params.kind);
  const allowed = ["tasks","assignments","tests","evaluation-templates","trainee-evaluation","trainer-evaluation","program-evaluation","trainee-rating"];
  const kind = req.params.kind;
  if (!allowed.includes(kind)) return res.status(400).json({error:"نوع القسم غير صحيح."});
  const u = req.session.user;
  if (u.role === "trainee") {
    // المتدرب يطّلع للقراءة فقط على المهام والواجبات والاختبارات العامة أو المرتبطة بدوراته.
    if (!["tasks","assignments","tests"].includes(kind)) return res.status(403).json({error:"هذا القسم غير متاح لحساب المتدرب."});
    const trainee = one("SELECT id FROM trainees WHERE user_id=?", u.id);
    if (!trainee) return res.json([]);
    return res.json(all(`SELECT a.*, c.title AS course_title
      FROM training_activities a
      LEFT JOIN courses c ON c.id=a.course_id
      WHERE a.kind=? AND (a.course_id IS NULL OR EXISTS (
        SELECT 1 FROM enrollments e WHERE e.course_id=a.course_id AND e.trainee_id=?
      )) ORDER BY a.id DESC`, kind, trainee.id));
  }
  if (u.role === "trainer") {
    const trainer = one("SELECT id FROM trainers WHERE user_id=?", u.id);
    if (!trainer) return res.json([]);
    return res.json(all(`SELECT a.*, c.title AS course_title
      FROM training_activities a LEFT JOIN courses c ON c.id=a.course_id
      WHERE a.kind=? AND (a.course_id IS NULL OR c.trainer_id=?) ORDER BY a.id DESC`, kind, trainer.id));
  }
  res.json(all("SELECT a.*, c.title AS course_title FROM training_activities a LEFT JOIN courses c ON c.id=a.course_id WHERE a.kind=? ORDER BY a.id DESC", kind));
});
app.post("/api/activities/:kind", auth, role("admin","trainer"), (req,res)=>{
  const allowed = ["tasks","assignments","tests","evaluation-templates","trainee-evaluation","trainer-evaluation","program-evaluation","trainee-rating"];
  if (!allowed.includes(req.params.kind)) return res.status(400).json({error:"نوع القسم غير صحيح."});
  const title=clean(req.body.title), description=clean(req.body.description), dueDate=clean(req.body.due_date), status=clean(req.body.status)||"نشط", courseId=req.body.course_id?Number(req.body.course_id):null, externalUrl=clean(req.body.external_url);
  if (!title) return res.status(400).json({error:"اكتب عنوان السجل أولًا."});
  if (courseId && !one("SELECT id FROM courses WHERE id=?", courseId)) return res.status(400).json({error:"الدورة المحددة غير موجودة."});
  if (req.session.user.role === "trainer") {
    if (!courseId) return res.status(400).json({error:"يجب على المدرب ربط السجل بإحدى دوراته."});
    const trainer=one("SELECT id FROM trainers WHERE user_id=?",req.session.user.id);
    if(!trainer||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",courseId,trainer.id)) return res.status(403).json({error:"يمكنك إدارة أنشطة دوراتك فقط."});
  }
  if (externalUrl && (!/^https?:\/\//i.test(externalUrl) || externalUrl.length>2000)) return res.status(400).json({error:"رابط الاختبار يجب أن يبدأ بـ https:// أو http://"});
  const result=q("INSERT INTO training_activities(kind,title,description,course_id,due_date,status,external_url) VALUES(?,?,?,?,?,?,?)",req.params.kind,title,description,courseId,dueDate,status,externalUrl);
  res.status(201).json(one("SELECT a.*, c.title AS course_title FROM training_activities a LEFT JOIN courses c ON c.id=a.course_id WHERE a.id=?",result.lastInsertRowid));
});
app.delete("/api/activities/:id", auth, role("admin","trainer"), (req,res)=>{
  const id=Number(req.params.id); const item=one("SELECT id,course_id FROM training_activities WHERE id=?",id); if(!item) return res.status(404).json({error:"السجل غير موجود."});
  if(req.session.user.role==="trainer"){const trainer=one("SELECT id FROM trainers WHERE user_id=?",req.session.user.id);if(!trainer||!item.course_id||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",item.course_id,trainer.id))return res.status(403).json({error:"يمكنك حذف أنشطة دوراتك فقط."});}
  q("DELETE FROM training_activities WHERE id=?",id); res.json({ok:true});
});

// Training plans: store safe external links; the platform does not pretend to upload files here.
app.get("/api/training-plans", auth, (req,res)=>res.json(all("SELECT p.id,p.title,p.url,p.description,p.created_at FROM training_plans p ORDER BY p.created_at DESC")));
app.post("/api/training-plans", auth, role("admin"), (req,res)=>{
 const title=clean(req.body.title), url=clean(req.body.url), description=clean(req.body.description);
 if(!title||!url)return res.status(400).json({error:"اسم الخطة والرابط مطلوبان."});
 if(!/^https?:\/\//i.test(url)||url.length>2000)return res.status(400).json({error:"أدخل رابطًا صحيحًا يبدأ بـ https:// أو http://"});
 const r=q("INSERT INTO training_plans(title,url,description,created_by) VALUES(?,?,?,?)",title,url,description,req.session.user.id);
 res.status(201).json(one("SELECT id,title,url,description,created_at FROM training_plans WHERE id=?",r.lastInsertRowid));
});
app.delete("/api/training-plans/:id", auth, role("admin"), (req,res)=>{const id=Number(req.params.id);if(!one("SELECT id FROM training_plans WHERE id=?",id))return res.status(404).json({error:"الخطة غير موجودة."});q("DELETE FROM training_plans WHERE id=?",id);res.json({ok:true});});

app.get("/api/my-attendance", auth, role("trainee"), (req,res)=>{
  const trainee=one("SELECT id FROM trainees WHERE user_id=?",req.session.user.id);
  if(!trainee)return res.json([]);
  res.json(all(`SELECT a.date,a.status,c.title course_title FROM attendance a JOIN courses c ON c.id=a.course_id WHERE a.trainee_id=? ORDER BY a.date DESC,c.title`,trainee.id));
});

app.post("/api/attendance", auth, role("admin","trainer"), (req,res)=>{
  const err=required(req.body,["course_id","trainee_id","date","status"]);if(err)return res.status(400).json({error:err});
  if(!["حاضر","غائب","متأخر"].includes(req.body.status))return res.status(400).json({error:"حالة حضور غير صحيحة."});
  const u=req.session.user;
  if(u.role==="trainer"){
    const t=one("SELECT id FROM trainers WHERE user_id=?",u.id);
    if(!t||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",Number(req.body.course_id),t.id))return res.status(403).json({error:"هذه الدورة ليست ضمن دوراتك."});
  }
  if(!one("SELECT id FROM enrollments WHERE course_id=? AND trainee_id=?",Number(req.body.course_id),Number(req.body.trainee_id)))return res.status(400).json({error:"لا يمكن تسجيل حضور متدرب غير مسجل في هذه الدورة."});
  try{q(`INSERT INTO attendance(course_id,trainee_id,date,status,marked_by) VALUES(?,?,?,?,?)
    ON CONFLICT(course_id,trainee_id,date) DO UPDATE SET status=excluded.status,marked_by=excluded.marked_by`,
    Number(req.body.course_id),Number(req.body.trainee_id),clean(req.body.date),clean(req.body.status),u.id);res.json({ok:true});}
  catch(e){handleError(res,e);}
});
app.get("/api/attendance", auth, role("admin","trainer"), (req,res)=>{
  const courseId=Number(req.query.course_id); const date=clean(req.query.date);
  const u=req.session.user;
  if(u.role==="trainer"){const t=one("SELECT id FROM trainers WHERE user_id=?",u.id);if(!t||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",courseId,t.id))return res.status(403).json({error:"هذه الدورة ليست ضمن دوراتك."});}
  res.json(all(`SELECT a.*,tr.name trainee_name,tr.phone FROM attendance a JOIN trainees tr ON tr.id=a.trainee_id WHERE a.course_id=? AND a.date=? ORDER BY tr.name`,courseId,date));
});


// Training batches: persisted in SQLite and available to admins only for management.
app.get("/api/batches", auth, (req,res)=>{
 const u=req.session.user;
 if(u.role==="admin") return res.json(all(`SELECT b.*,c.title course_title,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=b.course_id) trainee_count FROM training_batches b LEFT JOIN courses c ON c.id=b.course_id ORDER BY b.created_at DESC`));
 if(u.role==="trainer") { const t=one("SELECT id FROM trainers WHERE user_id=?",u.id); return res.json(t?all(`SELECT b.*,c.title course_title,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=b.course_id) trainee_count FROM training_batches b LEFT JOIN courses c ON c.id=b.course_id WHERE c.trainer_id=? ORDER BY b.created_at DESC`,t.id):[]); }
 const t=one("SELECT id FROM trainees WHERE user_id=?",u.id); return res.json(t?all(`SELECT DISTINCT b.*,c.title course_title,(SELECT COUNT(*) FROM enrollments e WHERE e.course_id=b.course_id) trainee_count FROM training_batches b JOIN courses c ON c.id=b.course_id JOIN enrollments e ON e.course_id=c.id WHERE e.trainee_id=? ORDER BY b.created_at DESC`,t.id):[]);
});
app.post("/api/batches", auth, role("admin"), (req,res)=>{
 const err=required(req.body,["title"]); if(err)return res.status(400).json({error:err});
 try { const r=q("INSERT INTO training_batches(title,course_id,code,starts_on,ends_on,notes) VALUES(?,?,?,?,?,?)",clean(req.body.title),req.body.course_id?Number(req.body.course_id):null,clean(req.body.code),clean(req.body.starts_on),clean(req.body.ends_on),clean(req.body.notes)); res.status(201).json(one("SELECT * FROM training_batches WHERE id=?",r.lastInsertRowid)); } catch(e){handleError(res,e);}
});
app.delete("/api/batches/:id", auth, role("admin"), (req,res)=>{q("DELETE FROM training_batches WHERE id=?",Number(req.params.id));res.json({ok:true});});

// Library resources: files are stored locally or in the configured Google Drive store.
const uploadDir=path.join(process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):__dirname+"/data","uploads");
if(!fs.existsSync(uploadDir))fs.mkdirSync(uploadDir,{recursive:true});
const LIBRARY_FILE_LIMIT=50*1024*1024, LIBRARY_VIDEO_LIMIT=100*1024*1024;
const LIBRARY_BRIDGE_SAFE_LIMIT=8*1024*1024; // Apps Script bridge payload is capped at 12 MB.
function libraryDriveCredentials(){
 const raw=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'').trim();
 if(raw){try{return {credentials:JSON.parse(raw)}}catch(e){throw new Error('قيمة GOOGLE_SERVICE_ACCOUNT_JSON غير صالحة.')}}
 const encoded=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64||'').trim();
 if(encoded){try{return {credentials:JSON.parse(Buffer.from(encoded,'base64').toString('utf8'))}}catch(e){throw new Error('قيمة GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 غير صالحة.')}}
 const keyFile=process.env.GOOGLE_SERVICE_ACCOUNT_FILE||(production?'/etc/secrets/google-service-account.json':'');
 if(keyFile&&fs.existsSync(keyFile))return {keyFile};
 return null;
}
async function libraryDriveClient(){
 const credentials=libraryDriveCredentials();
 if(!credentials)throw new Error('رفع الملفات الكبيرة يحتاج إعداد حساب خدمة Google Drive. أضف GOOGLE_SERVICE_ACCOUNT_JSON أو GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 أو GOOGLE_SERVICE_ACCOUNT_FILE، وشارك مجلد الرفع مع بريد حساب الخدمة بصلاحية محرر.');
 const {google}=require('googleapis');
 const auth=new google.auth.GoogleAuth({...credentials,scopes:['https://www.googleapis.com/auth/drive']});
 return google.drive({version:'v3',auth});
}
async function uploadLibraryFileToDrive(filePath,meta){
 const drive=await libraryDriveClient();
 const result=await drive.files.create({
  requestBody:{name:`${Date.now()}_${String(meta.original_name||'file').replace(/[\\/:*?"<>|]/g,'_').slice(0,180)}`,mimeType:meta.mime_type,parents:[process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID||'13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u']},
  media:{mimeType:meta.mime_type,body:fs.createReadStream(filePath)},
  fields:'id,name,webViewLink',supportsAllDrives:true
 });
 return result.data.id;
}
async function streamLibraryDriveFile(fileId,req,res,mimeType,downloadName){
 const drive=await libraryDriveClient();
 const options={responseType:'stream'};
 if(req.headers.range)options.headers={Range:req.headers.range};
 const response=await drive.files.get({fileId,alt:'media'},options);
 const headers=response.headers||{};
 res.setHeader('Content-Type',mimeType||headers['content-type']||'application/octet-stream');
 res.setHeader('Accept-Ranges','bytes');
 if(headers['content-range']){res.status(206);res.setHeader('Content-Range',headers['content-range']);}
 if(headers['content-length'])res.setHeader('Content-Length',headers['content-length']);
 if(downloadName)res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
 response.data.on('error',err=>{console.error('Google Drive library stream failed:',err.message);if(!res.headersSent)res.status(502).json({error:'تعذر قراءة الملف من Google Drive.'});else res.destroy(err)});
 response.data.pipe(res);
}
function libraryResourceAccess(req,r){
 if(!r)return false;const u=req.session.user;
 if(u.role==='admin')return true;
 if(u.role==='trainer'){if(!r.course_id)return true;const t=one('SELECT id FROM trainers WHERE user_id=?',u.id);return !!(t&&one('SELECT id FROM courses WHERE id=? AND trainer_id=?',r.course_id,t.id));}
 if(!r.course_id)return true;const t=one('SELECT id FROM trainees WHERE user_id=?',u.id);return !!(t&&one('SELECT id FROM enrollments WHERE course_id=? AND trainee_id=?',r.course_id,t.id));
}
// Group additional videos under the first resource in a single library panel.
if(!all('PRAGMA table_info(library_resources)').some(c=>c.name==='parent_resource_id'))db.exec('ALTER TABLE library_resources ADD COLUMN parent_resource_id INTEGER REFERENCES library_resources(id) ON DELETE CASCADE');
app.get("/api/library",auth,(req,res)=>{
 const u=req.session.user;
 const fields=`r.id,r.title,r.kind,r.course_id,r.description,r.original_name,r.mime_type,r.size_bytes,r.created_at,c.title course_title,(SELECT COUNT(*) FROM library_resources child WHERE child.parent_resource_id=r.id) video_count,(SELECT COUNT(*) FROM library_reactions lr WHERE lr.resource_id=r.id) reaction_count,(SELECT COUNT(*) FROM library_comments lc WHERE lc.resource_id=r.id) comment_count`;
 if(u.role==="admin") return res.json(all(`SELECT ${fields} FROM library_resources r LEFT JOIN courses c ON c.id=r.course_id WHERE r.parent_resource_id IS NULL ORDER BY r.created_at DESC`));
 if(u.role==="trainer") {const t=one("SELECT id FROM trainers WHERE user_id=?",u.id);return res.json(t?all(`SELECT ${fields} FROM library_resources r LEFT JOIN courses c ON c.id=r.course_id WHERE r.parent_resource_id IS NULL AND (r.course_id IS NULL OR c.trainer_id=?) ORDER BY r.created_at DESC`,t.id):[]);}
 const t=one("SELECT id FROM trainees WHERE user_id=?",u.id);return res.json(t?all(`SELECT DISTINCT ${fields} FROM library_resources r LEFT JOIN courses c ON c.id=r.course_id WHERE r.parent_resource_id IS NULL AND (r.course_id IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=r.course_id AND e.trainee_id=?)) ORDER BY r.created_at DESC`,t.id):[]);
});
// Binary streaming endpoint: avoids Base64 expansion and exposes real browser upload progress.
app.post('/api/library/upload',auth,role('admin','trainer'),async(req,res)=>{
 let tempFile='';
 try{
  let meta;
  try{meta=JSON.parse(decodeURIComponent(String(req.headers['x-library-metadata']||'')))}catch{return res.status(400).json({error:'بيانات المادة غير مكتملة أو غير صالحة.'});}
  const title=clean(meta.title),kind=clean(meta.kind),isVideo=kind==='فيديو';
  const originalName=path.basename(clean(meta.original_name));
  const mimeType=clean(meta.mime_type)||'application/octet-stream';
  if(!title||!originalName)return res.status(400).json({error:'أدخل عنوان المادة واختر ملفًا.'});
  const courseId=meta.course_id?Number(meta.course_id):null;
  if(courseId&&!one('SELECT id FROM courses WHERE id=?',courseId))return res.status(400).json({error:'الدورة المحددة غير موجودة.'});
  if(req.session.user.role==='trainer'){
   if(!courseId)return res.status(400).json({error:'يجب ربط المادة بإحدى دوراتك.'});
   const t=one('SELECT id FROM trainers WHERE user_id=?',req.session.user.id);
   if(!t||!one('SELECT id FROM courses WHERE id=? AND trainer_id=?',courseId,t.id))return res.status(403).json({error:'يمكنك إضافة مواد لدوراتك فقط.'});
  }
  const ext=path.extname(originalName).toLowerCase();
  const videoExts=new Set(['.mp4','.webm','.mov','.m4v']);
  if(isVideo&&!videoExts.has(ext))return res.status(400).json({error:'صيغة الفيديو غير مدعومة. استخدم MP4 أو WEBM أو MOV أو M4V.'});
  if(isVideo&&!/^video\//i.test(mimeType)&&mimeType!=='application/octet-stream')return res.status(400).json({error:'نوع ملف الفيديو غير صالح.'});
  const limit=isVideo?LIBRARY_VIDEO_LIMIT:LIBRARY_FILE_LIMIT;
  const declared=Number(req.headers['content-length']||0);
  if(declared>limit)return res.status(413).json({error:`الحد الأقصى ${isVideo?100:50} ميجابايت.`});
  const stored=`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  tempFile=path.join(uploadDir,`${stored}.uploading`);
  let received=0;
  await new Promise((resolve,reject)=>{
   const output=fs.createWriteStream(tempFile,{flags:'wx'});let settled=false;
   const fail=err=>{if(settled)return;settled=true;output.destroy();req.resume();reject(err)};
   req.on('data',chunk=>{if(settled)return;received+=chunk.length;if(received>limit){const err=new Error(`الحد الأقصى ${isVideo?100:50} ميجابايت.`);err.status=413;return fail(err)}if(!output.write(chunk))req.pause()});
   output.on('drain',()=>req.resume());
   req.on('end',()=>{if(!settled)output.end()});
   req.on('aborted',()=>fail(new Error('انقطع الاتصال قبل اكتمال رفع الملف.')));
   req.on('error',fail);output.on('error',fail);
   output.on('finish',()=>{if(!settled){settled=true;resolve()}});
  });
  if(!received)throw Object.assign(new Error('الملف المرسل فارغ.'),{status:400});
  let storage=stored,localFile=path.join(uploadDir,stored);
  // Large videos must use Drive API streaming/resumable upload. Sending a 50-100 MB
  // base64 payload through Apps Script exceeds its request limits and commonly returns 502.
  // Use the Apps Script bridge only for small files when no service-account credentials exist.
  const driveCredentials=libraryDriveCredentials();
  if(googleBridge.configured()){
   // Always use the resumable Drive session for library files (including small MP4s).
   // The legacy platformUpload endpoint rejects video extensions such as MP4.
   // uploadFile transfers data in 8 MiB chunks and supports all extensions
   // accepted by platformCreateUploadSession in PlatformBridge.gs.
   const uploaded=await googleBridge.uploadFile(tempFile,originalName,mimeType,received);
   storage='drive:'+uploaded.id;
  }else if(driveCredentials){
   const driveId=await uploadLibraryFileToDrive(tempFile,{original_name:originalName,mime_type:mimeType});
   storage='drive:'+driveId;
  }else if(production){
   throw new Error('رفع الفيديوهات الكبيرة يحتاج إعداد حساب خدمة Google Drive: أضف GOOGLE_SERVICE_ACCOUNT_JSON أو GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 في Render، وشارك مجلد الرفع مع بريد حساب الخدمة بصلاحية محرر.');
  }else{
   fs.renameSync(tempFile,localFile);tempFile='';
  }
  if(storage.startsWith('drive:')&&tempFile){fs.rmSync(tempFile,{force:true});tempFile='';}
  const parentId=meta.parent_resource_id?Number(meta.parent_resource_id):null;
  if(parentId){const parent=one("SELECT * FROM library_resources WHERE id=? AND kind='فيديو' AND parent_resource_id IS NULL",parentId);if(!isVideo||!parent||parent.course_id!==courseId)return res.status(400).json({error:'تعذر ربط الفيديو الإضافي بالبانل المحدد.'});}
  const r=q('INSERT INTO library_resources(title,kind,course_id,description,original_name,stored_name,mime_type,size_bytes,uploaded_by,parent_resource_id) VALUES(?,?,?,?,?,?,?,?,?,?)',title,isVideo?'فيديو':kind||'مرجع',courseId,clean(meta.description),originalName,storage,mimeType,received,req.session.user.id,parentId);
  if(isVideo&&Array.isArray(meta.questions))for(const item of meta.questions){
   const opts=Array.isArray(item.options)?item.options.map(clean).filter(Boolean).slice(0,6):[];
   if(clean(item.question)&&opts.length>=2)q('INSERT INTO library_video_questions(resource_id,at_seconds,question,options_json,correct_index,points) VALUES(?,?,?,?,?,?)',r.lastInsertRowid,Math.max(0,Number(item.at_seconds)||0),clean(item.question),JSON.stringify(opts),Math.max(0,Math.min(opts.length-1,Number(item.correct_index)||0)),Math.max(0.25,Math.min(100,Number(item.points)||1)));
  }
  await flushGoogleSheetsWrites();
   res.status(201).json({id:r.lastInsertRowid,ok:true});
 }catch(e){
  if(tempFile)try{fs.rmSync(tempFile,{force:true})}catch{}
  console.error('Library binary upload failed:',e.stack||e.message);
  if(!res.headersSent)res.status(e.status||500).json({error:e.status===413?e.message:(e.message||'تعذر حفظ الملف. راجع إعدادات التخزين وسجل الخادم.')});
 }
});

app.post("/api/library",auth,role("admin","trainer"),async(req,res)=>{
 const isVideo=clean(req.body.kind)==='فيديو';
 const err=required(req.body,["title","original_name","data_url"]);if(err)return res.status(400).json({error:err});
 const courseId=req.body.course_id?Number(req.body.course_id):null;
 if(courseId&&!one("SELECT id FROM courses WHERE id=?",courseId))return res.status(400).json({error:"الدورة المحددة غير موجودة."});
 if(req.session.user.role==="trainer"){if(!courseId)return res.status(400).json({error:"يجب ربط المادة بإحدى دوراتك."});const t=one("SELECT id FROM trainers WHERE user_id=?",req.session.user.id);if(!t||!one("SELECT id FROM courses WHERE id=? AND trainer_id=?",courseId,t.id))return res.status(403).json({error:"يمكنك إضافة مواد لدوراتك فقط."});}
 const match=String(req.body.data_url).match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);if(!match)return res.status(400).json({error:"صيغة الملف غير صحيحة."});
 const bytes=Buffer.from(match[2],"base64"),limit=isVideo?LIBRARY_VIDEO_LIMIT:LIBRARY_FILE_LIMIT;
 if(bytes.length>limit)return res.status(413).json({error:`الحد الأقصى ${isVideo?100:50} ميجابايت.`});
 if(isVideo&&!/^video\//i.test(match[1]))return res.status(400).json({error:"يجب اختيار ملف فيديو صالح."});
 const ext=path.extname(String(req.body.original_name)).slice(0,12).replace(/[^.\w-]/g,"");const stored=`${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
 try{
  let storage=stored;
  if(googleBridge.configured()||production){const uploaded=await uploadApplicationAttachment(req.body.original_name,match[1],match[2]);storage='drive:'+uploaded.id}
  else fs.writeFileSync(path.join(uploadDir,stored),bytes,{flag:"wx"});
  const r=q("INSERT INTO library_resources(title,kind,course_id,description,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)",clean(req.body.title),isVideo?"فيديو":clean(req.body.kind)||"مرجع",courseId,clean(req.body.description),path.basename(clean(req.body.original_name)),storage,match[1],bytes.length,req.session.user.id);
  if(isVideo&&Array.isArray(req.body.questions))for(const item of req.body.questions){const opts=Array.isArray(item.options)?item.options.map(clean).filter(Boolean).slice(0,6):[];if(clean(item.question)&&opts.length>=2){q('INSERT INTO library_video_questions(resource_id,at_seconds,question,options_json,correct_index,points) VALUES(?,?,?,?,?,?)',r.lastInsertRowid,Math.max(0,Number(item.at_seconds)||0),clean(item.question),JSON.stringify(opts),Math.max(0,Math.min(opts.length-1,Number(item.correct_index)||0)));}}
  await flushGoogleSheetsWrites();
   res.status(201).json({id:r.lastInsertRowid,ok:true});
 }catch(e){handleError(res,e);}
});
app.get('/api/library/videos-list',auth,(req,res)=>{const u=req.session.user;let rows=all("SELECT * FROM library_resources WHERE kind='فيديو' ORDER BY created_at DESC");rows=rows.filter(r=>libraryResourceAccess(req,r));res.json(rows.map(r=>({id:r.id,title:r.title,original_name:r.original_name,course_id:r.course_id,parent_resource_id:r.parent_resource_id})));});
app.patch('/api/library/:id/move',auth,role('admin','trainer'),(req,res)=>{const id=Number(req.params.id),target=Number(req.body.parent_resource_id);const video=one('SELECT * FROM library_resources WHERE id=? AND kind=\'فيديو\'',id);const parent=one('SELECT * FROM library_resources WHERE id=? AND kind=\'فيديو\' AND parent_resource_id IS NULL',target);if(!video||!parent||video.id===parent.id)return res.status(400).json({error:'اختر فيديو وعنصر فيديو رئيسيًا صالحًا.'});if(!libraryResourceAccess(req,video)||!libraryResourceAccess(req,parent))return res.sendStatus(403);if(video.course_id!==parent.course_id)return res.status(400).json({error:'يجب أن تكون الفيديوهات في الدورة نفسها لنقلها بين البانلات.'});q('UPDATE library_resources SET parent_resource_id=? WHERE id=?',parent.id,video.id);res.json({ok:true});});
app.get("/api/library/:id/watch",auth,(req,res)=>{
 const r=one('SELECT * FROM library_resources WHERE id=?',Number(req.params.id));if(!libraryResourceAccess(req,r))return res.status(r?403:404).json({error:r?'ليس لديك صلاحية لعرض هذه المادة.':'المادة غير موجودة.'});
 if(r.kind!=='فيديو')return res.status(400).json({error:'هذه المادة ليست فيديو.'});
 const t=req.session.user.role==='trainee'?one('SELECT id FROM trainees WHERE user_id=?',req.session.user.id):null;
 const progress=t?one('SELECT position_seconds,duration_seconds,watched_seconds,completed FROM library_video_progress WHERE resource_id=? AND trainee_id=?',r.id,t.id):null;
 const questions=all('SELECT id,at_seconds,question,options_json FROM library_video_questions WHERE resource_id=? ORDER BY at_seconds,id',r.id).map(x=>({...x,options:JSON.parse(x.options_json),answered:!!(t&&one('SELECT id FROM library_video_answers WHERE question_id=? AND trainee_id=?',x.id,t.id))}));
 const reactions=one('SELECT COUNT(*) n FROM library_reactions WHERE resource_id=?',r.id).n;
 const comments=all('SELECT c.id,c.comment,c.created_at,u.display_name FROM library_comments c JOIN users u ON u.id=c.user_id WHERE c.resource_id=? ORDER BY c.created_at DESC LIMIT 100',r.id);
 const rootId=r.parent_resource_id||r.id;const videos=all('SELECT id,title,original_name FROM library_resources WHERE id=? OR parent_resource_id=? ORDER BY id',rootId,rootId);
 res.json({id:r.id,title:r.title,description:r.description,mime_type:r.mime_type,size_bytes:r.size_bytes,progress,questions,reactions,comments,liked:!!one('SELECT id FROM library_reactions WHERE resource_id=? AND user_id=?',r.id,req.session.user.id),videos});
});
app.get('/api/library/:id/stream',auth,async(req,res)=>{
 const r=one('SELECT * FROM library_resources WHERE id=?',Number(req.params.id));if(!libraryResourceAccess(req,r))return res.status(r?403:404).json({error:'غير مسموح'});if(r.kind!=='فيديو')return res.sendStatus(404);
 if(r.stored_name.startsWith('drive:')){try{return await streamLibraryDriveFile(r.stored_name.slice(6),req,res,r.mime_type)}catch(e){console.error('Library video Drive stream failed:',e.message);return res.status(502).json({error:'تعذر تحميل الفيديو من Google Drive. تحقق من صلاحيات حساب الخدمة ومجلد التخزين.'})}}
 const file=path.join(uploadDir,path.basename(r.stored_name));if(!fs.existsSync(file))return res.status(404).json({error:'ملف الفيديو غير موجود.'});res.setHeader('Accept-Ranges','bytes');res.type(r.mime_type);res.sendFile(file);
});
app.post('/api/library/:id/progress',auth,(req,res)=>{
 const r=one('SELECT * FROM library_resources WHERE id=?',Number(req.params.id));if(!libraryResourceAccess(req,r))return res.sendStatus(r?403:404);if(req.session.user.role!=='trainee')return res.json({ok:true});const t=one('SELECT id FROM trainees WHERE user_id=?',req.session.user.id);if(!t)return res.status(403).json({error:'حساب المتدرب غير مرتبط بملف متدرب.'});
 const duration=Math.max(0,Number(req.body.duration_seconds)||0),position=Math.max(0,Number(req.body.position_seconds)||0),watched=Math.max(0,Math.min(duration||position,Number(req.body.watched_seconds)||0)),completed=Boolean(req.body.completed);
 q(`INSERT INTO library_video_progress(resource_id,trainee_id,position_seconds,duration_seconds,watched_seconds,completed,last_watched_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(resource_id,trainee_id) DO UPDATE SET position_seconds=excluded.position_seconds,duration_seconds=MAX(library_video_progress.duration_seconds,excluded.duration_seconds),watched_seconds=MAX(library_video_progress.watched_seconds,excluded.watched_seconds),completed=MAX(library_video_progress.completed,excluded.completed),last_watched_at=CURRENT_TIMESTAMP`,r.id,t.id,position,duration,watched,completed?1:0);res.json({ok:true});
});
app.post('/api/library/:id/answer',auth,role('trainee'),(req,res)=>{
 const resource=one('SELECT * FROM library_resources WHERE id=? AND kind=\'فيديو\'',Number(req.params.id));
 if(!libraryResourceAccess(req,resource))return res.sendStatus(resource?403:404);
 const t=one('SELECT id FROM trainees WHERE user_id=?',req.session.user.id);
 const question=one('SELECT q.* FROM library_video_questions q WHERE q.id=? AND q.resource_id=?',Number(req.body.question_id),Number(req.params.id));
 if(!t||!question)return res.status(404).json({error:'السؤال غير موجود.'});
 const opts=JSON.parse(question.options_json),selected=Number(req.body.selected_index);
 if(!Number.isInteger(selected)||selected<0||selected>=opts.length)return res.status(400).json({error:'اختر إجابة صحيحة.'});
 const priorCorrect=one('SELECT id FROM library_video_answers WHERE question_id=? AND trainee_id=?',question.id,t.id);
 if(priorCorrect)return res.status(409).json({error:'سبق اجتياز هذا السؤال.'});
 const correct=selected===question.correct_index,points=correct?Math.max(0,Number(question.points)||1):0;
 q('INSERT INTO library_video_answer_attempts(resource_id,question_id,trainee_id,selected_index,is_correct,points_awarded) VALUES(?,?,?,?,?,?)',resource.id,question.id,t.id,selected,correct?1:0,points);
 if(correct)q('INSERT INTO library_video_answers(question_id,trainee_id,selected_index,is_correct) VALUES(?,?,?,1)',question.id,t.id,selected);
 const attempts=one('SELECT COUNT(*) n FROM library_video_answer_attempts WHERE question_id=? AND trainee_id=?',question.id,t.id).n;
 const score=one('SELECT COALESCE(SUM(points_awarded),0) n FROM library_video_answer_attempts WHERE resource_id=? AND trainee_id=?',resource.id,t.id).n;
 res.json({ok:true,correct,attempts,points_awarded:points,score,message:correct?'إجابة صحيحة! حصلت على '+points+' درجة. يمكنك متابعة الفيديو.':'إجابة غير صحيحة. حاول مرة أخرى؛ لم يتم خصم درجات.'});
});

app.post('/api/library/:id/reaction',auth,(req,res)=>{const r=one('SELECT * FROM library_resources WHERE id=?',Number(req.params.id));if(!libraryResourceAccess(req,r))return res.sendStatus(r?403:404);const old=one('SELECT id FROM library_reactions WHERE resource_id=? AND user_id=?',r.id,req.session.user.id);if(old)q('DELETE FROM library_reactions WHERE id=?',old.id);else q('INSERT INTO library_reactions(resource_id,user_id,reaction) VALUES(?,?,\'like\')',r.id,req.session.user.id);res.json({liked:!old,count:one('SELECT COUNT(*) n FROM library_reactions WHERE resource_id=?',r.id).n});});
app.post('/api/library/:id/comments',auth,(req,res)=>{const r=one('SELECT * FROM library_resources WHERE id=?',Number(req.params.id));const comment=clean(req.body.comment);if(!libraryResourceAccess(req,r))return res.sendStatus(r?403:404);if(!comment||comment.length>1000)return res.status(400).json({error:'اكتب تعليقًا لا يتجاوز 1000 حرف.'});q('INSERT INTO library_comments(resource_id,user_id,comment) VALUES(?,?,?)',r.id,req.session.user.id,comment);res.status(201).json({ok:true});});
app.get('/api/library/:id/analytics',auth,role('admin','trainer'),(req,res)=>{
 const r=one('SELECT * FROM library_resources WHERE id=? AND kind=\'فيديو\'',Number(req.params.id));
 if(!r||!libraryResourceAccess(req,r))return res.sendStatus(404);
 const rows=all(`SELECT t.id trainee_id,t.name,COALESCE(p.position_seconds,0) position_seconds,COALESCE(p.duration_seconds,0) duration_seconds,COALESCE(p.watched_seconds,0) watched_seconds,COALESCE(p.completed,0) completed,p.last_watched_at
 FROM trainees t LEFT JOIN library_video_progress p ON p.trainee_id=t.id AND p.resource_id=?
 WHERE (? IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.trainee_id=t.id AND e.course_id=?)) ORDER BY t.name`,r.id,r.course_id,r.course_id);
 const questions=all(`SELECT q.id,q.at_seconds,q.question,q.points,
  COUNT(a.id) attempts,SUM(CASE WHEN a.is_correct=1 THEN 1 ELSE 0 END) correct_attempts
  FROM library_video_questions q LEFT JOIN library_video_answer_attempts a ON a.question_id=q.id
  WHERE q.resource_id=? GROUP BY q.id ORDER BY q.at_seconds,q.id`,r.id);
 const learners=rows.map(x=>({...x,answers:all(`SELECT q.id question_id,q.question,q.at_seconds,q.points,
  COUNT(a.id) attempts,MAX(a.is_correct) passed,MAX(a.attempted_at) last_attempt,
  SUM(a.points_awarded) points_awarded
  FROM library_video_questions q LEFT JOIN library_video_answer_attempts a ON a.question_id=q.id AND a.trainee_id=?
  WHERE q.resource_id=? GROUP BY q.id ORDER BY q.at_seconds,q.id`,x.trainee_id,r.id)}));
 res.json({total:rows.length,started:rows.filter(x=>x.watched_seconds>0).length,completed:rows.filter(x=>x.completed).length,questions,learners});
});

app.get("/api/library/:id/download",auth,async(req,res)=>{
 const r=one("SELECT * FROM library_resources WHERE id=?",Number(req.params.id));if(!libraryResourceAccess(req,r))return res.status(r?403:404).json({error:"ليس لديك صلاحية لفتح هذه المادة."});
 if(r.stored_name.startsWith('drive:')){try{return await streamLibraryDriveFile(r.stored_name.slice(6),req,res,r.mime_type,r.original_name)}catch(e){console.error('Library Drive download failed:',e.message);return res.status(502).json({error:'تعذر تنزيل الملف من Google Drive. تحقق من صلاحيات حساب الخدمة ومجلد التخزين.'})}}
 const file=path.join(uploadDir,path.basename(r.stored_name));if(!fs.existsSync(file))return res.status(404).json({error:"ملف التخزين غير موجود على الخادم."});res.download(file,r.original_name);
});
app.put('/api/library/:id',auth,role('admin','trainer'),async(req,res)=>{
 const r=one('SELECT * FROM library_resources WHERE id=? AND parent_resource_id IS NULL',Number(req.params.id));
 if(!r)return res.status(404).json({error:'عنصر المكتبة غير موجود.'});
 if(!libraryResourceAccess(req,r))return res.status(403).json({error:'ليس لديك صلاحية تعديل هذا العنصر.'});
 const title=clean(req.body.title),kind=clean(req.body.kind)||r.kind,description=String(req.body.description??r.description??'').slice(0,10000),courseId=req.body.course_id?Number(req.body.course_id):null;
 if(!title||title.length>180)return res.status(400).json({error:'اكتب عنواناً صحيحاً للمادة.'});
 if(courseId&&!one('SELECT id FROM courses WHERE id=?',courseId))return res.status(400).json({error:'الدورة المحددة غير موجودة.'});
 if(one('SELECT id FROM library_resources WHERE parent_resource_id=? LIMIT 1',r.id)&&kind!=='فيديو')return res.status(400).json({error:'هذا العنصر يحتوي على فيديوهات مرتبطة؛ لا يمكن تغيير نوعه عن فيديو.'});
 if(req.session.user.role==='trainer'){const t=one('SELECT id FROM trainers WHERE user_id=?',req.session.user.id);if(!courseId||!t||!one('SELECT id FROM courses WHERE id=? AND trainer_id=?',courseId,t.id))return res.status(403).json({error:'يمكنك تعديل مواد دوراتك فقط.'});}
 let storedName=r.stored_name,originalName=r.original_name,mimeType=r.mime_type,sizeBytes=r.size_bytes,temp='';
 if(req.body.file&&req.body.file.data){
  const name=path.basename(clean(req.body.file.name)),ext=path.extname(name).toLowerCase(),isVideo=kind==='فيديو',limit=isVideo?LIBRARY_VIDEO_LIMIT:LIBRARY_FILE_LIMIT;
  const raw=String(req.body.file.data);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))return res.status(400).json({error:'بيانات الملف البديل غير صحيحة.'});
  const bytes=Buffer.from(raw,'base64');if(!bytes.length||bytes.length>limit)return res.status(413).json({error:`الحد الأقصى ${isVideo?100:50} ميجابايت.`});
  if(isVideo&&!['.mp4','.webm','.mov','.m4v'].includes(ext))return res.status(400).json({error:'صيغة الفيديو غير مدعومة.'});
  if(!isVideo&&bytes.length>LIBRARY_FILE_LIMIT)return res.status(413).json({error:'الحد الأقصى 50 ميجابايت.'});
  const tempName=`replace-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;temp=path.join(uploadDir,tempName);fs.writeFileSync(temp,bytes,{flag:'wx'});
  try{
   if(googleBridge.configured()){const uploaded=await googleBridge.uploadFile(temp,name,clean(req.body.file.mime_type)||'application/octet-stream',bytes.length);storedName='drive:'+uploaded.id;fs.rmSync(temp,{force:true});temp='';}
   else if(libraryDriveCredentials()){const uploaded=await uploadLibraryFileToDrive(temp,{original_name:name,mime_type:clean(req.body.file.mime_type)||'application/octet-stream'});storedName='drive:'+uploaded;fs.rmSync(temp,{force:true});temp='';}
   else if(production)throw new Error('تعذر إعداد مخزن الملفات الدائم على الخادم.');
   else{const finalName=`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;fs.renameSync(temp,path.join(uploadDir,finalName));temp='';storedName=finalName;}
  }catch(error){if(temp)fs.rmSync(temp,{force:true});throw error;}
  originalName=name;mimeType=clean(req.body.file.mime_type)||'application/octet-stream';sizeBytes=bytes.length;
 }
 q('UPDATE library_resources SET title=?,kind=?,course_id=?,description=?,original_name=?,stored_name=?,mime_type=?,size_bytes=? WHERE id=?',title,kind,courseId,description,originalName,storedName,mimeType,sizeBytes,r.id);if(kind==='فيديو')q('UPDATE library_resources SET course_id=? WHERE parent_resource_id=?',courseId,r.id);
 if(storedName!==r.stored_name&&!String(r.stored_name).startsWith('drive:')&&one('SELECT COUNT(*) n FROM library_resources WHERE stored_name=?',r.stored_name).n<=1)fs.rmSync(path.join(uploadDir,path.basename(r.stored_name)),{force:true});
 await flushGoogleSheetsWrites();
 res.json({ok:true,message:'تم حفظ تعديلات عنصر المكتبة.'});
});
app.delete("/api/library/:id",auth,role("admin"),(req,res)=>{const r=one("SELECT * FROM library_resources WHERE id=?",Number(req.params.id));if(!r)return res.status(404).json({error:"المرجع غير موجود."});try{const rows=r.parent_resource_id?all('SELECT * FROM library_resources WHERE id=?',r.id):all('SELECT * FROM library_resources WHERE id=? OR parent_resource_id=?',r.id,r.id);for(const item of rows)if(!item.stored_name.startsWith('drive:')&&one('SELECT COUNT(*) n FROM library_resources WHERE stored_name=?',item.stored_name).n<=1)fs.rmSync(path.join(uploadDir,path.basename(item.stored_name)),{force:true});q("DELETE FROM library_resources WHERE id=?",r.parent_resource_id||r.id);res.json({ok:true});}catch(e){handleError(res,e);}});

require('./admin-edit')({app,db,q,one,all,auth,role});
require('./platform-chat')({app,db,q,one,all,auth,role});
require('./learning')({app,db,q,one,all,auth,role});
require('./print-reports')({app,one,all,auth});

// Dedicated storage adapter for the AI knowledge library.
// Uses the same validated Google service-account settings as the existing library,
// while keeping knowledge files in their own Apps Script bridge when configured.
function knowledgeServiceAccount(){ return libraryDriveCredentials(); }
function knowledgeStorageInfo(){
  const hasBridgeConfig=Boolean(process.env.KNOWLEDGE_SCRIPT_URL||process.env.KNOWLEDGE_BRIDGE_SECRET);
  if(knowledgeBridge.configured())return {configured:true,mode:'google-drive-knowledge-apps-script',maxFileMb:8};
  if(hasBridgeConfig)return {configured:false,mode:'incomplete-knowledge-bridge',maxFileMb:0,error:'أكمل KNOWLEDGE_SCRIPT_URL وKNOWLEDGE_BRIDGE_SECRET معًا.'};
  if(production)return {configured:false,mode:'knowledge-bridge-required',maxFileMb:0,error:'يلزم إعداد جسر Google Apps Script المخصص لمكتبة المعرفة.'};
  try{if(knowledgeServiceAccount())return {configured:true,mode:'google-drive-service-account',maxFileMb:50};}
  catch(error){return {configured:false,mode:'invalid-service-account',maxFileMb:0,error:error.message};}
  return {configured:true,mode:'local-development',maxFileMb:50};
}
async function knowledgeDriveClient(){
  const credentials=knowledgeServiceAccount();if(!credentials)throw new Error('Google service-account credentials are not configured.');
  const {google}=require('googleapis');
  const auth=new google.auth.GoogleAuth({...credentials,scopes:['https://www.googleapis.com/auth/drive.file']});
  return google.drive({version:'v3',auth});
}
async function storeKnowledgeFile({name,mimeType,base64}){
  const info=knowledgeStorageInfo();if(!info.configured)throw new Error(info.error||'Google Drive storage is not configured.');
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length>info.maxFileMb*1024*1024)throw new Error(`Current knowledge storage supports files up to ${info.maxFileMb} MB.`);
  if(info.mode==='google-drive-service-account'){
    const drive=await knowledgeDriveClient();
    const safeName=String(name||'document').replace(/[\\/:*?"<>|]/g,'_').slice(0,180);
    const uploaded=await drive.files.create({requestBody:{name:`knowledge_${Date.now()}_${safeName}`,mimeType:mimeType||'application/octet-stream',parents:[process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID||DRIVE_FOLDER_ID]},media:{mimeType:mimeType||'application/octet-stream',body:require('stream').Readable.from(bytes)},fields:'id,name'});
    return `drive-sa:${uploaded.data.id}`;
  }
  if(info.mode==='google-drive-knowledge-apps-script'){
    const uploaded=await knowledgeBridge.upload(name,mimeType,base64);return `knowledge-drive:${uploaded.id}`;
  }
  const ext=path.extname(String(name||'')).slice(0,12).replace(/[^.\w-]/g,'');
  const stored=`knowledge-${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(uploadDir,stored),bytes,{flag:'wx'});return stored;
}
async function readKnowledgeFile(storedName,originalName){
  const stored=String(storedName||'');
  if(stored.startsWith('drive-sa:')){
    const drive=await knowledgeDriveClient();const file=await drive.files.get({fileId:stored.slice(8),alt:'media'},{responseType:'arraybuffer'});
    return {bytes:Buffer.isBuffer(file.data)?file.data:Buffer.from(file.data),name:originalName||'knowledge-document'};
  }
  if(stored.startsWith('knowledge-drive:')){const file=await knowledgeBridge.download(stored.slice('knowledge-drive:'.length));return {bytes:file.bytes,mimeType:file.mime,name:originalName||file.name};}
  if(stored.startsWith('drive:')){const file=await googleBridge.download(stored.slice(6));return {bytes:file.bytes,mimeType:file.mime,name:originalName||file.name};}
  const safe=path.basename(stored);if(!safe||safe!==stored)throw new Error('Invalid stored file path.');
  const target=path.resolve(uploadDir,safe);if(!target.startsWith(path.resolve(uploadDir)+path.sep))throw new Error('Invalid stored file path.');
  return {bytes:fs.readFileSync(target),name:originalName||safe};
}

require('./ai')({app,db,q,one,all,auth,role,flush:flushGoogleSheetsWrites,storeKnowledgeFile,readKnowledgeFile,knowledgeStorageInfo});
require('./adaptive')({app,db,q,one,all,auth,role});
require('./trainee-performance-report')({app,one,all,auth,role});
require('./intelligence')({app,db,q,one,all,auth});

app.use("/api", (req,res)=>res.status(404).json({error:"المسار غير موجود."}));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
initializeGoogleSheetsStore().then(() => {
  const server = app.listen(PORT, "0.0.0.0", () => console.log(`Central Training Administration listening on port ${PORT} (Google Sheets primary database)`));
  server.requestTimeout = 420000;
}).catch(err => {
  console.error("Fatal: Google Sheets database initialization failed:", err.message);
  process.exit(1);
});
