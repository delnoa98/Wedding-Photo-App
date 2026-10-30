# Wedding Photo App

Guests scan a QR code, open this page on their phone, and take photos. Each photo uploads automatically, at full original quality, to a Google Drive folder named **Wedding**. From the same page they can open the guest book and leave a typed note, a voice note, or both.

The folder is created the first time a photo or a guest book note arrives. It is a new folder, so an existing folder with the same name is left alone. These are plain static files. GitHub Pages can serve this repository from the root.

## Use it

1. Follow [SETUP.md](SETUP.md): paste `apps-script/Code.gs` into a Google Apps Script web app, deploy it as **Me** / **Anyone**, and paste the `/exec` URL into `config.js`. If that web app is already live, edit the existing deployment and publish a **new version** so the URL does not change. The guest book needs Google Sheets in addition to Drive.
2. Turn on GitHub Pages from the `main` branch, `/` root.
3. Print [qr.html](qr.html). The code points at [https://delnoa98.github.io/Wedding-Photo-App/](https://delnoa98.github.io/Wedding-Photo-App/). Photos and the guest book are both on that page.

Until `UPLOAD_URL` is set, the page shows a “Not set up yet” notice and does not open the camera or accept notes.

The optional name on the photo page is remembered on the phone and added to the filename, along with the time and the original file name. The guest book asks for that same name and remembers it too. Several photos queue and upload one after another. A photo that fails can be retried. A photo that would exceed Apps Script’s 50 MB request limit is refused with a clear message instead of being shrunk.

A guest book entry is saved only after the script confirms it. Notes are rows in a Google Sheet named **Wedding Guest Book**, inside a **Guest Book** folder in **Wedding**. A voice note is an audio file next to that sheet, and the row links to it.

## Files

- `index.html`, `styles.css`, `app.js` — the camera page
- `guestbook.html`, `guestbook.js` — the guest book (typed note and optional voice note)
- `config.js` — the one line to paste the upload URL
- `apps-script/Code.gs` — saves original photos into Drive, and guest book entries into a sheet in that same folder
- `qr.png`, `qr.html` — the table card
