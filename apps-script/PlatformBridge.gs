// ============================================================
// منصة الإدارة المركزية للتدريب
// الهيئة المصرية العامة لمشروعات الصرف
// وحدة التطوير والذكاء الاصطناعي
// Platform Bridge - Google Apps Script
// ============================================================
//
// Deploy as Web App:
// Execute as: Me
// Who has access: Anyone
//
// Script Properties المطلوبة:
// PLATFORM_BRIDGE_SECRET
// PLATFORM_FOLDER_ID   (اختياري)
// ============================================================

const PLATFORM_NAME =
  'منصة الإدارة المركزية للتدريب';

const ORGANIZATION_NAME =
  'الهيئة المصرية العامة لمشروعات الصرف';

const DEVELOPMENT_UNIT =
  'وحدة التطوير والذكاء الاصطناعي';

const PLATFORM_URL =
  'https://central-training-platform.onrender.com/';

const OFFICIAL_EMAIL =
  'dtctantaformal@gmail.com';

const DEFAULT_PLATFORM_FOLDER_ID =
  '13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u';


// ============================================================
// Web App
// ============================================================

function doPost(e) {
  return platformBridge_(e);
}

function doGet() {
  return platformJson_({
    success: true,
    platform: PLATFORM_NAME,
    organization: ORGANIZATION_NAME,
    message: 'Central Training Platform Bridge Ready'
  });
}


function platformJson_(value) {

  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);

}


// ============================================================
// تفويض الخدمات أول مرة
// ============================================================

function platformAuthorize() {

  const props =
    PropertiesService.getScriptProperties();

  const folderId =
    props.getProperty('PLATFORM_FOLDER_ID') ||
    DEFAULT_PLATFORM_FOLDER_ID;

  DriveApp
    .getFolderById(folderId)
    .getName();

  MailApp.getRemainingDailyQuota();

}


// ============================================================
// التحقق من البريد الإلكتروني
// ============================================================

function platformValidEmail_(email) {

  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
    .test(String(email || '').trim());

}


// ============================================================
// تنظيف النصوص
// ============================================================

function platformCleanText_(value, maxLength) {

  return String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength || 5000);

}


// ============================================================
// HTML Escape
// ============================================================

function platformEscapeHtml_(value) {

  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

}



// ============================================================
// إنشاء جلسة رفع مباشر إلى Google Drive (Resumable Upload)
// يستخدمها Render لرفع الملف على أجزاء 8 MiB مباشرة إلى Drive.
// لا يتم تمرير محتوى الملف أو رابط الجلسة إلى المتصفح.
// ============================================================

function platformCreateUploadSession_(p, folder) {
  const name = String(p.name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);

  const size = Number(p.size);
  const maxBytes = 100 * 1024 * 1024; // حد موحد مع مسار رفع المكتبة في Render

  if (!name || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    throw new Error('حجم الملف غير صالح. الحد الأقصى 100 ميجابايت.');
  }

  const allowed = /\.(docx?|xlsx?|pptx?|pdf|txt|md|csv|rtf|png|jpe?g|gif|webp|bmp|zip|7z|rar|tar|gz|tgz|xz|bz2|msi|exe|msix|appx|dmg|pkg|deb|rpm|appimage|apk|jar|vsix|iso)$/i;
  if (!allowed.test(name)) {
    throw new Error('نوع الملف غير مدعوم.');
  }

  const mime = String(p.mime || 'application/octet-stream').slice(0, 200);
  const metadata = {
    name: name,
    mimeType: mime,
    parents: [folder.getId()]
  };

  const endpoint =
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink';

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify(metadata),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size)
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const headers = response.getAllHeaders();
  const uploadUrl = headers.Location || headers.location;

  if (status < 200 || status >= 300 || !uploadUrl) {
    const detail = response.getContentText();
    throw new Error(
      'تعذر إنشاء جلسة رفع Google Drive (HTTP ' + status + '): ' +
      String(detail || 'لم يرجع Google Drive رابط جلسة الرفع.').slice(0, 500)
    );
  }

  return {
    success: true,
    uploadUrl: String(uploadUrl),
    maxBytes: maxBytes
  };
}

// ============================================================
// Platform Bridge
// ============================================================

