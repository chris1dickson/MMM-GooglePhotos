# Google Drive Setup Guide

Complete guide to setting up Google Drive with MMM-CloudPhotos.

---

## Prerequisites

- Google account with Google Drive access
- MagicMirror² installed
- MMM-CloudPhotos module installed

---

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Select a project** → **New Project**
3. Enter project name (e.g., "MagicMirror Photos")
4. Click **Create**
5. Wait for project creation (takes ~30 seconds)

---

## Step 2: Enable Google Drive API

1. In Google Cloud Console, ensure your new project is selected
2. Go to **APIs & Services** → **Library**
3. Search for "Google Drive API"
4. Click **Google Drive API**
5. Click **Enable**

---

## Step 3: Create OAuth 2.0 Credentials

### Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type
3. Click **Create**
4. Fill in required fields:
   - **App name**: "MagicMirror Photos"
   - **User support email**: Your email
   - **Developer contact**: Your email
5. Click **Save and Continue**
6. Skip "Scopes" (click **Save and Continue**)
7. Add test users:
   - Click **Add Users**
   - Enter your Google account email
   - Click **Add**
8. Click **Save and Continue**
9. Review and click **Back to Dashboard**

### Create OAuth Client ID

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select **Application type**: **Desktop app**
4. Enter name: "MagicMirror Desktop Client"
5. Click **Create**
6. Click **Download JSON** on the popup
7. Save the file as `google_drive_auth.json` in your MMM-CloudPhotos folder:
   ```bash
   ~/MagicMirror/modules/MMM-CloudPhotos/google_drive_auth.json
   ```

---

## Step 4: Generate OAuth Token

### Run Token Generator

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node generate_drive_token.js
```

### Follow the Prompts

1. **Open the URL** displayed in your terminal
2. **Sign in** with your Google account (the one you added as test user)
3. You may see a warning "Google hasn't verified this app":
   - Click **Advanced**
   - Click **Go to MagicMirror Photos (unsafe)**
4. Grant permissions:
   - Review the requested permissions
   - Click **Continue**
5. **Copy the authorization code** from the browser
6. **Paste it** into the terminal when prompted
7. Press **Enter**

### Verify Token Created

You should see:
```
✅ Token saved to token_drive.json
```

Check the file exists:
```bash
ls ~/MagicMirror/modules/MMM-CloudPhotos/token_drive.json
```

---

## Step 5: Organize Photos in Google Drive

### Create a Folder

1. Go to [Google Drive](https://drive.google.com)
2. Click **New** → **Folder**
3. Name it (e.g., "MagicMirror Photos")
4. Upload your photos to this folder
5. You can organize with subfolders (e.g., "Family", "Vacation")

### Get Folder ID

1. Open the folder in Google Drive
2. Look at the URL in your browser:
   ```
   https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j
                                          ^^^^^^^^^^^^^^^^^^^^
                                          This is the folder ID
   ```
3. Copy the folder ID

---

## Step 6: Configure MMM-CloudPhotos

Add to your `~/MagicMirror/config/config.js`:

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    provider: "google-drive",
    driveFolders: [
      {
        id: "YOUR_FOLDER_ID_HERE",  // Paste your folder ID
        depth: -1                    // -1 = scan all subfolders
      }
    ],
    updateInterval: 60000,  // Change photo every 60 seconds
    showWidth: 1080,
    showHeight: 1920
  }
}
```

### Folder Depth Options

- `depth: -1` - Scan all subfolders (infinite recursion)
- `depth: 0` - Only scan this folder (no subfolders)
- `depth: 1` - Scan this folder + 1 level of subfolders
- `depth: N` - Scan N levels deep

### Multiple Folders

```javascript
driveFolders: [
  { id: "1a2b3c4d5e6f7g8h9i0j", depth: -1 },  // Family photos (all subfolders)
  { id: "2b3c4d5e6f7g8h9i0j1k", depth: 0 },   // Vacation (no subfolders)
  { id: null, depth: 1 }                       // Drive root (1 level)
]
```

---

## Step 7: Restart MagicMirror

```bash
pm2 restart MagicMirror
```

Or if not using PM2:
```bash
npm start
```

---

## Verification

Check the logs to verify it's working:

```bash
pm2 logs MagicMirror
```

You should see:
```
[CLOUDPHOTOS] Initializing MMM-CloudPhotos V3...
[GDRIVE] Successfully authenticated with Google Drive API
[GDRIVE] Found X photos
```

---

## Troubleshooting

### "Authentication failed"

**Regenerate token:**
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
rm token_drive.json
node generate_drive_token.js
```

### "No such file: google_drive_auth.json"

- Verify file exists in module folder
- Check filename is exactly `google_drive_auth.json`
- Ensure you downloaded the correct credentials file from Google Cloud Console

### "Drive API not enabled"

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Go to **APIs & Services** → **Library**
4. Search for "Google Drive API"
5. Click **Enable**

### "Access not granted"

- Add your email as a test user in OAuth consent screen
- When authorizing, make sure to click **Continue** on all permission screens

### "No photos appearing"

- Verify folder ID is correct (check Drive URL)
- Ensure folder contains image files (JPG, PNG, GIF, WEBP)
- Check photos aren't in Google Drive trash
- Review logs: `pm2 logs MagicMirror --lines 100`

---

## File Permissions

The OAuth credentials grant **read-only** access to your Google Drive:

- Scope: `https://www.googleapis.com/auth/drive.readonly`
- Cannot modify, delete, or upload files
- Cannot access other Google services
- Limited to files you have access to

---

## API Quotas

Google Drive API free tier:
- **1 billion queries per day** (per project)
- MMM-CloudPhotos uses ~270 queries per day
- You're using **0.000027%** of the quota

If you have multiple MagicMirrors:
- Each can use the same Google Cloud project
- Or create separate projects for each

---

## Security Best Practices

1. **Don't commit credentials to Git:**
   ```bash
   # Already in .gitignore:
   google_drive_auth.json
   token_drive.json
   ```

2. **Restrict OAuth app to test users** (keep it in testing mode)

3. **Rotate credentials** if compromised:
   - Delete OAuth client in Cloud Console
   - Create new one
   - Generate new token

4. **Use dedicated folder** for MagicMirror photos (not your entire Drive)

---

## Advanced Configuration

### Relative Paths

Use relative paths for portability:
```javascript
config: {
  keyFilePath: "./google_drive_auth.json",  // Relative to module folder
  tokenPath: "./token_drive.json"
}
```

### Absolute Paths

Or specify absolute paths:
```javascript
config: {
  keyFilePath: "/home/pi/creds/google_drive_auth.json",
  tokenPath: "/home/pi/creds/token_drive.json"
}
```

---

## Next Steps

- [Configuration Guide](CONFIGURATION.md) - All configuration options
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues
- [README](../README.md) - Back to main documentation
