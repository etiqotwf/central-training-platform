// Central Training Platform - Knowledge Library Drive Bridge
// Deploy as a NEW Web App deployment, separate from the existing archive bridge.
// Execute as: Me | Who has access: Anyone
// Script Properties (this project only):
//   KNOWLEDGE_BRIDGE_SECRET  (same value as Render KNOWLEDGE_BRIDGE_SECRET; 32+ chars)
//   KNOWLEDGE_FOLDER_ID      (Google Drive folder dedicated to Knowledge originals)

function doGet() {
  try {
    var folder = knowledgeFolder_();
    return knowledgeJson_({ success: true, service: 'Central Knowledge Drive Bridge', folder: folder.getName() });
  } catch (error) {
    return knowledgeJson_({ success: false, error: String(error && error.message || error) });
  }
}

function doPost(e) {
  var lock;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var envelope = JSON.parse(raw);
    var props = PropertiesService.getScriptProperties();
    var secret = String(props.getProperty('KNOWLEDGE_BRIDGE_SECRET') || '');
    if (secret.length < 32) throw new Error('Set KNOWLEDGE_BRIDGE_SECRET (32+ chars) in this Apps Script project.');
    if (typeof envelope.payload !== 'string' || envelope.payload.length > 12000000) throw new Error('Invalid request.');

    var expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8));
    var actual = String(envelope.signature || '');
    var different = actual.length ^ expected.length;
    for (var i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
    if (different) throw new Error('Invalid signature.');

    var p = JSON.parse(envelope.payload);
    if (!p.requestId || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.requestId) || Math.abs(Date.now() - Number(p.timestamp)) > 300000) {
      throw new Error('Expired or invalid request.');
    }

    var folder = knowledgeFolder_();
    if (p.action === 'knowledgeHealth') {
      return knowledgeJson_({ success: true, folder: folder.getName(), folderId: folder.getId() });
    }

    if (p.action === 'knowledgeDownload') {
      var file = DriveApp.getFileById(String(p.id || ''));
      var parents = file.getParents();
      var inside = false;
      while (parents.hasNext()) if (parents.next().getId() === folder.getId()) inside = true;
      if (!inside) throw new Error('File is outside the Knowledge folder.');
      if (file.getSize() > 8388608) throw new Error('File exceeds 8 MB.');
      return knowledgeJson_({
        success: true,
        name: file.getName(),
        mime: file.getMimeType(),
        base64: Utilities.base64Encode(file.getBlob().getBytes())
      });
    }

    if (p.action !== 'knowledgeUpload') throw new Error('Unknown Knowledge Bridge action.');

    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var cache = CacheService.getScriptCache();
    var cacheKey = 'knowledge:' + p.requestId;
    var prior = cache.get(cacheKey);
    if (prior) return knowledgeJson_(JSON.parse(prior));

    var name = String(p.name || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
    if (!/\.(docx?|xlsx?|pptx?|pdf|txt|md|png|jpe?g)$/i.test(name)) throw new Error('Unsupported Knowledge file type.');
    var bytes = Utilities.base64Decode(String(p.base64 || ''));
    if (!bytes.length || bytes.length > 8388608) throw new Error('Maximum Knowledge file size is 8 MB.');
    var mime = String(p.mime || 'application/octet-stream').slice(0, 150);
    var saved = folder.createFile(Utilities.newBlob(bytes, mime, name));
    var result = { success: true, id: saved.getId(), url: saved.getUrl(), name: saved.getName() };
    cache.put(cacheKey, JSON.stringify(result), 21600);
    return knowledgeJson_(result);
  } catch (error) {
    return knowledgeJson_({ success: false, error: String(error && error.message || error) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function knowledgeAuthorize() {
  var folder = knowledgeFolder_();
  folder.getName();
  DriveApp.getRootFolder().getName();
}

function knowledgeFolder_() {
  var id = String(PropertiesService.getScriptProperties().getProperty('KNOWLEDGE_FOLDER_ID') || '').trim();
  if (!id) throw new Error('Set KNOWLEDGE_FOLDER_ID in this Apps Script project.');
  return DriveApp.getFolderById(id);
}

function knowledgeJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
