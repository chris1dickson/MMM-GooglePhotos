# Module Refactor Plan: MMM-GooglePhotos → MMM-CloudPhotos

## Overview

Rename and refactor the module to support multiple cloud storage providers, starting with Google Drive and enabling future support for OneDrive, Dropbox, iCloud Photos, etc.

## Goals

1. **Provider-agnostic architecture** - Abstract cloud storage operations into a provider interface
2. **Clean naming** - Remove Google-specific branding from module name
3. **Extensibility** - Easy to add new cloud providers in the future
4. **No backward compatibility** - Clean break (new module, fresh setup)

## Architecture Design

### 1. Provider Interface (BaseProvider)

All cloud providers implement this interface:

```javascript
class BaseProvider {
  constructor(config, logger)

  // Authentication & Initialization
  async initialize()

  // Photo Discovery
  async scanFolder(folderId, depth, recursive)

  // Photo Download
  async downloadPhoto(photoId, options)

  // Incremental Sync (optional)
  async getChanges(changeToken)
  async getStartPageToken()

  // Metadata
  getProviderName()
}
```

### 2. Provider Registry & Factory

```javascript
// components/providers/ProviderFactory.js
const PROVIDERS = {
  'google-drive': () => require('./GoogleDriveProvider'),
  'onedrive': () => require('./OneDriveProvider'),      // Future
  'dropbox': () => require('./DropboxProvider'),        // Future
  'icloud': () => require('./iCloudProvider')           // Future
};

function createProvider(providerName, config, logger) {
  const ProviderClass = PROVIDERS[providerName]();
  return new ProviderClass(config, logger);
}
```

### 3. Configuration Structure

**New Config Format:**

```javascript
{
  module: "MMM-CloudPhotos",
  position: "fullscreen_below",
  config: {
    // Provider Selection
    provider: "google-drive",  // NEW: Which cloud provider to use

    // Provider-Specific Config
    providerConfig: {
      // For Google Drive
      keyFilePath: "./google_auth.json",
      tokenFilePath: "./token_drive.json",
      driveFolders: [
        { id: "folder_id_here", depth: 2 }
      ],

      // For OneDrive (future)
      // clientId: "...",
      // clientSecret: "...",
      // folders: [...]
    },

    // Universal Settings (work for all providers)
    showWidth: 1920,
    showHeight: 1080,
    updateInterval: 300000,
    useBlobStorage: true,
    maxCacheSizeMB: 200,
    jpegQuality: 85,
    sortMode: "random"
  }
}
```

### 4. Directory Structure

```
MMM-CloudPhotos/
├── MMM-CloudPhotos.js          (renamed from MMM-GooglePhotos.js)
├── MMM-CloudPhotos.css         (renamed)
├── node_helper.js              (updated imports)
├── package.json                (updated name/description)
│
├── components/
│   ├── providers/
│   │   ├── BaseProvider.js           (NEW - abstract interface)
│   │   ├── ProviderFactory.js        (NEW - provider registry/factory)
│   │   ├── GoogleDriveProvider.js    (refactored from GDriveAPI.js)
│   │   ├── OneDriveProvider.js       (FUTURE - stub/placeholder)
│   │   └── DropboxProvider.js        (FUTURE - stub/placeholder)
│   │
│   ├── PhotoDatabase.js        (no changes needed)
│   └── CacheManager.js         (updated to use provider interface)
│
├── tests/
│   ├── unit/
│   │   ├── PhotoDatabase.test.js
│   │   ├── CacheManager.test.js
│   │   └── GoogleDriveProvider.test.js  (renamed from GDriveAPI.test.js)
│   └── integration/
│       └── full-workflow.test.js
│
├── docs/
│   ├── PROVIDERS.md            (NEW - guide for adding providers)
│   └── PROVIDER_COMPARISON.md  (NEW - compare cloud providers)
│
├── README.md                   (updated branding/docs)
├── BLOB_STORAGE_GUIDE.md       (updated references)
└── CHANGELOG.md                (NEW - document breaking changes)
```

## Implementation Steps

### Phase 1: Provider Abstraction (Core Architecture)

1. **Create BaseProvider interface**
   - `components/providers/BaseProvider.js`
   - Define abstract methods all providers must implement
   - Document expected return formats

2. **Create ProviderFactory**
   - `components/providers/ProviderFactory.js`
   - Provider registry
   - Factory method for instantiation
   - Error handling for unknown providers

3. **Refactor GDriveAPI → GoogleDriveProvider**
   - Move `components/GDriveAPI.js` → `components/providers/GoogleDriveProvider.js`
   - Extend BaseProvider
   - Keep existing implementation
   - Update method signatures to match interface

### Phase 2: Module Rename (Branding)

