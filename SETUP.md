# Set up the wedding album

Two jobs: connect Google Drive, then turn the page on. Do them in order.

If the photo upload is **already deployed**, skip to [Add the guest book](#add-the-guest-book-to-a-live-album). Do not create a second web app, and do not change the URL in `config.js`.

## Add the guest book to a live album

Guests already use the `/exec` URL in `config.js`. Paste the new script into that same project and publish it as a **new version of the existing deployment**. That keeps the URL. A new deployment would mint a different URL and the phones would still be talking to the old script.

1. Open [script.google.com](https://script.google.com) and open the project that already receives the photos.
2. Open `Code.gs` in the editor. Select all of the code and delete it.
3. In this repository, open `apps-script/Code.gs`, copy the **whole** file, and paste it into the editor.
4. Save (the disk icon, or Ctrl+S / Cmd+S).
5. Click **Deploy** → **Manage deployments**.
6. On the **existing** web app row (the URL that ends with `/exec` and already matches `config.js`), click the pencil (**Edit**).
7. Set **Version** to **New version**. You can leave the description blank or write `Guest book`.
8. Leave **Execute as:** Me. Leave **Who has access:** Anyone.
9. Click **Deploy**.
10. Google asks you to authorize the new version. Continue until you can click **Allow**.

The `/exec` URL does not change. Leave `config.js` exactly as it is.

### New permission

Photos already use Google Drive. The guest book also writes a spreadsheet, so this version needs one new scope:

- `https://www.googleapis.com/auth/spreadsheets` — on the consent screen: **See, edit, create, and delete all your Google Sheets spreadsheets**

Drive access is unchanged and was already granted:

- `https://www.googleapis.com/auth/drive`

No other new scopes. Guests still do not sign in. The web app still runs as you.

If you dismiss the authorization prompt, this version is not really live. Open **Deploy** → **Manage deployments** → pencil → **Deploy** again and allow the Sheets permission. Do not add a second deployment.

Confirm it: open the `/exec` URL in a browser tab. The JSON should include `"guestbook": true`.

The first note creates a folder named **Guest Book** inside the existing **Wedding** folder, and a Google Sheet in that folder named **Wedding Guest Book**. Each row is the time, the guest’s name, the typed message, and a link to the voice note when they recorded one. Voice notes are audio files in **Guest Book**, named with the time and the guest’s name. Nothing in that folder is shared publicly; you open it from your Drive.

If a guest sees “isn’t accepting notes yet”, phones are still reaching the old version. Repeat the steps above and finish **Allow**.

## 1. Google Drive upload

1. Open [script.google.com](https://script.google.com) and sign in with the Google account that should own the photos.
2. Click **New project**.
3. Select all the starter code and delete it. Open `apps-script/Code.gs` from this project, copy the whole file, and paste it in.
4. Click **Deploy** → **New deployment**.
5. Next to “Select type”, choose **Web app**.
6. **Execute as:** Me.
7. **Who has access:** Anyone.
8. Click **Deploy**. When Google asks you to authorize, allow access to **Google Drive** and to **Google Sheets** (see the scope list above). Sheets is what stores guest book notes.
9. Copy the **Web app** URL. It ends with `/exec`.
10. In this project, open `config.js`. Replace `PASTE_HERE` on this line and save:

```js
const UPLOAD_URL = 'PASTE_HERE';
```

The first photo or guest book note creates a **new** folder in that Google Drive named exactly **Wedding**. The script remembers that folder and keeps using it. It will not add files to an older folder that happens to have the same name.

Anyone with the web app link can add photos and notes there. That is what lets guests upload without signing in. Photos are stored as the original file. A photo that would make the request larger than 50 MB (roughly a 37 MB original, because base64 makes the request bigger) is refused, and the page says so. The picture is never resized.

Guest book notes go in a **Guest Book** folder inside **Wedding**, in a sheet named **Wedding Guest Book**.

If you change `Code.gs` later: **Deploy** → **Manage deployments** → pencil on the existing deployment → **Version: New version** → **Deploy**. The `/exec` URL stays the same, so you do not change `config.js`. If the new code needs a permission you have not granted (the guest book needs Google Sheets), finish the authorization prompt or that version will not save notes.

## 2. GitHub Pages

Guests open the page by scanning the QR code. The same code covers photos and the guest book. The camera page links to the guest book, and the guest book links back.

1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Save.

The address is [https://delnoa98.github.io/Wedding-Photo-App/](https://delnoa98.github.io/Wedding-Photo-App/). The guest book is [https://delnoa98.github.io/Wedding-Photo-App/guestbook.html](https://delnoa98.github.io/Wedding-Photo-App/guestbook.html).

Print `qr.html` (it uses `qr.png`) and put the card on the table. The caption reads “Scan to share a photo or leave a message”.
