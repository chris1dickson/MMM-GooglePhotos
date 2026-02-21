# MMM-CloudPhotos

Display your photos from **cloud storage providers** on [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror).

## ☁️ Supported Providers

- ✅ **Google Drive** - [Setup Guide](docs/GOOGLE_DRIVE_SETUP.md)
- ✅ **OneDrive** - [Setup Guide](docs/ONEDRIVE_SETUP.md)
- 🔄 **Dropbox, iCloud** - Coming soon

## ✨ Key Features

- 🖼️ **Offline-first** - 200MB local cache, works without internet
- 🔄 **Auto-recovery** - Automatically reconnects when network returns
- 📊 **Connection status** - Visual indicator (☁ online, ⚠ offline, 🔄 retrying)
- ⚡ **Efficient scanning** - Uses Delta/Changes API (92% less API quota)
- 🗜️ **Smart caching** - Automatic image optimization with Sharp
- 📁 **Flexible folders** - Recursive scanning with depth control
- 🎨 **Multiple sort modes** - Sequential, random, newest, oldest

---

## 🚀 Quick Start

### 1. Install Module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/chris1dickson/MMM-CloudPhotos.git
cd MMM-CloudPhotos
npm install
```

### 2. Setup Cloud Provider

Choose your provider:
- **Google Drive**: Follow [Google Drive Setup Guide](docs/GOOGLE_DRIVE_SETUP.md)
- **OneDrive**: Follow [OneDrive Setup Guide](docs/ONEDRIVE_SETUP.md)

### 3. Configure MagicMirror

Add to `config/config.js`:

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    // Google Drive:
    provider: "google-drive",
    driveFolders: [
      { id: "YOUR_FOLDER_ID", depth: -1 }
    ],

    // OR OneDrive:
    // provider: "onedrive",
    // folders: [
    //   { id: "YOUR_FOLDER_ID", depth: -1 }
    // ],

    updateInterval: 60000,  // Change photo every 60 seconds
    showWidth: 1920,
    showHeight: 1080
  }
}
```

### 4. Restart MagicMirror

```bash
pm2 restart MagicMirror
```

---

## 📖 Documentation

- **[Configuration Guide](docs/CONFIGURATION.md)** - All configuration options explained
- **[Google Drive Setup](docs/GOOGLE_DRIVE_SETUP.md)** - Complete Google Drive setup
- **[OneDrive Setup](docs/ONEDRIVE_SETUP.md)** - Complete OneDrive setup
- **[Installation Guide](docs/INSTALL.md)** - Detailed installation steps
- **[BLOB Storage Guide](docs/BLOB_STORAGE_GUIDE.md)** - Performance optimization
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Testing Guide](docs/TESTING.md)** - For developers and testing

---

## 🌐 Offline Mode & Network Recovery

MMM-CloudPhotos automatically handles network failures:

- **Boots offline**: Shows cached photos immediately, no crashes
- **Auto-retry**: Reconnects with exponential backoff (5s → 2min max)
- **Visual status**: Connection indicator in photo metadata
  - ☁ **Online** - Connected and syncing
  - ⚠ **Offline** - Showing cached photos, retrying connection
  - 🔄 **Retrying** - Currently attempting to reconnect
- **Seamless recovery**: Automatically resumes syncing when network returns

Configuration:
```javascript
config: {
  maxAuthRetries: Infinity,       // Retry forever (or set a limit)
  maxAuthBackoffMs: 120000,       // Max 2 minutes between retries
}
```

---

## ⚙️ Configuration Highlights

### Basic Options

| Option | Default | Description |
|--------|---------|-------------|
| `provider` | `"google-drive"` | Cloud provider: `"google-drive"` or `"onedrive"` |
| `driveFolders` | `[]` | Google Drive folders (array of `{id, depth}`) |
| `folders` | `[]` | OneDrive folders (array of `{id, depth}`) |
| `updateInterval` | `60000` | Photo change interval (ms) |
| `showWidth` | `1920` | Display width (px) |
| `showHeight` | `1080` | Display height (px) |

### Advanced Options

| Option | Default | Description |
|--------|---------|-------------|
| `sortMode` | `"sequential"` | Sort mode: `sequential`, `random`, `newest`, `oldest` |
| `maxCacheSizeMB` | `200` | Maximum cache size (~5-6 hours offline) |
| `scanInterval` | `21600000` | Scan for new photos (6 hours) |
| `useBlobStorage` | `true` | Store images in SQLite (requires Sharp) |
| `maxAuthRetries` | `Infinity` | Authentication retry attempts |
| `maxAuthBackoffMs` | `120000` | Max retry backoff (2 minutes) |

**[→ See all configuration options](docs/CONFIGURATION.md)**

---

## 🎯 Example Configurations

### Multiple Folders
```javascript
config: {
  driveFolders: [
    { id: "1a2b3c", depth: -1 },  // Family (all subfolders)
    { id: "2b3c4d", depth: 0 },   // Vacation (no subfolders)
    { id: null, depth: 1 }         // Drive root (1 level)
  ]
}
```

### Sort by Newest Photos
```javascript
config: {
  sortMode: "newest",
  updateInterval: 120000  // 2 minutes per photo
}
```

### Large Offline Cache
```javascript
config: {
  maxCacheSizeMB: 1000,    // 1GB cache
  scanInterval: 86400000   // Scan once per day
}
```

---

## 🔧 Troubleshooting

**Module not loading?**
- Check logs: `pm2 logs MagicMirror`
- Verify OAuth credentials exist
- See [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

**No photos appearing?**
- Verify folder ID is correct
- Check folder contains image files
- Review [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

**Authentication errors?**
```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
rm token_*.json
node generate_drive_token.js  # or generate_onedrive_token.js
```

---

## 📊 How It Works

```
Cloud Storage (Drive/OneDrive)
    ↓
Provider scans folders (with depth control)
    ↓
PhotoDatabase stores metadata (SQLite)
    ↓
CacheManager downloads photos (batch, background)
    ↓
Display shows photos (from cache, instant)
```

**Key Features:**
- **Incremental scanning**: Only fetches changes (92% API savings)
- **Smart caching**: Downloads 5 photos/30s, auto-evicts old photos
- **Network resilient**: Continues showing photos during outages
- **API efficient**: ~270 calls/day (1.67% of free tier)

---

## 🧪 Testing

Run tests to verify installation:

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm test                      # Jest unit tests
node quick-test.js            # Quick integration test
node test_v3_standalone.js    # Comprehensive test
```

See [Testing Guide](docs/TESTING.md) for details.

---

## 📋 Requirements

- MagicMirror² v2.0.0+
- Node.js v18+
- Google Drive or OneDrive account
- (Optional) Sharp for image optimization: `npm install sharp`

---

## 📝 License

MIT

---

## 👏 Credits

- Original: [@eouia](https://github.com/eouia)
- Previous: [@hermanho](https://github.com/hermanho)
- Current: [@chris1dickson](https://github.com/chris1dickson)

---

## 💬 Support

- [Documentation](docs/)
- [Issues](https://github.com/chris1dickson/MMM-CloudPhotos/issues)
- [Google Drive API Docs](https://developers.google.com/drive)

---

**🎉 Enjoy your photos on MagicMirror!**
