'use strict';
const assert = require('node:assert/strict');
const buildCoursePlan = require('../ai/course-planner');
const fs = require('node:fs');
const serverSource = fs.readFileSync(require.resolve('../server'), 'utf8');
const source = [
  'المهارات الأساسية في الحاسوب تشمل تشغيل الجهاز والتعامل مع الملفات والمجلدات. يجب حفظ الملفات بأسماء واضحة وتنظيمها في مجلدات مناسبة.',
  'نظام التشغيل هو البرنامج المسؤول عن إدارة موارد الحاسوب وتشغيل التطبيقات، ويسمح للمستخدم بالتفاعل مع الجهاز.',
  'معالجة النصوص تساعد على إنشاء المستندات وتنسيقها وتحريرها، ويمكن إدراج الجداول والصور وتنسيق الفقرات.',
  'الجداول الإلكترونية تستخدم لتنظيم البيانات وإجراء العمليات الحسابية باستخدام الصيغ والدوال، ويمكن تمثيل النتائج في رسوم بيانية.',
  'أمن المعلومات يتطلب استخدام كلمات مرور قوية وتحديث البرامج وعدم مشاركة بيانات الدخول مع الآخرين.',
  'البريد الإلكتروني يستخدم للتواصل وإرسال المرفقات، ويجب التأكد من عنوان المستلم وعدم فتح الروابط مجهولة المصدر.',
  'العروض التقديمية تنظم الأفكار في شرائح، ويجب أن تكون الشرائح واضحة ومختصرة وتدعم الشرح بصريًا.',
  'التخزين السحابي يسمح بالوصول إلى الملفات من أجهزة متعددة مع مراعاة صلاحيات المشاركة والخصوصية.'
].join('\n');
const plan = buildCoursePlan({ courseTitle: 'الدورة المركزية', count: 4, hours: 8, content: source, sourceTitle: 'المرجع', level: 'مبتدئ', notes: '' });
assert.equal(plan.sessions.length, 4);
assert.deepEqual(plan.sessions.map(s => s.difficulty), ['تمهيدي', 'تمهيدي', 'متوسط', 'متقدم']);
assert.deepEqual(plan.sessions.map(s => s.questions.length), [2, 2, 3, 5]);
for (const s of plan.sessions) {
  assert.match(s.task, /مهمتك:/);
  assert.match(s.assignment, /ذاكر|راجع/);
  assert.doesNotMatch(s.task + s.assignment, /اطلب من المتدربين|على المدرب أن/);
  for (const q of s.questions) {
    assert.match(q.text, /مذاكرتك|المرجع|مراجعتك|اختيار|معلومة|تساعدك|تطبيق/);
    assert.equal(q.options.length, 3);
    assert.ok(q.correct >= 0 && q.correct < q.options.length);
  }
}
assert.equal(plan.sessions.reduce((n, s) => n + s.duration_minutes, 0), 480);
// Trainee responses in both dashboard and standalone session APIs expose learner-safe columns only.
assert.match(serverSource, /sessions = trainee \? all\(`SELECT s\.id,s\.title,s\.course_id,s\.starts_at,s\.duration,s\.platform,s\.url,s\.created_at,s\.description,s\.session_number,s\.difficulty_level,s\.learning_goal/);
assert.match(serverSource, /SELECT s\.id,s\.title,s\.course_id,s\.starts_at,s\.duration,s\.platform,s\.url,s\.created_at,s\.description,s\.session_number,s\.difficulty_level,s\.learning_goal,c\.title course_title FROM sessions/);
assert.doesNotMatch(serverSource.match(/sessions = trainee \? all\(`([\s\S]*?)`, trainee\.id\)/)?.[1] || '', /instructor_notes/);
assert.match(serverSource, /app\.delete\("\/api\/courses\/:id\/enrolled\/:traineeId"/);
assert.match(serverSource, /DELETE FROM enrollments WHERE course_id=\? AND trainee_id=\?/);
assert.match(serverSource, /express\.json\(\{ limit: "75mb" \}\)/);
console.log('Central V37 workflow tests passed.');
