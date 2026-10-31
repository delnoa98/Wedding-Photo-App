/**
 * Wedding photo inbox and guest book.
 *
 * Guests POST JSON as text/plain so the browser skips the CORS preflight
 * Apps Script cannot answer.
 *
 * Photo uploads (the original client) send guest, filename, mimeType, and
 * data. They do not send kind. That path is unchanged: the bytes are stored
 * in a Google Drive folder named "Wedding". The first save creates that
 * folder and remembers its id. An older folder with the same name is never
 * searched for and never written to.
 *
 * Guest book entries send kind "guestbook". The note is appended to a Google
 * Sheet named "Wedding Guest Book" inside a "Guest Book" subfolder of that
 * same Wedding folder. An optional voice note is an audio file in that
 * subfolder, named with the UTC time and the guest's name. The audio is
 * posted on "audio", not "data", so a photo-only deployment rejects it
 * instead of filing the recording with the pictures.
 *
 * Deploy: Execute as Me, Who has access: Anyone.
 * The guest book adds the Google Sheets scope
 * (https://www.googleapis.com/auth/spreadsheets). Drive was already required.
 */

var WEDDING_FOLDER_NAME = "Wedding";
var FOLDER_ID_PROPERTY = "WEDDING_FOLDER_ID";
var GUESTBOOK_FOLDER_NAME = "Guest Book";
var GUESTBOOK_FOLDER_PROPERTY = "GUESTBOOK_FOLDER_ID";
var GUESTBOOK_SHEET_NAME = "Wedding Guest Book";
var GUESTBOOK_SHEET_PROPERTY = "GUESTBOOK_SHEET_ID";
var MAX_POST_BYTES = 50 * 1024 * 1024;
var MAX_MESSAGE_CHARS = 4000;

function doGet() {
  return json_({
    ok: true,
    guestbook: true,
    message: "Wedding photo upload is ready. Guest book notes are saved in a Guest Book folder inside Wedding. The first photo or note creates a new Google Drive folder named Wedding."
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: "The photo was missing from the request." });
    }

    var contents = e.postData.contents;
    var posted = e.postData.length || e.contentLength || 0;
    if (posted > MAX_POST_BYTES || contents.length > MAX_POST_BYTES) {
      if (/"kind"\s*:\s*"guestbook"/.test(String(contents).substring(0, 160))) {
        return json_({
          ok: false,
          error: "That voice note is too large to save. Please record a shorter one."
        });
      }
      return json_({
        ok: false,
        error: "This photo is too large to upload. Apps Script accepts up to 50 MB per request, and the original file is sent without resizing."
      });
    }

    var body = JSON.parse(contents);
    if (body && body.kind === "guestbook") {
      return saveGuestbook_(body);
    }
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
 * Append one guest book entry. ok is returned only after the voice file
 * (if any) exists and the sheet row has been flushed.
 */
