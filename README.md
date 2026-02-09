# MMM-CloudPhotos

Display your photos from **cloud storage providers** on [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror).

## ☁️ Multi-Provider Architecture

**MMM-CloudPhotos** (formerly MMM-GooglePhotos) now supports multiple cloud storage providers.

### Currently Supported

- ✅ **Google Drive** - Display photos from Drive folders (fully supported)

### Coming Soon

- 🔄 **OneDrive** - Microsoft cloud storage
- 🔄 **Dropbox** - Popular file hosting
- 🔄 **iCloud Photos** - Apple's photo service
- 🔄 **Local Filesystem** - Scan local folders

## Screenshots

![screenshot](images/screenshot.png)
![screenshot](images/screenshot2.png)

## Features

- ✅ Display photos from **Google Drive folders** (recursive scanning supported)
- ✅ **Offline-first architecture** - 200MB local cache for resilience
- ✅ **Efficient scanning** - Uses Drive Changes API (92% less API quota)
- ✅ **BLOB storage mode** - Store processed images in SQLite for better performance
- ✅ **Image optimization** - Automatic resizing and compression
- ✅ **Full-screen display** - Perfect for MagicMirror setups

---

## Quick Start

### 1. Clone the Repository

```bash
cd ~/MagicMirror/modules
git clone https://github.com/YOUR_USERNAME/MMM-CloudPhotos-fork.git MMM-CloudPhotos
cd MMM-CloudPhotos
npm install
```

### 2. Enable Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Choose **Desktop app** as application type
6. Download credentials as JSON
7. Save it as `google_drive_auth.json` in the module folder

### 3. Generate OAuth Token

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node generate_drive_token.js
```

Follow the prompts:
1. Open the URL in your browser
2. Authorize the application
3. Copy the authorization code
4. Paste it when prompted

This creates `token_drive.json` in your module folder.

### 4. Organize Photos in Google Drive

1. Create a folder in Google Drive (e.g., "MagicMirror Photos")
2. Upload/organize your photos into this folder
3. You can use subfolders (e.g., "Family", "Vacation", etc.)
4. Get the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j
                                          ^^^^^^^^^^^^^^^^^^^^
                                          This is the folder ID
   ```

### 5. Configure MagicMirror

Add this to your `config/config.js`:

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      {
        id: "YOUR_FOLDER_ID",  // From Drive folder URL
        depth: -1              // -1 = scan all subfolders
      }
    ],
    updateInterval: 60000,     // Change photo every 60 seconds
    showWidth: 1080,
    showHeight: 1920
  }
}
```

### 6. Restart MagicMirror

```bash
pm2 restart MagicMirror
```

---

## Configuration Options

### Core Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `driveFolders` | Array | `[]` | **Required.** Array of Drive folder configurations |
| `driveFolders[].id` | String/null | - | Folder ID from Drive URL. Use `null` for Drive root |
| `driveFolders[].depth` | Number | `-1` | Folder scan depth: `-1` = infinite, `0` = folder only, `N` = N levels |
| `updateInterval` | Number | `60000` | Photo change interval in milliseconds (minimum 10 seconds) |
| `showWidth` | Number | `1080` | Display width in pixels (images resized to fit) |
| `showHeight` | Number | `1920` | Display height in pixels (images resized to fit) |

### Advanced Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyFilePath` | String | `"./google_drive_auth.json"` | Path to OAuth credentials file |
| `tokenPath` | String | `"./token_drive.json"` | Path to OAuth token file |
| `sortMode` | String | `"sequential"` | Photo sort order: `"sequential"`, `"random"`, `"newest"`, `"oldest"` |
| `maxCacheSizeMB` | Number | `200` | Maximum cache size in MB (~5-6 hours offline) |
| `scanInterval` | Number | `21600000` | How often to scan for new photos (default: 6 hours) |
| `timeFormat` | String | `"YYYY/MM/DD HH:mm"` | Time format for photo metadata |
| `autoInfoPosition` | Boolean/Function | `false` | Auto-reposition photo info to prevent burn-in |
| `debug` | Boolean | `false` | Enable verbose logging |

