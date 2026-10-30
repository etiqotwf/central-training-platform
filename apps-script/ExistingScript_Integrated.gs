
 
 // ============================================================
// 📂 المجلد الرئيسي للمشروع الجديد
// ============================================================

const MAIN_FOLDER_ID = "1BWu9yqqD27CcZtB-iZ3BNKlxp24r6pEH";

function getMainFolder_() {
  return DriveApp.getFolderById(MAIN_FOLDER_ID);
}
 
 function doPost(e) {
  if (e && e.postData && e.postData.type && e.postData.type.indexOf('application/json')===0) return platformBridge_(e);

  // =========================================================
  // 🛡️ التأكد من وجود الطلب
  // =========================================================
  if (!e || !e.parameter) {

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "No data received"
        })
      )
      .setMimeType(ContentService.MimeType.JSON);
  }


  // =========================================================
  // 🔍 قراءة الـ Action
  // =========================================================
  const action =
    (e.parameter.action || "")
      .toString()
      .trim();

  Logger.log("=================================");
  Logger.log("POST REQUEST");
  Logger.log("ACTION = " + action);
  Logger.log("=================================");


  // =========================================================
  // ✏️ 1️⃣ تعديل الدورة
  // =========================================================
  // مهم جدًا:
  // أي طلب فيه action=updateCourse
  // يذهب مباشرة إلى handleCoursePost_
  // ولا يدخل في كود المتدربين.
  // =========================================================

  if (action === "updateCourse") {

    Logger.log("✏️ Update Course Request");

    const coursePostResponse =
      handleCoursePost_(e);

    if (coursePostResponse) {
      return coursePostResponse;
    }

  }


  // =========================================================
  // 📚 2️⃣ جلب الدورات
  // =========================================================
  // في حالة أن صفحة edit.html أرسلت
  // action=getCourses بواسطة POST
  // =========================================================

  if (action === "getCourses") {

    Logger.log("📚 Get Courses Request");

    const courseGetResponse =
      handleCourseGet_(e);

    if (courseGetResponse) {
      return courseGetResponse;
    }

  }


  // =========================================================
  // 📊 3️⃣ فتح Sheet1
  // =========================================================

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Sheet1");


  if (!sheet) {

    Logger.log("❌ Sheet1 not found");

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "Sheet1 not found"
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  }


  // =========================================================
  // 📥 قراءة بيانات الشيت
  // =========================================================

  const data =
    sheet
      .getDataRange()
      .getValues();


  // =========================================================
  // 👨‍💼 4️⃣ استقبال تقييم المدير
  // =========================================================
  // يعتمد على ID الموجود في العمود 21
  // =========================================================

  if (e.parameter.id) {

    const searchId =
      e.parameter.id
        .toString()
        .trim();

    const before =
      e.parameter.before || "";

    const after =
      e.parameter.after || "";


    Logger.log(
      "📊 Manager Evaluation ID = " +
      searchId
    );


    // -------------------------------------------------------
    // البحث عن الـ ID
    // -------------------------------------------------------

    for (let i = 3; i < data.length; i++) {

      // العمود 21 = index 20
      const storedId =
        data[i][20];


      if (
        storedId &&
        storedId
          .toString()
          .trim() === searchId
      ) {

        Logger.log(
          "✅ Manager evaluation found at row " +
          (i + 1)
        );


        // ---------------------------------------------------
        // ✍️ كتابة تقييم المدير
        // العمود 17 = قبل
        // العمود 18 = بعد
        // ---------------------------------------------------

        sheet
          .getRange(i + 1, 17)
          .setValue(before);

        sheet
          .getRange(i + 1, 18)
          .setValue(after);


        return ContentService
          .createTextOutput(
            JSON.stringify({
              success: true
            })
          )
          .setMimeType(
            ContentService.MimeType.JSON
          );

      }

    }


    // -------------------------------------------------------
    // ❌ ID غير موجود
    // -------------------------------------------------------

    Logger.log(
      "❌ Manager evaluation ID not found: " +
      searchId
    );


    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "not_found"
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }


  // =========================================================
  // 👤 5️⃣ إضافة متدرب جديد
  // =========================================================


  // =========================================================
  // 🧱 إعداد الرأس
  // =========================================================

  if (sheet.getLastRow() === 0) {

    sheet.appendRow([
      "الإدارة المركزية للتدريب\n" +
      "Drainage Training Center - Tanta (DTC)\n" +
      "📝 نموذج تقييم الدورة التدريبية"
    ]);

    sheet
      .getRange(1, 1)
      .setFontWeight("bold")
      .setFontSize(18)
      .setHorizontalAlignment("center");

    sheet.setRowHeight(1, 70);

    sheet.insertRowsAfter(1, 1);

  }


  // =========================================================
  // 🏷️ إعداد عناوين الأعمدة
  // =========================================================

  const headers =
    sheet
      .getRange(3, 1, 1, 21)
      .getValues()[0];


  if (
    headers.every(
      cell => cell === ""
    )
  ) {

    const titles = [

      "📅 الوقت",
      "👤 الاسم",
      "📞 الهاتف",
      "📧 البريد الإلكتروني",
      "🏢 الإدارة",
      "🎓 المؤهل",
      "💼 الوظيفة",
      "🏨 الإقامة",
      "📘 اسم الدورة",
      "📅 بداية الدورة",
      "📅 نهاية الدورة",
      "🧑‍🏫 المدرب",
      "📖 المادة العلمية",
      "🏢 التنظيم",
      "🏨 الإقامة",
      "📝 ملاحظات",
      "📊 تقييم المدير قبل",
      "📊 تقييم المدير بعد",
      "🔗 رابط التقييم",
      "📱 QR Code",
      "🆔 ID"

    ];


    sheet
      .getRange(3, 1, 1, 21)
      .setValues([titles]);


    sheet
      .getRange(3, 1, 1, 21)
      .setFontWeight("bold")
      .setFontSize(16)
      .setBackground("#e0e0e0");

  }


  // =========================================================
  // 📥 استقبال بيانات المتدرب
  // =========================================================

  const submittedName =
    e.parameter.traineeName
      ? e.parameter.traineeName
          .toString()
          .trim()
      : "";


  const submittedCourse =
    e.parameter.courseName
      ? e.parameter.courseName
          .toString()
          .trim()
      : "";


  const courseStartValue =
    e.parameter.courseStartDate || "";


  // =========================================================
  // 📅 التحقق من تاريخ بداية الدورة
  // =========================================================

  let submittedStart = "";


  if (courseStartValue) {

    const startDate =
      new Date(courseStartValue);


    if (!isNaN(startDate.getTime())) {

      submittedStart =
        Utilities.formatDate(
          startDate,
          "Africa/Cairo",
          "dd/MM/yyyy"
        );

    }

  }


  // =========================================================
  // 🔍 منع التكرار + منع الإرسال المتكرر
  // =========================================================

  for (
    let i = data.length - 1;
    i >= 3;
    i--
  ) {

    const rowName =
      data[i][1]
        ? data[i][1]
            .toString()
            .trim()
        : "";


    const rowCourse =
      data[i][8]
        ? data[i][8]
            .toString()
            .trim()
        : "";


    let rowStart = "";


    if (data[i][9]) {

      const rowStartDate =
        new Date(data[i][9]);


      if (
        !isNaN(
          rowStartDate.getTime()
        )
      ) {

        rowStart =
          Utilities.formatDate(
            rowStartDate,
            "Africa/Cairo",
            "dd/MM/yyyy"
          );

      }

    }


    // -------------------------------------------------------
    // ⚠️ نفس المتدرب + نفس الدورة + نفس التاريخ
    // -------------------------------------------------------

    if (
      rowName === submittedName &&
      rowCourse === submittedCourse &&
      rowStart === submittedStart
    ) {

      return HtmlService
        .createHtmlOutput(
          "<h2 style='color:orange;text-align:center;'>" +
          "⚠️ تم الإرسال مسبقًا" +
          "</h2>"
        );

    }


    // -------------------------------------------------------
    // ⏱️ منع الإرسال خلال دقيقة
    // -------------------------------------------------------

    if (
      data[i][0] &&
      rowName === submittedName
    ) {

      const lastTimestamp =
        new Date(data[i][0]);

      const now =
        new Date();

      const diffMinutes =
        (now - lastTimestamp) / 60000;


      if (
        !isNaN(diffMinutes) &&
        diffMinutes < 1
      ) {

        return HtmlService
          .createHtmlOutput(
            "<h2 style='color:red;text-align:center;'>" +
            "⏱️ انتظر دقيقة" +
            "</h2>"
          );

      }

    }

  }


  // =========================================================
  // 🆔 إنشاء ID فريد
  // =========================================================

  const uniqueId =
    Utilities.getUuid();


  // =========================================================
  // 🔗 رابط نموذج تقييم المدير
  // =========================================================

  const managerFormURL =
  "https://script.google.com/macros/s/" +
  "AKfycbxnMysXZo0ZZARa6BG-EpSSFS30GO57oRi32tw3hWdEvMT-f1i2o6ZScVfqhLWsWfMp" +
  "/exec";

  const evaluationLink =
    managerFormURL +
    "?id=" +
    uniqueId;


  // =========================================================
  // 📱 رابط QR
  // =========================================================

  const qrUrl =
    "https://quickchart.io/qr?text=" +
    encodeURIComponent(
      evaluationLink
    ) +
    "&size=800&format=png";


  // =========================================================
  // 💾 إضافة المتدرب إلى الشيت
  // =========================================================

  if (submittedName) {

    sheet.appendRow([

      new Date(),

      submittedName,

      e.parameter.traineePhone || "",

      e.parameter.traineeEmail || "",

      e.parameter.department || "",

      e.parameter.qualification || "",

      e.parameter.jobTitle || "",

      e.parameter.residencyStatus || "",

      submittedCourse,

      e.parameter.courseStartDate || "",

      e.parameter.courseEndDate || "",

      e.parameter.trainerRating || "",

      e.parameter.contentRating || "",

      e.parameter.organizationRating || "",

      e.parameter.residencyRating || "",

      e.parameter.comments || "",

      "",

      "",

      evaluationLink,

      qrUrl,

      uniqueId

    ]);

  }


  // =========================================================
  // 🎨 تنسيق آخر صف
  // =========================================================

  const lastRowFormatted =
    sheet.getLastRow();


  const range =
    sheet.getRange(
      lastRowFormatted,
      1,
      1,
      21
    );


  range
    .setFontSize(14)
    .setFontWeight("bold");


  sheet.setRowHeight(
    lastRowFormatted,
    45
  );


  // =========================================================
  // 📜 توليد الشهادة
  // =========================================================

  const lastRow =
    getLastDataRow(sheet);


  if (lastRow !== null) {

    const row =
      sheet
        .getRange(
          lastRow,
          1,
          1,
          21
        )
        .getValues()[0];


    generateCertificatePDF(

      row[1],   // الاسم

      row[4],   // الإدارة

      row[9],   // بداية الدورة

      row[10],  // نهاية الدورة

      row[7],   // الإقامة

      row[3],   // البريد

      row[8],   // اسم الدورة

      row[5],   // المؤهل

      row[19],  // QR

      evaluationLink

    );

  }


  // =========================================================
  // ✅ الرد النهائي
  // =========================================================

  return HtmlService
    .createHtmlOutput(
      "<h2 style='color:green;text-align:center;'>" +
      "✅ تم الإرسال + QR جاهز" +
      "</h2>"
    );

}
function getLastDataRow(sheet) {  
const lastRow = sheet.getLastRow();
if (lastRow < 4) return null;

const data = sheet.getRange(4, 1, lastRow - 3, 20).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].join("").trim() !== "") return i + 4;
  }

  return null;
}

