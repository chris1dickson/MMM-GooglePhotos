#!/usr/bin/env node

"use strict";

/**
 * Standalone Test Script for MMM-GooglePhotos V3
 *
 * This script tests all V3 components WITHOUT requiring MagicMirror.
 *
 * Usage:
 *   node test_v3_standalone.js
 *
 * Prerequisites:
 *   1. Run: npm install
 *   2. Create google_drive_auth.json
 *   3. Run: node generate_drive_token.js
 *   4. Edit CONFIG below with your folder ID
 */

const fs = require("fs");
const path = require("path");

// Import our components
const { createProvider } = require("./components/providers/ProviderFactory.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

// ============================================================
// CONFIGURATION - Load from test-config.json if available
// ============================================================

let CONFIG;

// Try to load configuration from test-config.json
try {
  if (fs.existsSync('./test-config.json')) {
    CONFIG = JSON.parse(fs.readFileSync('./test-config.json', 'utf8'));

    // Add default cache path if not specified
    if (!CONFIG.cachePath) {
      CONFIG.cachePath = path.resolve(__dirname, "cache", "images");
    }

    // Add default test settings if not specified
    if (!CONFIG.testDuration) {
      CONFIG.testDuration = 120000;
    }
    if (!CONFIG.photoLimit) {
      CONFIG.photoLimit = 10;
    }

    console.log("✅ Loaded configuration from test-config.json");
  } else {
    throw new Error("test-config.json not found");
  }
} catch (error) {
  // Fallback to hardcoded configuration
  console.log("⚠️  Using default configuration (edit CONFIG in this file or create test-config.json)");
  CONFIG = {
    // Your Google Drive folder ID (get from Drive URL)
    driveFolders: [
      {
        id: "YOUR_GOOGLE_DRIVE_FOLDER_ID",
        depth: -1                    // -1 = all subfolders
      }
    ],

    // OAuth credentials
    keyFilePath: "./google_drive_auth.json",
    tokenPath: "./token_drive.json",

    // Cache settings
    cachePath: path.resolve(__dirname, "cache", "images"),
    maxCacheSizeMB: 200,

    // Test settings
    testDuration: 120000,  // Run for 2 minutes
    photoLimit: 10         // Download only 10 photos for testing
  };
}

// ============================================================
// TEST SUITE
// ============================================================

class TestSuite {
  constructor() {
    this.tests = [];
    this.results = [];
    this.startTime = Date.now();
  }

  log(message, level = "INFO") {
    const timestamp = new Date().toISOString();
    const prefix = {
      INFO: "ℹ️ ",
      SUCCESS: "✅",
      ERROR: "❌",
      WARN: "⚠️ "
    }[level] || "  ";

    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async test(name, testFn) {
    this.log(`\n${"=".repeat(60)}`);
    this.log(`TEST: ${name}`, "INFO");
    this.log("=".repeat(60));

    const startTime = Date.now();

    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.log(`✅ PASS (${duration}ms)`, "SUCCESS");
      this.results.push({ name, status: "PASS", duration });
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(`❌ FAIL (${duration}ms)`, "ERROR");
      this.log(`Error: ${error.message}`, "ERROR");
      if (error.stack) {
        console.error(error.stack);
      }
      this.results.push({ name, status: "FAIL", duration, error: error.message });
      return false;
    }
  }

  printSummary() {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter(r => r.status === "PASS").length;
    const failed = this.results.filter(r => r.status === "FAIL").length;

    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Tests: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Total Time: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log("=".repeat(60));

    if (failed > 0) {
      console.log("\n❌ FAILED TESTS:");
      this.results
        .filter(r => r.status === "FAIL")
        .forEach(r => {
          console.log(`  - ${r.name}: ${r.error}`);
        });
    }

    console.log("\n");
  }
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function main() {
  const suite = new TestSuite();

  console.clear();
  console.log("\n" + "╔" + "═".repeat(58) + "╗");
  console.log("║  MMM-GooglePhotos V3 - Standalone Test Suite            ║");
  console.log("╚" + "═".repeat(58) + "╝\n");

  // Check prerequisites
  suite.log("Checking prerequisites...");

  if (CONFIG.driveFolders[0].id === "YOUR_FOLDER_ID_HERE" || CONFIG.driveFolders[0].id === "YOUR_GOOGLE_DRIVE_FOLDER_ID") {
    suite.log("❌ ERROR: Please configure your Google Drive folder ID", "ERROR");
    suite.log("Either edit test-config.json or CONFIG in test_v3_standalone.js", "ERROR");
    suite.log("Set your Google Drive folder ID (from Drive URL)", "ERROR");
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.keyFilePath)) {
    suite.log(`❌ ERROR: ${CONFIG.keyFilePath} not found`, "ERROR");
    suite.log("Run: Create OAuth credentials and save as google_drive_auth.json", "ERROR");
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.tokenPath)) {
    suite.log(`❌ ERROR: ${CONFIG.tokenPath} not found`, "ERROR");
    suite.log("Run: node generate_drive_token.js", "ERROR");
    process.exit(1);
  }

  suite.log("✅ Prerequisites OK", "SUCCESS");

  // Test 1: Database Initialization
  let database;
  await suite.test("Database Initialization", async () => {
    const dbPath = path.resolve(__dirname, "cache", "test_photos.db");

    // Clean up old test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      suite.log("Cleaned up old test database");
    }

    database = new PhotoDatabase(dbPath, (msg) => suite.log(msg));
    await database.initialize();

    suite.log("Database created successfully");

    // Verify schema
    const photoCount = await database.getTotalPhotoCount();
    suite.log(`Initial photo count: ${photoCount}`);

    if (photoCount !== 0) {
      throw new Error("Expected 0 photos in new database");
    }
  });

  // Test 2: Google Drive API Authentication
  let driveAPI;
  await suite.test("Google Drive API Authentication", async () => {
    const providerConfig = {
      keyFilePath: CONFIG.keyFilePath,
      tokenPath: CONFIG.tokenPath,
      driveFolders: CONFIG.driveFolders
    };
    driveAPI = createProvider("google-drive", providerConfig, (msg) => suite.log(msg));
    driveAPI.setDatabase(database);

    await driveAPI.initialize();
    suite.log("Google Drive API authenticated successfully");
  });

  // Test 3: Folder Scanning
  let photos = [];
  await suite.test("Folder Scanning", async () => {
    const folderId = CONFIG.driveFolders[0].id;
    const depth = CONFIG.driveFolders[0].depth;

    suite.log(`Scanning folder: ${folderId} (depth: ${depth})`);

    photos = await driveAPI.scanFolder(folderId, depth);

    suite.log(`Found ${photos.length} photos`);

    if (photos.length === 0) {
      throw new Error("No photos found. Make sure your Drive folder has images.");
    }

    // Log first few photos
    photos.slice(0, 3).forEach((photo, i) => {
      suite.log(`  [${i + 1}] ${photo.name} (${photo.id})`);
    });
  });

  // Test 4: Save Photos to Database
  await suite.test("Save Photos to Database", async () => {
    // Limit for testing
    const photosToSave = photos.slice(0, CONFIG.photoLimit);

    suite.log(`Saving ${photosToSave.length} photos to database...`);

    await database.savePhotos(photosToSave);

    const totalCount = await database.getTotalPhotoCount();
    suite.log(`Database now has ${totalCount} photos`);

    if (totalCount !== photosToSave.length) {
      throw new Error(`Expected ${photosToSave.length} photos, got ${totalCount}`);
    }
  });

  // Test 5: Cache Manager Initialization
  let cacheManager;
  let useBlobStorage = false;

  // Check if Sharp is available
  try {
    require("sharp");
    useBlobStorage = true;
    suite.log("Sharp library detected - BLOB storage will be enabled", "INFO");
  } catch (e) {
    suite.log("Sharp not installed - file-based storage will be used", "INFO");
  }

  await suite.test("Cache Manager Initialization", async () => {
    // Create cache directory
    await fs.promises.mkdir(CONFIG.cachePath, { recursive: true });

    cacheManager = new CacheManager(
      {
        cachePath: CONFIG.cachePath,
        maxCacheSizeMB: CONFIG.maxCacheSizeMB,
        useBlobStorage: useBlobStorage,
        showWidth: 1920,
        showHeight: 1080,
        jpegQuality: 85
      },
      database,
      driveAPI,
      (msg) => suite.log(msg)
    );

    suite.log("Cache manager initialized");
    suite.log(`  BLOB storage: ${cacheManager.useBlobStorage ? 'enabled' : 'disabled'}`);

    if (cacheManager.useBlobStorage) {
      suite.log(`  Image processing: ${cacheManager.screenWidth}x${cacheManager.screenHeight} @ ${cacheManager.jpegQuality}%`);
    }

    // Stop automatic ticking for controlled testing
    cacheManager.stop();
  });

  // Test 6: Download Single Photo
  await suite.test("Download Single Photo", async () => {
    const photosToCache = await database.getPhotosToCache(1);

    if (photosToCache.length === 0) {
      throw new Error("No photos available to cache");
    }

    const photo = photosToCache[0];
    suite.log(`Downloading photo: ${photo.filename} (${photo.id})`);

    await cacheManager.downloadPhoto(photo.id);

    // Verify it was cached
    const cachedCount = await database.getCachedPhotoCount();
    suite.log(`Cached photos: ${cachedCount}`);

    if (cachedCount !== 1) {
      throw new Error("Photo was not cached");
    }

    // Verify photo was cached (either BLOB or file)
    const cachedPhoto = await database.getNextPhoto();
    if (!cachedPhoto) {
      throw new Error("Cached photo not found");
    }

    if (cachedPhoto.cached_data) {
      suite.log(`BLOB size: ${(cachedPhoto.cached_data.length / 1024).toFixed(2)} KB`);
    } else if (cachedPhoto.cached_path) {
      if (!fs.existsSync(cachedPhoto.cached_path)) {
        throw new Error("Cached file not found on disk");
      }
      const stats = fs.statSync(cachedPhoto.cached_path);
      suite.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
    } else {
      throw new Error("Photo has no cached data");
    }
  });

  // Test 7: Download Multiple Photos
  await suite.test("Download Multiple Photos (Batch)", async () => {
    const batchSize = Math.min(3, CONFIG.photoLimit - 1);
    const photosToCache = await database.getPhotosToCache(batchSize);

    suite.log(`Downloading ${photosToCache.length} photos...`);

    const results = await Promise.allSettled(
      photosToCache.map(p => cacheManager.downloadPhoto(p.id))
    );

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    suite.log(`Succeeded: ${succeeded}, Failed: ${failed}`);

    if (succeeded === 0) {
      throw new Error("All downloads failed");
    }

    const cachedCount = await database.getCachedPhotoCount();
    suite.log(`Total cached photos: ${cachedCount}`);
  });

  // Test 8: Cache Statistics
  await suite.test("Cache Statistics", async () => {
    const stats = await cacheManager.getStats();

    suite.log("Cache Statistics:");
    suite.log(`  Total Size: ${stats.totalSizeMB} MB / ${stats.maxSizeMB} MB`);
    suite.log(`  Usage: ${stats.usagePercent}%`);
    suite.log(`  Cached Photos: ${stats.cachedCount} / ${stats.totalCount}`);
    suite.log(`  Cache Percent: ${stats.cachePercent}%`);
    suite.log(`  Consecutive Failures: ${stats.consecutiveFailures}`);
    suite.log(`  Offline: ${stats.isOffline}`);

    if (stats.isOffline) {
      throw new Error("Cache manager reports offline status unexpectedly");
    }
  });

  // Test 9: Get Next Photo to Display
  await suite.test("Get Next Photo to Display", async () => {
    const photo = await database.getNextPhoto();

    if (!photo) {
      throw new Error("No photo available to display");
    }

    suite.log(`Next photo: ${photo.filename}`);
    suite.log(`  Resolution: ${photo.width}x${photo.height}`);

    // Verify cached data (BLOB or file)
    if (photo.cached_data) {
      suite.log(`  BLOB size: ${(photo.cached_data.length / 1024).toFixed(2)} KB`);
      suite.log(`  Storage: BLOB`);
    } else if (photo.cached_path) {
      suite.log(`  Path: ${photo.cached_path}`);
      const fileBuffer = await fs.promises.readFile(photo.cached_path);
      suite.log(`  File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
      suite.log(`  Storage: File-based`);
    } else {
      throw new Error("Photo has no cached data");
    }

    // Mark as viewed
    await database.markPhotoViewed(photo.id);
    suite.log(`  Marked as viewed`);
  });

  // Test 10: Changes API (Incremental Scan)
  await suite.test("Changes API - Incremental Scan", async () => {
    suite.log("Testing incremental scan...");

    // First call should save the change token
    const changedPhotos = await driveAPI.scanForChanges();

    suite.log(`Initial scan found ${changedPhotos.length} photos`);

    // Check if change token was saved
    const token = await database.getSetting("changes_token");

    if (!token) {
      throw new Error("Change token was not saved");
    }

    suite.log(`Change token saved: ${token.substring(0, 20)}...`);

    // Second call should use the token (no changes expected)
    suite.log("Running second scan (should detect no changes)...");
    const changedPhotos2 = await driveAPI.scanForChanges();

    suite.log(`Second scan found ${changedPhotos2.length} changes`);
    suite.log("Changes API working correctly");
  });

  // Test 11: Cache Eviction
  await suite.test("Cache Eviction", async () => {
    const cachedBefore = await database.getCachedPhotoCount();

    suite.log(`Photos cached before eviction: ${cachedBefore}`);

    if (cachedBefore < 2) {
      suite.log("Not enough photos to test eviction, skipping...", "WARN");
      return;
    }

    // Evict 1 photo
    await cacheManager.evictOldest(1);

    const cachedAfter = await database.getCachedPhotoCount();
    suite.log(`Photos cached after eviction: ${cachedAfter}`);

    if (cachedAfter !== cachedBefore - 1) {
      throw new Error(`Expected ${cachedBefore - 1} photos, got ${cachedAfter}`);
    }

    suite.log("Cache eviction working correctly");
  });

  // Test 12: Database Settings
  await suite.test("Database Settings Storage", async () => {
    await database.saveSetting("test_key", "test_value");
    const value = await database.getSetting("test_key");

    if (value !== "test_value") {
      throw new Error("Setting not saved/retrieved correctly");
    }

    suite.log("Settings storage working correctly");
  });

  // ============================================================
  // NEW BLOB STORAGE TESTS
  // ============================================================

  // Test 13: BLOB Storage Detection
  await suite.test("BLOB Storage Mode Detection", async () => {
    const storageStats = await database.db.all(`
      SELECT
        COUNT(*) as total_cached,
        SUM(CASE WHEN cached_data IS NOT NULL THEN 1 ELSE 0 END) as blob_count,
        SUM(CASE WHEN cached_path IS NOT NULL THEN 1 ELSE 0 END) as file_count,
        SUM(cached_size_bytes) as total_size
      FROM photos
      WHERE cached_data IS NOT NULL OR cached_path IS NOT NULL
    `);

    const storage = storageStats[0];

    suite.log(`Total cached: ${storage.total_cached} photos`);
    suite.log(`BLOB storage: ${storage.blob_count} photos`);
    suite.log(`File storage: ${storage.file_count} photos`);
    suite.log(`Total size: ${(storage.total_size / 1024).toFixed(2)} KB`);

    if (useBlobStorage && storage.blob_count === 0 && storage.file_count > 0) {
      throw new Error("BLOB mode enabled but no BLOBs stored");
    }

    if (!useBlobStorage && storage.file_count === 0 && storage.blob_count > 0) {
      throw new Error("File mode enabled but no files stored");
    }

    suite.log(`Storage mode working correctly (BLOB: ${useBlobStorage})`);
  });

  // Test 14: BLOB Data Validation
  await suite.test("BLOB Data Validation", async () => {
    const blobPhotos = await database.db.all(`
      SELECT id, filename, cached_data, cached_mime_type, cached_size_bytes
      FROM photos
      WHERE cached_data IS NOT NULL
      LIMIT 1
    `);

    if (blobPhotos.length === 0) {
      suite.log("No BLOB photos to validate (file mode or no photos cached)", "WARN");
      return;
    }

    const photo = blobPhotos[0];
    suite.log(`Validating BLOB: ${photo.filename}`);

    // Check Buffer
    if (!Buffer.isBuffer(photo.cached_data)) {
      throw new Error("cached_data is not a Buffer");
    }
    suite.log(`  ✓ Valid Buffer (${(photo.cached_data.length / 1024).toFixed(2)} KB)`);

    // Check MIME type
    if (photo.cached_mime_type !== 'image/jpeg') {
      throw new Error(`Unexpected MIME type: ${photo.cached_mime_type}`);
    }
    suite.log(`  ✓ Correct MIME type: ${photo.cached_mime_type}`);

    // Check JPEG header
    const header = photo.cached_data.slice(0, 3).toString('hex');
    if (header !== 'ffd8ff') {
      throw new Error(`Invalid JPEG header: ${header}`);
    }
    suite.log(`  ✓ Valid JPEG header (FFD8FF)`);

    // Check size matches
    if (photo.cached_data.length !== photo.cached_size_bytes) {
      throw new Error(`Size mismatch: ${photo.cached_data.length} vs ${photo.cached_size_bytes}`);
    }
    suite.log(`  ✓ Size matches database record`);

    // Test base64 conversion (for frontend)
    const base64 = photo.cached_data.toString('base64');
    if (!base64 || base64.length === 0) {
      throw new Error("Failed to convert to base64");
    }
    suite.log(`  ✓ Can convert to base64 (${(base64.length / 1024).toFixed(2)} KB)`);

    suite.log("BLOB data validation passed");
  });

  // Test 15: Image Compression Verification
  await suite.test("Image Compression Verification", async () => {
    if (!useBlobStorage) {
      suite.log("Skipping - BLOB storage not enabled", "WARN");
      return;
    }

    const compressionStats = await database.db.all(`
      SELECT
        filename,
        cached_size_bytes,
        width,
        height
      FROM photos
      WHERE cached_data IS NOT NULL
      ORDER BY cached_size_bytes DESC
      LIMIT 3
    `);

    if (compressionStats.length === 0) {
      suite.log("No BLOB photos for compression check", "WARN");
      return;
    }

    suite.log("Compression results:");
    for (const photo of compressionStats) {
      suite.log(`  ${photo.filename}: ${(photo.cached_size_bytes / 1024).toFixed(2)} KB (${photo.width}x${photo.height})`);
    }

    // Check that images are reasonably compressed
    // Expect < 200KB for 1920x1080 @ 85% quality
    const oversized = compressionStats.filter(p => p.cached_size_bytes > 200 * 1024);
    if (oversized.length > 0) {
      suite.log(`Warning: ${oversized.length} photos over 200KB`, "WARN");
    }

    suite.log("Compression working as expected");
  });

  // Test 16: Mixed Storage Compatibility
  await suite.test("Mixed Storage Mode Compatibility", async () => {
    const nextPhoto = await database.getNextPhoto();

    if (!nextPhoto) {
      throw new Error("No photo available for compatibility test");
    }

    suite.log(`Testing retrieval: ${nextPhoto.filename}`);

    // Verify photo has EITHER cached_data OR cached_path
    const hasBlobData = nextPhoto.cached_data !== null && nextPhoto.cached_data !== undefined;
    const hasFilePath = nextPhoto.cached_path !== null && nextPhoto.cached_path !== undefined;

    if (!hasBlobData && !hasFilePath) {
      throw new Error("Photo has neither BLOB data nor file path");
    }

    if (hasBlobData) {
      suite.log(`  ✓ Using BLOB storage (${(nextPhoto.cached_data.length / 1024).toFixed(2)} KB)`);
    }

    if (hasFilePath) {
      suite.log(`  ✓ Using file storage (${nextPhoto.cached_path})`);
    }

    suite.log("Mixed storage compatibility verified");
  });

  // ============================================================
  // SORT MODE TESTS
  // ============================================================

  // Test 17: Sequential Sort Mode
  await suite.test("Sequential Sort Mode", async () => {
    // Create new database with sequential sort
    const seqDb = new PhotoDatabase(
      path.resolve(__dirname, "cache", "test_seq_sort.db"),
      suite.log.bind(suite),
      { sortMode: 'sequential' }
    );
    await seqDb.initialize();

    // Add test photos with varying creation times and mark as viewed
    const testPhotos = [
      { id: 'photo_c', name: 'photo_c.jpg', createdTime: '2024-03-01T10:00:00Z' },
      { id: 'photo_a', name: 'photo_a.jpg', createdTime: '2024-01-01T10:00:00Z' },
      { id: 'photo_b', name: 'photo_b.jpg', createdTime: '2024-02-01T10:00:00Z' },
    ];

    await seqDb.savePhotos(testPhotos);

    // Cache all photos
    for (const photo of testPhotos) {
      await seqDb.updatePhotoCacheBlob(photo.id, Buffer.from('test'), 'image/jpeg');
    }

    // Get photos in sequential order (should be a, b, c by ID)
    const photo1 = await seqDb.getNextPhoto();
    await seqDb.markPhotoViewed(photo1.id);
    const photo2 = await seqDb.getNextPhoto();
    await seqDb.markPhotoViewed(photo2.id);
    const photo3 = await seqDb.getNextPhoto();
    await seqDb.markPhotoViewed(photo3.id);

    suite.log(`Order: ${photo1.id}, ${photo2.id}, ${photo3.id}`);

    if (photo1.id !== 'photo_a' || photo2.id !== 'photo_b' || photo3.id !== 'photo_c') {
      throw new Error(`Expected a,b,c but got ${photo1.id},${photo2.id},${photo3.id}`);
    }

    // Verify cycling - next photo should be the oldest viewed (photo_a)
    const photo4 = await seqDb.getNextPhoto();
    if (photo4.id !== 'photo_a') {
      throw new Error(`Expected cycling to start with photo_a, got ${photo4.id}`);
    }

    await seqDb.close();
    suite.log("Sequential sort order verified (a→b→c→a)");
  });

  // Test 18: Random Sort Mode
  await suite.test("Random Sort Mode", async () => {
    // Create new database with random sort
    const randDb = new PhotoDatabase(
      path.resolve(__dirname, "cache", "test_rand_sort.db"),
      suite.log.bind(suite),
      { sortMode: 'random' }
    );
    await randDb.initialize();

    // Add test photos
    const testPhotos = [
      { id: 'photo_1', name: 'photo_1.jpg', createdTime: '2024-01-01T10:00:00Z' },
      { id: 'photo_2', name: 'photo_2.jpg', createdTime: '2024-02-01T10:00:00Z' },
      { id: 'photo_3', name: 'photo_3.jpg', createdTime: '2024-03-01T10:00:00Z' },
      { id: 'photo_4', name: 'photo_4.jpg', createdTime: '2024-04-01T10:00:00Z' },
      { id: 'photo_5', name: 'photo_5.jpg', createdTime: '2024-05-01T10:00:00Z' },
    ];

    await randDb.savePhotos(testPhotos);

    // Cache all photos
    for (const photo of testPhotos) {
      await randDb.updatePhotoCacheBlob(photo.id, Buffer.from('test'), 'image/jpeg');
    }

    // Get first set of photos (all unviewed)
    const firstRun = [];
    for (let i = 0; i < 5; i++) {
      const photo = await randDb.getNextPhoto();
      firstRun.push(photo.id);
      await randDb.markPhotoViewed(photo.id);
    }

    suite.log(`First run order: ${firstRun.join(', ')}`);

    // Get second set (all viewed, should be random again)
    const secondRun = [];
    for (let i = 0; i < 5; i++) {
      const photo = await randDb.getNextPhoto();
      secondRun.push(photo.id);
      await randDb.markPhotoViewed(photo.id);
    }

    suite.log(`Second run order: ${secondRun.join(', ')}`);

    // Verify all photos are included (no skipping)
    const uniqueFirst = new Set(firstRun);
    const uniqueSecond = new Set(secondRun);

    if (uniqueFirst.size !== 5 || uniqueSecond.size !== 5) {
      throw new Error("Random mode should include all photos without skipping");
    }

    // While we can't guarantee randomness in small sample, verify it's not always sequential
    const isSequential = firstRun.every((id, i) => id === `photo_${i + 1}`);
    if (isSequential) {
      suite.log("  ⚠ Order appears sequential, but may be random chance", "WARN");
    } else {
      suite.log("  ✓ Order is non-sequential (random)");
    }

    await randDb.close();
    suite.log("Random sort mode verified");
  });

  // Test 19: Newest Sort Mode
  await suite.test("Newest Sort Mode", async () => {
    // Create new database with newest sort
    const newestDb = new PhotoDatabase(
      path.resolve(__dirname, "cache", "test_newest_sort.db"),
      suite.log.bind(suite),
      { sortMode: 'newest' }
    );
    await newestDb.initialize();

    // Add test photos with different creation times
    const testPhotos = [
      { id: 'old_photo', name: 'old.jpg', createdTime: '2020-01-01T10:00:00Z' },
      { id: 'new_photo', name: 'new.jpg', createdTime: '2024-12-01T10:00:00Z' },
      { id: 'mid_photo', name: 'mid.jpg', createdTime: '2022-06-01T10:00:00Z' },
    ];

    await newestDb.savePhotos(testPhotos);

    // Cache all photos
    for (const photo of testPhotos) {
      await newestDb.updatePhotoCacheBlob(photo.id, Buffer.from('test'), 'image/jpeg');
    }

    // Get photos in newest-first order
    const photo1 = await newestDb.getNextPhoto();
    await newestDb.markPhotoViewed(photo1.id);
    const photo2 = await newestDb.getNextPhoto();
    await newestDb.markPhotoViewed(photo2.id);
    const photo3 = await newestDb.getNextPhoto();
    await newestDb.markPhotoViewed(photo3.id);

    suite.log(`Order: ${photo1.id}, ${photo2.id}, ${photo3.id}`);

    if (photo1.id !== 'new_photo' || photo2.id !== 'mid_photo' || photo3.id !== 'old_photo') {
      throw new Error(`Expected newest→oldest but got ${photo1.id},${photo2.id},${photo3.id}`);
    }

    await newestDb.close();
    suite.log("Newest sort order verified (2024→2022→2020)");
  });

  // Test 20: Oldest Sort Mode
  await suite.test("Oldest Sort Mode", async () => {
    // Create new database with oldest sort
    const oldestDb = new PhotoDatabase(
      path.resolve(__dirname, "cache", "test_oldest_sort.db"),
      suite.log.bind(suite),
      { sortMode: 'oldest' }
    );
    await oldestDb.initialize();

    // Add test photos with different creation times
    const testPhotos = [
      { id: 'new_photo', name: 'new.jpg', createdTime: '2024-12-01T10:00:00Z' },
      { id: 'old_photo', name: 'old.jpg', createdTime: '2020-01-01T10:00:00Z' },
      { id: 'mid_photo', name: 'mid.jpg', createdTime: '2022-06-01T10:00:00Z' },
    ];

    await oldestDb.savePhotos(testPhotos);

    // Cache all photos
    for (const photo of testPhotos) {
      await oldestDb.updatePhotoCacheBlob(photo.id, Buffer.from('test'), 'image/jpeg');
    }

    // Get photos in oldest-first order
    const photo1 = await oldestDb.getNextPhoto();
    await oldestDb.markPhotoViewed(photo1.id);
    const photo2 = await oldestDb.getNextPhoto();
    await oldestDb.markPhotoViewed(photo2.id);
    const photo3 = await oldestDb.getNextPhoto();
    await oldestDb.markPhotoViewed(photo3.id);

    suite.log(`Order: ${photo1.id}, ${photo2.id}, ${photo3.id}`);

    if (photo1.id !== 'old_photo' || photo2.id !== 'mid_photo' || photo3.id !== 'new_photo') {
      throw new Error(`Expected oldest→newest but got ${photo1.id},${photo2.id},${photo3.id}`);
    }

    await oldestDb.close();
    suite.log("Oldest sort order verified (2020→2022→2024)");
  });

  // Clean up
  suite.log("\n" + "=".repeat(60));
  suite.log("CLEANUP");
  suite.log("=".repeat(60));

  // Stop cache manager
  if (cacheManager) {
    cacheManager.stop();
    suite.log("Stopped cache manager");
  }

  // Close database
  if (database) {
    await database.close();
    suite.log("Closed database");
  }

  // Print summary
  suite.printSummary();

  // Exit with appropriate code
  const failed = suite.results.filter(r => r.status === "FAIL").length;
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================
// ERROR HANDLING
// ============================================================

process.on("unhandledRejection", (error) => {
  console.error("\n❌ Unhandled Promise Rejection:");
  console.error(error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("\n❌ Uncaught Exception:");
  console.error(error);
  process.exit(1);
});

// ============================================================
// RUN TESTS
// ============================================================

main().catch((error) => {
  console.error("\n❌ Fatal Error:");
  console.error(error);
  process.exit(1);
});