### Image Processing & Storage

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useBlobStorage` | Boolean | `true` | Store images as BLOBs in SQLite (requires Sharp) |
| `blobQuality` | Number | `80` | JPEG quality (1-100) for image compression |

**How it works (when Sharp is installed):**
1. Photos are downloaded from Google Drive
2. Sharp library resizes images to fit `showWidth` x `showHeight` (aspect ratio preserved)
3. Resized images are compressed to JPEG at `blobQuality` %
4. Images stored as BLOBs in SQLite (if `useBlobStorage: true`) or as files (if `false`)
5. Result: ~70-80% smaller files, faster loading, less SD card wear

**Without Sharp installed:**
- Photos downloaded directly without resizing or compression
- Original file sizes retained (larger cache usage)
- Stored as files in `cache/images/` folder

**Recommendation:** Install Sharp (`npm install sharp`) for automatic image optimization.

See [BLOB_STORAGE_GUIDE.md](BLOB_STORAGE_GUIDE.md) for complete details.

### Removed Options (Not Yet Implemented in V3)

| Option | Status | Notes |
|--------|--------|-------|
| `albums` | ❌ Removed | Use `driveFolders` instead |
| `sort` | ⚠️ Changed | Use `sortMode` instead (supports sequential, random, newest, oldest) |
| `uploadAlbum` | ❌ Removed | Not implemented in V3 |
| `condition` | ❌ Removed | Date/size filtering not yet implemented |

---

## Configuration Examples

### Basic Configuration

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      { id: "YOUR_FOLDER_ID_HERE", depth: -1 }
    ]
  }
}
```

### Multiple Folders with Different Depths

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      { id: "1a2b3c4d5e6f7g8h9i0j", depth: -1 },  // Family photos (all subfolders)
      { id: "2b3c4d5e6f7g8h9i0j1k", depth: 0 },   // Vacation (this folder only)
      { id: null, depth: 1 }                       // Drive root (1 level deep)
    ],
    updateInterval: 60000,  // 1 minute per photo
    maxCacheSizeMB: 300     // Increase cache to 300MB
  }
}
```

### Custom Display Settings

```javascript
{
  module: "MMM-CloudPhotos",
  position: "top_right",
  config: {
    driveFolders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ],
    updateInterval: 120000,  // 2 minutes per photo
    showWidth: 1920,         // 4K resolution
    showHeight: 1080,
    autoInfoPosition: true,  // Prevent burn-in
    debug: true              // Verbose logging
  }
}
```

### Sort Mode Examples

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ],
    sortMode: "newest",      // Show newest photos first
    // Options:
    // "sequential" (default) - Deterministic order by photo ID
    // "random"               - Random order, prioritizes unviewed photos
    // "newest"               - Newest photos first by creation date
    // "oldest"               - Oldest photos first by creation date
    updateInterval: 60000
  }
}
```

---

## Performance Optimization

### Enable BLOB Storage (Recommended)

Install Sharp for image processing:
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm install sharp
```

Enable in config:
```javascript
config: {
  useBlobStorage: true,
  blobQuality: 80,
  maxCacheSizeMB: 200
}
```

**Benefits:**
- 50% fewer I/O operations
- Better cache efficiency
- Reduced SD card wear
- Faster image loading

See [BLOB_STORAGE_GUIDE.md](BLOB_STORAGE_GUIDE.md) for complete details.

### For Large Photo Collections (10K+ photos)

```javascript
config: {
  driveFolders: [
    { id: "YOUR_FOLDER_ID", depth: 2 }  // Limit depth to avoid long scans
  ],
  scanInterval: 43200000,  // Scan every 12 hours instead of 6
  maxCacheSizeMB: 500      // Increase cache if you have space
}
```

### For Slow Networks

```javascript
config: {
  maxCacheSizeMB: 100,     // Smaller cache
  updateInterval: 120000   // Change photos less frequently (2 min)
}
```

### For Maximum Offline Time

```javascript
config: {
  maxCacheSizeMB: 1000,    // 1GB cache (~30 hours offline)
  scanInterval: 86400000   // Scan once per day
}
```

### Optimize for Raspberry Pi

- Use BLOB storage to reduce SD card wear
- Set appropriate `showWidth` and `showHeight` for your screen
- Limit `driveFolders` depth if you have many photos
- Increase `updateInterval` if experiencing performance issues

---

## How It Works

### Architecture

```
Google Drive Folders
    ↓
GDriveAPI scans folders (with depth control)
    ↓
PhotoDatabase stores metadata (SQLite)
    ↓
CacheManager downloads photos (batch=5, 30s ticks)
    ↓