function generateCertificatePDF(
  name,
  department,
  courseStartDate,
  courseEndDate,
  residencyStatus,
  email,
  courseName,
  qualification,
  qrUrl,
  evaluationLink
) {
  const parentFolder = getMainFolder_(); // 📂 المجلد الرئيسي
  const serialNumber = "DTC-" + Utilities.formatDate(new Date(), "Africa/Cairo", "yyyyMMdd-HHmmss");
  const doc = DocumentApp.create(`شهادة - ${name}`);
  const body = doc.getBody();

  // 🧼 تهيئة المستند
  body.clear();
  body.setMarginTop(5);
  body.setMarginBottom(5);
  body.setMarginLeft(25);
  body.setMarginRight(25);

  // 🖼️ إنشاء الإطار الخارجي للشهادة
  const borderTable = body.appendTable([[""]]);
  borderTable.setBorderWidth(10).setBorderColor("#000000");
  const borderCell = borderTable.getCell(0, 0);

  // تكبير الحشوة الداخلية
  borderCell.setPaddingTop(5);
  borderCell.setPaddingBottom(5);
  borderCell.setPaddingLeft(25);
  borderCell.setPaddingRight(25);

  // 🖼️ جدول الشعار + النصوص
  const headerTable = borderCell.appendTable();
  headerTable.setBorderWidth(0);
  const headerRow = headerTable.appendTableRow();

  // ✅ النصوص - أقصى اليمين
  const textCell = headerRow.appendTableCell();
  textCell.setWidth(620);
  textCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(10).setPaddingRight(10);
  textCell.appendParagraph("وزارة الموارد المائية والري")
    .setFontSize(18).setBold(true).setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  textCell.appendParagraph("الهيئة المصرية العامة لمشروعات الصرف")
    .setFontSize(16).setBold(true).setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  // ✅ الشعار - أقصى اليسار
  const logoCell = headerRow.appendTableCell();
  logoCell.setWidth(100);
  logoCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(10).setPaddingRight(10);
  try {
    const logoFile = DriveApp.getFileById("1KBkz11mqUFXiI_H9ZP116kl42M4JWNkQ");
    logoCell.appendImage(logoFile.getBlob())
      .setWidth(100).setHeight(100)
      .setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  } catch (e) {
    Logger.log("⚠️ تعذر تحميل الشعار");
  }

  // 📛 العناوين الرئيسية
  borderCell.appendParagraph("الإدارة المركزية للتدريب")
    .setFontSize(26).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setFontFamily("Times New Roman").setSpacingBefore(0).setSpacingAfter(0);
  borderCell.appendParagraph("🎓 Drainage Training Center - Tanta (DTC)")
    .setFontSize(26).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setFontFamily("Times New Roman").setSpacingBefore(0).setSpacingAfter(0);
  borderCell.appendParagraph("ـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ")
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(0);
  borderCell.appendParagraph("🏅 شهادة ")
    .setFontSize(27).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setFontFamily("Times New Roman").setSpacingBefore(0).setSpacingAfter(0);

  // 📜 نص الشهادة
  const certParagraph1 = borderCell.appendParagraph("يشهد الإدارة المركزية للتدريب بأن ");
  certParagraph1.setFontSize(23).setBold(true).setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingBefore(0).setSpacingAfter(0);

  const infoTable = borderCell.appendTable([
    [
      ` الإقامة: ${residencyStatus}`,
      ` الإدارة: ${department}`,
      ` المؤهل: ${qualification}`,
      ` الاسم: ${name}`
    ]
  ]);
  infoTable.setBorderWidth(0);
  const row = infoTable.getRow(0);
  for (let i = 0; i < 4; i++) {
    const cell = row.getCell(i);
    const paragraph = cell.getChild(0).asParagraph();
    paragraph.setFontSize(21).setFontFamily("Times New Roman")
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(0);
    cell.setPaddingRight(2).setPaddingLeft(2);
  }

  const formattedCourseDate = Utilities.formatDate(new Date(courseStartDate), "Africa/Cairo", "d/M/yyyy");
  const certParagraph2 = borderCell.appendParagraph(`✅ قد اجتاز دورة "${courseName}" المنعقدة بتاريخ ${formattedCourseDate} بنجاح.`);
  certParagraph2.setFontSize(23).setBold(true).setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingBefore(2).setSpacingAfter(2).setLineSpacing(1);

  const footerParagraph = borderCell.appendParagraph(`🔖 رقم الشهادة: ${serialNumber}\tـــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ`);
  footerParagraph.setFontSize(14)
    .setFontFamily("Times New Roman")
    .setItalic(true)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setSpacingBefore(10)
    .setSpacingAfter(10);

  // ✅ التوقيع
  borderCell.appendParagraph("رئيس الإدارة المركزية للتدريب")
    .setFontSize(20).setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.LEFT).setSpacingAfter(15);
  borderCell.appendParagraph("دكتور/ محمود الحداد")
    .setFontSize(20)
    .setFontFamily("Times New Roman")
    .setAlignment(DocumentApp.HorizontalAlignment.LEFT)
    .setIndentStart(50);

  // حفظ وإغلاق المستند
  doc.saveAndClose();

  // ✨ إنشاء مجلد الدورة + مجلد فرعي للشهادات
  const formattedStartDate = Utilities.formatDate(new Date(courseStartDate), "Africa/Cairo", "dd/MM/yyyy");
  const courseFolderName = `${courseName} - ${formattedStartDate}`;
  let courseFolder = parentFolder.getFoldersByName(courseFolderName);
  courseFolder = courseFolder.hasNext() ? courseFolder.next() : parentFolder.createFolder(courseFolderName);

  const certsFolderName = `شهادات - ${courseName} - ${formattedStartDate}`;
  let certsFolder = courseFolder.getFoldersByName(certsFolderName);
  certsFolder = certsFolder.hasNext() ? certsFolder.next() : courseFolder.createFolder(certsFolderName);

  // 📄 تصدير الشهادة إلى PDF وحفظها داخل مجلد "الشهادات"
  const pdf = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF);
  const file = certsFolder.createFile(pdf).setName(`شهادة - ${name} - ${courseName}.pdf`);

  // ✅ استدعاء باقي الملفات المرتبطة
 generateCourseLetter(
  name,
  courseName,
  courseStartDate,
  courseEndDate,
  department,
  courseFolder,
  residencyStatus,
  qualification,
  evaluationLink // ✅ بدل qrUrl
);
  generateCourseRecordsDOC(courseName, courseStartDate, SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1"), courseFolder);
  generateStatisticsPDF(courseName, courseStartDate, SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1"), courseFolder);
// generateEnglishCertificateFromTemplate(name, courseName, courseStartDate, courseEndDate, qualification, courseFolder, residencyStatus);
  // 📧 إرسال الشهادة بالبريد
  if (email) {
    MailApp.sendEmail({
      to: email,
      subject: `📄 شهادتك من الإدارة المركزية للتدريب`,
      body: `مرحبًا ${name}،\n\nمرفق شهادة اجتيازك لدورة "${courseName}".\n\nمع تحياتنا.\nالإدارة المركزية للتدريب.`,
      attachments: [file]
    });
  }
}

function generateCourseLetter(
  name,
  courseName,
  courseStartDate,
  courseEndDate,
  department,
  subfolder,
  residencyStatus,
  qualification,
  evaluationLink
) 
{

  const formattedStart = Utilities.formatDate(
    new Date(courseStartDate),
    "Africa/Cairo",
    "yyyy/MM/dd"
  );

  const folderName = `خطابات - ${courseName} - ${formattedStart}`;
  let lettersFolder;

  const subfolders = subfolder.getFoldersByName(folderName);

  if (subfolders.hasNext()) {
    lettersFolder = subfolders.next();
  } else {
    lettersFolder = subfolder.createFolder(folderName);
  }

  const doc = DocumentApp.create(`خطاب - ${name}`);
  const body = doc.getBody();

  body.setPageHeight(841);
  body.setPageWidth(595);

  // 🔥 تقليل الهوامش علشان صفحة واحدة
  body.setMarginTop(2);
  body.setMarginBottom(5);
  body.setMarginLeft(35);
  body.setMarginRight(35);

  const isFemale =
    residencyStatus === "مقيمة" ||
    residencyStatus === "غير مقيمة";

  const isEngineer = qualification && qualification.toString().includes("هندس");

  let title;

  if (isEngineer) {
    title = isFemale ? "المهندسة" : "المهندس";
  } else {
    title = isFemale ? "السيدة" : "السيد";
  }

const departmentText = department
  ? department.toString().trim().toLowerCase()
  : "";

const isCentralOrRegional =
  departmentText.includes("إدارة مركزية") ||
  departmentText.includes("الإدارة المركزية") ||
  departmentText.includes("الادارة المركزية") ||
  departmentText.includes("إقليم") ||
  departmentText.includes("اقليم") ||
  departmentText.includes("إقليمية") ||
  departmentText.includes("اقليمية");

const managerTitle = isCentralOrRegional
  ? "رئيس الإدارة المركزية"
  : "السيد المهندس";
  const attendedWord = isFemale ? "حضرت" : "حضر";
  const wasWord = isFemale ? "وكانت" : "وكان";

  const formattedEnd = Utilities.formatDate(
    new Date(courseEndDate),
    "Africa/Cairo",
    "yyyy/MM/dd"
  );

  // =========================
  // 🟦 الهيدر
  // =========================
  const headerTable = body.appendTable();
  headerTable.setBorderWidth(0);

  const headerRow = headerTable.appendTableRow();

  // =========================
  // 📱 QR + لينك
  // =========================
  const leftCell = headerRow.appendTableCell();

  leftCell.appendParagraph("تقييم المدير")
    .setAlignment(DocumentApp.HorizontalAlignment.LEFT)
    .setBold(true)
    .setFontSize(12);

  const qrCell = leftCell;

  qrCell.setPaddingTop(1);
  qrCell.setPaddingBottom(1);

  if (evaluationLink && evaluationLink.toString().trim() !== "") {
    try {

     // ===== اختصار الرابط (مع الرجوع للرابط الأصلي إذا فشل) =====
      // QR
      const qrApi = `https://quickchart.io/qr?text=${encodeURIComponent(evaluationLink)}&size=400&ecLevel=H&margin=1`;

      const response = UrlFetchApp.fetch(qrApi);
      const blob = response.getBlob();

      const img = qrCell.appendImage(blob);
      img.setWidth(140);
      img.setHeight(140);

     // 🔥 عرض نص صغير كرابط مع الاحتفاظ بالرابط الكامل
const linkPara = qrCell.appendParagraph("اضغط هنا لتقييم المدير");

linkPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
linkPara.setFontSize(12);
linkPara.setBold(true);
linkPara.setForegroundColor("#000000");

// الرابط الحقيقي المخفي
linkPara.setLinkUrl(evaluationLink);
      linkPara.setSpacingBefore(2);
      linkPara.setSpacingAfter(2);

    } catch (e) {
      qrCell.appendParagraph("❌ خطأ في QR")
        .setFontSize(10)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }

  } else {
    qrCell.appendParagraph("❌ لا يوجد QR")
      .setFontSize(10)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  }

  // =========================
  // 🏢 العناوين
  // =========================
  const rightCell = headerRow.appendTableCell();

  rightCell.appendParagraph("وزارة الموارد المائية والري")
  .setFontSize(15)
  .setBold(true)
  .setForegroundColor("#000000")
  .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

rightCell.appendParagraph("الهيئة المصرية العامة لمشروعات الصرف")
  .setFontSize(15)
  .setBold(true)
  .setForegroundColor("#000000")
  .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

rightCell.appendParagraph("الإدارة المركزية للتدريب")
  .setFontSize(15)
  .setBold(true)
  .setForegroundColor("#000000")
  .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  // =========================
  // 🔥 اللوجو + الخطوط
  // =========================
  const logoDividerTable = body.appendTable();
  logoDividerTable.setBorderWidth(0);

  const dividerRow = logoDividerTable.appendTableRow();

  const rightLineCell = dividerRow.appendTableCell();
  rightLineCell.appendParagraph("ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ")
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingBefore(0)
    .setSpacingAfter(0);

  const logoCell = dividerRow.appendTableCell();

  const innerTable = logoCell.appendTable();
  innerTable.setBorderWidth(0);

  const innerRow = innerTable.appendTableRow();
  const imageCell = innerRow.appendTableCell();

  try {
    const logo = UrlFetchApp.fetch(
      "https://drive.google.com/uc?export=download&id=1gYuThd9P8NzjuLLE4_mDhxtRrZXhWLKz"
    ).getBlob();

    const img = imageCell.appendImage(logo);
    img.setWidth(70);
    img.setHeight(70);

  } catch (e) {}

  const textCell = innerRow.appendTableCell();

  textCell.appendParagraph("Drainage Training Center - Tanta (DTC)")
    .setFontSize(9)
    .setBold(true)
    .setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  const leftLineCell = dividerRow.appendTableCell();
  leftLineCell.appendParagraph("ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ")
    .setAlignment(DocumentApp.HorizontalAlignment.LEFT)
    .setSpacingBefore(0)
    .setSpacingAfter(0);

  // =========================
  // 📝 الخطاب
  // =========================
 const managerPosition = isCentralOrRegional
  ? `رئيس الإدارة المركزية / ${department}`
  : `${managerTitle} / مدير عام ${department}`;

body.appendParagraph(managerPosition)
.setFontSize(17)
.setBold(true)
.setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
.setSpacingBefore(5)
.setSpacingAfter(8);

  body.appendParagraph("تحية طيبة وبعد،،،")
    .setFontSize(17)
    .setBold(true)
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingAfter(8);

  body.appendParagraph(
    `نرجو التفضل بالإحاطة بأن ${title} / ${name} قد ${attendedWord} دورة عن "${courseName}" والتي أقيمت بالإدارة المركزية للتدريب تبدأ بتاريخ ${formattedStart} وتنتهي بتاريخ ${formattedEnd}، ${wasWord} ${residencyStatus} خلال فترة الدورة.`
  )
    .setFontSize(15)
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingAfter(12);

  body.appendParagraph(
    isFemale ? "وقد اجتازت الدورة بنجاح." : "وقد اجتاز الدورة بنجاح."
  )
    .setFontSize(17)
    .setBold(true)
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingAfter(12);

  body.appendParagraph("وتفضلوا سيادتكم بقبول فائق الاحترام،،،")
    .setFontSize(17)
    .setBold(true)
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingAfter(10);

 const today = Utilities.formatDate(new Date(courseEndDate), "Africa/Cairo", "yyyy/MM/dd");

  body.appendParagraph(today)
    .setFontSize(15)
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .setSpacingAfter(15);

body.appendParagraph(
  "تنبيه هام: يرجى من المدير المباشر للمتدرب مسح رمز الاستجابة السريعة الموضح أعلى الخطاب، وإتمام تقييم المتدرب، مع ضرورة الالتزام بذلك."
)
  .setFontSize(12)
  .setBold(true)
  .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
  .setSpacingBefore(5)
  .setSpacingAfter(8);


body.appendParagraph("مدير عام المركز")
  .setFontSize(15)
  .setBold(true)
  .setAlignment(DocumentApp.HorizontalAlignment.LEFT)
  .setSpacingAfter(30);

body.appendParagraph("م/ بسنت محمد أحمد")
  .setFontSize(15)
  .setBold(true)
  .setAlignment(DocumentApp.HorizontalAlignment.LEFT)
  .setSpacingAfter(20);
  
    // =========================
  // 🔻 الفوتر
  // =========================
  body.appendParagraph("ــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــــ")
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph("مراكز التدريب التابعة للهيئة المصرية العامة لمشروعات الصرف")
    .setFontSize(11)
    .setBold(true)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph("Tel: 040/3070551 - P.O.Box: 31752 - Facebook: facebook.com/dtccontact")
    .setFontSize(11)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  const pdfBlob = DriveApp
    .getFileById(doc.getId())
    .getAs(MimeType.PDF)
    .setName(`خطاب - ${name}.pdf`);

  DriveApp.getFileById(doc.getId()).setTrashed(true);

  lettersFolder.createFile(pdfBlob);
}


function generateCourseRecordsDOC(courseName, courseStartDate, sheet, subfolder) {
  const formattedDate = Utilities.formatDate(new Date(courseStartDate), "Africa/Cairo", "dd/MM/yyyy");
  const docName = `تقييم الدورة - ${courseName} - ${formattedDate}`;

  const data = sheet.getDataRange().getValues();
  const headers = data[2];
  const records = data.slice(3).filter(row => {
    return row[8] === courseName &&
           Utilities.formatDate(new Date(row[9]), "Africa/Cairo", "dd/MM/yyyy") === formattedDate;
  });

  if (records.length === 0) return;

  // ✅ الأعمدة المطلوبة فقط
  const selectedIndexes = [1, 4, 7, 11, 12, 13, 14, 15]; // الأعمدة المطلوبة
  const columnTitles = ["🔢 رقم", ...selectedIndexes.map(i => headers[i])];

  // ✅ توسيع الأعمدة لتتناسب
  const columnWidths = [30, 160, 150, 50, 50, 50, 50, 50, 215];

  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  body.setMarginLeft(10);

  // ✅ عنوان التقرير
  body.appendParagraph(`📋 تقييم الدورة التدريبية`)
    .setFontSize(20).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`${courseName} - ${formattedDate}`)
    .setFontSize(16).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(" ");

  // ✅ إنشاء الجدول
  const table = body.appendTable();
  table.setBorderWidth(1);

  // ✅ رؤوس الجدول
  const headerRow = table.appendTableRow();
  columnTitles.forEach((title, i) => {
    const cell = headerRow.appendTableCell(title.toString());
    cell.setBold(true).setWidth(columnWidths[i]);
  });

  // ✅ بيانات المتدربين + الترقيم
  records.forEach((row, index) => {
    const tableRow = table.appendTableRow();

    // رقم تسلسلي
    tableRow.appendTableCell((index + 1).toString()).setWidth(columnWidths[0]);

    // باقي البيانات
    selectedIndexes.forEach((colIndex, i) => {
      let text = row[colIndex] != null ? row[colIndex].toString() : "";
      const cell = tableRow.appendTableCell(text);
      cell.setWidth(columnWidths[i + 1]);
    });
  });

  // ✅ حفظ وتصدير المستند كـ PDF
  doc.saveAndClose();
  const pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(`${docName}.pdf`);

  // ✅ حذف أي ملف قديم بنفس الاسم
  const oldPDFs = subfolder.getFilesByName(`${docName}.pdf`);
  while (oldPDFs.hasNext()) oldPDFs.next().setTrashed(true);

  subfolder.createFile(pdfBlob);

  // ✅ حذف Google Doc المؤقت
  DriveApp.getFileById(doc.getId()).setTrashed(true);
}