function platformBridge_(e) {

  let lock;

  try {

    const envelope =
      JSON.parse(
        e &&
        e.postData &&
        e.postData.contents
          ? e.postData.contents
          : '{}'
      );

    const props =
      PropertiesService.getScriptProperties();

    const secret =
      props.getProperty(
        'PLATFORM_BRIDGE_SECRET'
      );


    // --------------------------------------------------------
    // Security
    // --------------------------------------------------------

    if (!secret || secret.length < 32) {

      throw new Error(
        'Set PLATFORM_BRIDGE_SECRET with at least 32 characters in Script Properties.'
      );

    }


    if (
      typeof envelope.payload !== 'string' ||
      envelope.payload.length > 12000000
    ) {

      throw new Error(
        'Invalid request.'
      );

    }


    const expected =
      Utilities.base64Encode(
        Utilities.computeHmacSha256Signature(
          envelope.payload,
          secret,
          Utilities.Charset.UTF_8
        )
      );


    const actual =
      String(
        envelope.signature || ''
      );


    let different =
      actual.length ^ expected.length;


    for (
      let i = 0;
      i < expected.length;
      i++
    ) {

      different |=
        expected.charCodeAt(i) ^
        (actual.charCodeAt(i) || 0);

    }


    if (different) {

      throw new Error(
        'Invalid signature.'
      );

    }


    const p =
      JSON.parse(
        envelope.payload
      );


    if (
      !p.requestId ||
      !/^[a-zA-Z0-9_-]{1,100}$/
        .test(p.requestId) ||
      Math.abs(
        Date.now() -
        Number(p.timestamp)
      ) > 300000
    ) {

      throw new Error(
        'Expired or invalid request.'
      );

    }


    // --------------------------------------------------------
    // Platform Folder
    // --------------------------------------------------------

    const folder =
      DriveApp.getFolderById(

        props.getProperty(
          'PLATFORM_FOLDER_ID'
        ) ||

        DEFAULT_PLATFORM_FOLDER_ID

      );


    // ========================================================
    // إنشاء جلسة رفع مباشر (Render يرفع الأجزاء 8 MiB إلى Drive)
    // ========================================================

    if (p.action === 'platformCreateUploadSession') {
      return platformJson_(
        platformCreateUploadSession_(p, folder)
      );
    }


    // ========================================================
    // HEALTH
    // ========================================================

    if (
      p.action ===
      'platformHealth'
    ) {

      return platformJson_({

        success: true,

        platform:
          PLATFORM_NAME,

        organization:
          ORGANIZATION_NAME,

        folder:
          folder.getName(),

        remainingMailQuota:
          MailApp.getRemainingDailyQuota()

      });

    }


    // ========================================================
    // DOWNLOAD
    // ========================================================

    if (
      p.action ===
      'platformDownload'
    ) {

      const file =
        DriveApp.getFileById(
          String(p.id)
        );


      const parents =
        file.getParents();


      let inside = false;


      while (
        parents.hasNext()
      ) {

        if (
          parents
            .next()
            .getId() ===
          folder.getId()
        ) {

          inside = true;

        }

      }


      if (!inside) {

        throw new Error(
          'File is outside the platform folder.'
        );

      }


      if (
        file.getSize() >
        8388608
      ) {

        throw new Error(
          'File exceeds 8 MB.'
        );

      }


      return platformJson_({

        success: true,

        name:
          file.getName(),

        mime:
          file.getMimeType(),

        base64:
          Utilities.base64Encode(
            file
              .getBlob()
              .getBytes()
          )

      });

    }


    // ========================================================
    // الإجراءات المسموحة
    // ========================================================

    const allowedActions = [

      'platformUpload',

      'platformCredentials',

      'platformContact'

    ];


    if (
      allowedActions
        .indexOf(p.action) < 0
    ) {

      throw new Error(
        'Unknown action.'
      );

    }


    // --------------------------------------------------------
    // Lock
    // --------------------------------------------------------

    lock =
      LockService
        .getScriptLock();


    lock.waitLock(
      30000
    );


    // --------------------------------------------------------
    // Prevent duplicate requests
    // --------------------------------------------------------

    const cache =
      CacheService
        .getScriptCache();


    const cacheKey =
      'platform:' +
      p.requestId;


    const prior =
      cache.get(
        cacheKey
      );


    if (prior) {

      return platformJson_(
        JSON.parse(prior)
      );

    }


    let result;


    // ========================================================
    // FILE UPLOAD
    // ========================================================

    if (
      p.action ===
      'platformUpload'
    ) {

      const name =
        String(
          p.name || 'file'
        )
          .replace(
            /[\\/:*?"<>|]/g,
            '_'
          )
          .slice(
            0,
            180
          );


      if (
        !/\.(docx?|xlsx?|pptx?|pdf|txt|png|jpe?g|zip|7z|rar|tar|gz|tgz|xz|msi|exe|msix|appx|dmg|pkg|deb|rpm|appimage|apk|jar)$/i
          .test(name)
      ) {

        throw new Error(
          'Unsupported file type.'
        );

      }


      const bytes =
        Utilities.base64Decode(
          String(
            p.base64 || ''
          )
        );


      if (
        !bytes.length ||
        bytes.length >
          8388608
      ) {

        throw new Error(
          'Maximum file size is 8 MB.'
        );

      }


      const file =
        folder.createFile(

          Utilities.newBlob(

            bytes,

            String(
              p.mime ||
              'application/octet-stream'
            ),

            name

          )

        );


      result = {

        success: true,

        id:
          file.getId(),

        url:
          file.getUrl()

      };

    }


    // ========================================================
    // إرسال بيانات الدخول للمتدرب / المحاضر
    // ========================================================

    else if (
      p.action ===
      'platformCredentials'
    ) {

      const email =
        platformCleanText_(
          p.email,
          250
        );


      const username =
        platformCleanText_(
          p.username,
          250
        );


      const password =
        String(
          p.password || ''
        );


      const personName =
        platformCleanText_(
          p.name,
          250
        );


      if (
        !platformValidEmail_(
          email
        ) ||
        !username ||
        !password
      ) {

        throw new Error(
          'Invalid recipient or credentials.'
        );

      }


      if (
        MailApp
          .getRemainingDailyQuota() <
        1
      ) {

        throw new Error(
          'Daily email quota exhausted. Try again later.'
        );

      }


      // مهم:
      // لا نسمح باستخدام رابط المعهد القديم
      const loginUrl =
        PLATFORM_URL;


      const subject =

        'بيانات الدخول | ' +
        PLATFORM_NAME;


      const plainBody =

        'السيد/السيدة ' +
        (personName || 'مستخدم المنصة') +
        '\n\n' +

        'تحية طيبة وبعد،\n\n' +

        'تم إنشاء وتجهيز حسابكم على ' +
        PLATFORM_NAME +
        '.\n\n' +

        'رابط الدخول:\n' +
        loginUrl +
        '\n\n' +

        'اسم المستخدم:\n' +
        username +
        '\n\n' +

        'كلمة المرور:\n' +
        password +
        '\n\n' +

        'يرجى الاحتفاظ ببيانات الدخول وعدم مشاركتها مع أي شخص آخر.\n\n' +

        ORGANIZATION_NAME +
        '\n' +

        PLATFORM_NAME +
        '\n' +

        DEVELOPMENT_UNIT;


      const htmlBody = `

<div dir="rtl"
     style="
       font-family:Arial,Tahoma,sans-serif;
       background:#f4f7fb;
       padding:25px;
     ">

  <div style="
    max-width:650px;
    margin:auto;
    background:#ffffff;
    border-radius:12px;
    overflow:hidden;
    border:1px solid #dce4ee;
  ">

    <div style="
      background:#123c69;
      color:white;
      text-align:center;
      padding:24px;
    ">

      <div style="
        font-size:20px;
        font-weight:bold;
      ">
        ${platformEscapeHtml_(ORGANIZATION_NAME)}
      </div>

      <div style="
        margin-top:8px;
        font-size:18px;
      ">
        ${platformEscapeHtml_(PLATFORM_NAME)}
      </div>

    </div>


    <div style="
      padding:28px;
      color:#263238;
      line-height:1.9;
    ">

      <p>
        السيد/السيدة
        <strong>
          ${platformEscapeHtml_(personName || 'مستخدم المنصة')}
        </strong>
      </p>

      <p>
        تحية طيبة وبعد،
      </p>

      <p>
        تم إنشاء وتجهيز حسابكم بنجاح على
        <strong>
          ${platformEscapeHtml_(PLATFORM_NAME)}
        </strong>.
      </p>


      <div style="
        background:#f7f9fc;
        border:1px solid #e0e6ed;
        border-radius:10px;
        padding:18px;
        margin:20px 0;
      ">

        <div>
          <strong>
            اسم المستخدم:
          </strong>

          ${platformEscapeHtml_(username)}
        </div>

        <div style="
          margin-top:12px;
        ">

          <strong>
            كلمة المرور:
          </strong>

          ${platformEscapeHtml_(password)}

        </div>

      </div>


      <div style="
        text-align:center;
        margin:28px 0;
      ">

        <a
          href="${PLATFORM_URL}"
          style="
            display:inline-block;
            background:#123c69;
            color:#ffffff;
            padding:13px 28px;
            text-decoration:none;
            border-radius:7px;
            font-weight:bold;
          "
        >

          الدخول إلى المنصة

        </a>

      </div>


      <p style="
        color:#687784;
        font-size:13px;
      ">

        حفاظًا على سرية حسابكم،
        يرجى عدم مشاركة بيانات الدخول
        مع أي شخص آخر.

      </p>

    </div>


    <div style="
      background:#eef3f8;
      text-align:center;
      padding:17px;
      font-size:12px;
      color:#506270;
    ">

      ${platformEscapeHtml_(DEVELOPMENT_UNIT)}
      <br>

      ${platformEscapeHtml_(ORGANIZATION_NAME)}

    </div>

  </div>

</div>

`;


      MailApp.sendEmail({

        to:
          email,

        subject:
          subject,

        name:
          PLATFORM_NAME,

        body:
          plainBody,

        htmlBody:
          htmlBody,

        replyTo:
          OFFICIAL_EMAIL

      });


      result = {

        success: true,

        sent: true,

        message:
          'تم إرسال بيانات الدخول بنجاح.'

      };

    }


    // ========================================================
    // اتصل بنا
    // ========================================================

    else if (
      p.action ===
      'platformContact'
    ) {

      const senderName =
        platformCleanText_(
          p.name,
          200
        );


      const senderEmail =
        platformCleanText_(
          p.email,
          250
        );


      const inquirySubject =
        platformCleanText_(
          p.subject,
          300
        );


      const inquiryMessage =
        platformCleanText_(
          p.message,
          8000
        );


      if (
        !senderName
      ) {

        throw new Error(
          'يرجى كتابة الاسم.'
        );

      }


      if (
        !platformValidEmail_(
          senderEmail
        )
      ) {

        throw new Error(
          'يرجى كتابة بريد إلكتروني صحيح.'
        );

      }


      if (
        !inquirySubject
      ) {

        throw new Error(
          'يرجى كتابة موضوع الاستفسار.'
        );

      }


      if (
        !inquiryMessage
      ) {

        throw new Error(
          'يرجى كتابة رسالة الاستفسار.'
        );

      }


      if (
        MailApp
          .getRemainingDailyQuota() <
        1
      ) {

        throw new Error(
          'تعذر إرسال الرسالة حاليًا بسبب بلوغ الحد اليومي للبريد.'
        );

      }


      const contactSubject =

        'استفسار جديد من المنصة | ' +
        inquirySubject;


      const contactPlainBody =

        'استفسار جديد وارد من ' +
        PLATFORM_NAME +
        '\n\n' +

        'الاسم: ' +
        senderName +
        '\n' +

        'البريد الإلكتروني: ' +
        senderEmail +
        '\n' +

        'موضوع الاستفسار: ' +
        inquirySubject +
        '\n\n' +

        'نص الرسالة:\n' +
        inquiryMessage +
        '\n\n' +

        '-------------------------\n' +

        'يمكن الرد مباشرة على هذه الرسالة، وسيتم توجيه الرد إلى:\n' +
        senderEmail;


      const contactHtmlBody = `

<div dir="rtl"
     style="
       font-family:Arial,Tahoma,sans-serif;
       max-width:700px;
       margin:auto;
       color:#263238;
     ">

  <div style="
    background:#123c69;
    color:#fff;
    padding:20px;
    border-radius:10px 10px 0 0;
  ">

    <strong>
      استفسار جديد من منصة الإدارة المركزية للتدريب
    </strong>

  </div>


  <div style="
    border:1px solid #dce4ee;
    padding:24px;
    line-height:1.9;
  ">

    <p>
      <strong>الاسم:</strong>
      ${platformEscapeHtml_(senderName)}
    </p>

    <p>
      <strong>البريد الإلكتروني:</strong>
      ${platformEscapeHtml_(senderEmail)}
    </p>

    <p>
      <strong>موضوع الاستفسار:</strong>
      ${platformEscapeHtml_(inquirySubject)}
    </p>

    <hr style="
      border:none;
      border-top:1px solid #e1e7ed;
      margin:20px 0;
    ">

    <p>
      <strong>
        الرسالة:
      </strong>
    </p>

    <div style="
      background:#f7f9fc;
      padding:16px;
      border-radius:8px;
      white-space:pre-wrap;
    ">

      ${platformEscapeHtml_(inquiryMessage)}

    </div>

  </div>

</div>

`;


      MailApp.sendEmail({

        to:
          OFFICIAL_EMAIL,

        subject:
          contactSubject,

        name:
          PLATFORM_NAME,

        body:
          contactPlainBody,

        htmlBody:
          contactHtmlBody,

        replyTo:
          senderEmail

      });


      result = {

        success: true,

        sent: true,

        message:
          'تم إرسال استفساركم بنجاح، وسيتم الرد على البريد الإلكتروني المسجل في أقرب وقت ممكن.'

      };

    }


    // ========================================================
    // Cache successful result
    // ========================================================

    cache.put(

      cacheKey,

      JSON.stringify(
        result
      ),

      21600

    );


    return platformJson_(
      result
    );

  }

  catch (error) {

    return platformJson_({

      success: false,

      error:
        String(
          error.message ||
          error
        )

    });

  }

  finally {

    if (
      lock &&
      lock.hasLock()
    ) {

      lock.releaseLock();

    }

  }

}