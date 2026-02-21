# Configuration Guide

Complete reference for all MMM-CloudPhotos configuration options.

---

## Table of Contents

- [Provider Selection](#provider-selection)
- [Folder Configuration](#folder-configuration)
- [Display Settings](#display-settings)
- [Cache & Storage](#cache--storage)
- [Network & Offline Mode](#network--offline-mode)
- [Authentication](#authentication)
- [Sort Modes](#sort-modes)
- [Advanced Options](#advanced-options)
- [Complete Example](#complete-example)

---

## Provider Selection

### `provider`
- **Type**: String
- **Default**: `"google-drive"`
- **Options**: `"google-drive"`, `"onedrive"`
- **Description**: Cloud storage provider to use

```javascript
config: {
  provider: "google-drive"  // or "onedrive"
}
```

---

## Folder Configuration

### Google Drive Folders

#### `driveFolders`
- **Type**: Array of Objects
- **Default**: `[]`
- **Required**: Yes (for Google Drive)
- **Description**: Array of Google Drive folders to scan for photos

**Object Structure:**
```javascript
{
  id: String|null,   // Folder ID from Drive URL (null = Drive root)
  depth: Number      // Scan depth (-1 = infinite, 0 = folder only, N = N levels)
}
```

**Examples:**
```javascript
// Single folder, all subfolders
driveFolders: [
  { id: "1a2b3c4d5e6f7g8h9i0j", depth: -1 }
]

// Multiple folders with different depths
driveFolders: [
  { id: "1a2b3c", depth: -1 },  // Family (all subfolders)
  { id: "2b3c4d", depth: 0 },   // Vacation (no subfolders)
  { id: null, depth: 1 }         // Drive root (1 level deep)
]
```

### OneDrive Folders

#### `folders`
- **Type**: Array of Objects
- **Default**: `[]`
- **Required**: Yes (for OneDrive)
- **Description**: Array of OneDrive folders to scan for photos

**Object Structure:**
```javascript
{
  id: String|null,   // Folder ID from OneDrive (null = OneDrive root)
  depth: Number      // Scan depth (-1 = infinite, 0 = folder only, N = N levels)
}
```

**Example:**
```javascript
folders: [
  { id: "YOUR_ONEDRIVE_FOLDER_ID", depth: -1 }
]
```

---

## Display Settings

### `updateInterval`
- **Type**: Number (milliseconds)
- **Default**: `60000` (60 seconds)
- **Minimum**: `10000` (10 seconds)
- **Description**: How often to change photos

```javascript
updateInterval: 60000,   // 1 minute
updateInterval: 120000,  // 2 minutes
updateInterval: 300000,  // 5 minutes
```

### `showWidth`
- **Type**: Number (pixels)
- **Default**: `1920`
- **Description**: Display width for photos (images resized to fit)

```javascript
showWidth: 1920,   // Full HD landscape
showWidth: 1080,   // HD portrait
showWidth: 3840,   // 4K
```

### `showHeight`
- **Type**: Number (pixels)
- **Default**: `1080`
- **Description**: Display height for photos (images resized to fit)

```javascript
showHeight: 1080,  // Landscape mode (16:9) - default
showHeight: 1200,  // Landscape mode (16:10)
showHeight: 1920,  // Portrait mode
```

### `timeFormat`
- **Type**: String
- **Default**: `"relative"`
- **Options**: `"relative"` or any moment.js format string
- **Description**: Time format for photo metadata

```javascript
timeFormat: "relative",           // "3 years ago"
timeFormat: "YYYY/MM/DD HH:mm",  // "2024/12/25 14:30"
timeFormat: "MMM DD, YYYY",       // "Dec 25, 2024"
```

### `autoInfoPosition`
- **Type**: Boolean or Function
- **Default**: `false`
- **Description**: Auto-reposition photo info to prevent screen burn-in

```javascript
autoInfoPosition: false,  // Fixed position
autoInfoPosition: true,   // Auto-move to prevent burn-in
```

---

## Cache & Storage

### `maxCacheSizeMB`
- **Type**: Number (megabytes)
- **Default**: `200`
- **Description**: Maximum cache size (~5-6 hours offline with default settings)

```javascript
maxCacheSizeMB: 200,   // Default (~5-6 hours)
maxCacheSizeMB: 500,   // ~12-15 hours
maxCacheSizeMB: 1000,  // ~24-30 hours (1GB)
```

### `scanInterval`
- **Type**: Number (milliseconds)
- **Default**: `21600000` (6 hours)
- **Description**: How often to scan cloud storage for new photos

```javascript
scanInterval: 21600000,   // 6 hours (default)
scanInterval: 43200000,   // 12 hours
scanInterval: 86400000,   // 24 hours (once per day)
scanInterval: 3600000,    // 1 hour (for frequent updates)
```

### `useBlobStorage`
- **Type**: Boolean
- **Default**: `true`
- **Requires**: Sharp library (`npm install sharp`)
- **Description**: Store processed images as BLOBs in SQLite database

**Benefits:**
- 50% fewer I/O operations
- Better cache efficiency
- Reduced SD card wear
- Faster image loading

```javascript
useBlobStorage: true,   // Store in database (recommended)
useBlobStorage: false,  // Store as files in cache/images/
```

### `jpegQuality` / `blobQuality`
- **Type**: Number (1-100)
- **Default**: `85`
- **Requires**: Sharp library and `useBlobStorage: true`
- **Description**: JPEG compression quality

```javascript
jpegQuality: 85,  // Default (good balance)
jpegQuality: 95,  // Higher quality, larger files
jpegQuality: 70,  // Lower quality, smaller files
```

---

## Network & Offline Mode

### `maxAuthRetries`
- **Type**: Number or `Infinity`
- **Default**: `Infinity`
- **Description**: Maximum authentication retry attempts when connection fails

```javascript
maxAuthRetries: Infinity,  // Retry forever (recommended)
maxAuthRetries: 10,        // Stop after 10 attempts
maxAuthRetries: 0,         // No retries (not recommended)
```

### `maxAuthBackoffMs`
- **Type**: Number (milliseconds)
- **Default**: `120000` (2 minutes)
- **Description**: Maximum backoff time between authentication retries

**Retry Pattern**: 5s → 10s → 20s → 40s → 80s → 120s (max) → 120s → ...

```javascript
maxAuthBackoffMs: 120000,  // 2 minutes max (default)
maxAuthBackoffMs: 300000,  // 5 minutes max
maxAuthBackoffMs: 60000,   // 1 minute max
```

**How It Works:**
- Boots without internet: Shows cached photos, retries in background
- Network drops after auth: Automatically detects and reconnects
- Visual status indicator: ☁ online, ⚠ offline, 🔄 retrying

---

## Authentication

### Google Drive

#### `keyFilePath`
- **Type**: String (path)
- **Default**: `"./google_drive_auth.json"`
- **Description**: Path to Google OAuth credentials file

```javascript
keyFilePath: "./google_drive_auth.json",                    // Relative to module
keyFilePath: "/home/pi/creds/google_drive_auth.json",       // Absolute path
```

#### `tokenPath`
- **Type**: String (path)
- **Default**: `"./token_drive.json"`
- **Description**: Path to Google OAuth token file

```javascript
tokenPath: "./token_drive.json",                     // Relative to module
tokenPath: "/home/pi/creds/token_drive.json",        // Absolute path
```

### OneDrive

#### `clientId`
- **Type**: String
- **Required**: Yes (for OneDrive)
- **Description**: Azure App Client ID

```javascript
clientId: "YOUR_AZURE_CLIENT_ID"
```

#### `clientSecret`
- **Type**: String
- **Required**: Yes (for OneDrive)
- **Description**: Azure App Client Secret

```javascript
clientSecret: "YOUR_AZURE_CLIENT_SECRET"
```

#### `tokenPath` (OneDrive)
- **Type**: String (path)
- **Default**: `"./token_onedrive.json"`
- **Description**: Path to OneDrive OAuth token file

```javascript
tokenPath: "./token_onedrive.json"
```

---

## Sort Modes

### `sortMode`
- **Type**: String
- **Default**: `"sequential"`
- **Options**: `"sequential"`, `"random"`, `"newest"`, `"oldest"`
- **Description**: How to order photos for display

#### Sequential (Default)
Deterministic order by photo ID. Shows photos in consistent order, prioritizes unviewed photos.

```javascript
sortMode: "sequential"
```

#### Random
Random order each cycle. Prioritizes unviewed photos, then randomizes viewed photos.

```javascript
sortMode: "random"
```

#### Newest First
Shows newest photos first by creation/upload date.

```javascript
sortMode: "newest"
```

#### Oldest First
Shows oldest photos first by creation/upload date.

```javascript
sortMode: "oldest"
```

**Note:** All modes prioritize unviewed photos before showing viewed photos again.

---

## Advanced Options

### `debug`
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable verbose logging for troubleshooting

```javascript
debug: true  // Detailed logs
```

### Provider-Specific Config

You can pass provider-specific configuration:

```javascript
config: {
  provider: "google-drive",
  providerConfig: {
    keyFilePath: "./custom_auth.json",
    tokenPath: "./custom_token.json",
    driveFolders: [{ id: "...", depth: -1 }]
  }
}
```

---

## Complete Example

### Google Drive - Full Configuration

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    // Provider
    provider: "google-drive",

    // Folders
    driveFolders: [
      { id: "1a2b3c4d5e6f7g8h9i0j", depth: -1 },  // Family photos
      { id: "2b3c4d5e6f7g8h9i0j1k", depth: 0 }    // Vacation
    ],

    // Display
    updateInterval: 60000,
    showWidth: 1920,
    showHeight: 1200,
    timeFormat: "relative",
    autoInfoPosition: true,

    // Cache & Storage
    maxCacheSizeMB: 500,
    scanInterval: 43200000,      // 12 hours
    useBlobStorage: true,
    jpegQuality: 85,

    // Network & Offline
    maxAuthRetries: Infinity,
    maxAuthBackoffMs: 120000,

    // Sort
    sortMode: "newest",

    // Auth (optional, defaults shown)
    keyFilePath: "./google_drive_auth.json",
    tokenPath: "./token_drive.json",

    // Debug
    debug: false
  }
}
```

### OneDrive - Full Configuration

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    // Provider
    provider: "onedrive",

    // Auth
    clientId: "YOUR_AZURE_CLIENT_ID",
    clientSecret: "YOUR_AZURE_CLIENT_SECRET",
    tokenPath: "./token_onedrive.json",

    // Folders
    folders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ],

    // Display
    updateInterval: 60000,
    showWidth: 1920,
    showHeight: 1200,

    // Cache
    maxCacheSizeMB: 200,
    scanInterval: 21600000,
    useBlobStorage: true,

    // Network
    maxAuthRetries: Infinity,
    maxAuthBackoffMs: 120000,

    // Sort
    sortMode: "sequential"
  }
}
```

---

## Minimal Configurations

### Google Drive - Minimal
```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    driveFolders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ]
  }
}
```

### OneDrive - Minimal
```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    provider: "onedrive",
    clientId: "YOUR_CLIENT_ID",
    clientSecret: "YOUR_CLIENT_SECRET",
    folders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ]
  }
}
```

---

## Performance Tuning

### For Raspberry Pi
```javascript
config: {
  useBlobStorage: true,      // Reduce SD card wear
  maxCacheSizeMB: 200,       // Conservative cache
  scanInterval: 43200000,    // Scan twice per day
  jpegQuality: 80            // Lower quality = faster
}
```

### For Large Collections (10K+ photos)
```javascript
config: {
  driveFolders: [
    { id: "YOUR_FOLDER", depth: 2 }  // Limit depth
  ],
  maxCacheSizeMB: 500,
  scanInterval: 86400000    // Scan once per day
}
```

### For Maximum Offline Time
```javascript
config: {
  maxCacheSizeMB: 2000,     // 2GB cache (~60+ hours)
  scanInterval: 86400000,   // Daily scans
  useBlobStorage: true
}
```

### For Slow Networks
```javascript
config: {
  maxCacheSizeMB: 100,      // Smaller cache
  updateInterval: 120000,   // Slower photo changes
  jpegQuality: 75          // More compression
}
```

---

## Next Steps

- [Google Drive Setup](GOOGLE_DRIVE_SETUP.md) - Setup guide
- [OneDrive Setup](ONEDRIVE_SETUP.md) - Setup guide
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues
- [README](../README.md) - Back to main documentation