function generateStatisticsPDF(courseName, courseStartDate, sheet, subfolder) {
  const formattedDate = Utilities.formatDate(new Date(courseStartDate), "Africa/Cairo", "dd/MM/yyyy");
  const docName = `📄 تقرير تقييم الدورة - ${courseName} - ${formattedDate}`;

  const data = sheet.getDataRange().getValues();
 const records = data.slice(3).filter(row => {
  const rowCourse = row[8];

  const rowStart = row[9]
    ? Utilities.formatDate(new Date(row[9]), "Africa/Cairo", "dd/MM/yyyy")
    : "";

  return rowCourse === courseName && rowStart === formattedDate;
});

  if (records.length === 0) return;

  const total = records.length;
  const levels = ["ممتاز", "جيد جداً", "جيد", "مقبول", "ضعيف"];
  const normalize = val => (!val ? "" : val.trim().replace(/إمتياز|امتياز/g, "ممتاز"));

  const evalTrainer = {}, evalContent = {}, evalOrg = {}, evalRes = {};
  levels.forEach(lvl => {
    evalTrainer[lvl] = 0;
    evalContent[lvl] = 0;
    evalOrg[lvl] = 0;
    evalRes[lvl] = 0;
  });

  const comments = [];

  records.forEach(row => {
    const tr = normalize(row[11]);
    const ct = normalize(row[12]);
    const or = normalize(row[13]);
    const rs = normalize(row[14]);
    const comment = row[15];

    const qualification = row[5];
    if (typeof qualification === 'string' && qualification.includes("دكتوراه")) {
      Logger.log("يحمل دكتوراه: " + row[1]);
    }

    if (levels.includes(tr)) evalTrainer[tr]++;
    if (levels.includes(ct)) evalContent[ct]++;
    if (levels.includes(or)) evalOrg[or]++;
    if (levels.includes(rs)) evalRes[rs]++;

    if (comment && comment.trim()) comments.push(comment.trim());
  });

  // إنشاء المستند
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(40).setMarginRight(40);

  body.appendParagraph("تقرير للعرض على السيد الدكتور / رئيس الإدارة المركزية للتدريب")
    .setFontSize(16).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingAfter(10);
  body.appendParagraph(`عن دورة "${courseName}" المنعقدة بتاريخ ${formattedDate}`)
    .setFontSize(14).setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingAfter(20);
  body.appendParagraph(`👥 عدد المتدربين: ${total}`)
    .setFontSize(16).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(20);

  const table = body.appendTable();
  table.setBorderWidth(1);

  const headerRow = table.appendTableRow();
  ["تقييم المحاضر", "تقييم المادة العلمية", "تقييم التنظيم وقاعة المحاضرات", "تقييم الإقامة", "الرسم البياني"].forEach(title => {
    const cell = headerRow.appendTableCell(title);
    const p = cell.getChild(0).asParagraph();
    p.setBold(true).setFontSize(14).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    cell.setVerticalAlignment(DocumentApp.VerticalAlignment.MIDDLE);
  });

  const dataRow = table.appendTableRow();
  function formatEvaluationText(obj) {
    return levels.map(lvl => `${lvl}: ${obj[lvl] || 0}`).join('\n');
  }
  [evalTrainer, evalContent, evalOrg, evalRes].forEach(evalObj => {
    const cell = dataRow.appendTableCell(formatEvaluationText(evalObj));
    const p = cell.getChild(0).asParagraph();
    p.setFontSize(14).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    cell.setVerticalAlignment(DocumentApp.VerticalAlignment.MIDDLE);
  });

  // ===== إنشاء ملف Google Sheet مؤقت للرسم =====
  const tempSheet = SpreadsheetApp.create(`Graph - ${docName}`);
  const chartData = [["التقييم", "عدد"]];
 const totalAll = levels.reduce((sum, lvl) =>
  sum + evalTrainer[lvl] + evalContent[lvl] + evalOrg[lvl] + evalRes[lvl], 0);

levels.forEach(lvl => {
  const totalForLevel = evalTrainer[lvl] + evalContent[lvl] + evalOrg[lvl] + evalRes[lvl];
  const percentage = totalAll ? Math.round((totalForLevel / totalAll) * 100) : 0;
  const labelWithPercent = `${lvl} - ${percentage}%`;  // مثلاً: ممتاز - 30%
chartData.push([labelWithPercent, totalForLevel]);

});


  const sheet1 = tempSheet.getSheets()[0];
  sheet1.getRange(1, 1, chartData.length, 2).setValues(chartData);

 let chart = sheet1.newChart()
  .asPieChart()
  .addRange(sheet1.getRange(1, 1, chartData.length, 2))
  .setPosition(6, 1, 0, 0)
  .setOption('title', 'ملخص التقييمات')
  .setOption('pieHole', 0.4)
  .setOption('pieSliceText', 'label') // ✅ يعرض التسمية المدمجة
  .setOption('pieSliceTextStyle', { fontSize: 30, bold: true })
  .setOption('legend', { position: 'right' })
  .setOption('width', 800)
  .setOption('height', 600)
  .build();



  sheet1.insertChart(chart);

  SpreadsheetApp.flush();

  const charts = sheet1.getCharts();
  const chartImageBlob = charts[0].getAs('image/png');

  // خلية الرسم البياني داخل الجدول
  const chartCell = dataRow.appendTableCell();
  chartCell.setVerticalAlignment(DocumentApp.VerticalAlignment.MIDDLE);
  chartCell.appendImage(chartImageBlob).setWidth(180).setHeight(180);

  // الخاتمة
  body.appendParagraph("\nوذلك للعلم والتنبيه بما يلزم نحو تلافي الملاحظات الواردة بالتقرير.")
    .setFontSize(14).setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingBefore(20);

  body.appendParagraph("أعد التقرير / وحدة  تطوير البرمجيات")
    .setFontSize(13).setItalic(true).setAlignment(DocumentApp.HorizontalAlignment.RIGHT).setSpacingBefore(20).setSpacingAfter(30);

  body.appendParagraph("رئيس وحدة تطوير البرمجيات").setFontSize(16).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  body.appendParagraph("").setFontSize(16).setAlignment(DocumentApp.HorizontalAlignment.LEFT).setIndentStart(50);

  // حفظ PDF
  doc.saveAndClose();
  const pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF).setName(`${docName}.pdf`);

  const oldFiles = subfolder.getFilesByName(`${docName}.pdf`);
  while (oldFiles.hasNext()) oldFiles.next().setTrashed(true);
  subfolder.createFile(pdfBlob);

  // حذف ملف الجدول المؤقت
  Utilities.sleep(3000);
  DriveApp.getFileById(tempSheet.getId()).setTrashed(true);
}



 function generateEnglishCertificateFromTemplate(name, courseName, courseStartDate, courseEndDate, qualification, subfolder, residencyStatus) {
  // ✅ ترجمة البيانات
  const nameEn = LanguageApp.translate(name, 'ar', 'en');
  const courseEn = LanguageApp.translate(courseName, 'ar', 'en');
  const startDateEn = Utilities.formatDate(new Date(courseStartDate), "Africa/Cairo", "MMMM d, yyyy");
  const endDateEn = Utilities.formatDate(new Date(courseEndDate), "Africa/Cairo", "MMMM d, yyyy");
  const duration = Math.floor((new Date(courseEndDate) - new Date(courseStartDate)) / (1000 * 60 * 60 * 24)) + 1;

  // ✅ تحديد الجنس واللقب
  const isFemale = residencyStatus === "مقيمة" || residencyStatus === "غير مقيمة";
  const title = (qualification && (qualification.includes("هندس") || qualification.includes("مهندس"))) ? "Eng." : (isFemale ? "Ms." : "Mr.");

  // ✅ استدعاء التيمبليت وإنشاء نسخة مؤقتة
  const templateId = "1yIYlDDoVatEinWRwHzcUi8GAyAAMfR527kTtaD8TDLM"; // ← ID القالب
  const templateFile = DriveApp.getFileById(templateId);
  const tempDoc = templateFile.makeCopy(`Temp Certificate - ${nameEn}`);
  Utilities.sleep(2000); // مهلة لضمان جهوزية الملف

  const doc = DocumentApp.openById(tempDoc.getId());
  const body = doc.getBody();

  // ✅ استبدال المتغيرات داخل التيمبليت
  body.replaceText("{{name}}", `${title} ${nameEn}`);
  body.replaceText("{{course}}", courseEn);
  body.replaceText("{{startDate}}", startDateEn);
  body.replaceText("{{endDate}}", endDateEn);
  body.replaceText("{{duration}}", duration.toString());
  doc.saveAndClose();

  // ✅ توليد PDF من المستند
  const pdfBlob = DriveApp.getFileById(tempDoc.getId()).getAs(MimeType.PDF);
  pdfBlob.setName(`Certificate - ${nameEn}.pdf`);

  // ✅ إنشاء مجلد فرعي باسم الدورة + german
  const parentFolder = subfolder || DriveApp.getRootFolder();
  const folderName = `${courseEn} german`;
  let courseFolder;
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    courseFolder = folders.next();
  } else {
    courseFolder = parentFolder.createFolder(folderName);
  }

  // ✅ حفظ ملف الـ PDF داخل المجلد الفرعي
  const pdfFile = courseFolder.createFile(pdfBlob);

  // ✅ حذف الملف المؤقت
  DriveApp.getFileById(tempDoc.getId()).setTrashed(true);

  Logger.log("✅ تم حفظ الشهادة PDF في: " + pdfFile.getUrl());
}

 



