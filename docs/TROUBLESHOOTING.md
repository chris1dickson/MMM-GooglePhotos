# Troubleshooting Guide

Common issues and solutions for MMM-CloudPhotos.

---

## Table of Contents

- [Module Not Loading](#module-not-loading)
- [Authentication Errors](#authentication-errors)
- [No Photos Appearing](#no-photos-appearing)
- [Photos Not Updating](#photos-not-updating)
- [Network & Offline Issues](#network--offline-issues)
- [Performance Issues](#performance-issues)
- [Cache Issues](#cache-issues)
- [Display Issues](#display-issues)

---

## Module Not Loading

### Symptoms
- Module doesn't appear on MagicMirror
- Black screen or MagicMirror won't start

### Solutions

#### 1. Check Logs
```bash
pm2 logs MagicMirror --lines 100
```

Look for errors related to `MMM-CloudPhotos`.

#### 2. Verify Installation
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
ls
```

Should see: `MMM-CloudPhotos.js`, `node_helper.js`, `package.json`, etc.

#### 3. Check Dependencies
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm install
```

#### 4. Verify Node.js Version
```bash
node --version
```

Requires: Node.js v18 or higher

#### 5. Check Config Syntax
Make sure `config/config.js` has no syntax errors:
```bash
node -c ~/MagicMirror/config/config.js
```

---

## Authentication Errors

### Error: "Authentication failed"

#### For Google Drive:

1. **Regenerate token:**
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   rm token_drive.json
   node generate_drive_token.js
   ```

2. **Verify credentials file exists:**
   ```bash
   ls google_drive_auth.json
   ```

3. **Check file permissions:**
   ```bash
   chmod 600 google_drive_auth.json token_drive.json
   ```

4. **Verify Google Drive API is enabled:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Select your project
   - Go to **APIs & Services** → **Library**
   - Search for "Google Drive API"
   - Ensure it's enabled

#### For OneDrive:

1. **Regenerate token:**
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   rm token_onedrive.json
   node generate_onedrive_token.js
   ```

2. **Verify Azure app credentials:**
   - Check `clientId` and `clientSecret` in config
   - Ensure they match your Azure app

3. **Check token expiry:**
   - OneDrive tokens expire
   - Module automatically refreshes them
   - If issues persist, regenerate token

### Error: "No such file: google_drive_auth.json"

1. **Download credentials from Google Cloud Console:**
   - Go to **APIs & Services** → **Credentials**
   - Click your OAuth 2.0 Client ID
   - Click **Download JSON**

2. **Save as correct filename:**
   ```bash
   mv ~/Downloads/client_secret_*.json ~/MagicMirror/modules/MMM-CloudPhotos/google_drive_auth.json
   ```

3. **Or use absolute path in config:**
   ```javascript
   config: {
     keyFilePath: "/home/pi/creds/google_drive_auth.json"
   }
   ```

### Error: "Access not granted" or "insufficient permissions"

1. **Add yourself as test user:**
   - Go to Google Cloud Console
   - **APIs & Services** → **OAuth consent screen**
   - Add your email under **Test users**

2. **Re-authorize the app:**
   - When running `generate_drive_token.js`
   - Click **Continue** on all permission screens
   - Don't skip any permission requests

---

## No Photos Appearing

### Check Folder Configuration

1. **Verify folder ID is correct:**
   - Open folder in Google Drive/OneDrive
   - Check URL:
     ```
     https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j
                                            ^^^^^^^^^^^^^^^^^^^^
                                            This is the folder ID
     ```

2. **Check depth setting:**
   ```javascript
   driveFolders: [
     { id: "YOUR_FOLDER_ID", depth: -1 }  // -1 = all subfolders
   ]
   ```

3. **Verify folder contains images:**
   - Supported formats: JPG, JPEG, PNG, GIF, WEBP
   - Not RAW files (.CR2, .NEF, etc.)

### Check Database

1. **View photo count:**
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   sqlite3 cache/photos.db "SELECT COUNT(*) FROM photos;"
   ```

2. **View cached photo count:**
   ```bash
   sqlite3 cache/photos.db "SELECT COUNT(*) FROM photos WHERE cached_at IS NOT NULL;"
   ```

3. **Reset database (last resort):**
   ```bash
   rm -rf cache/
   pm2 restart MagicMirror
   ```

### Check Logs

```bash
pm2 logs MagicMirror --lines 100 | grep CLOUDPHOTOS
```

Look for:
- "Found X photos" - photos were scanned successfully
- "No photos found" - folder is empty or inaccessible

---

## Photos Not Updating

### Check Scan Interval

Default is 6 hours. Photos won't update immediately after adding to cloud.

**Force a scan:**
```bash
pm2 restart MagicMirror
```

**Adjust scan interval (config.js):**
```javascript
config: {
  scanInterval: 3600000  // 1 hour (in milliseconds)
}
```

### Verify New Photos Are in Folder

1. Check folder in Google Drive/OneDrive
2. Ensure photos aren't in trash
3. Verify you have read access to the folder

### Check Incremental Sync

Module uses Changes/Delta API for efficiency:
```bash
pm2 logs MagicMirror | grep "incremental sync"
```

If issues, force full rescan:
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
sqlite3 cache/photos.db "DELETE FROM settings WHERE key='changes_token';"
pm2 restart MagicMirror
```

---

## Network & Offline Issues

### Connection Status Indicator

Check the status shown in photo metadata:
- ☁ **Online** - Connected and syncing
- ⚠ **Offline** - Showing cached photos
- 🔄 **Retrying** - Attempting to reconnect

### Module Boots Offline

**This is normal!** Module will:
1. Show cached photos immediately
2. Retry connection in background
3. Automatically reconnect when network returns

**Check retry behavior in logs:**
```bash
pm2 logs MagicMirror | grep "authentication retry"
```

### Network Drops After Being Online

Module should automatically detect and retry. Check logs:
```bash
pm2 logs MagicMirror | grep "Network error detected"
```

If not recovering:
```bash
pm2 restart MagicMirror
```

### Disable Auto-Retry (Not Recommended)

```javascript
config: {
  maxAuthRetries: 0  // No retries
}
```

### Adjust Retry Behavior

```javascript
config: {
  maxAuthRetries: 20,           // Stop after 20 attempts
  maxAuthBackoffMs: 60000      // Max 1 minute between retries
}
```

---

## Performance Issues

### Slow Photo Changes

**Symptoms:** Long delay when changing photos

**Solutions:**

1. **Enable BLOB storage:**
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   npm install sharp
   ```

   ```javascript
   config: {
     useBlobStorage: true
   }
   ```

2. **Reduce image quality:**
   ```javascript
   config: {
     jpegQuality: 75  // Lower = faster
   }
   ```

3. **Match screen resolution:**
   ```javascript
   config: {
     showWidth: 1920,    // Match your screen
     showHeight: 1080
   }
   ```

### High CPU Usage

1. **Reduce scan frequency:**
   ```javascript
   config: {
     scanInterval: 86400000  // Once per day
   }
   ```

2. **Limit folder depth:**
   ```javascript
   driveFolders: [
     { id: "YOUR_FOLDER", depth: 2 }  // Instead of -1
   ]
   ```

3. **Check for excessive logging:**
   ```javascript
   config: {
     debug: false  // Disable debug mode
   }
   ```

### SD Card Wear (Raspberry Pi)

**Use BLOB storage to reduce writes:**
```bash
npm install sharp
```

```javascript
config: {
  useBlobStorage: true,
  maxCacheSizeMB: 200
}
```

---

## Cache Issues

### Cache Full

**Symptoms:** "Cache over limit" in logs

**Solutions:**

1. **Increase cache size:**
   ```javascript
   config: {
     maxCacheSizeMB: 500  // Increase from 200
   }
   ```

2. **Reduce photo collection:**
   - Remove some folders from `driveFolders`
   - Use `depth: 0` to exclude subfolders

3. **Clear cache manually:**
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   rm -rf cache/images/*
   sqlite3 cache/photos.db "UPDATE photos SET cached_at=NULL, cached_path=NULL, cached_size_bytes=NULL;"
   ```

### Out of Disk Space

**Check available space:**
```bash
df -h
```

**Solutions:**
1. Reduce `maxCacheSizeMB`
2. Clean other MagicMirror modules' caches
3. Expand SD card / storage

### Corrupted Cache

**Reset cache and database:**
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
rm -rf cache/
pm2 restart MagicMirror
```

---

## Display Issues

### Photos Not Fullscreen

**Verify position:**
```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below"  // Must be fullscreen_*
}
```

### Photos Stretched or Distorted

Module preserves aspect ratio by default. If seeing issues:

**Check CSS customizations:**
```bash
cat ~/MagicMirror/css/custom.css | grep GPHOTO
```

**Reset to default:**
Remove any `#GPHOTO` CSS rules from `custom.css`

### Info Overlay Not Showing

**Check if hidden by CSS:**
```bash
cat ~/MagicMirror/css/custom.css | grep GPHOTO_INFO
```

**Reset:**
Remove any `#GPHOTO_INFO` CSS rules

### Wrong Time Format

**Use relative time:**
```javascript
config: {
  timeFormat: "relative"  // "3 years ago"
}
```

**Or custom format:**
```javascript
config: {
  timeFormat: "YYYY/MM/DD HH:mm"
}
```

---

## Getting Help

If you're still stuck:

1. **Check existing issues:**
   - [GitHub Issues](https://github.com/chris1dickson/MMM-CloudPhotos/issues)

2. **Gather information:**
   ```bash
   # Node version
   node --version

   # Logs
   pm2 logs MagicMirror --lines 200 > ~/cloudphotos-logs.txt

   # Module version
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   git log -1 --oneline
   ```

3. **Create a new issue:**
   - Include Node version
   - Include relevant logs
   - Describe steps to reproduce
   - Include config (remove sensitive info)

---

## Next Steps

- [Configuration Guide](CONFIGURATION.md) - All configuration options
- [Google Drive Setup](GOOGLE_DRIVE_SETUP.md) - Setup guide
- [OneDrive Setup](ONEDRIVE_SETUP.md) - Setup guide
- [README](../README.md) - Back to main documentation