Display shows photos every 60s (from cache)
```

### Key Features

**Efficient Scanning:**
- Initial scan: Full folder scan (~5 minutes for 10K photos)
- Incremental scan: Changes API (1-5 API calls, <3 seconds)
- Runs every 6 hours (configurable)

**Smart Caching:**
- Downloads 5 photos every 30 seconds in background
- 200MB cache (~5-6 hours offline)
- Automatic eviction of least-recently-viewed photos
- Photos display from local cache (instant, no network needed)

**Network Resilience:**
- Graceful degradation after 3 consecutive failures
- Cached photos continue displaying during outages
- Automatically resumes when connection returns
- No confusing error messages

**API Quota Compliance:**
- ~270 API calls/day (1.67% of free tier limit)
- Incremental scanning saves 92% of API quota
- Read-only scope: `drive.readonly`

---

## Troubleshooting

### Module not loading

1. Check logs: `pm2 logs MagicMirror`
2. Verify `google_drive_auth.json` exists
3. Verify `token_drive.json` was generated
4. Check Node.js version: `node --version` (requires v18+)
5. Check dependencies: `npm install`

### No photos appearing

1. Verify folder ID is correct (check Drive URL)
2. Check folder has image files (JPG, PNG, GIF, WEBP)
3. Ensure photos are not in Google Drive's trash
4. Check file permissions (you must have access)
5. Check Drive API quota: [Google Cloud Console](https://console.cloud.google.com)
6. Review logs for errors: `pm2 logs MagicMirror --lines 100`

### Authentication errors

Regenerate token:
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
rm token_drive.json
node generate_drive_token.js
```

Verify:
1. `google_drive_auth.json` exists and is valid
2. Google Drive API is enabled in Cloud Console
3. OAuth consent screen is configured

### Photos not updating

1. Check `scanInterval` setting (default: 6 hours)
2. Check console logs: `pm2 logs MagicMirror`
3. Manually trigger scan by restarting: `pm2 restart MagicMirror`
4. Verify new photos are in the Drive folder

### Cache full or out of disk space

1. Increase `maxCacheSizeMB` if you have space
2. Or reduce number of photos in Drive folders
3. Check cache directory: `~/MagicMirror/modules/MMM-CloudPhotos/cache/`
4. Clean old cache: `rm -rf cache/`

---

## CSS Customizations

### Hide Photo Info

Add to `~/MagicMirror/css/custom.css`:
```css
#GPHOTO_INFO {
  display: none;
}
```

### Move Info to Top-Left

```css
#GPHOTO_INFO {
  top: 10px;
  left: 10px;
  bottom: inherit;
  right: inherit;
}
```

### Cover Whole Region

```css
#GPHOTO_CURRENT {
  background-size: cover;
}
```

### Contain Image (Fully Visible)

```css
#GPHOTO_CURRENT {
  background-size: contain;
}
```

### Add Opacity

```css
@keyframes trans {
  from {opacity: 0}
  to {opacity: 0.5}
}
#GPHOTO_CURRENT {
  background-size: cover;
  opacity: 0.5;
}
```

---

## Migration from V2 (Google Photos) to V3 (Google Drive)

> **Note:** V2 (Google Photos API) stopped working in March 2025. If you're a new user, skip this section and use the Quick Start above.

### For Existing V2 Users:

**What Changed:**
- V2 used `albums: ["Album Name"]` - **No longer works**
- V3 uses `driveFolders: [{id: "...", depth: -1}]` - **Works now**

**Migration Steps:**

1. **Move your photos** from Google Photos to Google Drive:
   - Create folders in Google Drive
   - Upload/move your photos there
   - Get folder IDs from Drive URLs

2. **Update your config.js**:
   ```javascript
   // Replace this (V2 - broken):
   albums: ["Family Photos", "Vacation 2024"]

   // With this (V3 - working):
   driveFolders: [
     { id: "1a2b3c4d5e6f7g8h9i0j", depth: -1 },  // Family Photos
     { id: "2b3c4d5e6f7g8h9i0j1k", depth: -1 }   // Vacation 2024
   ]
   ```

3. **Set up Google Drive API** (see Quick Start above)

4. **Clean old cache**:
   ```bash
   cd ~/MagicMirror/modules/MMM-CloudPhotos
   rm -rf cache/*
   pm2 restart MagicMirror
   ```

---

## FAQ

**Q: Can I use both Google Photos albums and Drive folders?**
A: No, V3 only supports Google Drive. Google Photos API is deprecated.

**Q: Will my photos in Google Photos work?**
A: No, you need to move/copy photos to Google Drive folders.

**Q: Can I filter photos by date or size?**
A: Not yet. This feature is planned for a future release.

**Q: Can I upload photos from MagicMirror?**
A: Not in V3. This feature may return in a future release.

**Q: How much does Google Drive API cost?**
A: It's free! The free tier allows 1B queries/day. V3 uses ~270/day.