function testGenerateEnglishCertificateFromTemplate() {
  const name = "أحمد محمد";
  const courseName = "إدارة المشروعات";
  const courseStartDate = "2025-09-10";
  const courseEndDate = "2025-09-12";
  const qualification = "بكالوريوس هندسة";

  const folderId = "1BWu9yqqD27CcZtB-iZ3BNKlxp24r6pEH"; // ← استبدل بـ ID مجلد Google Drive اللي عايز تحفظ فيه
  const subfolder = DriveApp.getFolderById(folderId);

  generateEnglishCertificateFromTemplate(
    name,
    courseName,
    courseStartDate,
    courseEndDate,
    qualification,
    subfolder
  );
}


function doGet(e) {

  // =========================================================
  // 🛡️ التأكد من وجود الطلب
  // =========================================================
  if (!e || !e.parameter) {

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "No parameters received"
        })
      )
      .setMimeType(ContentService.MimeType.JSON);
  }


  // =========================================================
  // 🎛️ لوحة إدارة الـ 3 Index
  // =========================================================
  // مهم جدًا:
  // لازم طلبات getCourses و updateCourse
  // تروح إلى Course Manager أولًا
  // قبل الـ handlers القديمة.
  // =========================================================

  if (
    e.parameter.action === "getCourses"
  ) {

    return CM_handleGetCourses_(e);

  }


  if (
    e.parameter.action === "updateCourse"
  ) {

    return CM_handleUpdateCourse_(e);

  }


  // =========================================================
  // ✏️ 1️⃣ تعديل الدورة - النظام القديم
  // =========================================================

  const courseUpdateResponse =
    handleCoursePost_(e);

  if (courseUpdateResponse) {

    return courseUpdateResponse;

  }


  // =========================================================
  // 📚 2️⃣ جلب الدورات من GitHub - النظام القديم
  // =========================================================

  const courseGetResponse =
    handleCourseGet_(e);

  if (courseGetResponse) {

    return courseGetResponse;

  }


  // =========================================================
  // 📊 فتح Sheet1
  // =========================================================

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Sheet1");


  if (!sheet) {

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "Sheet1 not found"
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }

  // =========================================================
  // ⬇️ من هنا كمل باقي doGet القديم عندك كما هو تمامًا
  // =========================================================
  // باقي كود doGet كما هو...

  // =========================================================
  // 📥 قراءة البيانات
  // =========================================================
  const data =
    sheet
      .getDataRange()
      .getValues();


  // =========================================================
  // 🔑 قراءة البارامترات
  // =========================================================
  const id =
    (e.parameter.id || "")
      .toString()
      .trim();

  const getData =
    (e.parameter.getData || "")
      .toString()
      .trim();

  const lastIndex =
    parseInt(
      e.parameter.lastIndex || "0",
      10
    );


  Logger.log("=================================");
  Logger.log("GET REQUEST");
  Logger.log("ID = " + id);
  Logger.log("getData = " + getData);
  Logger.log("lastIndex = " + lastIndex);
  Logger.log("=================================");


  // =========================================================
  // 👤 2️⃣ API جلب بيانات المتدرب بالـ ID
  // =========================================================
  if (getData === "true") {

    // -------------------------------------------------------
    // التأكد من وجود ID
    // -------------------------------------------------------
    if (!id) {

      return ContentService
        .createTextOutput(
          JSON.stringify({
            success: false,
            error: "No ID"
          })
        )
        .setMimeType(ContentService.MimeType.JSON);
    }


    // -------------------------------------------------------
    // البحث عن المتدرب
    // -------------------------------------------------------
    for (let i = 3; i < data.length; i++) {

      const storedId =
        (data[i][20] || "")
          .toString()
          .trim();


      if (storedId === id) {

        Logger.log(
          "✅ Trainee found at row: " +
          (i + 1)
        );


        return ContentService
          .createTextOutput(
            JSON.stringify({

              success: true,

              name:
                data[i][1] || "",

              course:
                data[i][8] || "",

              department:
                data[i][4] || "",

              start:
                data[i][9]
                  ? Utilities.formatDate(
                      new Date(data[i][9]),
                      "Africa/Cairo",
                      "dd/MM/yyyy"
                    )
                  : "",

              end:
                data[i][10]
                  ? Utilities.formatDate(
                      new Date(data[i][10]),
                      "Africa/Cairo",
                      "dd/MM/yyyy"
                    )
                  : ""

            })
          )
          .setMimeType(
            ContentService.MimeType.JSON
          );
      }
    }


    // -------------------------------------------------------
    // المتدرب غير موجود
    // -------------------------------------------------------
    Logger.log(
      "❌ Trainee not found. ID = " + id
    );


    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: "Not Found"
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }


  // =========================================================
  // 👨‍💼 3️⃣ فتح صفحة المدير
  // =========================================================
  if (id) {

    Logger.log(
      "Opening manager page for ID = " + id
    );


    return HtmlService
      .createHtmlOutputFromFile("manager")
      .setXFrameOptionsMode(
        HtmlService.XFrameOptionsMode.ALLOWALL
      );
  }


  // =========================================================
  // 📊 4️⃣ API البيانات العادية
  // =========================================================

  // البيانات تبدأ من الصف الرابع
  const filteredData =
    data.slice(3);


  // منع lastIndex من أن يكون سالبًا
  const safeLastIndex =
    Math.max(0, lastIndex);


  const newData =
    filteredData.slice(
      safeLastIndex
    );


  Logger.log(
    "Returning " +
    newData.length +
    " rows"
  );


  return ContentService
    .createTextOutput(
      JSON.stringify(newData)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}

