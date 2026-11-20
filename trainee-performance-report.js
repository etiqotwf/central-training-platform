'use strict';

module.exports = function ({ app, one, all, auth, role }) {
  const parseJson = (value, fallback) => {
    try { return JSON.parse(value || ''); } catch { return fallback; }
  };

  app.get('/api/trainees/:id/performance-report', auth, role('admin', 'trainer'), (req, res) => {
    try {
      const traineeId = Number(req.params.id);
      const requestedCourseId = req.query.course_id == null ? null : Number(req.query.course_id);
      if (!Number.isInteger(traineeId) || traineeId <= 0) return res.status(400).json({ error: 'رقم المتدرب غير صحيح.' });
      if (requestedCourseId !== null && (!Number.isInteger(requestedCourseId) || requestedCourseId <= 0)) return res.status(400).json({ error: 'رقم الدورة غير صحيح.' });

      const trainee = one(
        'SELECT id,name,phone,email,department,created_at FROM trainees WHERE id=?',
        traineeId
      );
      if (!trainee) return res.status(404).json({ error: 'المتدرب غير موجود.' });

      const user = req.session.user;
      if (requestedCourseId !== null) {
        const enrolled = one('SELECT 1 ok FROM enrollments WHERE trainee_id=? AND course_id=?', traineeId, requestedCourseId);
        if (!enrolled) return res.status(404).json({ error: 'المتدرب غير مسجل في هذه الدورة.' });
      }

      let reportTrainerId = null;
      if (user.role === 'trainer') {
        const trainer = one('SELECT id FROM trainers WHERE user_id=?', user.id);
        if (!trainer) return res.status(403).json({ error: 'ليس لديك صلاحية لعرض التقرير.' });
        reportTrainerId = trainer.id;
        const allowed = requestedCourseId !== null
          ? one('SELECT 1 ok FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.trainee_id=? AND e.course_id=? AND c.trainer_id=? LIMIT 1', traineeId, requestedCourseId, trainer.id)
          : one(
              `SELECT 1 ok FROM enrollments e
               JOIN courses c ON c.id=e.course_id
               WHERE e.trainee_id=? AND c.trainer_id=? LIMIT 1`,
              traineeId, trainer.id
            );
        if (!allowed) return res.status(403).json({ error: 'لا يمكنك عرض تقرير متدرب خارج دوراتك.' });
      }

      const courses = all(
        `SELECT c.id,c.title,c.starts_on,c.ends_on,e.created_at enrolled_at
         FROM enrollments e JOIN courses c ON c.id=e.course_id
         WHERE e.trainee_id=? AND (? IS NULL OR c.id=?) AND (? IS NULL OR c.trainer_id=?) ORDER BY c.title,c.id`,
        traineeId, requestedCourseId, requestedCourseId, reportTrainerId, reportTrainerId
      ).map(course => {
        const activities = all(
          `SELECT id,kind,title,due_date,created_at,status
           FROM training_activities
           WHERE course_id=? AND kind IN ('tasks','assignments')
           ORDER BY created_at,id`,
          course.id
        );

        const work = activities.flatMap(activity =>
          all(
            `SELECT s.id submission_id,s.answer,s.submitted_at,s.grade,s.feedback,
                    s.reviewed_at,f.name file_name
             FROM activity_submissions s
             LEFT JOIN activity_files f ON f.id=s.file_id
             WHERE s.activity_id=? AND s.trainee_id=?
             ORDER BY s.submitted_at,s.id`,
            activity.id, traineeId
          ).map(submission => ({
            ...submission,
            activity_id: activity.id,
            kind: activity.kind,
            title: activity.title,
            due_date: activity.due_date
          }))
        );

        const tests = all(
          `SELECT a.id activity_id,a.title,a.total_score,a.assessment_json,
                  at.id attempt_id,at.started_at,at.submitted_at,at.status,at.score,
                  at.feedback,at.answers_json,at.answer_text,at.file_id,af.name file_name
           FROM training_activities a
           JOIN assessment_attempts at ON at.activity_id=a.id
           LEFT JOIN activity_files af ON af.id=at.file_id
           WHERE a.course_id=? AND a.kind='tests' AND at.trainee_id=?
           ORDER BY at.started_at,at.id`,
          course.id, traineeId
        ).map(test => {
          const config = parseJson(test.assessment_json, {});
          const answers = parseJson(test.answers_json, []);
          const questions = (config.questions || []).map((question, index) => {
            const selected = answers[index];
            const hasAnswer = Number.isInteger(selected);
            return {
              question: question.text || '',
              answer_index: hasAnswer ? selected : null,
              answer_text: hasAnswer ? (question.options || [])[selected] || '' : '',
              correct_index: Number.isInteger(question.correct) ? question.correct : null,
              correct_text: Number.isInteger(question.correct) ? (question.options || [])[question.correct] || '' : '',
              correct: hasAnswer && selected === question.correct
            };
          });
          return {
            ...test,
            questions,
            correct_count: questions.filter(item => item.correct).length,
            wrong_count: questions.filter(item => item.answer_index !== null && !item.correct).length
          };
        });

        const attendance = all(
          'SELECT date,status FROM attendance WHERE course_id=? AND trainee_id=? ORDER BY date,id',
          course.id, traineeId
        );
        const attendanceSummary = {
          present: attendance.filter(item => item.status === 'حاضر').length,
          absent: attendance.filter(item => item.status === 'غائب').length,
          late: attendance.filter(item => item.status === 'متأخر').length
        };

        const videos = all(
          `SELECT r.id resource_id,r.title,r.description,r.course_id,
                  COALESCE(p.position_seconds,0) position_seconds,
                  COALESCE(p.duration_seconds,0) duration_seconds,
                  COALESCE(p.watched_seconds,0) watched_seconds,
                  COALESCE(p.completed,0) completed,p.last_watched_at
           FROM library_resources r
           LEFT JOIN library_video_progress p
             ON p.resource_id=r.id AND p.trainee_id=?
           WHERE r.kind='فيديو' AND r.course_id=?
           ORDER BY r.created_at,r.id`,
          traineeId, course.id
        ).map(video => {
          const questions = all(
            `SELECT id question_id,at_seconds,question,options_json,correct_index,points
             FROM library_video_questions WHERE resource_id=? ORDER BY at_seconds,id`,
            video.resource_id
          ).map(question => {
            const attempts = all(
              `SELECT selected_index,is_correct,points_awarded,attempted_at
               FROM library_video_answer_attempts
               WHERE question_id=? AND trainee_id=? ORDER BY attempted_at,id`,
              question.question_id, traineeId
            );
            const options = parseJson(question.options_json, []);
            return {
              ...question,
              options,
              attempts: attempts.map(attempt => ({
                ...attempt,
                answer_text: options[attempt.selected_index] || '',
                correct_text: options[question.correct_index] || ''
              })),
              attempts_count: attempts.length,
              correct_attempts: attempts.filter(attempt => !!attempt.is_correct).length,
              points_awarded: attempts.reduce((sum, attempt) => sum + Number(attempt.points_awarded || 0), 0)
            };
          });
          const possiblePoints = questions.reduce((sum, question) => sum + Number(question.points || 0), 0);
          const awardedPoints = questions.reduce((sum, question) => sum + question.points_awarded, 0);
          return {
            ...video,
            watched_percent: video.duration_seconds > 0
              ? Math.min(100, Math.round(video.watched_seconds / video.duration_seconds * 100))
              : 0,
            questions,
            possible_points: possiblePoints,
            awarded_points: awardedPoints,
            score_percent: possiblePoints > 0 ? Math.round(awardedPoints / possiblePoints * 100) : null
          };
        });

        const programs = all(
          `SELECT p.title FROM training_programs p
           JOIN program_courses pc ON pc.program_id=p.id
           WHERE pc.course_id=? ORDER BY p.title`,
          course.id
        );

        const gradedWork = work.filter(item => item.grade !== null && item.grade !== undefined)
          .map(item => Number(item.grade));
        const testGrades = tests.filter(item => item.score !== null && Number(item.total_score) > 0)
          .map(item => Number(item.score) / Number(item.total_score) * 100);
        const videoGrades = videos.filter(item => item.score_percent !== null)
          .map(item => item.score_percent);
        const allGrades = [...gradedWork, ...testGrades, ...videoGrades];

        return {
          ...course,
          programs,
          work,
          tests,
          attendance,
          attendance_summary: attendanceSummary,
          videos,
          summary: {
            activities: activities.length,
            submissions: work.length,
            graded_submissions: gradedWork.length,
            test_attempts: tests.length,
            video_count: videos.length,
            videos_started: videos.filter(video => video.watched_seconds > 0).length,
            video_questions: videos.reduce((sum, video) => sum + video.questions.length, 0),
            average_grade: allGrades.length
              ? Math.round(allGrades.reduce((sum, grade) => sum + grade, 0) / allGrades.length * 100) / 100
              : null
          }
        };
      });

      res.json({ trainee, courses, generated_at: new Date().toISOString() });
    } catch (error) {
      console.error('Trainee performance report:', error.message);
      res.status(500).json({ error: 'تعذر إنشاء تقرير الأداء. راجع سجل الخادم.' });
    }
  });
};