**Q: What happens if I exceed the cache limit?**
A: The module automatically evicts the least-recently-viewed photos.

**Q: Can I use photos from shared drives?**
A: Yes, as long as you have read access to the folder.

---

## Testing & Development

### Available Test Scripts

The module includes several test scripts for validation and development:

#### 1. Comprehensive Test Suite

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node test_v3_standalone.js
```

**What it tests:**
- Google Drive API authentication
- Folder scanning (with depth control)
- Photo database operations
- Cache management (file-based and BLOB)
- All 4 sort modes (sequential, random, newest, oldest)
- Changes API (incremental scanning)
- Image download and processing

**Prerequisites:**
- OAuth credentials (`google_drive_auth.json`)
- Valid token (`token_drive.json`)
- Edit folder ID in script before running

#### 2. Quick Test (Pre-configured)

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node quick-test.js
```

**What it does:**
- Quick validation of basic functionality
- Uses configuration from `test-config.json`
- Faster than comprehensive test suite

**Setup:**
1. Copy `test-config.json.example` to `test-config.json`
2. Edit with your folder ID
3. Run the script

#### 3. BLOB Storage Test

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm install sharp  # Required for BLOB storage
node test_blob_storage.js
```

**What it tests:**
- Sharp image processing
- BLOB storage in SQLite
- Image resizing and compression
- Performance comparison (BLOB vs file-based)

#### 4. Jest Unit Tests

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm install  # Install dev dependencies
npm test     # Run all tests with coverage
```

**Test commands:**
- `npm test` - Run all tests with coverage report
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:watch` - Watch mode for development

**What it tests:**
- `PhotoDatabase` - Database operations, sort modes, cache management
- `CacheManager` - Cache eviction, BLOB storage, size limits
- `full-workflow` - End-to-end integration test

#### 5. Linting

```bash
npm run lint:js
```

Runs ESLint with auto-fix to ensure code quality.

### Test Configuration

Most test scripts require a configuration file. Create `test-config.json`:

```json
{
  "driveFolders": [
    {
      "id": "YOUR_FOLDER_ID_HERE",
      "depth": -1
    }
  ],
  "keyFilePath": "./google_drive_auth.json",
  "tokenPath": "./token_drive.json",
  "maxCacheSizeMB": 200,
  "useBlobStorage": true,
  "sortMode": "sequential"
}
```

### Development Workflow

1. **Setup:** Generate OAuth credentials and token
2. **Unit tests:** `npm run test:unit` (fast, no API calls)
3. **Integration tests:** `npm run test:integration` (requires API access)
4. **Standalone tests:** `node test_v3_standalone.js` (full validation)
5. **Lint:** `npm run lint:js` (ensure code quality)

### Test Output Examples

**Successful test run:**
```
[2025-02-08T12:00:00.000Z] ℹ️  TEST: Sequential Sort Mode
[2025-02-08T12:00:00.100Z] ✅ Sort mode test passed
[2025-02-08T12:00:00.200Z] ℹ️  TEST: Random Sort Mode
[2025-02-08T12:00:00.300Z] ✅ Sort mode test passed
```

**Failed authentication:**
```
❌ Error: Authentication failed
   Check google_drive_auth.json and token_drive.json
```

---

## Additional Documentation

- **[Installation Guide](INSTALL.md)** - Detailed step-by-step installation
- **[BLOB Storage Guide](BLOB_STORAGE_GUIDE.md)** - Performance optimization with BLOB storage

---

## Requirements

- MagicMirror² v2.0.0+
- Node.js v18+
- Google Drive account
- Google Cloud project with Drive API enabled
- (Optional) Sharp for BLOB storage: `npm install sharp`

---

## Known Limitations

### V3 Does Not Support:
1. ❌ Photo filtering by date/size/ratio (planned for future)
2. ❌ Uploading photos from MagicMirror
3. ❌ Google Photos albums (use Drive folders instead)

### Future Enhancements:
- Photo filters (date range, aspect ratio)
- Extended offline mode (preserve cache)
- View statistics and favorites
- Multiple Google accounts

---

## License

MIT

---

## Credits

- Original module by [@eouia](https://github.com/eouia)
- Current maintainer: [@hermanho](https://github.com/hermanho)
- V3 Drive migration and enhancements

---

## Support

- Check the documentation above
- Review [Issues](https://github.com/YOUR_USERNAME/MMM-CloudPhotos-fork/issues)
- For Google API questions, see [Google Drive API docs](https://developers.google.com/drive)

---

**🎉 Enjoy your photos on MagicMirror!**