function saveGuestbook_(body) {
  var guest = sanitize_(body && body.guest).substring(0, 60);
  if (!guest) {
    return json_({ ok: false, error: "Add your name so we know who this is from." });
  }

  var message = "";
  if (body && body.message != null) message = String(body.message);
  message = message.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (message.length > MAX_MESSAGE_CHARS) {
    return json_({ ok: false, error: "That message is too long. Please keep it under 4000 characters." });
  }

  var audioRaw = body && typeof body.audio === "string" ? body.audio : "";
  var audioBytes = null;
  var audioMime = "";
  if (String(audioRaw).replace(/\s/g, "")) {
    try {
      audioBytes = decodeAudio_(audioRaw);
    } catch (decodeErr) {
      return json_({ ok: false, error: "The voice note could not be read. Please record it again." });
    }
    audioMime = cleanAudioMime_(body.mimeType);
  }

  if (!message && !audioBytes) {
    return json_({ ok: false, error: "Write a message or record a voice note." });
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  var voiceFile = null;
  var rowWritten = false;
  try {
    lock.waitLock(20000);
    locked = true;

    var wedding = getWeddingFolder_();
    var bookFolder = getGuestBookFolder_(wedding);
    var voiceUrl = "";
    var voiceId = "";
    var voiceName = "";

    if (audioBytes) {
      var filename = buildAudioFilename_(guest, audioMime);
      var blob = Utilities.newBlob(audioBytes, audioMime, filename);
      voiceFile = bookFolder.createFile(blob);
      voiceUrl = voiceFile.getUrl();
      voiceId = voiceFile.getId();
      voiceName = voiceFile.getName();
    }

    appendGuestBookRow_(bookFolder, guest, message, voiceUrl);
    rowWritten = true;
    SpreadsheetApp.flush();

    return json_({
      ok: true,
      kind: "guestbook",
      name: guest,
      voiceFileId: voiceId,
      voiceName: voiceName,
      folderId: bookFolder.getId(),
      folderName: bookFolder.getName()
    });
  } catch (err) {
    if (voiceFile && !rowWritten) {
      try {
        voiceFile.setTrashed(true);
      } catch (ignore) {}
    }
    var messageText = err && err.message ? String(err.message) : String(err);
    Logger.log(messageText);
    return json_({ ok: false, error: guestBookErrorMessage_(messageText) });
  } finally {
    if (locked) {
      try {
        lock.releaseLock();
      } catch (ignoreRelease) {}
    }
  }
}

function guestBookErrorMessage_(message) {
  var text = String(message || "");
  if (/obtain lock|timed out/i.test(text)) {
    return "The guest book is busy. Please try again in a moment.";
  }
  if (/permission|authoriz|insufficient/i.test(text)) {
    return "The guest book needs permission to use Google Sheets. Please try again after it’s been allowed.";
  }
  if (/^(Add your name|Write a message|That message is too long|The voice note could not be read|That voice note is too large|Couldn't save the link)/.test(text)) {
    return text;
  }
  return "Couldn't save your message. Please try again.";
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

function getGuestBookFolder_(weddingFolder) {
  var props = PropertiesService.getScriptProperties();
  var existing = folderById_(props.getProperty(GUESTBOOK_FOLDER_PROPERTY));
  if (existing && folderIsParentOf_(weddingFolder, existing)) return existing;

  var created = weddingFolder.createFolder(GUESTBOOK_FOLDER_NAME);
  props.setProperty(GUESTBOOK_FOLDER_PROPERTY, created.getId());
  return created;
}

function getGuestBookSpreadsheet_(guestFolder) {
  var props = PropertiesService.getScriptProperties();
  var existing = fileById_(props.getProperty(GUESTBOOK_SHEET_PROPERTY));
  if (existing && existing.getMimeType() === MimeType.GOOGLE_SHEETS) {
    placeInFolder_(existing, guestFolder);
    return SpreadsheetApp.openById(existing.getId());
  }

  var created = SpreadsheetApp.create(GUESTBOOK_SHEET_NAME);
  props.setProperty(GUESTBOOK_SHEET_PROPERTY, created.getId());
  var file = DriveApp.getFileById(created.getId());
  placeInFolder_(file, guestFolder);
  var sheet = created.getSheets()[0];
  sheet.setName("Messages");
  writeHeaderRow_(sheet);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 460);
  sheet.setColumnWidth(4, 180);
  return created;
}

function appendGuestBookRow_(guestFolder, guest, message, voiceUrl) {
  var ss = getGuestBookSpreadsheet_(guestFolder);
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() < 1) writeHeaderRow_(sheet);

  var row = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(row, 1, 1, 4).setVerticalAlignment("top");
  setExactText_(sheet.getRange(row, 1), guestBookTimestamp_());
  setExactText_(sheet.getRange(row, 2), guest);
  setExactText_(sheet.getRange(row, 3), message);
  sheet.getRange(row, 3).setWrap(true);

  var linkCell = sheet.getRange(row, 4);
  if (voiceUrl) {
    linkCell.setFormula(hyperlinkFormula_(voiceUrl));
  } else {
    linkCell.clearContent();
  }
}

function writeHeaderRow_(sheet) {
  setExactText_(sheet.getRange(1, 1), "Time");
  setExactText_(sheet.getRange(1, 2), "Name");
  setExactText_(sheet.getRange(1, 3), "Message");
  setExactText_(sheet.getRange(1, 4), "Voice note");
  sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function setExactText_(cell, text) {
  var value = String(text || "");
  if (!value) {
    cell.clearContent();
    return;
  }
  // Rich text is stored as text, so a message that starts with "=" is not a formula.
  cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(value).build());
}

function hyperlinkFormula_(url) {
  var safe = String(url || "");
  if (!/^https:\/\/[^\s"]+$/.test(safe)) {
    throw new Error("Couldn't save the link to the voice note.");
  }
  return '=HYPERLINK("' + safe + '","Open voice note")';
}

function guestBookTimestamp_() {
  var zone = "UTC";
  try {
    zone = Session.getScriptTimeZone() || "UTC";
  } catch (err) {
    zone = "UTC";
  }
  return Utilities.formatDate(new Date(), zone, "yyyy-MM-dd HH:mm:ss") + " " + zone;
}

function placeInFolder_(file, folder) {
  try {
    if (folderIsParentOf_(folder, file)) return;
    file.moveTo(folder);
  } catch (err) {
    Logger.log(err && err.message ? err.message : err);
  }
}

function folderFromStoredId_(props) {
  return folderById_(props.getProperty(FOLDER_ID_PROPERTY));
}

function folderById_(id) {
  if (!id) return null;
  try {
    var folder = DriveApp.getFolderById(id);
    if (folder.isTrashed()) return null;
    return folder;
  } catch (err) {
    return null;
  }
}

function fileById_(id) {
  if (!id) return null;
  try {
    var file = DriveApp.getFileById(id);
    if (file.isTrashed()) return null;
    return file;
  } catch (err) {
    return null;
  }
}

function folderIsParentOf_(parent, child) {
  var parents = child.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === parent.getId()) return true;
  }
  return false;
}

function decodePhoto_(data) {
  return decodeBase64_(data, "The photo data was empty.", "The photo data could not be read.");
}

function decodeAudio_(data) {
  return decodeBase64_(
    data,
    "The voice note could not be read. Please record it again.",
    "The voice note could not be read. Please record it again."
  );
}

function decodeBase64_(data, emptyMessage, badMessage) {
  var raw = String(data || "").trim();
  var comma = raw.indexOf(",");
  if (raw.substring(0, 5) === "data:" && comma !== -1) {
    raw = raw.substring(comma + 1);
  }
  raw = raw.replace(/\s/g, "");
  if (!raw) {
    throw new Error(emptyMessage);
  }
  var bytes = Utilities.base64Decode(raw);
  if (!bytes || !bytes.length) {
    throw new Error(badMessage);
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

function buildAudioFilename_(guest, mimeType) {
  var stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmssSSS'Z'");
  var who = sanitize_(guest).substring(0, 60) || "guest";
  return stamp + "_" + who + "." + audioExtension_(mimeType);
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

function cleanAudioMime_(mime) {
  var value = String(mime || "").split(";")[0].trim().toLowerCase();
  if (/^audio\/[a-z0-9!#$&^_.+-]+$/.test(value)) return value;
  return "application/octet-stream";
}

function audioExtension_(mime) {
  var base = String(mime || "").split(";")[0].trim().toLowerCase();
  var map = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/3gpp": "3gp",
    "audio/3gpp2": "3g2",
    "audio/amr": "amr"
  };
  return map[base] || "audio";
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