function reorganizeLettersByMonth() {

  const LETTERS_ROOT_ID = "1BWu9yqqD27CcZtB-iZ3BNKlxp24r6pEH";
  const root = DriveApp.getFolderById(LETTERS_ROOT_ID);
  const folders = root.getFolders();

  while (folders.hasNext()) {

    const courseFolder = folders.next();
    const folderName = courseFolder.getName();

    // ⛔ تجاهل فولدرات الشهور (yyyy-MM)
    if (/^\d{4}-\d{2}$/.test(folderName)) continue;

    // 🔍 استخراج تاريخ البداية من اسم الفولدر (dd/MM/yyyy)
    const dateMatch = folderName.match(/(\d{2})\/(\d{2})\/(\d{4})/);

    // لو مفيش تاريخ واضح → تجاهل
    if (!dateMatch) {
      Logger.log("⚠️ لم يتم العثور على تاريخ في: " + folderName);
      continue;
    }

    const day = dateMatch[1];
    const month = dateMatch[2];
    const year = dateMatch[3];

    // 📅 شهر بداية الدورة فقط
    const yearMonth = `${year}-${month}`;

    // 📁 فولدر الشهر
    let monthFolder;
    const monthFolders = root.getFoldersByName(yearMonth);

    if (monthFolders.hasNext()) {
      monthFolder = monthFolders.next();
    } else {
      monthFolder = root.createFolder(yearMonth);
    }

    // 🔁 نقل فولدر الدورة
    monthFolder.addFolder(courseFolder);
    root.removeFolder(courseFolder);
  }

  Logger.log("✅ تم تصنيف الدورات حسب شهر بداية الدورة");
}

