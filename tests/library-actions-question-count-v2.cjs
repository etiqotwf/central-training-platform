'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'public/course-workflow.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'ai/index.js'), 'utf8');
const planner = require(path.join(root, 'ai/course-planner.js'));
assert.match(app, /data-edit-library/);
assert.match(app, /openLibraryEditor\(Number\(editLibrary\.dataset\.editLibrary\)\)/);
assert.match(app, /data-add-library-video/);
assert.match(app, /addVideoToLibraryPanel\(Number\(addLibraryVideo\.dataset\.addLibraryVideo\)\)/);
assert.match(workflow, /name="questions_per_test"/);
assert.match(workflow, /id="workflowQuestionCount"/);
assert.match(workflow, /body\.question_count=Number\(countInput\.value\)/);
assert.match(api, /questionsPerTest=Number\(req\.body\.questions_per_test\|\|5\)/);
assert.match(api, /requestedCount<1\|\|requestedCount>30/);
const content = Array.from({ length: 18 }, (_, i) => `المقطع التدريبي ${i + 1} يشرح الإجراءات الفنية المرتبطة بإدارة الموارد المائية والصرف وكيفية تنفيذ الأعمال ومراجعة النتائج بدقة.`).join('\n\n');
for (const expected of [5, 7, 10, 15, 30]) {
  const plan = planner({ courseTitle: 'دورة اختبار', count: 3, hours: 6, content, sourceTitle: 'مرجع', level: 'متوسط', questionsPerTest: expected });
  assert.deepEqual(plan.sessions.map(x => x.questions.length), [expected, expected, expected]);
}
console.log('Library edit/add-video handlers and configurable workflow question counts passed.');
