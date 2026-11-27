
// Central Training Platform - Knowledge Library Drive Bridge
// Execute as: Me | Who has access: Anyone
//
// Script Properties:
// KNOWLEDGE_BRIDGE_SECRET
// KNOWLEDGE_FOLDER_ID

var KNOWLEDGE_MAX_FILE_BYTES = 8 * 1024 * 1024;
var KNOWLEDGE_MAX_PAYLOAD_CHARS = 12000000;

function doGet() {
  try {
    var folder = knowledgeFolder_();
    return knowledgeJson_({
      success: true,
      service: 'Central Knowledge Drive Bridge',
      folder: folder.getName()
    });
  } catch (error) {
    return knowledgeJson_({
      success: false,
      error: String(error && error.message || error)
    });
  }
}

function doPost(e) {
  var lock;

  try {
    var raw = e && e.postData && e.postData.contents
      ? e.postData.contents
      : '{}';

    var envelope = JSON.parse(raw);
    var props = PropertiesService.getScriptProperties();
    var secret = String(
      props.getProperty('KNOWLEDGE_BRIDGE_SECRET') || ''
    );

    if (secret.length < 32) {
      throw new Error(
        'Set KNOWLEDGE_BRIDGE_SECRET (32+ chars) in this Apps Script project.'
      );
    }

    if (
      typeof envelope.payload !== 'string' ||
      envelope.payload.length > KNOWLEDGE_MAX_PAYLOAD_CHARS
    ) {
      throw new Error('Invalid request or request is too large.');
    }

    var expected = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(
        envelope.payload,
        secret,
        Utilities.Charset.UTF_8
      )
    );

    var actual = String(envelope.signature || '');
    var different = actual.length ^ expected.length;

    for (var i = 0; i < expected.length; i++) {
      different |= expected.charCodeAt(i) ^
        (actual.charCodeAt(i) || 0);
    }

    if (different) {
      throw new Error('Invalid signature.');
    }

    var p = JSON.parse(envelope.payload);

    if (
      !p.requestId ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(p.requestId) ||
      Math.abs(Date.now() - Number(p.timestamp)) > 300000
    ) {
      throw new Error('Expired or invalid request.');
    }

    var folder = knowledgeFolder_();

    if (p.action === 'knowledgeHealth') {
      return knowledgeJson_({
        success: true,
        folder: folder.getName(),
        folderId: folder.getId()
      });
    }

    if (p.action === 'knowledgeDownload') {
      var fileId = String(p.id || '');

      if (!fileId) {
        throw new Error('Missing file ID.');
      }

      var file = DriveApp.getFileById(fileId);
      var parents = file.getParents();
      var inside = false;

      while (parents.hasNext()) {
        if (parents.next().getId() === folder.getId()) {
          inside = true;
          break;
        }
      }

      if (!inside) {
        throw new Error('File is outside the Knowledge folder.');
      }

      if (file.getSize() > KNOWLEDGE_MAX_FILE_BYTES) {
        throw new Error('File exceeds the 8 MB download limit.');
      }

      return knowledgeJson_({
        success: true,
        name: file.getName(),
        mime: file.getMimeType(),
        base64: Utilities.base64Encode(file.getBlob().getBytes())
      });
    }

    if (p.action !== 'knowledgeUpload') {
      throw new Error('Unknown Knowledge Bridge action.');
    }

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    var cache = CacheService.getScriptCache();
    var cacheKey = 'knowledge:' + p.requestId;
    var prior = cache.get(cacheKey);

    if (prior) {
      return knowledgeJson_(JSON.parse(prior));
    }

    var name = String(p.name || 'document')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 180);

    var allowed =
      /\.(doc|docx|xls|xlsx|ppt|pptx|pdf|txt|md|csv|rtf|odt|ods|odp|png|jpe?g|gif|webp|bmp|svg|zip|7z|rar|tar|gz|tgz|xz|bz2|msi|exe|msix|appx|dmg|pkg|deb|rpm|appimage|apk|jar|mp4|webm|mov|m4v)$/i;

    if (!allowed.test(name)) {
      throw new Error('Unsupported Knowledge file type.');
    }

    var base64 = String(p.base64 || '');

    if (!base64) {
      throw new Error('No file data received.');
    }

    var estimatedBytes = Math.floor(base64.length * 3 / 4);

    if (estimatedBytes > KNOWLEDGE_MAX_FILE_BYTES + 3) {
      throw new Error('Maximum Knowledge file size is 8 MB.');
    }

    var bytes = Utilities.base64Decode(base64);

    if (
      !bytes.length ||
      bytes.length > KNOWLEDGE_MAX_FILE_BYTES
    ) {
      throw new Error('Maximum Knowledge file size is 8 MB.');
    }

    var mime = String(
      p.mime || 'application/octet-stream'
    ).slice(0, 150);

    var saved = folder.createFile(
      Utilities.newBlob(bytes, mime, name)
    );

    var result = {
      success: true,
      id: saved.getId(),
      url: saved.getUrl(),
      name: saved.getName(),
      mime: saved.getMimeType(),
      size: saved.getSize()
    };

    cache.put(cacheKey, JSON.stringify(result), 21600);

    return knowledgeJson_(result);

  } catch (error) {
    return knowledgeJson_({
      success: false,
      error: String(error && error.message || error)
    });

  } finally {
    if (lock && lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function knowledgeAuthorize() {
  var folder = knowledgeFolder_();
  folder.getName();
  DriveApp.getRootFolder().getName();
}

function knowledgeFolder_() {
  var id = String(
    PropertiesService.getScriptProperties()
      .getProperty('KNOWLEDGE_FOLDER_ID') || ''
  ).trim();

  if (!id) {
    throw new Error(
      'Set KNOWLEDGE_FOLDER_ID in this Apps Script project.'
    );
  }

  return DriveApp.getFolderById(id);
}

function knowledgeJson_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