function generateArchiveDashboard_SINGLE_FUNCTION() {

  /************** الإعدادات **************/
  const ROOT_FOLDER_ID = "1BWu9yqqD27CcZtB-iZ3BNKlxp24r6pEH";
  const TRAINEE_SHEET_ID = "1XX20LVRFvfjIjc1HMR1HfcS4uGa1fjUS3ui4l_m2knM";

  const COURSE_COL_INDEX = 8; // العمود I (صفرى)
  const DATE_COL_INDEX   = 0; // العمود A (تاريخ التسجيل)
  const START_ROW = 4;

  // 🔴 فترة زمنية (عدّلها بحرية)
  const FROM_DATE = new Date("2025-01-01");
  const TO_DATE   = new Date("2027-12-31");

  const REPORT_NAME = "📊 Dashboard أرشيف الدورات";
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);

  /************** فتح أو إنشاء ملف التقرير **************/
  let ss;
  const files = DriveApp.getFilesByName(REPORT_NAME);
  ss = files.hasNext()
    ? SpreadsheetApp.open(files.next())
    : SpreadsheetApp.create(REPORT_NAME);

  let indexSheet = ss.getSheetByName("الفهرس") || ss.insertSheet("الفهرس");
  let dashSheet  = ss.getSheetByName("Dashboard") || ss.insertSheet("Dashboard");
  indexSheet.clear();
  dashSheet.clear();

  /************** قراءة شيت المتدربين **************/
  const traineeSS = SpreadsheetApp.openById(TRAINEE_SHEET_ID);
  const traineeSheet = traineeSS.getSheets()[0];
  const lastRow = traineeSheet.getLastRow();

  const data = traineeSheet
    .getRange(START_ROW, 1, lastRow - START_ROW + 1, COURSE_COL_INDEX + 1)
    .getValues();

  // فلترة حسب التاريخ + وجود اسم دورة
  const trainees = data.filter(r => {
    const d = r[DATE_COL_INDEX];
    const c = r[COURSE_COL_INDEX];
    return d instanceof Date &&
           d >= FROM_DATE &&
           d <= TO_DATE &&
           c && c.toString().trim();
  }).map(r => r[COURSE_COL_INDEX].toString().trim());

  const TOTAL_TRAINEES_REAL = trainees.length;

  /************** قراءة Drive **************/
  const monthStats = {};
  const courseCounters = {};
  const courseList = [];

  const months = root.getFolders();
  while (months.hasNext()) {

    const monthFolder = months.next();
    const monthName = monthFolder.getName();
    if (!/^\d{4}-\d{2}$/.test(monthName)) continue;

    monthStats[monthName] = {
      courses: 0,
      trainees: 0,
      rows: []
    };

    const courses = monthFolder.getFolders();
    while (courses.hasNext()) {

      const courseFolder = courses.next();
      const folderName = courseFolder.getName().trim();

      courseCounters[folderName] = 0;
      courseList.push({ month: monthName, name: folderName });

      monthStats[monthName].courses++;
      monthStats[monthName].rows.push([monthName, folderName]);
    }
  }

  /************** توزيع المتدربين (بدون تكرار) **************/
  trainees.forEach(courseNameFromSheet => {

    const normalizedSheetName =
      courseNameFromSheet.replace(/\s+/g, " ").toLowerCase();

    for (let c of courseList) {

      const normalizedFolderName =
        c.name.replace(/\s+/g, " ").toLowerCase();

      if (normalizedFolderName.includes(normalizedSheetName)) {
        courseCounters[c.name]++;
        monthStats[c.month].trainees++;
        break; // ⛔ المتدرب يتحسب مرة واحدة فقط
      }
    }
  });

  /************** شيت الفهرس **************/
  indexSheet.appendRow([
    "📅 الشهر",
    "📘 اسم الدورة",
    "👥 عدد المتدربين",
    "📁 اسم الفولدر",
    "🕒 تاريخ الفهرسة"
  ]);

  const now = Utilities.formatDate(new Date(), "Africa/Cairo", "yyyy-MM-dd HH:mm");

  let totalCourses = 0;

  courseList.forEach(c => {
    indexSheet.appendRow([
      c.month,
      c.name,
      courseCounters[c.name],
      c.name,
      now
    ]);
    totalCourses++;
  });

  indexSheet.autoResizeColumns(1, 5);

  /************** Dashboard **************/
  dashSheet.setRightToLeft(true);

  dashSheet.getRange("A1:D1").merge()
    .setValue("🏛️ Dashboard أرشيف الدورات التدريبية")
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setBackground("#0b5394")
    .setFontColor("white");

  // KPI
  dashSheet.getRange("A3:B3").merge()
    .setValue("📘 إجمالي الدورات")
    .setBackground("#d9ead3");

  dashSheet.getRange("C3:D3").merge()
    .setValue(totalCourses)
    .setFontSize(16)
    .setFontWeight("bold");

  dashSheet.getRange("A4:B4").merge()
    .setValue("👥 إجمالي المتدربين")
    .setBackground("#cfe2f3");

  dashSheet.getRange("C4:D4").merge()
    .setValue(TOTAL_TRAINEES_REAL)
    .setFontSize(16)
    .setFontWeight("bold");

  // جدول شهري
  dashSheet.getRange("A6:C6")
    .setValues([["📅 الشهر", "📘 عدد الدورات", "👥 عدد المتدربين"]])
    .setFontWeight("bold")
    .setBackground("#eeeeee");

  let r = 7;
  for (let m in monthStats) {
    dashSheet.appendRow([
      m,
      monthStats[m].courses,
      monthStats[m].trainees
    ]);
    r++;
  }

  // رسم بياني
  dashSheet.insertChart(
    dashSheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(dashSheet.getRange(`A6:C${r - 1}`))
      .setPosition(2, 6, 0, 0)
      .setOption("title", "📊 المتدربين شهريًا")
      .build()
  );

  /************** جدول الدورات + عدد المتدربين **************/
  let tableRow = r + 3;

  dashSheet.getRange(tableRow, 1, 1, 4).merge()
    .setValue("📋 جدول الدورات المنفذة حسب الشهر")
    .setFontSize(14)
    .setFontWeight("bold")
    .setBackground("#0b5394")
    .setFontColor("white")
    .setHorizontalAlignment("center");

  tableRow += 2;

  dashSheet.getRange(tableRow, 1, 1, 3)
    .setValues([["📅 الشهر", "📘 اسم الدورة", "👥 عدد المتدربين"]])
    .setFontWeight("bold")
    .setBackground("#eeeeee");

  tableRow++;

  for (let m in monthStats) {
    monthStats[m].rows.forEach(row => {

      const courseName = row[1];
      const count = courseCounters[courseName] || 0;

      dashSheet.getRange(tableRow, 1, 1, 3).setValues([[
        row[0],
        courseName,
        count
      ]]);

      tableRow++;
    });
  }

  dashSheet.autoResizeColumns(1, 4);

  Logger.log("✅ Dashboard جاهز – حساب سليم + فترة زمنية + توزيع دقيق");
}





