# Set up the wedding album

Two jobs: connect Google Drive, then turn the page on. Do them in order.

## 1. Google Drive upload

1. Open [script.google.com](https://script.google.com) and sign in with the Google account that should own the photos.
2. Click **New project**.
3. Select all the starter code and delete it. Open `apps-script/Code.gs` from this project, copy the whole file, and paste it in.
4. Click **Deploy** → **New deployment**.
5. Next to “Select type”, choose **Web app**.
6. **Execute as:** Me.
7. **Who has access:** Anyone.
8. Click **Deploy**. When Google asks you to authorize, allow access to Google Drive.
9. Copy the **Web app** URL. It ends with `/exec`.
10. In this project, open `config.js`. Replace `PASTE_HERE` on this line and save:

```js
const UPLOAD_URL = 'PASTE_HERE';
```

The first photo creates a **new** folder in that Google Drive named exactly **Wedding**. The script remembers that folder and keeps using it. It will not add photos to an older folder that happens to have the same name.

Anyone with the web app link can add photos there. That is what lets guests upload without signing in. Photos are stored as the original file. A photo that would make the request larger than 50 MB (roughly a 37 MB original, because base64 makes the request bigger) is refused, and the page says so. The picture is never resized.

If you change `Code.gs` later: **Deploy** → **Manage deployments** → pencil → **Version: New version** → **Deploy**. Copy the URL again only if it changed.

## 2. GitHub Pages

Guests open the page by scanning the QR code.

1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Save.

The address is [https://delnoa98.github.io/Wedding-Photo-App/](https://delnoa98.github.io/Wedding-Photo-App/).

Print `qr.html` (it uses `qr.png`) and put the card on the table. The caption reads “Scan to share your photos with us”.
