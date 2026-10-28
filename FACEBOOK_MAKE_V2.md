# Facebook Course Gallery V2

- Make endpoint: `POST /api/facebook-courses/make-sync`
- Facebook posts are classified server-side; only training/course/workshop/field-training posts are shown in the gallery.
- Course titles are extracted from Arabic post text (e.g. "في مجال (...)" / "برنامج تدريبي" / "دورة تدريبية" / "ورشة عمل").
- Manual gallery entries are always preserved.
- Re-running Make updates the same Facebook post by Post ID instead of duplicating it.
- The gallery supports album image arrays when Make supplies image URLs in `attachments`.
- Recommended Make schedule after verification: every 15 minutes or a suitable operational interval.