// ============================================================
// ✏️ نظام تعديل الدورات من صفحة edit.html
// ============================================================

const GITHUB_OWNER = "etiqotwf";
const GITHUB_REPO = "dtc";
const GITHUB_FILE = "index.html";
const GITHUB_BRANCH = "main";


// ============================================================
// 🔐 الحصول على GitHub Token من Script Properties
// ============================================================
function getGitHubToken_() {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty("GITHUB_TOKEN");

  if (!token) {
    throw new Error("GITHUB_TOKEN غير موجود في Script Properties");
  }

  return token;
}


// ============================================================
// 📥 جلب index.html من GitHub
// ============================================================
function getGitHubFile_() {

  const token = getGitHubToken_();

  const url =
    "https://api.github.com/repos/" +
    GITHUB_OWNER + "/" +
    GITHUB_REPO +
    "/contents/" +
    GITHUB_FILE +
    "?ref=" + encodeURIComponent(GITHUB_BRANCH);

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json"
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();

  if (code !== 200) {
    throw new Error(
      "فشل قراءة index.html من GitHub. HTTP " +
      code +
      " - " +
      response.getContentText()
    );
  }

  const json = JSON.parse(response.getContentText());

  const bytes = Utilities.base64Decode(
    json.content.replace(/\s/g, "")
  );

  const content = Utilities
    .newBlob(bytes)
    .getDataAsString("UTF-8");

  return {
    content: content,
    sha: json.sha
  };
}


// ============================================================
// 📚 استخراج الدورات من index.html
// ============================================================
function getCoursesFromIndex_() {

  const file = getGitHubFile_();
  const content = file.content;

  const courses = [];

  /*
    يبحث عن الشكل:

    "اسم الدورة": { start: "2026-8-10", end: "2026-8-12" },
  */

  const regex =
    /"([^"]+)"\s*:\s*\{\s*start:\s*"([^"]+)"\s*,\s*end:\s*"([^"]+)"\s*\}/g;

  let match;

  while ((match = regex.exec(content)) !== null) {

    courses.push({
      name: match[1],
      start: match[2],
      end: match[3]
    });
  }

  return courses;
}


// ============================================================
// 📤 إرسال الملف المعدل إلى GitHub
// ============================================================
function updateGitHubFile_(newContent, sha, commitMessage) {

  const token = getGitHubToken_();

  const url =
    "https://api.github.com/repos/" +
    GITHUB_OWNER + "/" +
    GITHUB_REPO +
    "/contents/" +
    GITHUB_FILE;

  const encodedContent = Utilities
    .base64Encode(
      Utilities.newBlob(newContent, "text/html", GITHUB_FILE)
        .getBytes()
    );

  const payload = {
    message: commitMessage || "تعديل بيانات الدورة",
    content: encodedContent,
    sha: sha,
    branch: GITHUB_BRANCH
  };

  const response = UrlFetchApp.fetch(url, {

    method: "put",

    contentType: "application/json",

    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json"
    },

    payload: JSON.stringify(payload),

    muteHttpExceptions: true
  });

  const code = response.getResponseCode();

  if (code !== 200) {

    throw new Error(
      "فشل تحديث index.html على GitHub. HTTP " +
      code +
      " - " +
      response.getContentText()
    );
  }

  return JSON.parse(response.getContentText());
}


