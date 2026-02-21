# Installation Guide

Complete step-by-step instructions for installing MMM-GooglePhotos V3 (Google Drive).

---

## Prerequisites

- MagicMirror² v2.0.0+
- Node.js v18+
- Google Drive account
- Photos organized in Google Drive folder(s)

---

## Step 1: Install Module

### Standard Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/chris1dickson/MMM-CloudPhotos.git MMM-CloudPhotos
cd MMM-CloudPhotos
npm install
```

### Docker Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/chris1dickson/MMM-CloudPhotos.git MMM-CloudPhotos
docker exec -it -w /opt/magic_mirror/modules/MMM-CloudPhotos magic_mirror npm install
```

---

## Step 2: Enable Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. From the navigation menu, select **APIs & Services > Library**
4. Search for **"Google Drive API"**
5. Click on it and press **Enable**

---

## Step 3: Create OAuth Credentials

1. In Google Cloud Console, go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User Type: **External** (unless you have Google Workspace)
   - App name: `MagicMirror GooglePhotos`
   - User support email: Your email
   - Authorized domains: (leave blank for testing)
   - Developer contact: Your email
   - Click **Save and Continue**
   - Scopes: Click **Save and Continue** (we'll add minimal scope)
   - Test users: Add your Gmail address
   - Click **Save and Continue**
4. Back at Create OAuth client ID:
   - Application type: **Desktop app**
   - Name: `MagicMirror Desktop`
   - Click **Create**
5. Click **Download JSON**
6. Save the downloaded file as `google_drive_auth.json` in your MMM-GooglePhotos folder

```bash
# Example
mv ~/Downloads/client_secret_xxxxx.json ~/MagicMirror/modules/MMM-GooglePhotos/google_drive_auth.json
```

---

## Step 4: Generate OAuth Token

Run the token generation script:

```bash
cd ~/MagicMirror/modules/MMM-GooglePhotos
node generate_drive_token.js
```

### What happens:

1. The script will display a URL
2. Copy the URL and open it in your browser
3. Log in with your Google account
4. You'll see a warning "Google hasn't verified this app" - Click **Advanced > Go to MagicMirror GooglePhotos (unsafe)**
5. Click **Allow** to grant access to Google Drive
6. Copy the authorization code from the browser
7. Paste it into the terminal when prompted
8. The script will create `token_drive.json`

**Important:** Keep both `google_drive_auth.json` and `token_drive.json` private!

---

## Step 5: Organize Photos in Google Drive

1. Open [Google Drive](https://drive.google.com)
2. Create a folder (e.g., "MagicMirror Photos")
3. Upload your photos to this folder
4. Optionally create subfolders (e.g., "Family", "Vacation")
5. Get the folder ID from the URL:

```
https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j
                                       ^^^^^^^^^^^^^^^^^^^^
                                       This is the folder ID
```

Copy the folder ID for the next step.

---

## Step 6: Configure MagicMirror

Edit `~/MagicMirror/config/config.js` and add:

```javascript
{
  module: "MMM-GooglePhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      {
        id: "YOUR_FOLDER_ID_HERE",  // Paste your folder ID
        depth: -1                    // -1 = scan all subfolders
      }
    ],
    updateInterval: 60000,           // Change photo every 60 seconds
    showWidth: 1080,                 // Your screen width
    showHeight: 1920                 // Your screen height
  }
}
```

---

## Step 7: (Optional) Enable BLOB Storage

For better performance, install Sharp:

```bash
cd ~/MagicMirror/modules/MMM-GooglePhotos
npm install sharp
```

Then add to your config:

```javascript
config: {
  driveFolders: [...],
  useBlobStorage: true,
  blobQuality: 80,
  maxCacheSizeMB: 200
}
```

See [BLOB_STORAGE_GUIDE.md](BLOB_STORAGE_GUIDE.md) for details.

---

## Step 8: Restart MagicMirror

```bash
pm2 restart MagicMirror
```

Or if running manually:

```bash
cd ~/MagicMirror
npm start
```

---

## Verification

Check that it's working:

```bash
# View logs
pm2 logs MagicMirror

# You should see:
# - "GDriveAPI initialized"
# - "Initial scan complete"
# - "Found X photos"
# - "Downloaded photo to cache"
```

---

## Troubleshooting

### Module not loading

```bash
# Check logs
pm2 logs MagicMirror --lines 50

# Common issues:
# - google_drive_auth.json missing or invalid
# - token_drive.json not generated
# - Node.js version too old (need v18+)
```

### "Authentication failed"

```bash
# Regenerate token
cd ~/MagicMirror/modules/MMM-GooglePhotos
rm token_drive.json
node generate_drive_token.js
```

### "No photos found"

- Verify folder ID is correct
- Check photos are not in trash
- Ensure you have read access to the folder
- Try using Drive root with `id: null`

### "Permission denied" errors

Make sure you granted the correct permissions:
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. APIs & Services > OAuth consent screen
3. Click **Publish App** if still in testing mode

---

## Upgrade from V2 to V3

If you're upgrading from the old Google Photos version:

1. **Move photos** from Google Photos to Google Drive
2. **Delete old files**:
   ```bash
   cd ~/MagicMirror/modules/MMM-GooglePhotos
   rm google_auth.json token.json credentials.json 2>/dev/null
   rm -rf cache/*
   ```
3. **Follow steps above** to set up Google Drive API
4. **Update config** to use `driveFolders` instead of `albums`

---

## Token Expiration

Unlike V2, **V3 tokens don't expire weekly**!

If your token does expire:
```bash
rm token_drive.json
node generate_drive_token.js
```

---

## Multiple Google Accounts

To use photos from multiple Google accounts:

1. Create separate module instances in config.js
2. Each needs its own `google_drive_auth.json` and `token_drive.json`
3. Rename them (e.g., `google_drive_auth_account2.json`)
4. Specify in config:

```javascript
{
  module: "MMM-GooglePhotos",
  config: {
    keyFilePath: "./google_drive_auth_account2.json",
    tokenPath: "./token_drive_account2.json",
    driveFolders: [...]
  }
}
```

---

## Security Best Practices

- **Never commit** `google_drive_auth.json` or `token_drive.json` to git
- These files are already in `.gitignore`
- Use read-only Drive scope (already configured)
- Publish your OAuth app to avoid weekly token expiration

---

## Next Steps

- See [README.md](README.md) for complete configuration options
- See [BLOB_STORAGE_GUIDE.md](BLOB_STORAGE_GUIDE.md) for performance optimization
- Check logs: `pm2 logs MagicMirror`

---

**Questions?** Check the [README.md](README.md) or open an issue on GitHub.
