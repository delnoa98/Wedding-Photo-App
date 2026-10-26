/**
 * Wedding photo inbox.
 *
 * Guests POST the original photo as base64 inside a text/plain body
 * (so the browser skips the CORS preflight Apps Script cannot answer).
 * The first upload creates a brand-new Google Drive folder named "Wedding"
 * and stores that folder's id. Later uploads always use that same folder.
 * An older folder that already has the same name is never searched for
 * and never written to.
 *
 * Deploy: Execute as Me, Who has access: Anyone.
 */

var WEDDING_FOLDER_NAME = "Wedding";
var FOLDER_ID_PROPERTY = "WEDDING_FOLDER_ID";
var MAX_POST_BYTES = 50 * 1024 * 1024;

function doGet() {
  return json_({
    ok: true,
    message: "Wedding photo upload is ready. The first photo creates a new Google Drive folder named Wedding."
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: "The photo was missing from the request." });
    }

    var posted = e.postData.length || e.contentLength || 0;
    if (posted > MAX_POST_BYTES || e.postData.contents.length > MAX_POST_BYTES) {
      return json_({
        ok: false,
        error: "This photo is too large to upload. Apps Script accepts up to 50 MB per request, and the original file is sent without resizing."
      });
    }

    var body = JSON.parse(e.postData.contents);
    if (!body || typeof body !== "object" || Object.prototype.toString.call(body) !== "[object Object]") {
      return json_({ ok: false, error: "Could not read the upload." });
    }
    var bytes = decodePhoto_(body.data);
    var mimeType = cleanMime_(body.mimeType);
    var filename = buildFilename_(body.guest, body.filename);
    var folder = getWeddingFolder_();
    var blob = Utilities.newBlob(bytes, mimeType, filename);
    var file = folder.createFile(blob);

    return json_({
      ok: true,
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      folderId: folder.getId(),
      folderName: folder.getName()
    });
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    Logger.log(message);
    return json_({ ok: false, error: message });
  }
}

/**
 * Use the folder id saved on the first run. If that folder is gone,
 * create another new "Wedding" folder. Never look one up by name.
 */
function getWeddingFolder_() {
  var props = PropertiesService.getScriptProperties();
  var existing = folderFromStoredId_(props);
  if (existing) return existing;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    existing = folderFromStoredId_(props);
    if (existing) return existing;
    var created = DriveApp.createFolder(WEDDING_FOLDER_NAME);
    props.setProperty(FOLDER_ID_PROPERTY, created.getId());
    return created;
  } finally {
    lock.releaseLock();
  }
}

function folderFromStoredId_(props) {
  var id = props.getProperty(FOLDER_ID_PROPERTY);
  if (!id) return null;
  try {
    var folder = DriveApp.getFolderById(id);
    if (folder.isTrashed()) return null;
    return folder;
  } catch (err) {
    return null;
  }
}

function decodePhoto_(data) {
  var raw = String(data || "").trim();
  var comma = raw.indexOf(",");
  if (raw.substring(0, 5) === "data:" && comma !== -1) {
    raw = raw.substring(comma + 1);
  }
  raw = raw.replace(/\s/g, "");
  if (!raw) {
    throw new Error("The photo data was empty.");
  }
  var bytes = Utilities.base64Decode(raw);
  if (!bytes || !bytes.length) {
    throw new Error("The photo data could not be read.");
  }
  return bytes;
}

function buildFilename_(guest, original) {
  var stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmssSSS'Z'");
  var parts = [stamp];
  var who = sanitize_(guest).substring(0, 60);
  if (who) parts.push(who);
  parts.push(sanitize_(original).substring(0, 120) || "photo");
  var name = parts.join("_");
  if (name.length > 220) name = name.substring(0, 220);
  return name;
}

function sanitize_(value) {
  return String(value || "")
    .replace(/[\/\\?%*:|"<>\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
}

function cleanMime_(mime) {
  var value = String(mime || "").trim().toLowerCase();
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value)) return value;
  return "application/octet-stream";
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