// ============================================================
// 🛡️ حماية النص من رموز Regex
// ============================================================
function escapeRegExp_(text) {

  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


// ============================================================
// ✏️ تعديل دورة واحدة
// ============================================================


// ============================================================
// 🌐 API - GET
// ============================================================
function handleCoursePost_(e) {

  try {

    if (!e || !e.parameter) {
      throw new Error("لم يتم استقبال أي بيانات");
    }

    const action =
      (e.parameter.action || "").toString().trim();

    Logger.log("ACTION = " + action);
    Logger.log("oldName = " + e.parameter.oldName);
    Logger.log("newName = " + e.parameter.newName);
    Logger.log("start = " + e.parameter.start);
    Logger.log("end = " + e.parameter.end);

    // ============================================
    // التأكد أن الطلب خاص بتعديل الدورة
    // ============================================

    if (action !== "updateCourse") {
      return null;
    }

    const oldName =
      (e.parameter.oldName || "")
        .toString()
        .trim();

    const newName =
      (e.parameter.newName || "")
        .toString()
        .trim();

    const start =
      (e.parameter.start || "")
        .toString()
        .trim();

    const end =
      (e.parameter.end || "")
        .toString()
        .trim();

    // ============================================
    // التحقق من البيانات
    // ============================================

    if (!oldName) {
      throw new Error("اسم الدورة القديم غير موجود");
    }

    if (!newName) {
      throw new Error("اسم الدورة الجديد غير موجود");
    }

    if (!start) {
      throw new Error("تاريخ البداية غير موجود");
    }

    if (!end) {
      throw new Error("تاريخ النهاية غير موجود");
    }

    // ============================================
    // تنفيذ التعديل على GitHub
    // ============================================

    const result =
      updateCourseOnGitHub_(
        oldName,
        newName,
        start,
        end
      );

    // ============================================
    // الرد
    // ============================================

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: true,
          message: "تم تعديل الدورة بنجاح",
          commit:
            result && result.commit
              ? result.commit.sha
              : ""
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  } catch (error) {

    Logger.log(
      "❌ UPDATE COURSE ERROR: " +
      error.message
    );

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: error.message
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );
  }
}
function updateCourseOnGitHub_(
  oldName,
  newName,
  newStart,
  newEnd
) {

  // ============================================
  // التحقق من البيانات
  // ============================================

  if (
    !oldName ||
    !newName ||
    !newStart ||
    !newEnd
  ) {
    throw new Error(
      "كل بيانات الدورة مطلوبة"
    );
  }

  // ============================================
  // جلب index.html من GitHub
  // ============================================

  const file =
    getGitHubFile_();

  // ============================================
  // تنظيف الأسماء
  // ============================================

  function normalizeName_(text) {

    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();

  }

  const targetName =
    normalizeName_(oldName);

  let found = false;

  // ============================================
  // البحث عن الدورات
  // ============================================

  const coursePattern =
    /"([^"]+)"\s*:\s*\{\s*start\s*:\s*"([^"]*)"\s*,\s*end\s*:\s*"([^"]*)"\s*\}/g;

  // ============================================
  // تعديل الدورة
  // ============================================

  const newContent =
    file.content.replace(
      coursePattern,
      function (
        match,
        courseName,
        oldStart,
        oldEnd
      ) {

        if (
          normalizeName_(courseName) !==
          targetName
        ) {

          return match;
        }

        found = true;

        return (
          '"' +
          newName +
          '": { start: "' +
          newStart +
          '", end: "' +
          newEnd +
          '" }'
        );

      }
    );

  // ============================================
  // لم نجد الدورة
  // ============================================

  if (!found) {

    throw new Error(
      "لم يتم العثور على الدورة المطلوبة داخل index.html على GitHub"
    );
  }

  // ============================================
  // التأكد من وجود تغيير
  // ============================================

  if (
    newContent === file.content
  ) {

    throw new Error(
      "لم يحدث أي تغيير في index.html"
    );
  }

  // ============================================
  // رفع التعديل إلى GitHub
  // ============================================

  const result =
    updateGitHubFile_(
      newContent,
      file.sha,
      "تعديل اسم وتاريخ دورة"
    );

  return result;
}


// ============================================================
// 📚 API - جلب الدورات من GitHub
// ============================================================
function handleCourseGet_(e) {

  try {

    if (!e || !e.parameter) {
      return null;
    }

    const action =
      (e.parameter.action || "")
        .toString()
        .trim();

    // لو الطلب مش خاص بجلب الدورات
    if (action !== "getCourses") {
      return null;
    }

    // جلب index.html من GitHub
    const courses = getCoursesFromIndex_();

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: true,
          courses: courses
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {

    Logger.log(
      "❌ GET COURSES ERROR: " +
      error.message
    );

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          error: error.message
        })
      )
      .setMimeType(ContentService.MimeType.JSON);
  }
}



function testUpdateCourse() {

  const result =
    updateCourseOnGitHub_(
      "اعمال الرفع ",
      "اعمال  ",
      "2026-8-18",
      "2026-8-30"
    );

  Logger.log(
    JSON.stringify(result)
  );
}

// Deploy this as a NEW standalone Apps Script project. Execute as Me; access Anyone.
// Script Properties: PLATFORM_BRIDGE_SECRET (same as the server, >= 32 characters).
// Optional Script Property: PLATFORM_FOLDER_ID. Default is the user's platform folder.


function platformJson_(v) { return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON); }
function platformAuthorize() {
  DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PLATFORM_FOLDER_ID') || '13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u').getName();
  MailApp.getRemainingDailyQuota();
}
function platformBridge_(e) {
  var lock;
  try {
    var envelope=JSON.parse(e.postData.contents||'{}');
    var props=PropertiesService.getScriptProperties();
    var secret=props.getProperty('PLATFORM_BRIDGE_SECRET');
    if(!secret||secret.length<32)throw new Error('Set PLATFORM_BRIDGE_SECRET with at least 32 characters in Script Properties.');
    if(typeof envelope.payload!=='string'||envelope.payload.length>12000000)throw new Error('Invalid request.');
    var expected=Utilities.base64Encode(Utilities.computeHmacSha256Signature(envelope.payload,secret,Utilities.Charset.UTF_8));
    var actual=String(envelope.signature||''),different=actual.length^expected.length;
    for(var i=0;i<expected.length;i++)different|=expected.charCodeAt(i)^(actual.charCodeAt(i)||0);
    if(different)throw new Error('Invalid signature.');
    var p=JSON.parse(envelope.payload);
    if(!p.requestId||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.requestId)||Math.abs(Date.now()-Number(p.timestamp))>300000)throw new Error('Expired or invalid request.');
    var folder=DriveApp.getFolderById(props.getProperty('PLATFORM_FOLDER_ID')||'13xUHOP92OyWO0KIJvxu1jFE2ijFbg7_u');
    if(p.action==='platformHealth')return platformJson_({success:true,folder:folder.getName(),remainingMailQuota:MailApp.getRemainingDailyQuota()});
    if(p.action==='platformDownload') {
      var f=DriveApp.getFileById(String(p.id)),parents=f.getParents(),inside=false;
      while(parents.hasNext())if(parents.next().getId()===folder.getId())inside=true;
      if(!inside)throw new Error('File is outside the platform folder.');
      if(f.getSize()>8388608)throw new Error('File exceeds 8 MB.');
      return platformJson_({success:true,name:f.getName(),mime:f.getMimeType(),base64:Utilities.base64Encode(f.getBlob().getBytes())});
    }
    if(['platformUpload','platformCredentials','platformContact'].indexOf(p.action)<0)throw new Error('Unknown action.');
    lock=LockService.getScriptLock();lock.waitLock(30000);
    var cache=CacheService.getScriptCache(),key='platform:'+p.requestId,prior=cache.get(key);
    if(prior)return platformJson_(JSON.parse(prior));
    var result;
    if(p.action==='platformUpload') {
      var name=String(p.name||'file').replace(/[\\/:*?"<>|]/g,'_').slice(0,180);
      if(!/\.(docx?|xlsx?|pptx?|pdf|txt|png|jpe?g|zip)$/i.test(name))throw new Error('Unsupported file type.');
      var bytes=Utilities.base64Decode(String(p.base64||''));
      if(!bytes.length||bytes.length>8388608)throw new Error('Maximum file size is 8 MB.');
      var file=folder.createFile(Utilities.newBlob(bytes,String(p.mime||'application/octet-stream'),name));
      result={success:true,id:file.getId(),url:file.getUrl()};
    } else if(p.action==='platformContact') {
      var replyTo=String(p.replyTo||'').trim(),msg=String(p.message||'').trim(),subject=String(p.subject||'استفسار من منصة الإدارة المركزية للتدريب').slice(0,160);
      if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(replyTo)||msg.length<10||msg.length>5000)throw new Error('Invalid contact message.');
      if(MailApp.getRemainingDailyQuota()<1)throw new Error('Daily email quota exhausted. Try again later.');
      MailApp.sendEmail({to:'dtctantaformal@gmail.com',replyTo:replyTo,subject:subject,name:'منصة الإدارة المركزية للتدريب',body:'رسالة واردة من منصة الإدارة المركزية للتدريب\n\nالمرسل: '+String(p.displayName||'مستخدم المنصة')+'\nبريد الرد: '+replyTo+'\n\n'+msg});
      result={success:true,sent:true};
    } else {
      var email=String(p.email||'').trim();
      if(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)||!p.username||!p.password)throw new Error('Invalid recipient or credentials.');
      if(MailApp.getRemainingDailyQuota()<1)throw new Error('Daily email quota exhausted. Try again later.');
      var link=String(p.loginUrl||'');
      if(!/^https?:\/\//.test(link))throw new Error('Set PLATFORM_PUBLIC_URL to the platform login URL.');
      MailApp.sendEmail({to:email,subject:'بيانات الدخول إلى منصة الإدارة المركزية للتدريب',name:'الإدارة المركزية للتدريب',body:'مرحباً '+String(p.name||'')+'\n\nتم تجهيز حسابك على منصة التدريب.\nرابط الدخول: '+link+'\nاسم المستخدم: '+p.username+'\nكلمة المرور: '+p.password+'\n\nاحتفظ ببياناتك ولا تشاركها مع الآخرين.\nإدارة الإدارة المركزية للتدريب'});
      result={success:true,sent:true};
    }
    cache.put(key,JSON.stringify(result),21600);
    return platformJson_(result);
  } catch(error) { return platformJson_({success:false,error:String(error.message||error)}); }
  finally { if(lock&&lock.hasLock())lock.releaseLock(); }
}
