# Wedding Photo App

Guests scan a QR code, open this page on their phone, and take photos. Each photo uploads automatically, at full original quality, to a Google Drive folder named **Wedding**.

The folder is created the first time a photo arrives. It is a new folder, so an existing folder with the same name is left alone. These are plain static files. GitHub Pages can serve this repository from the root.

## Use it

1. Follow [SETUP.md](SETUP.md): paste `apps-script/Code.gs` into a Google Apps Script web app, deploy it as **Me** / **Anyone**, and paste the `/exec` URL into `config.js`.
2. Turn on GitHub Pages from the `main` branch, `/` root.
3. Print [qr.html](qr.html). The code points at [https://delnoa98.github.io/Wedding-Photo-App/](https://delnoa98.github.io/Wedding-Photo-App/).

Until `UPLOAD_URL` is set, the page shows a “Not set up yet” notice and does not open the camera.

The optional name is remembered on the phone and added to the filename, along with the time and the original file name. Several photos queue and upload one after another. A photo that fails can be retried. A photo that would exceed Apps Script’s 50 MB request limit is refused with a clear message instead of being shrunk.

## Files

- `index.html`, `styles.css`, `app.js` — the guest page
- `config.js` — the one line to paste the upload URL
- `apps-script/Code.gs` — saves original bytes into Drive
- `qr.png`, `qr.html` — the table card
