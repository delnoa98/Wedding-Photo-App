(function () {
  // Apps Script web apps reject request bodies over 50 MB. Base64 makes a
  // voice note about 4/3 of its size, so this checks the encoded body.
  var APPS_SCRIPT_MAX_POST_BYTES = 50 * 1024 * 1024 - 8 * 1024;
  var NAME_KEY = "weddingGuestName";
  var MAX_RECORD_MS = 2 * 60 * 1000;
  var MAX_MESSAGE_CHARS = 4000;

  var notice = document.getElementById("setup-notice");
  var form = document.getElementById("book-form");
  var nameInput = document.getElementById("guest-name");
  var messageInput = document.getElementById("message");
  var recordBtn = document.getElementById("record-btn");
  var stopBtn = document.getElementById("stop-btn");
  var replayBtn = document.getElementById("replay-btn");
  var rerecordBtn = document.getElementById("rerecord-btn");
  var playback = document.getElementById("playback");
  var recStatus = document.getElementById("rec-status");
  var recTime = document.getElementById("rec-time");
  var voiceNote = document.getElementById("voice-note");
  var micError = document.getElementById("mic-error");
  var submitBtn = document.getElementById("submit-btn");
  var formError = document.getElementById("form-error");
  var success = document.getElementById("success");
  var thanks = document.getElementById("thanks");
  var another = document.getElementById("another");

  var recorder = null;
  var stream = null;
  var chunks = [];
  var audioBlob = null;
  var audioUrl = "";
  var takenMime = "";
  var recording = false;
  var starting = false;
  var startedAt = 0;
  var timerId = null;
  var session = 0;
  var submitting = false;
  var submitAfterStop = false;
  var autoStopped = false;

  function configuredUrl() {
    if (typeof UPLOAD_URL !== "string") return "";
    var url = UPLOAD_URL.trim();
    if (!url || url === "PASTE_HERE") return "";
    if (!/^https:\/\//.test(url)) return "";
    return url;
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanMessage(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
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
    if (!ready) {
      recordBtn.disabled = true;
      submitBtn.disabled = true;
    }
  }

  function showError(message) {
    formError.hidden = false;
    formError.textContent = message;
    if (formError.scrollIntoView) formError.scrollIntoView({ block: "nearest" });
  }

  function hideError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  function setVoiceNote(message) {
    voiceNote.hidden = !message;
    voiceNote.textContent = message || "";
  }

  function showMicError(message) {
    micError.hidden = !message;
    micError.textContent = message || "";
  }

  function formatTime(ms) {
    var total = Math.min(MAX_RECORD_MS, Math.max(0, Math.floor(ms / 1000)));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function setRecTime(ms) {
    recTime.textContent = formatTime(ms);
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function stopStream() {
    if (!stream) return;
    stream.getTracks().forEach(function (track) {
      try {
        track.stop();
      } catch (err) {}
    });
    stream = null;
  }

  function discardTake() {
    try {
      playback.pause();
    } catch (err) {}
    playback.removeAttribute("src");
    try {
      playback.load();
    } catch (err) {}
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = "";
    audioBlob = null;
    takenMime = "";
  }

  function showIdle() {
    recordBtn.hidden = false;
    recStatus.hidden = true;
    stopBtn.hidden = true;
    playback.hidden = true;
    replayBtn.hidden = true;
    rerecordBtn.hidden = true;
  }

  function showRecording() {
    recordBtn.hidden = true;
    recStatus.hidden = false;
    stopBtn.hidden = false;
    playback.hidden = true;
    replayBtn.hidden = true;
    rerecordBtn.hidden = true;
    setRecTime(Date.now() - startedAt);
  }

  function showPreview() {
    recordBtn.hidden = true;
    recStatus.hidden = true;
    stopBtn.hidden = true;
    playback.hidden = false;
    replayBtn.hidden = false;
    rerecordBtn.hidden = false;
  }

  function setBusy(busy, label) {
    submitBtn.disabled = busy || !configuredUrl();
    submitBtn.textContent = label || "Add to the guest book";
    submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    recordBtn.disabled = busy || !configuredUrl();
    replayBtn.disabled = busy;
    rerecordBtn.disabled = busy;
  }

  // Chrome/Android record WebM Opus. iPhone Safari records audio/mp4 and
  // rejects a WebM mime type, so the first supported type wins at runtime.
  function mimeCandidates() {
    return [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/aac"
    ];
  }

  function canUseMime(type) {
    try {
      return typeof MediaRecorder !== "undefined" &&
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(type);
    } catch (err) {
      return false;
    }
  }

  function createRecorder(mediaStream) {
    var candidates = mimeCandidates();
    var i;
    for (i = 0; i < candidates.length; i++) {
      if (!canUseMime(candidates[i])) continue;
      try {
        return new MediaRecorder(mediaStream, { mimeType: candidates[i] });
      } catch (err) {}
    }
    return new MediaRecorder(mediaStream);
  }

  function baseMime(value) {
    var type = String(value || "").split(";")[0].trim().toLowerCase();
    if (type.indexOf("audio/") === 0) return type;
    var ua = navigator.userAgent || "";
    var safari = /safari/i.test(ua) && !/chrome|chromium|android|edg/i.test(ua);
    var apple = /iphone|ipad|ipod/i.test(ua);
    if (safari || apple) return "audio/mp4";
    return "audio/webm";
  }

  function recordingUnsupportedMessage() {
    return "This phone can’t record a voice note in the browser. You can still type a message.";
  }

  function micFailureMessage(err) {
    var name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Microphone access was blocked. You can still type a message, or allow the mic and try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No microphone was found. You can still type a message.";
    }
    return "Couldn’t start the recording. You can still type a message.";
  }

  function startRecording() {
    if (recording || starting || submitting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      showMicError(recordingUnsupportedMessage());
      return;
    }

    starting = true;
    recordBtn.disabled = true;
    showMicError("");
    var mySession = ++session;
    var pending = navigator.mediaDevices.getUserMedia({ audio: true });

    pending.then(function (mediaStream) {
      if (mySession !== session || submitting) {
        mediaStream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (err) {}
        });
        return;
      }
      stream = mediaStream;
      chunks = [];
      try {
        recorder = createRecorder(stream);
      } catch (err) {
        stopStream();
        showMicError(recordingUnsupportedMessage());
        showIdle();
        finishInterruptedSubmit();
        return;
      }

      recorder.ondataavailable = function (event) {
        if (mySession !== session) return;
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = function () {
        if (mySession !== session) return;
        recording = false;
        clearTimer();
        stopStream();
        showMicError("The recording stopped unexpectedly. You can try again, or just type a message.");
        if (!audioBlob) showIdle();
        finishInterruptedSubmit();
      };
      recorder.onstop = function () {
        if (mySession !== session) return;
        clearTimer();
        recording = false;
        var mime = baseMime(recorder.mimeType || takenMime);
        var blob = new Blob(chunks, { type: mime });
        stopStream();
        if (!blob.size) {
          showMicError("The recording was empty. Please try again.");
          if (!audioBlob) showIdle();
        } else {
          discardTake();
          audioBlob = blob;
          takenMime = mime;
          audioUrl = URL.createObjectURL(blob);
          playback.src = audioUrl;
          try { playback.load(); } catch (err) {}
          showMicError("");
          showPreview();
          if (autoStopped) {
            setVoiceNote("That’s 2 minutes, so the recording stopped. Listen back, or record again.");
            autoStopped = false;
          }
        }
        if (submitAfterStop) {
          submitAfterStop = false;
          beginSubmit();
        }
      };

      try {
        try {
          recorder.start(1000);
        } catch (timesliceErr) {
          recorder.start();
        }
      } catch (startErr) {
        stopStream();
        showMicError(recordingUnsupportedMessage());
        showIdle();
        finishInterruptedSubmit();
        return;
      }

      // Drop the previous take only after the new one has actually started.
      if (audioBlob || audioUrl) discardTake();
      recording = true;
      startedAt = Date.now();
      autoStopped = false;
      setVoiceNote("");
      showRecording();
      clearTimer();
      timerId = setInterval(tick, 200);
      if (submitAfterStop) stopRecording();
    }).catch(function (err) {
      if (mySession !== session) return;
      stopStream();
      showMicError(micFailureMessage(err));
      finishInterruptedSubmit();
    }).then(function () {
      if (mySession !== session) return;
      starting = false;
      if (!recording && !submitting && configuredUrl()) recordBtn.disabled = false;
    });
  }

  function tick() {
    if (!recording) return;
    var elapsed = Date.now() - startedAt;
    if (elapsed >= MAX_RECORD_MS) {
      setRecTime(MAX_RECORD_MS);
      autoStopped = true;
      stopRecording();
      return;
    }
    setRecTime(elapsed);
  }

  function stopRecording() {
    clearTimer();
    if (!recorder || recorder.state !== "recording") {
      recording = false;
      if (submitAfterStop) stopStream();
      finishInterruptedSubmit();
      return;
    }
    try {
      recorder.stop();
    } catch (err) {
      recording = false;
      stopStream();
      if (submitAfterStop) {
        submitAfterStop = false;
        beginSubmit();
      }
    }
  }

  function replay() {
    if (!audioBlob || !playback.getAttribute("src")) return;
    try {
      playback.currentTime = 0;
    } catch (err) {}
    var pending = playback.play();
    if (pending && typeof pending.catch === "function") {
      pending.catch(function () {
        setVoiceNote("Tap the player above to listen.");
      });
    }
  }

  function byteLength(text) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
    return text.length;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        var comma = text.indexOf(",");
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read the voice note."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function guestFacingError(message) {
    var text = String(message || "");
    if (/^Failed to fetch$|^NetworkError|^Load failed$|NetworkError when attempting to fetch/i.test(text)) {
      return "Couldn't reach the guest book. Check your connection and try again.";
    }
    if (/photo data was empty|photo was missing|Could not read the upload|too large to upload|original file is sent/i.test(text)) {
      return "This guest book isn't accepting notes yet. Please tell the couple, then try again in a little while.";
    }
    if (text.length > 300 || /<\s*html/i.test(text)) {
      return "Couldn't save your message. Please try again.";
    }
    return text || "Couldn't save your message. Please try again.";
  }

  function readResponse(response) {
    return response.text().then(function (text) {
      var payload = null;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = null;
      }
      if (payload && payload.ok === true && payload.kind === "guestbook") return payload;
      if (payload && payload.ok === true) {
        throw new Error("This guest book isn't accepting notes yet. Please tell the couple, then try again in a little while.");
      }
      if (payload && payload.error) throw new Error(String(payload.error));
      throw new Error("Couldn't save your message. Check your connection and try again.");
    });
  }

  function send(guest, message, blob, mime) {
    var url = configuredUrl();
    if (!url) return Promise.reject(new Error("This page isn't connected yet."));
    var prepare = blob ? blobToBase64(blob) : Promise.resolve("");
    return prepare.then(function (audio) {
      var payload = {
        kind: "guestbook",
        guest: guest,
        message: message
      };
      if (audio) {
        payload.mimeType = baseMime(mime || (blob && blob.type));
        // Not "data": a photo-only script would save that field as a picture.
        payload.audio = audio;
      }
      var body = JSON.stringify(payload);
      if (byteLength(body) > APPS_SCRIPT_MAX_POST_BYTES) {
        var tooBig = new Error("That voice note is too large to send. Please record a shorter one.");
        tooBig.tooLarge = true;
        throw tooBig;
      }
      return fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body
      }).then(readResponse);
    });
  }

  function showSuccess(name) {
    form.hidden = true;
    success.hidden = false;
    thanks.textContent = "Thank you, " + name + ". The couple will read this with the photos.";
    messageInput.value = "";
    discardTake();
    showIdle();
    setVoiceNote("");
    showMicError("");
    hideError();
    try {
      success.focus({ preventScroll: true });
    } catch (err) {
      success.focus();
    }
  }

  function finishInterruptedSubmit() {
    if (!submitAfterStop) return;
    submitAfterStop = false;
    beginSubmit();
  }

  function beginSubmit() {
    if (submitting) return;
    hideError();
    var guest = cleanName(nameInput.value);
    var message = cleanMessage(messageInput.value);
    if (!guest) {
      showError("Add your name so we know who this is from.");
      nameInput.focus();
      setBusy(false);
      return;
    }
    if (!message && !audioBlob) {
      showError("Write a message or record a voice note.");
      messageInput.focus();
      setBusy(false);
      return;
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      showError("That message is too long. Please keep it under 4000 characters.");
      messageInput.focus();
      setBusy(false);
      return;
    }
    if (!configuredUrl()) {
      showError("This page isn't connected yet.");
      setBusy(false);
      return;
    }

    submitting = true;
    setBusy(true, "Saving…");
    rememberName();
    var blob = audioBlob;
    var mime = takenMime;
    send(guest, message, blob, mime).then(function (payload) {
      showSuccess((payload && payload.name) || guest);
    }).catch(function (err) {
      showError(guestFacingError(err && err.message));
    }).then(function () {
      submitting = false;
      setBusy(false);
    });
  }

  function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    hideError();
    if (recording || starting) {
      submitAfterStop = true;
      if (recording) stopRecording();
      setBusy(true, "Finishing…");
      if (!recording && !starting) {
        submitAfterStop = false;
        beginSubmit();
      }
      return;
    }
    beginSubmit();
  }

  function leaveAnother() {
    submitting = false;
    submitAfterStop = false;
    success.hidden = true;
    form.hidden = false;
    hideError();
    setVoiceNote("");
    showMicError("");
    showIdle();
    setBusy(false);
    messageInput.focus();
  }

  loadName();
  nameInput.addEventListener("input", rememberName);
  nameInput.addEventListener("change", rememberName);
  recordBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", function () {
    autoStopped = false;
    stopRecording();
  });
  replayBtn.addEventListener("click", replay);
  rerecordBtn.addEventListener("click", function () {
    setVoiceNote("");
    startRecording();
  });
  another.addEventListener("click", leaveAnother);
  form.addEventListener("submit", onSubmit);
  setReady(!!configuredUrl());
  showIdle();
})();