4. **Rename main module files**
   - `MMM-GooglePhotos.js` → `MMM-CloudPhotos.js`
   - `MMM-GooglePhotos.css` → `MMM-CloudPhotos.css`
   - Update `Module.register("MMM-CloudPhotos", ...)`

5. **Update package.json**
   - Name: `mmm-cloudphotos`
   - Description: "MagicMirror module for displaying photos from cloud storage"
   - Update keywords

6. **Update all internal references**
   - Log messages: `[GPHOTOS-V3]` → `[CLOUDPHOTOS]`
   - CSS classes: `.MMM-GooglePhotos` → `.MMM-CloudPhotos`
   - File paths and imports

### Phase 3: Integration (Wire Everything Together)

7. **Update node_helper.js**
   - Import ProviderFactory
   - Use `createProvider(config.provider, config.providerConfig, log)`
   - Remove direct GDriveAPI imports

8. **Update CacheManager.js**
   - Accept generic `photoProvider` instead of `driveAPI`
   - Update variable names: `this.driveAPI` → `this.photoProvider`
   - Keep same download logic (provider interface is compatible)

9. **Update configuration examples**
   - Create example configs for Google Drive
   - Create placeholder configs for future providers
   - Update README with new config structure

### Phase 4: Documentation (User-Facing)

10. **Update README.md**
    - Change all "MMM-GooglePhotos" → "MMM-CloudPhotos"
    - Update installation instructions
    - Document `provider` config option
    - Add "Supported Providers" section

11. **Update BLOB_STORAGE_GUIDE.md**
    - Update module name references
    - Keep technical content unchanged

12. **Create CHANGELOG.md**
    - Document breaking changes from v2 → v3
    - Note module rename
    - No migration guide needed (user confirmed)

13. **Create provider documentation**
    - `docs/PROVIDERS.md` - Guide for adding new providers
    - `docs/PROVIDER_COMPARISON.md` - Compare features of different providers

### Phase 5: Testing (Validation)

14. **Update test suite**
    - Rename test files
    - Update imports
    - Mock BaseProvider interface
    - Verify all 40 tests still pass

15. **Create provider-specific tests**
    - `tests/unit/GoogleDriveProvider.test.js`
    - Test provider interface compliance

### Phase 6: Future Provider Stubs (Optional)

16. **Create provider stubs**
    - `OneDriveProvider.js` with TODO comments
    - `DropboxProvider.js` with TODO comments
    - Document what needs implementation

## Breaking Changes

### For Users

- **Module name**: `MMM-GooglePhotos` → `MMM-CloudPhotos`
- **Config structure**: New `provider` and `providerConfig` fields
- **Repository**: GitHub repo renamed to match

### For Developers

- **File locations**: `GDriveAPI.js` moved to `providers/GoogleDriveProvider.js`
- **Class names**: `GDriveAPI` → `GoogleDriveProvider`
- **Import paths**: Updated throughout codebase

## Migration Notes

**User Decision**: No migration guide needed. This is treated as a new module with fresh setup.

Users will need to:
1. Remove old `MMM-GooglePhotos` module
2. Install new `MMM-CloudPhotos` module
3. Update config with new structure
4. Restart MagicMirror

## Future Provider Roadmap

### Potential Providers to Add

1. **Microsoft OneDrive** - OAuth 2.0, Microsoft Graph API
2. **Dropbox** - OAuth 2.0, Dropbox API v2
3. **iCloud Photos** - Complex (requires iCloud login)
4. **Amazon Photos** - Amazon Drive API
5. **Local Filesystem** - Simple file scanner
6. **SMB/NAS** - Network share support

### Provider Feature Matrix

| Provider | Auth Type | Incremental Sync | Metadata | Difficulty |
|----------|-----------|------------------|----------|------------|
| Google Drive | OAuth 2.0 | ✅ Changes API | ✅ Rich | Easy (done) |
| OneDrive | OAuth 2.0 | ✅ Delta API | ✅ Rich | Medium |
| Dropbox | OAuth 2.0 | ✅ Delta API | ✅ Good | Medium |
| iCloud | Apple ID | ⚠️ Limited | ⚠️ Basic | Hard |
| Local | None | ⚠️ File watch | ⚠️ EXIF | Easy |

## Success Criteria

- ✅ Module renamed throughout codebase
- ✅ Provider interface abstraction complete
- ✅ Google Drive provider fully functional
- ✅ All 40 tests passing
- ✅ Documentation updated
- ✅ Clear path for adding future providers

## Timeline

Estimated effort: **4-6 hours**

- Phase 1: 1.5 hours
- Phase 2: 0.5 hours
- Phase 3: 1 hour
- Phase 4: 1 hour
- Phase 5: 1 hour
- Phase 6: 0.5 hours

---

**Status**: Planning phase - Ready to begin implementation
