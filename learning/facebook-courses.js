'use strict';

const crypto = require('crypto');

module.exports = function ({ app, auth, role, wrap }) {

  // =========================================================
  // NEW SUPABASE
  // =========================================================
  const supaUrl = () =>
    String(process.env.SUPABASE_URL || '').replace(/\/$/, '');

  const supaKey = () =>
    String(process.env.SUPABASE_SECRET_KEY || '').trim();

  const bucket = () =>
    String(
      process.env.SUPABASE_STORAGE_BUCKET ||
      'facebook-course-images'
    ).trim();

  const configured = () => !!(supaUrl() && supaKey());

  const headers = (extra = {}) => {
    const key = supaKey();

    return {
      apikey: key,

      ...(key.startsWith('eyJ')
        ? {
            Authorization: `Bearer ${key}`
          }
        : {}),

      ...extra
    };
  };

  const enc = v => encodeURIComponent(String(v));

  function ensure() {
    if (!configured()) {
      throw Object.assign(
        Error(
          'تخزين Supabase غير مفعّل. أضف SUPABASE_URL و SUPABASE_SECRET_KEY إلى Environment Variables.'
        ),
        {
          status: 503
        }
      );
    }
  }

  async function db(path, opt = {}) {

    ensure();

    const r = await fetch(
      `${supaUrl()}/rest/v1/${path}`,
      {
        ...opt,

        headers: {
          ...headers({
            'Content-Type': 'application/json'
          }),

          ...(opt.headers || {})
        },
        signal: opt.signal || AbortSignal.timeout(15000)
      }
    );

    const text = await r.text();

    let j = null;

    try {
      j = text
        ? JSON.parse(text)
        : null;
    } catch {
      j = text;
    }

    if (!r.ok) {
      throw Error(
        `Supabase ${r.status}: ${
          typeof j === 'object'
            ? (
                j.message ||
                j.error ||
                JSON.stringify(j)
              )
            : j
        }`
      );
    }

    return j;
  }

  // =========================================================
  // OLD SUPABASE
  // =========================================================
  const oldSupaUrl = () =>
    String(
      process.env.OLD_SUPABASE_URL ||
      'https://xmgbzvcogadsspnfrmdu.supabase.co'
    ).replace(/\/$/, '');

  const oldSupaKey = () =>
    String(
      process.env.OLD_SUPABASE_SECRET_KEY ||
      ''
    ).trim();

  const keyHeaders = (
    key,
    extra = {}
  ) => ({
    apikey: key,

    ...(String(key).startsWith('eyJ')
      ? {
          Authorization: `Bearer ${key}`
        }
      : {}),

    ...extra
  });

  async function rawDb(
    base,
    key,
    path,
    opt = {}
  ) {

    if (!base || !key) {
      throw Error(
        'Supabase configuration missing'
      );
    }

    const r = await fetch(
      `${base}/rest/v1/${path}`,
      {
        ...opt,

        headers: {
          ...keyHeaders(
            key,
            {
              'Content-Type':
                'application/json'
            }
          ),

          ...(opt.headers || {})
        },
        signal: opt.signal || AbortSignal.timeout(15000)
      }
    );

    const text = await r.text();

    let j = null;

    try {
      j = text
        ? JSON.parse(text)
        : null;
    } catch {
      j = text;
    }

    if (!r.ok) {
      throw Error(
        `Supabase ${r.status}: ${
          typeof j === 'object'
            ? (
                j.message ||
                j.error ||
                JSON.stringify(j)
              )
            : j
        }`
      );
    }

    return j;
  }

  // =========================================================
  // CONNECTION TEST
  // =========================================================
  async function probe(
    label,
    base,
    key
  ) {

    const out = {
      label,
      configured: !!(base && key),
      ok: false,
      status: null,
      error: null
    };

    if (!out.configured) {
      out.error =
        'configuration missing';

      return out;
    }

    try {

      const r = await fetch(
        `${base}/rest/v1/facebook_course_posts?select=post_id&limit=1`,
        {
          headers: keyHeaders(
            key,
            {
              Accept:
                'application/json'
            }
          ),

          signal:
            AbortSignal.timeout(
              15000
            )
        }
      );

      out.status = r.status;
      out.ok = r.ok;

      if (!r.ok) {
        out.error =
          (await r.text())
            .slice(0, 500);
      }

    } catch (e) {

      out.error =
        `${e.name || 'Error'}: ${
          e.message ||
          String(e)
        }`;

      if (e.cause) {
        out.cause =
          String(
            e.cause?.message ||
            e.cause
          );
      }
    }

    return out;
  }

  // =========================================================
  // TEXT HELPERS
  // =========================================================
  function normalizeArabic(v = '') {
    return String(v)
      .replace(/[ـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanTitle(v = '') {
    return String(v)
      .replace(/[«»“”"']/g, '')
      .replace(
        /^[\s•📌📍🎓✅⭐🌟🔹🔸▪▫–—-]+/u,
        ''
      )
      .replace(
        /[.،,:؛]+$/u,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim()
      .slice(
        0,
        180
      );
  }

  function titleFrom(
    message = ''
  ) {

    const raw =
      String(message || '')
        .replace(/\r/g, '');

    const flat =
      raw
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const patterns = [

      /(?:في\s+مجال|فى\s+مجال)\s*[(:：-]?\s*[«"“]?([^()«»"”\n]{4,150})/iu,

      /(?:برنامج\s+تدريبي|البرنامج\s+التدريبي|برنامج\s+تدريبى)\s*(?:في|فى|عن|بعنوان|:|-)?\s*[«"“]?([^()«»"”\n]{4,150})/iu,

      /(?:دورة\s+تدريبية|الدورة\s+التدريبية|دوره\s+تدريبيه)\s*(?:في|فى|عن|بعنوان|:|-)?\s*[«"“]?([^()«»"”\n]{4,150})/iu,

      /(?:ورشة\s+عمل|ورشه\s+عمل)\s*(?:عن|بعنوان|في|فى|:|-)?\s*[«"“]?([^()«»"”\n]{4,150})/iu,

      /(?:ندوة|ندوه)\s*(?:عن|بعنوان|في|فى|:|-)?\s*[«"“]?([^()«»"”\n]{4,150})/iu
    ];

    for (const re of patterns) {

      const m =
        flat.match(re);

      if (m?.[1]) {

        const t =
          cleanTitle(
            m[1].split(
              /(?:\s+(?:والذي|والتى|والتي|وذلك|حيث|بمشاركة|لعدد|خلال|ضمن)\s+)/iu
            )[0]
          );

        if (t.length >= 4) {
          return t;
        }
      }
    }

    const lines =
      raw
        .split(/\n+/)
        .map(cleanTitle)
        .filter(
          x =>
            x.length >= 4 &&
            !/^#/.test(x)
        );

    return (
      lines[0] ||
      'دورة / فعالية تدريبية'
    ).slice(
      0,
      180
    );
  }

  function classifyTraining(
    message = '',
    title = ''
  ) {

    const n =
      normalizeArabic(
        `${title} ${message}`
      );

    const strong = [
      'دوره تدريبيه',
      'برنامج تدريبي',
      'برنامج تدريبى',
      'التدريب الميداني',
      'التدريب الميدانى',
      'فعاليات التدريب',
      'اختتام التدريب',
      'اختتمت',
      'ورشه عمل',
      'ندوه تدريبيه',
      'متدربين',
      'المتدربين'
    ];

    const medium = [
      'تدريب',
      'دوره',
      'برنامج',
      'ورشه',
      'ندوه',
      'فنيين',
      'مهندسين'
    ];

    const score =
      strong.reduce(
        (a, k) =>
          a +
          (
            n.includes(
              normalizeArabic(k)
            )
              ? 2
              : 0
          ),
        0
      ) +
      medium.reduce(
        (a, k) =>
          a +
          (
            n.includes(
              normalizeArabic(k)
            )
              ? 1
              : 0
          ),
        0
      );

    return {
      is_training:
        score >= 2,

      training_score:
        score,

      category:
        n.includes('ورشه')
          ? 'ورشة عمل'
          : n.includes('ندوه')
            ? 'ندوة'
            : (
                n.includes(
                  'ميداني'
                ) ||
                n.includes(
                  'ميدانى'
                )
              )
              ? 'تدريب ميداني'
              : 'دورة تدريبية'
    };
  }

  function cleanBody(
    b = {}
  ) {

    return {
      title:
        String(
          b.title || ''
        )
          .trim()
          .slice(
            0,
            180
          ),

      message:
        String(
          b.message || ''
        )
          .trim()
          .slice(
            0,
            5000
          ),

      created_time:
        b.created_time
          ? new Date(
              b.created_time
            ).toISOString()
          : new Date()
              .toISOString(),

      permalink:
        String(
          b.permalink_url ||
          b.permalink ||
          ''
        )
          .trim()
          .slice(
            0,
            1000
          )
    };
  }

  function publicPost(x) {

    const at =
      Array.isArray(
        x.attachments
      )
        ? x.attachments
        : [];

    const images =
      at
        .map(
          a =>
            a?.imageUrl ||
            a?.url
        )
        .filter(Boolean);

    const title =
      x.manually_edited &&
      x.manual_title
        ? x.manual_title
        : (
            x.title ||
            titleFrom(
              x.message ||
              ''
            )
          );

    const message =
      x.manually_edited &&
      x.manual_message != null
        ? x.manual_message
        : (
            x.message ||
            ''
          );

    return {
      id:
        x.post_id,

      post_id:
        x.post_id,

      source:
        x.source,

      title,

      message,

      created_time:
        x.created_time ||
        '',

      permalink_url:
        x.permalink ||
        '',

      image:
        x.cover_image ||
        images[0] ||
        '',

      images:
        images.length
          ? images
          : (
              x.cover_image
                ? [
                    x.cover_image
                  ]
                : []
            ),

      hidden:
        !!x.hidden,

      ...classifyTraining(
        message,
        title
      )
    };
  }

  // =========================================================
  // STORAGE
  // =========================================================
  function extFromType(
    t = ''
  ) {

    return /png/i.test(t)
      ? 'png'
      : /webp/i.test(t)
        ? 'webp'
        : 'jpg';
  }

  async function uploadBuffer(
    buf,
    contentType,
    name
  ) {

    ensure();

    const r =
      await fetch(
        `${supaUrl()}/storage/v1/object/${enc(bucket())}/${name
          .split('/')
          .map(enc)
          .join('/')}`,
        {
          method: 'POST',

          headers:
            headers({
              'Content-Type':
                contentType ||
                'image/jpeg',

              'x-upsert':
                'true'
            }),

          body:
            buf
        }
      );

    if (!r.ok) {
      throw Error(
        `Storage ${r.status}: ${
          await r.text()
        }`
      );
    }

    return `${supaUrl()}/storage/v1/object/public/${bucket()}/${name
      .split('/')
      .map(enc)
      .join('/')}`;
  }

  async function uploadDataUrl(
    dataUrl,
    prefix = 'manual'
  ) {

    if (!dataUrl) {
      return '';
    }

    const m =
      String(dataUrl)
        .match(
          /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/
        );

    if (!m) {
      throw Object.assign(
        Error(
          'صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP.'
        ),
        {
          status: 400
        }
      );
    }

    const buf =
      Buffer.from(
        m[2],
        'base64'
      );

    if (
      buf.length >
      6 * 1024 * 1024
    ) {
      throw Object.assign(
        Error(
          'حجم الصورة أكبر من 6 MB.'
        ),
        {
          status: 400
        }
      );
    }

    const ext =
      m[1] === 'jpeg'
        ? 'jpg'
        : m[1];

    const name =
      `${prefix}/${Date.now()}-${crypto
        .randomBytes(5)
        .toString('hex')}.${ext}`;

    return uploadBuffer(
      buf,
      `image/${m[1]}`,
      name
    );
  }

  async function cacheRemoteImage(
    url,
    postId,
    index
  ) {

    if (
      !/^https:\/\//i.test(
        String(url || '')
      )
    ) {
      return '';
    }

    try {

      const r =
        await fetch(
          url,
          {
            redirect:
              'follow',

            signal:
              AbortSignal.timeout(
                20000
              )
          }
        );

      if (!r.ok) {
        return '';
      }

      const type =
        r.headers.get(
          'content-type'
        ) ||
        'image/jpeg';

      if (
        !type.startsWith(
          'image/'
        )
      ) {
        return '';
      }

      const buf =
        Buffer.from(
          await r.arrayBuffer()
        );

      if (
        !buf.length ||
        buf.length >
          12 * 1024 * 1024
      ) {
        return '';
      }

      const hash =
        crypto
          .createHash(
            'sha1'
          )
          .update(url)
          .digest('hex')
          .slice(
            0,
            12
          );

      const safe =
        String(postId)
          .replace(
            /[^a-zA-Z0-9_-]/g,
            '_'
          );

      return await uploadBuffer(
        buf,
        type,
        `facebook/${safe}/${index}-${hash}.${extFromType(type)}`
      );

    } catch (e) {

      console.warn(
        'Facebook image cache:',
        e.message
      );

      return '';
    }
  }

  function makeImages(
    b = {}
  ) {

    const out = [];

    const add = v => {

      v =
        String(v || '')
          .trim();

      if (
        /^https:\/\//i.test(v) &&
        !out.includes(v)
      ) {
        out.push(v);
      }
    };

    add(
      b.full_picture
    );

    add(
      b.fullPicture
    );

    add(
      b.coverImage
    );

    add(
      b.image
    );

    add(
      b.picture
    );

    const walk = v => {

      if (!v) {
        return;
      }

      if (
        Array.isArray(v)
      ) {
        return v.forEach(
          walk
        );
      }

      if (
        typeof v ===
        'string'
      ) {
        return add(v);
      }

      if (
        typeof v !==
        'object'
      ) {
        return;
      }

      add(v.src);
      add(v.url);
      add(v.imageUrl);
      add(v.image_url);
      add(v.source);
      add(v.image?.src);
      add(
        v.media?.image?.src
      );

      walk(v.data);
      walk(v.attachments);
      walk(
        v.subattachments
      );
      walk(v.images);
    };

    walk(
      b.attachments
    );

    walk(
      b.mappable_attachments
    );

    walk(
      b.mappableAttachments
    );

    walk(
      b.images
    );

    return out.slice(
      0,
      40
    );
  }

  async function cacheImages(
    urls,
    id,
    old = []
  ) {

    const jobs =
      urls.map(
        (u, i) =>
          cacheRemoteImage(
            u,
            id,
            i
          )
      );

    const got =
      await Promise.all(
        jobs
      );

    const saved =
      got
        .map(
          (u, i) =>
            u
              ? {
                  imageUrl:
                    u,

                  sourceUrl:
                    urls[i],

                  type:
                    'image'
                }
              : null
        )
        .filter(Boolean);

    return saved.length
      ? saved
      : old;
  }

  // =========================================================
  // DATABASE HELPERS
  // =========================================================
  async function getOne(id) {

    const rows =
      await db(
        `facebook_course_posts?post_id=eq.${enc(id)}&limit=1`,
        {
          headers: {
            Accept:
              'application/json'
          }
        }
      );

    return rows?.[0] ||
      null;
  }

  async function upsert(row) {

    return db(
      'facebook_course_posts?on_conflict=post_id',
      {
        method:
          'POST',

        headers: {
          Prefer:
            'resolution=merge-duplicates,return=representation'
        },

        body:
          JSON.stringify(
            row
          )
      }
    );
  }

  // =========================================================
  // HEALTH
  // =========================================================
  app.get(
    '/api/facebook-courses/health',
    auth,
    role('admin'),
    async (req, res) => {

      const current =
        await probe(
          'new',
          supaUrl(),
          supaKey()
        );

      const old =
        await probe(
          'old',
          oldSupaUrl(),
          oldSupaKey()
        );

      res.json({
        ok:
          current.ok ||
          old.ok,

        current,
        old
      });
    }
  );

  // =========================================================
  // GET GALLERY
  // =========================================================
  app.get(
    '/api/facebook-courses',
    auth,
    async (req, res) => {

      let all = [];
      let source = 'new';
      let warning = '';

      try {

        all =
          await rawDb(
            supaUrl(),
            supaKey(),
            'facebook_course_posts?select=*&order=created_time.desc.nullslast',
            {
              headers: {
                Accept:
                  'application/json'
              }
            }
          );

      } catch (e1) {

        console.error(
          '[Facebook Gallery] NEW Supabase:',
          e1.message
        );

        try {

          all =
            await rawDb(
              oldSupaUrl(),
              oldSupaKey(),
              'facebook_course_posts?select=*&order=created_time.desc.nullslast',
              {
                headers: {
                  Accept:
                    'application/json'
                }
              }
            );

          source = 'old';

          warning =
            'يتم عرض البيانات مؤقتاً من المصدر القديم لحين استكمال اتصال قاعدة البيانات الجديدة.';

        } catch (e2) {

          console.error(
            '[Facebook Gallery] OLD Supabase:',
            e2.message
          );

          return res.json({
            configured:
              false,

            page:
              'https://www.facebook.com/dtccontact/',

            synced_at:
              null,

            posts:
              [],

            total_imported:
              0,

            hidden_count:
              0,

            excluded_count:
              0,

            source:
              'unavailable',

            warning:
              'تعذر الاتصال بمصدر بيانات معرض الدورات. افتح /api/facebook-courses/health بحساب المدير لمعرفة السبب.'
          });
        }
      }

      const posts =
        all
          .filter(
            x =>
              !x.hidden
          )
          .map(
            publicPost
          );

      res.json({
        configured:
          true,

        page:
          'https://www.facebook.com/dtccontact/',

        synced_at:
          all[0]?.updated_at ||
          null,

        posts,

        total_imported:
          all.filter(
            x =>
              x.source !==
              'manual'
          ).length,

        hidden_count:
          all.filter(
            x =>
              x.hidden
          ).length,

        excluded_count:
          0,

        source,

        warning
      });
    }
  );

  // =========================================================
  // ADD MANUAL COURSE
  // =========================================================
  app.post(
    '/api/facebook-courses',
    auth,
    role('admin'),
    wrap(
      async (
        req,
        res
      ) => {

        const b =
          cleanBody(
            req.body
          );

        if (!b.title) {
          throw Object.assign(
            Error(
              'اكتب اسم الدورة.'
            ),
            {
              status:
                400
            }
          );
        }

        const image =
          await uploadDataUrl(
            req.body?.image_data,
            'manual'
          );

        const id =
          `manual-${Date.now()}-${crypto
            .randomBytes(3)
            .toString('hex')}`;

        const row = {
          post_id:
            id,

          source:
            'manual',

          title:
            b.title,

          message:
            b.message,

          created_time:
            b.created_time,

          permalink:
            b.permalink,

          cover_image:
            image,

          attachments:
            image
              ? [
                  {
                    imageUrl:
                      image,

                    type:
                      'image'
                  }
                ]
              : [],

          hidden:
            false,

          updated_at:
            new Date()
              .toISOString()
        };

        const saved =
          (
            await upsert(
              row
            )
          )?.[0] ||
          row;

        res.json({
          ok:
            true,

          post:
            publicPost(
              saved
            ),

          message:
            'تمت إضافة الدورة إلى المعرض.'
        });
      }
    )
  );

  // =========================================================
  // UPDATE COURSE
  // =========================================================
  app.put(
    '/api/facebook-courses/:id',
    auth,
    role('admin'),
    wrap(
      async (
        req,
        res
      ) => {

        const old =
          await getOne(
            req.params.id
          );

        if (!old) {
          throw Object.assign(
            Error(
              'الدورة غير موجودة.'
            ),
            {
              status:
                404
            }
          );
        }

        const b =
          cleanBody(
            req.body
          );

        if (!b.title) {
          throw Object.assign(
            Error(
              'اكتب اسم الدورة.'
            ),
            {
              status:
                400
            }
          );
        }

        let cover =
          old.cover_image ||
          '';

        let attachments =
          old.attachments ||
          [];

        if (
          req.body?.remove_image
        ) {
          cover = '';
          attachments = [];
        }

        if (
          req.body?.image_data
        ) {

          cover =
            await uploadDataUrl(
              req.body.image_data,
              old.source ===
              'manual'
                ? 'manual'
                : 'edited'
            );

          attachments = [
            {
              imageUrl:
                cover,

              type:
                'image'
            }
          ];
        }

        const row =
          old.source ===
          'manual'
            ? {
                ...old,

                title:
                  b.title,

                message:
                  b.message,

                created_time:
                  b.created_time,

                permalink:
                  b.permalink,

                cover_image:
                  cover,

                attachments,

                updated_at:
                  new Date()
                    .toISOString()
              }
            : {
                ...old,

                manually_edited:
                  true,

                manual_title:
                  b.title,

                manual_message:
                  b.message,

                created_time:
                  b.created_time,

                permalink:
                  b.permalink,

                cover_image:
                  cover,

                attachments,

                updated_at:
                  new Date()
                    .toISOString()
              };

        const saved =
          (
            await upsert(
              row
            )
          )?.[0] ||
          row;

        res.json({
          ok:
            true,

          post:
            publicPost(
              saved
            ),

          message:
            'تم تحديث بيانات الدورة.'
        });
      }
    )
  );

  // =========================================================
  // DELETE / HIDE
  // =========================================================
  app.delete(
    '/api/facebook-courses/:id',
    auth,
    role('admin'),
    wrap(
      async (
        req,
        res
      ) => {

        const old =
          await getOne(
            req.params.id
          );

        if (!old) {
          throw Object.assign(
            Error(
              'العنصر غير موجود.'
            ),
            {
              status:
                404
            }
          );
        }

        if (
          old.source ===
          'manual'
        ) {

          await db(
            `facebook_course_posts?post_id=eq.${enc(req.params.id)}`,
            {
              method:
                'DELETE',

              headers: {
                Prefer:
                  'return=minimal'
              }
            }
          );

          return res.json({
            ok:
              true,

            message:
              'تم حذف الإضافة المحلية من المعرض.'
          });
        }

        await db(
          `facebook_course_posts?post_id=eq.${enc(req.params.id)}`,
          {
            method:
              'PATCH',

            headers: {
              Prefer:
                'return=minimal'
            },

            body:
              JSON.stringify({
                hidden:
                  true,

                updated_at:
                  new Date()
                    .toISOString()
              })
          }
        );

        res.json({
          ok:
            true,

          message:
            'تم إخفاء المنشور من المعرض، ولن تعيده مزامنة Facebook تلقائياً.'
        });
      }
    )
  );

  // =========================================================
  // MAKE -> NEW SUPABASE
  // =========================================================
  app.post(
    '/api/facebook-courses/make-sync',
    wrap(
      async (
        req,
        res
      ) => {

        const secret =
          String(
            process.env.MAKE_SYNC_SECRET ||
            ''
          ).trim();

        const sent =
          String(
            req.get(
              'x-sync-secret'
            ) ||
            req.get(
              'authorization'
            ) ||
            ''
          )
            .replace(
              /^Bearer\s+/i,
              ''
            )
            .trim();

        if (
          secret &&
          sent !== secret
        ) {
          return res
            .status(401)
            .json({
              ok:
                false,

              error:
                'Unauthorized sync request.'
            });
        }

        const b =
          req.body ||
          {};

        const id =
          String(
            b.postId ||
            b.post_id ||
            b.id ||
            ''
          ).trim();

        if (!id) {
          throw Object.assign(
            Error(
              'Facebook post id is required.'
            ),
            {
              status:
                400
            }
          );
        }

        const old =
          await getOne(id);

        const message =
          String(
            b.message ||
            b.story ||
            ''
          )
            .trim()
            .slice(
              0,
              12000
            );

        const urls =
          makeImages(b);

        const created =
          b.created_time ||
          b.createdTime ||
          new Date()
            .toISOString();

        let created_time;

        try {
          created_time =
            new Date(
              created
            ).toISOString();
        } catch {
          created_time =
            new Date()
              .toISOString();
        }

        const attachments =
          urls.length
            ? await cacheImages(
                urls,
                id,
                old?.attachments ||
                []
              )
            : (
                old?.attachments ||
                []
              );

        const cover =
          attachments[0]
            ?.imageUrl ||
          old?.cover_image ||
          '';

        const row = {
          post_id:
            id,

          source:
            'facebook-make',

          title:
            String(
              b.title ||
              titleFrom(
                message
              )
            )
              .trim()
              .slice(
                0,
                180
              ),

          message,

          created_time,

          permalink:
            String(
              b.permalink_url ||
              b.permalink ||
              b.link ||
              ''
            )
              .trim()
              .slice(
                0,
                1500
              ),

          cover_image:
            cover,

          post_type:
            String(
              b.status_type ||
              b.type ||
              ''
            )
              .trim()
              .slice(
                0,
                80
              ),

          attachments,

          hidden:
            old?.hidden ||
            false,

          manually_edited:
            old?.manually_edited ||
            false,

          manual_title:
            old?.manual_title ||
            null,

          manual_message:
            old?.manual_message ??
            null,

          updated_at:
            new Date()
              .toISOString()
        };

        await upsert(
          row
        );

        res.json({
          ok:
            true,

          created:
            !old,

          post_id:
            id,

          images:
            attachments.length,

          message:
            !old
              ? 'تم استيراد منشور Facebook وحفظ صوره دائماً.'
              : 'تم تحديث منشور Facebook مع الحفاظ على حالة الإخفاء والتعديلات اليدوية.'
        });
      }
    )
  );

  // =========================================================
  // OLD SUPABASE -> NEW SUPABASE
  // MANUAL PERMANENT SYNC
  // =========================================================
  async function syncOldToNew(options = {}) {

    const copyImages = options.copyImages === true;

    ensure();

    const oldKey =
      oldSupaKey();

    if (!oldKey) {
      throw Object.assign(
        Error(
          'OLD_SUPABASE_SECRET_KEY غير مضاف إلى Environment Variables.'
        ),
        {
          status:
            503
        }
      );
    }

    console.log(
      '[Facebook Sync] Starting OLD -> NEW synchronization...'
    );

    // Fail fast: never leave the UI waiting while DNS/network is unavailable.
    const newProbe = await probe('new', supaUrl(), supaKey());
    if (!newProbe.ok) {
      const detail = newProbe.cause || newProbe.error || `HTTP ${newProbe.status || 'unknown'}`;
      console.error('[Facebook Sync] NEW unavailable:', detail);
      const dns = /ENOTFOUND|NXDOMAIN|getaddrinfo/i.test(detail);
      throw Object.assign(Error(dns
        ? `عنوان Supabase الجديد لا يعمل على DNS: ${supaUrl()}. انسخ Project URL من Supabase > Connect ثم حدّث SUPABASE_URL في Render.`
        : `تعذر الاتصال بـ Supabase الجديد: ${detail}`), {status:502});
    }
    const oldProbe = await probe('old', oldSupaUrl(), oldKey);
    if (!oldProbe.ok) {
      const detail = oldProbe.cause || oldProbe.error || `HTTP ${oldProbe.status || 'unknown'}`;
      console.error('[Facebook Sync] OLD unavailable:', detail);
      throw Object.assign(Error(`تعذر الاتصال بـ Supabase القديم: ${detail}`), {status:502});
    }
    console.log('[Facebook Sync] Connections OK; reading records...');

    // Read all existing Facebook records from OLD Supabase
    const oldRows =
      await rawDb(
        oldSupaUrl(),
        oldKey,
        'facebook_course_posts?select=*&order=created_time.asc.nullsfirst',
        {
          headers: {
            Accept:
              'application/json'
          }
        }
      );

    // Read NEW database
    const currentRows =
      await db(
        'facebook_course_posts?select=*',
        {
          headers: {
            Accept:
              'application/json'
          }
        }
      );

    const currentById =
      new Map(
        (
          currentRows ||
          []
        ).map(
          x => [
            String(
              x.post_id
            ),
            x
          ]
        )
      );

    let created = 0;
    let updated = 0;
    let imagesCopied = 0;
    let imageFailures = 0;

    const isNewStorageUrl =
      u =>
        String(
          u ||
          ''
        ).startsWith(
          `${supaUrl()}/storage/v1/object/public/${bucket()}/`
        );

    async function migrateImage(
      url,
      postId,
      index
    ) {

      url =
        String(
          url ||
          ''
        ).trim();

      if (
        !/^https:\/\//i.test(
          url
        )
      ) {
        return '';
      }

      // Already stored in NEW Supabase
      if (
        isNewStorageUrl(
          url
        )
      ) {
        return url;
      }

      // Manual UI sync is intentionally fast: metadata is synchronized first.
      // Full image caching can be enabled by a controlled background/admin run.
      if (!copyImages) return url;

      const cached = await cacheRemoteImage(url, postId, index);
      if (cached) { imagesCopied++; return cached; }
      // Do not destroy a working OLD image URL if copying it fails.
      imageFailures++;
      return url;
    }

    for (
      const source of
      oldRows || []
    ) {

      const id =
        String(
          source.post_id ||
          ''
        ).trim();

      if (!id) {
        continue;
      }

      const existing =
        currentById.get(
          id
        ) ||
        null;

      const sourceAttachments =
        Array.isArray(
          source.attachments
        )
          ? source.attachments
          : [];

      const urls = [];

      const add = u => {

        u =
          String(
            u ||
            ''
          ).trim();

        if (
          /^https:\/\//i.test(
            u
          ) &&
          !urls.includes(
            u
          )
        ) {
          urls.push(u);
        }
      };

      add(
        source.cover_image
      );

      for (
        const a of
        sourceAttachments
      ) {
        add(
          a?.imageUrl ||
          a?.url
        );
      }

      const migrated = [];

      for (
        let i = 0;
        i < urls.length;
        i++
      ) {

        const imageUrl =
          await migrateImage(
            urls[i],
            id,
            i
          );

        if (imageUrl) {

          migrated.push({
            imageUrl,

            sourceUrl:
              urls[i],

            type:
              'image'
          });
        }
      }

      const cover =
        migrated[0]
          ?.imageUrl ||
        source.cover_image ||
        existing
          ?.cover_image ||
        '';

      // Important:
      // hidden/manual values already present in NEW
      // always win over OLD values.
      const row = {
        post_id:
          id,

        message:
          source.message ||
          '',

        title:
          source.title ||
          titleFrom(
            source.message ||
            ''
          ),

        created_time:
          source.created_time ||
          null,

        permalink:
          source.permalink ||
          '',

        cover_image:
          cover,

        post_type:
          source.post_type ||
          '',

        attachments:
          migrated.length
            ? migrated
            : sourceAttachments,

        source:
          source.source ||
          'facebook',

        hidden:
          existing?.hidden ??
          source.hidden ??
          false,

        manually_edited:
          existing
            ?.manually_edited ??
          source
            .manually_edited ??
          false,

        manual_title:
          existing
            ?.manual_title ??
          source
            .manual_title ??
          null,

        manual_message:
          existing
            ?.manual_message ??
          source
            .manual_message ??
          null,

        updated_at:
          new Date()
            .toISOString()
      };

      await upsert(
        row
      );

      if (existing) {
        updated++;
      } else {
        created++;
      }

      currentById.set(
        id,
        {
          ...(existing || {}),
          ...row
        }
      );
    }

    const result = {
      old_total:
        (
          oldRows ||
          []
        ).length,

      created,

      updated,

      images_copied:
        imagesCopied,

      image_failures:
        imageFailures
    };

    console.log(
      '[Facebook Sync] Completed:',
      result
    );

    return result;
  }

  // =========================================================
  // ADMIN SYNC BUTTON
  // =========================================================
  app.post(
    '/api/facebook-courses/sync',
    auth,
    role('admin'),
    wrap(
      async (
        req,
        res
      ) => {

        const timeout = new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(Error('انتهت مهلة المزامنة بعد 45 ثانية. تم إيقاف انتظار الواجهة؛ راجع Logs قبل إعادة المحاولة.'),{status:504})),45000));
        const result = await Promise.race([syncOldToNew({copyImages:false}), timeout]);

        res.json({
          ok:
            true,

          ...result,

          message:
            `تمت مزامنة بيانات المعرض بنجاح: ${result.created} جديد، ${result.updated} محدث. الصور الحالية ظلت مرتبطة بمصادرها بدون تعطيل الواجهة.`
        });
      }
    )
  );
};