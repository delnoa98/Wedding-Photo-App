(function () {
  // Apps Script web apps reject request bodies over 50 MB. Base64 makes the
  // request about 4/3 the size of the photo, so this checks the encoded body.
  var APPS_SCRIPT_MAX_POST_BYTES = 50 * 1024 * 1024 - 8 * 1024;
  var NAME_KEY = "weddingGuestName";

  var notice = document.getElementById("setup-notice");
  var nameInput = document.getElementById("guest-name");
  var cameraInput = document.getElementById("camera-input");
  var galleryInput = document.getElementById("gallery-input");
  var cameraLabel = cameraInput.closest("label");
  var galleryLabel = galleryInput.closest("label");
  var savedCount = document.getElementById("saved-count");
  var queueStatus = document.getElementById("queue-status");
  var empty = document.getElementById("empty");
  var list = document.getElementById("photo-list");
  var folderNote = document.getElementById("folder-note");

  var items = [];
  var nextId = 1;
  var pumping = false;

  function configuredUrl() {
    if (typeof UPLOAD_URL !== "string") return "";
    var url = UPLOAD_URL.trim();
    if (!url || url === "PASTE_HERE") return "";
    if (!/^https:\/\//.test(url)) return "";
    return url;
  }

  function guestName() {
    return nameInput.value.replace(/\s+/g, " ").trim();
  }

  function rememberName() {
    try {
      localStorage.setItem(NAME_KEY, nameInput.value);
    } catch (err) {
      /* private mode can block storage; the name still applies this visit */
    }
  }

  function loadName() {
    try {
      var saved = localStorage.getItem(NAME_KEY);
      if (saved) nameInput.value = saved;
    } catch (err) {}
  }

  function setReady(ready) {
    notice.hidden = ready;
    folderNote.hidden = !ready;
    cameraInput.disabled = !ready;
    galleryInput.disabled = !ready;
    cameraLabel.classList.toggle("is-disabled", !ready);
    galleryLabel.classList.toggle("is-disabled", !ready);
  }

  function guessMime(file) {
    if (file.type) return file.type;
    var ext = ((file.name || "").split(".").pop() || "").toLowerCase();
    var map = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
      bmp: "image/bmp",
      tif: "image/tiff",
      tiff: "image/tiff"
    };
    return map[ext] || "application/octet-stream";
  }

  function byteLength(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
    return text.length;
  }

  function encodedRequestBytes(file, guest) {
    var base64Bytes = Math.ceil(file.size / 3) * 4;
    var meta = JSON.stringify({
      guest: guest,
      filename: file.name || "photo",
      mimeType: guessMime(file),
      data: ""
    });
    return base64Bytes + byteLength(meta);
  }

  function limitMessage(bytes) {
    var mb = (bytes / (1024 * 1024)).toFixed(1);
    return (
      "This photo is too large to upload (about " +
      mb +
      " MB once prepared). Apps Script accepts up to 50 MB per photo, and pictures are sent at full original quality, without resizing. Please choose a smaller one."
    );
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        var comma = text.indexOf(",");
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read this photo."));
      };
      reader.readAsDataURL(file);
    });
  }

  function countBy(status) {
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].status === status) n++;
    }
    return n;
  }

  function updateCount() {
    savedCount.textContent = String(countBy("done"));
    var uploading = countBy("uploading");
    var queued = countBy("queued");
    var failed = countBy("failed");
    var parts = [];
    if (uploading) parts.push(uploading + " uploading");
    if (queued) parts.push(queued + " queued");
    if (failed) parts.push(failed + " failed");
    queueStatus.textContent = parts.join(" · ");
    empty.hidden = items.length > 0;
  }

  function render(item) {
    var li = item.node;
    if (!li) {
      li = document.createElement("li");
      li.className = "photo";
      li.innerHTML =
        '<img alt="">' +
        '<div><p class="photo-name"></p><p class="photo-status"></p>' +
        '<p class="photo-error" hidden></p>' +
        '<button type="button" class="retry" hidden>Retry</button></div>';
      item.node = li;
      list.appendChild(li);
      li.querySelector(".retry").addEventListener("click", function () {
        if (item.status !== "failed" || !item.canRetry) return;
        item.status = "queued";
        item.error = "";
        render(item);
        updateCount();
        pump();
      });
    }
    li.className = "photo is-" + item.status;
    li.dataset.status = item.status;
    var img = li.querySelector("img");
    if (item.preview && img.getAttribute("src") !== item.preview) {
      img.src = item.preview;
    }
    img.alt = item.file.name || "Photo";
    li.querySelector(".photo-name").textContent = item.file.name || "Photo";
    var label = { queued: "Queued", uploading: "Uploading", done: "Done", failed: "Failed" }[item.status];
    li.querySelector(".photo-status").textContent = label;
    var error = li.querySelector(".photo-error");
    error.hidden = !item.error;
    error.textContent = item.error || "";
    var retry = li.querySelector(".retry");
    retry.hidden = !(item.status === "failed" && item.canRetry);
  }

  function enqueue(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    files.forEach(function (file) {
      var item = {
        id: nextId++,
        file: file,
        status: "queued",
        error: "",
        canRetry: true,
        preview: URL.createObjectURL(file),
        node: null
      };
      items.push(item);
      render(item);
    });
    updateCount();
    pump();
  }

  function readResponse(response) {
    return response.text().then(function (text) {
      var payload = null;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = null;
      }
      if (payload && payload.ok) return payload;
      if (payload && payload.error) throw new Error(payload.error);
      if (response.status === 413) {
        throw new Error(limitMessage(APPS_SCRIPT_MAX_POST_BYTES));
      }
      throw new Error("Couldn't save this photo. Check your connection and try again.");
    });
  }

  function uploadOne(item) {
    item.status = "uploading";
    item.error = "";
    render(item);
    updateCount();

    var guest = guestName();
    var prepared = encodedRequestBytes(item.file, guest);
    if (!item.file.size) {
      item.status = "failed";
      item.error = "This photo is empty.";
      item.canRetry = false;
      render(item);
      updateCount();
      return Promise.resolve();
    }
    if (prepared > APPS_SCRIPT_MAX_POST_BYTES) {
      item.status = "failed";
      item.error = limitMessage(prepared);
      item.canRetry = false;
      render(item);
      updateCount();
      return Promise.resolve();
    }

    return fileToBase64(item.file)
      .then(function (data) {
        var body = JSON.stringify({
          guest: guest,
          filename: item.file.name || "photo",
          mimeType: guessMime(item.file),
          data: data
        });
        if (byteLength(body) > APPS_SCRIPT_MAX_POST_BYTES) {
          var tooBig = new Error(limitMessage(byteLength(body)));
          tooBig.tooLarge = true;
          throw tooBig;
        }
        return fetch(configuredUrl(), {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: body
        });
      })
      .then(readResponse)
      .then(function () {
        item.status = "done";
        item.error = "";
        item.canRetry = false;
      })
      .catch(function (err) {
        item.status = "failed";
        item.error = (err && err.message) || "Couldn't save this photo.";
        item.canRetry = !(err && err.tooLarge);
      })
      .then(function () {
        render(item);
        updateCount();
      });
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    var step = function () {
      var next = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].status === "queued") {
          next = items[i];
          break;
        }
      }
      if (!next) {
        pumping = false;
        if (items.some(function (item) { return item.status === "queued"; })) pump();
        return;
      }
      uploadOne(next).then(step);
    };
    step();
  }

  function onPicked(event) {
    var input = event.target;
    enqueue(input.files);
    input.value = "";
  }

  loadName();
  nameInput.addEventListener("input", rememberName);
  nameInput.addEventListener("change", rememberName);
  cameraInput.addEventListener("change", onPicked);
  galleryInput.addEventListener("change", onPicked);
  setReady(!!configuredUrl());
  updateCount();
})();
