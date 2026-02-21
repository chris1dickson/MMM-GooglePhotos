# OneDrive Setup Guide

Complete guide for setting up MMM-CloudPhotos with OneDrive as your photo storage provider.

## Overview

OneDrive integration uses **Microsoft Graph API** to access your OneDrive photos. This guide walks you through:

1. Azure App Registration
2. Generating OAuth Token
3. Organizing Photos in OneDrive
4. Configuring MagicMirror

---

## Step 1: Register Azure Application

### 1.1 Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Sign in with your Microsoft account
3. Navigate to **Azure Active Directory** → **App registrations**
4. Click **New registration**

### 1.2 Configure Registration

- **Name**: `MMM-CloudPhotos` (or any name you prefer)
- **Supported account types**: Choose one:
  - **Personal Microsoft accounts only** (recommended for personal use)
  - **Accounts in any organizational directory and personal Microsoft accounts** (for work/school accounts)
- **Redirect URI**:
  - Platform: **Web**
  - URI: `http://localhost:3000/callback`

Click **Register**

### 1.3 Note Your Client ID

After registration, you'll see the **Overview** page:
- Copy the **Application (client) ID** - you'll need this later

### 1.4 Create Client Secret

1. Go to **Certificates & secrets** (left sidebar)
2. Click **New client secret**
3. Description: `MMM-CloudPhotos Secret`
4. Expires: **24 months** (or your preference)
5. Click **Add**
6. **IMPORTANT**: Copy the **Value** immediately (it won't be shown again)

### 1.5 Grant API Permissions

1. Go to **API permissions** (left sidebar)
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search and check:
   - `Files.Read` - Read user files
   - `offline_access` - Maintain access to data you have given it access to
6. Click **Add permissions**

**Note**: Admin consent is not required for personal accounts with these permissions.

---

## Step 2: Generate OAuth Token

### 2.1 Run Token Generator

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node generate_onedrive_token.js
```

### 2.2 Follow the Prompts

1. Enter your **Client ID** (from Step 1.3)
2. Enter your **Client Secret** (from Step 1.4)
3. The script will open a browser URL - **copy and open it**
4. Sign in with your Microsoft account
5. Click **Accept** to grant permissions
6. You'll be redirected to `localhost:3000/callback`
7. The script will automatically capture the authorization code

### 2.3 Verify Token

The script creates `token_onedrive.json` in your module folder:

```json
{
  "access_token": "EwB...",
  "refresh_token": "M.R3...",
  "expiry_date": 1234567890000,
  "client_id": "your-client-id",
  "client_secret": "your-client-secret"
}
```

**Keep this file secure** - it contains access to your OneDrive!

---

## Step 3: Organize Photos in OneDrive

### 3.1 Create Photo Folders

1. Go to [OneDrive](https://onedrive.live.com)
2. Create a folder structure, for example:
   ```
   📁 MagicMirror Photos
      📁 Family
      📁 Vacation
      📁 Pets
   ```

### 3.2 Upload Photos

- Drag and drop photos into your folders
- OneDrive automatically creates thumbnails
- Supported formats: JPG, PNG, GIF, BMP, TIFF

### 3.3 Get Folder IDs

**Method 1: From Web URL**
1. Navigate to your folder in OneDrive web interface
2. Look at the URL:
   ```
   https://onedrive.live.com/?id=01ABCDEFGH...XYZ
                                  ^^^^^^^^^^^^^^^^
                                  This is the folder ID
   ```
3. Copy the part after `id=`

**Method 2: Use Root**
- Use `null` or omit `id` to scan from OneDrive root

**Method 3: API Explorer**
1. Go to [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
2. Sign in
3. Run: `GET https://graph.microsoft.com/v1.0/me/drive/root/children`
4. Find your folder and copy its `id`

---

## Step 4: Configure MagicMirror

### 4.1 Basic Configuration

Add to `~/MagicMirror/config/config.js`:

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    // Select OneDrive provider
    provider: "onedrive",

    // OneDrive-specific configuration
    providerConfig: {
      clientId: "YOUR_CLIENT_ID",      // From Azure app registration
      clientSecret: "YOUR_SECRET",      // From Azure app registration
      tokenPath: "./token_onedrive.json",

      // Folders to scan
      folders: [
        {
          id: "YOUR_FOLDER_ID",  // From Step 3.3
          depth: -1              // -1 = scan all subfolders
        }
      ]
    },

    // Universal settings (same for all providers)
    updateInterval: 60000,      // Change photo every 60 seconds
    showWidth: 1920,           // Screen width for image sizing
    showHeight: 1080,          // Screen height for image sizing
    maxCacheSizeMB: 200,       // Local cache size
    useBlobStorage: true,      // Store processed images in SQLite
    jpegQuality: 85,           // JPEG compression quality (1-100)
    sortMode: "random"         // Photo order: random, sequential, newest, oldest
  }
}
```

### 4.2 Multiple Folders

Scan multiple folders or different depth levels:

```javascript
providerConfig: {
  clientId: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_SECRET",
  tokenPath: "./token_onedrive.json",
  folders: [
    {
      id: "FOLDER_1_ID",
      depth: 0              // Only photos directly in this folder
    },
    {
      id: "FOLDER_2_ID",
      depth: 2              // Scan 2 levels deep
    },
    {
      id: null,             // OneDrive root
      depth: -1             // Scan all subfolders recursively
    }
  ]
}
```

### 4.3 Restart MagicMirror

```bash
pm2 restart mm
# or
npm run start
```

---

## Configuration Options

### Provider-Specific (providerConfig)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | string | - | Azure App Client ID (required) |
| `clientSecret` | string | - | Azure App Client Secret (required) |
| `tokenPath` | string | `./token_onedrive.json` | Path to token file |
| `folders` | array | `[]` | Folders to scan (see format below) |

### Folder Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | string/null | `null` | Folder ID from OneDrive (null = root) |
| `depth` | number | `-1` | Scan depth: -1 = infinite, 0 = folder only, N = N levels |

### Universal Settings (all providers)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `updateInterval` | number | `60000` | Milliseconds between photo changes |
| `showWidth` | number | `1920` | Screen width for image resizing |
| `showHeight` | number | `1080` | Screen height for image resizing |
| `maxCacheSizeMB` | number | `200` | Maximum cache size in megabytes |
| `useBlobStorage` | boolean | `true` | Store images in SQLite vs files |
| `jpegQuality` | number | `85` | JPEG quality 1-100 (higher = better) |
| `sortMode` | string | `"random"` | Order: random, sequential, newest, oldest |
| `scanInterval` | number | `21600000` | Milliseconds between folder scans (6 hours) |

---

## Features

### Incremental Sync

OneDrive provider uses **Microsoft Graph Delta API** for efficient syncing:

- **First scan**: Full scan of all folders
- **Subsequent scans**: Only checks for changes (new/modified/deleted files)
- **Bandwidth savings**: Dramatically reduces API calls
- **Faster updates**: Detects changes in seconds

### Image Processing

All images are automatically optimized when Sharp is installed:

- **Automatic resizing**: Scaled to your screen dimensions
- **Compression**: Reduced to JPEG at specified quality
- **Storage savings**: 70-80% smaller cache sizes
- **Aspect ratio**: Preserved without distortion

### Caching

Photos are cached locally for offline resilience:

- **BLOB mode**: Images stored in SQLite database
- **File mode**: Images stored as files in `cache/images/`
- **Smart eviction**: Oldest photos removed when cache full
- **Fast loading**: No re-download needed

---

## Troubleshooting

### Token Generation Fails

**Error**: `ECONNREFUSED localhost:3000`
- **Cause**: Port 3000 already in use
- **Fix**: Stop other services on port 3000, or modify the script

**Error**: `invalid_client`
- **Cause**: Incorrect Client ID or Client Secret
- **Fix**: Double-check credentials from Azure portal

**Error**: `invalid_grant`
- **Cause**: Authorization code expired
- **Fix**: Run the script again and authorize immediately

### No Photos Found

**Check folder permissions**:
```bash
# Test OneDrive access
node -e "
const provider = require('./components/providers/OneDriveProvider');
const config = require('./token_onedrive.json');
const p = new provider(config, console.log);
p.initialize().then(() => p.fullScan()).then(console.log);
"
```

**Check folder ID**:
- Verify folder ID is correct
- Try using `null` to scan from root

### Token Refresh Fails

**Error**: `invalid_grant` during refresh
- **Cause**: Refresh token expired or revoked
- **Fix**: Re-run `generate_onedrive_token.js`

**Auto-refresh**: OneDrive provider automatically refreshes tokens before expiry

### API Rate Limits

OneDrive has generous rate limits:
- **Per user**: 10,000 requests per 10 minutes
- **Per app**: 20,000 requests per 10 minutes

MMM-CloudPhotos typically uses:
- **Initial scan**: ~10-50 requests (depends on folder count)
- **Incremental scan**: ~1-5 requests
- **Photo download**: 1 request per photo

---

## Security Best Practices

### Protect Your Credentials

1. **Never commit secrets to git**:
   ```bash
   echo "token_onedrive.json" >> .gitignore
   ```

2. **Restrict file permissions**:
   ```bash
   chmod 600 token_onedrive.json
   ```

3. **Use environment variables** (optional):
   ```javascript
   providerConfig: {
     clientId: process.env.ONEDRIVE_CLIENT_ID,
     clientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
     // ...
   }
   ```

### Limit Permissions

Only grant `Files.Read` permission - never request write access unless needed.

### Monitor Access

1. Go to [Microsoft Account - Apps & services](https://account.microsoft.com/privacy/app-access)
2. Review apps with access to your OneDrive
3. Revoke access if suspicious

---

## Comparison: OneDrive vs Google Drive

| Feature | OneDrive | Google Drive |
|---------|----------|--------------|
| **Free Storage** | 5 GB | 15 GB |
| **API** | Microsoft Graph | Google Drive API |
| **Auth Setup** | Azure Portal | Google Cloud Console |
| **Incremental Sync** | ✅ Delta API | ✅ Changes API |
| **Folder Scanning** | ✅ Recursive | ✅ Recursive |
| **Photo Metadata** | ✅ Rich EXIF | ✅ Rich EXIF |
| **Rate Limits** | 10K req/10min | Generous |
| **Integration** | Microsoft 365 | Google Workspace |

---

## Advanced Usage

### Custom Token Paths

```javascript
providerConfig: {
  tokenPath: "/home/pi/.config/onedrive/token.json",
  // ...
}
```

### Multiple OneDrive Accounts

Run multiple module instances with different configs:

```javascript
// Account 1
{
  module: "MMM-CloudPhotos",
  position: "top_center",
  config: {
    provider: "onedrive",
    providerConfig: {
      tokenPath: "./token_onedrive_account1.json",
      // ...
    }
  }
},

// Account 2
{
  module: "MMM-CloudPhotos",
  position: "bottom_center",
  config: {
    provider: "onedrive",
    providerConfig: {
      tokenPath: "./token_onedrive_account2.json",
      // ...
    }
  }
}
```

### Mixing Providers

Use both Google Drive and OneDrive:

```javascript
// OneDrive photos
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    provider: "onedrive",
    // ...
  }
},

// Google Drive photos
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_above",
  config: {
    provider: "google-drive",
    // ...
  }
}
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/chris1dickson/MMM-CloudPhotos/issues)
- **Discussions**: [MagicMirror Forum](https://forum.magicmirror.builders)
- **Microsoft Graph API**: [Documentation](https://docs.microsoft.com/en-us/graph/api/resources/onedrive)

---

## Next Steps

- **Dropbox**: Coming soon!
- **iCloud Photos**: Planned
- **Local Filesystem**: Planned

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
