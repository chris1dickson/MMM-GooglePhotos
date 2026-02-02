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
const GDriveAPI = require("./components/GDriveAPI.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

// ============================================================
// CONFIGURATION - EDIT THIS SECTION
// ============================================================

const CONFIG = {
  // Your Google Drive folder ID (get from Drive URL)
  driveFolders: [
    {
      id: "1dkAgKSTNWoY-qXMg4xHEyqJFRqZniB2I",
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

  if (CONFIG.driveFolders[0].id === "YOUR_FOLDER_ID_HERE") {
    suite.log("❌ ERROR: Please edit CONFIG in test_v3_standalone.js", "ERROR");
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
    driveAPI = new GDriveAPI(
      {
        keyFilePath: CONFIG.keyFilePath,
        tokenPath: CONFIG.tokenPath,
        driveFolders: CONFIG.driveFolders
      },
      database,
      (msg) => suite.log(msg)
    );

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
  await suite.test("Cache Manager Initialization", async () => {
    // Create cache directory
    await fs.promises.mkdir(CONFIG.cachePath, { recursive: true });

    cacheManager = new CacheManager(
      {
        cachePath: CONFIG.cachePath,
        maxCacheSizeMB: CONFIG.maxCacheSizeMB
      },
      database,
      driveAPI,
      (msg) => suite.log(msg)
    );

    suite.log("Cache manager initialized");

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

    // Verify file exists
    const cachedPhoto = await database.getNextPhoto();
    if (!cachedPhoto || !fs.existsSync(cachedPhoto.cached_path)) {
      throw new Error("Cached file not found on disk");
    }

    const stats = fs.statSync(cachedPhoto.cached_path);
    suite.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
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
    suite.log(`  Path: ${photo.cached_path}`);
    suite.log(`  Resolution: ${photo.width}x${photo.height}`);

    // Verify file exists and is readable
    const fileBuffer = await fs.promises.readFile(photo.cached_path);
    suite.log(`  File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

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
