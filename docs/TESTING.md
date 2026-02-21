# Testing Guide

Guide for testing and developing MMM-CloudPhotos.

---

## Table of Contents

- [Quick Test](#quick-test)
- [Unit Tests](#unit-tests)
- [Integration Tests](#integration-tests)
- [Manual Testing](#manual-testing)
- [Test Scripts](#test-scripts)
- [Development Workflow](#development-workflow)

---

## Quick Test

Fastest way to verify your setup is working.

### Run Quick Test

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node quick-test.js
```

### What It Tests

1. ✅ OAuth credentials exist
2. ✅ OAuth token exists
3. ✅ Google Drive API authentication
4. ✅ Folder scanning (finds photos)
5. ✅ Database operations
6. ✅ Cache manager initialization
7. ✅ Photo downloads
8. ✅ Geocoding (if photos have location data)
9. ✅ Display logic

### Expected Output

```
╔════════════════════════════════════════════════════════════╗
║     MMM-GooglePhotos V3 - Quick Test                      ║
║     Testing with Your Google Drive Folder                 ║
╚════════════════════════════════════════════════════════════╝

[0] Checking Prerequisites
✅ OAuth credentials found
✅ OAuth token found

[1] Initializing Database
✅ Database initialized

[2] Authenticating with Google Drive API
✅ Successfully authenticated

[3] Scanning Your Google Drive Folder
✅ Found 1762 photos in 3.46 seconds

[4] Saving Photos to Database
✅ Database has 10 photos

[5] Initializing Cache Manager
✅ Cache manager ready

[6] Downloading Photos to Cache
✅ Downloaded: IMG_20150531_123951.jpg
✅ Downloaded: IMG_20150531_124819.jpg
✅ Downloaded: IMG_20150531_124829.jpg
✅ 3 photos cached successfully

[7] Cache Statistics
📊 Cache Stats:
  Size: 0.19 MB / 200 MB (0.1%)
  Photos: 3 / 10 (30.0%)
  Status: 🟢 Online

[8] Testing Display Logic
✅ Next photo to display: IMG_20150531_124819.jpg

[9] Validating Metadata
✅ Has creation time
✅ Has location data
✅ Has geocoded location: Singapore, Singapore
```

---

## Unit Tests

Automated tests using Jest.

### Run All Tests

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm test
```

### Run Specific Test Suite

```bash
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:watch         # Watch mode for development
```

### What's Tested

**PhotoDatabase (19 tests):**
- Database initialization and recovery
- Photo CRUD operations
- Cache management
- Display logic and sorting
- Settings persistence

**CacheManager (16 tests):**
- Cache initialization
- Download operations with retry
- Batch downloads
- Cache eviction
- Graceful degradation (offline mode)

**Integration (5 tests):**
- Full workflow: Add → Cache → Display
- Cache eviction workflow
- Incremental caching
- Display rotation
- Failure recovery

### Coverage Report

After running tests, view coverage:
```bash
cat coverage/lcov-report/index.html
```

### Expected Results

```
PASS tests/unit/PhotoDatabase.test.js
PASS tests/integration/full-workflow.test.js
PASS tests/unit/CacheManager.test.js

Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        38.226 s
```

---

## Integration Tests

Test real cloud provider integration.

### Comprehensive Test

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
node test_v3_standalone.js
```

### What It Tests

1. Google Drive authentication
2. Folder scanning (depth control)
3. Photo database operations
4. Cache manager (file & BLOB modes)
5. All 4 sort modes (sequential, random, newest, oldest)
6. Changes API (incremental sync)
7. Image processing and optimization

### Expected Output

```
============================================================
TEST: Sequential Sort Mode
============================================================
✅ ✅ PASS (67ms)

============================================================
TEST: Random Sort Mode
============================================================
✅ ✅ PASS (71ms)

============================================================
TEST: Newest Sort Mode
============================================================
✅ ✅ PASS (67ms)

============================================================
TEST: Oldest Sort Mode
============================================================
✅ ✅ PASS (66ms)

============================================================
TEST SUMMARY
============================================================
Total Tests: 20
✅ Passed: 20
❌ Failed: 0
⏱️  Total Time: 24.70s
============================================================
```

---

## Manual Testing

### Test BLOB Storage

```bash
node test_blob_storage.js
```

Tests:
- Sharp library installation
- BLOB schema creation
- Image processing and storage
- Retrieval performance
- Storage comparison

### Test File Resize

```bash
node test_file_resize.js
```

Tests:
- Image download
- Sharp resizing
- File-based caching
- Dimension verification

### Test Metadata Fallback

```bash
node test_metadata_fallback.js
```

Tests:
- Display logic with/without time
- Display logic with/without location
- Filename fallback behavior

### Test OneDrive (if configured)

```bash
node test_onedrive.js
```

Tests:
- OneDrive authentication
- Folder scanning
- Delta API sync
- Token refresh

---

## Test Scripts

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Quick Test | `node quick-test.js` | Fast validation of setup |
| Comprehensive | `node test_v3_standalone.js` | Full test suite |
| Unit Tests | `npm test` | Jest unit tests |
| BLOB Storage | `node test_blob_storage.js` | BLOB storage validation |
| File Resize | `node test_file_resize.js` | Image processing test |
| Metadata | `node test_metadata_fallback.js` | Metadata display logic |
| OneDrive | `node test_onedrive.js` | OneDrive integration |
| Lint | `npm run lint:js` | Code quality check |

### Test Configuration

Most scripts use `test-config.json`:

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

Create from example:
```bash
cp test-config.json.example test-config.json
# Edit test-config.json with your folder ID
```

---

## Development Workflow

### 1. Setup Development Environment

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
npm install
```

### 2. Make Changes

Edit code in:
- `node_helper.js` - Backend logic
- `MMM-CloudPhotos.js` - Frontend logic
- `components/` - Core components

### 3. Run Linter

```bash
npm run lint:js
```

Fix any issues before committing.

### 4. Run Unit Tests

```bash
npm run test:unit
```

Ensure all tests pass.

### 5. Test Manually

```bash
node quick-test.js
```

Verify your changes work with real cloud providers.

### 6. Test in MagicMirror

```bash
pm2 restart MagicMirror
pm2 logs MagicMirror
```

Watch for errors or unexpected behavior.

### 7. Run Full Test Suite

```bash
npm test
node test_v3_standalone.js
```

Ensure nothing broke.

---

## Debugging Tests

### Enable Debug Logging

```javascript
// In test scripts
const logger = (...args) => console.log(...args);  // Verbose logging
```

### Check Test Database

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
sqlite3 cache/test_photos.db

# View tables
.tables

# View photo count
SELECT COUNT(*) FROM photos;

# View cached photos
SELECT id, filename, cached_at FROM photos WHERE cached_at IS NOT NULL;

# Exit
.quit
```

### Clean Test Artifacts

```bash
cd ~/MagicMirror/modules/MMM-CloudPhotos
rm -rf cache/test_*
```

### Run Single Test File

```bash
npx jest tests/unit/PhotoDatabase.test.js
```

### Run Single Test

```bash
npx jest -t "should save a photo"
```

---

## Continuous Integration

### Pre-commit Checks

Before committing:
```bash
npm run lint:js
npm test
```

### GitHub Actions (if configured)

Automatically runs on push:
- Linting
- Unit tests
- Integration tests (if credentials provided)

---

## Test Coverage

### Generate Coverage Report

```bash
npm test -- --coverage
```

### View HTML Report

```bash
open coverage/lcov-report/index.html
```

### Coverage Goals

- **Statements**: 70%+
- **Branches**: 70%+
- **Functions**: 70%+
- **Lines**: 70%+

---

## Writing New Tests

### Unit Test Example

```javascript
// tests/unit/MyComponent.test.js
describe('MyComponent', () => {
  it('should do something', async () => {
    const component = new MyComponent();
    const result = await component.doSomething();
    expect(result).toBe(expected);
  });
});
```

### Integration Test Example

```javascript
// tests/integration/my-workflow.test.js
describe('My Workflow', () => {
  it('should complete workflow', async () => {
    // Setup
    const db = new PhotoDatabase(':memory:');
    await db.initialize();

    // Execute
    await db.savePhotos(photos);
    const result = await db.getNextPhoto();

    // Verify
    expect(result).toBeDefined();

    // Cleanup
    await db.close();
  });
});
```

---

## Troubleshooting Tests

### "Authentication failed" in tests

Regenerate token:
```bash
rm token_drive.json
node generate_drive_token.js
```

### "Cannot find module 'sharp'"

Install Sharp:
```bash
npm install sharp
```

### Tests timing out

Increase timeout in test:
```javascript
jest.setTimeout(30000);  // 30 seconds
```

### Database locked errors

Clean test databases:
```bash
rm -rf cache/test_*.db*
```

---

## Next Steps

- [Configuration Guide](CONFIGURATION.md) - All configuration options
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues
- [README](../README.md) - Back to main documentation
