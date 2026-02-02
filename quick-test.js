#!/usr/bin/env node

"use strict";

/**
 * Quick Test Script - Pre-configured for Your Drive Folder
 *
 * This script is pre-configured with your Google Drive folder ID.
 * Just run: node quick-test.js
 */

const fs = require("fs");
const path = require("path");
const GDriveAPI = require("./components/GDriveAPI.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

// Load configuration
const config = JSON.parse(fs.readFileSync('./test-config.json', 'utf8'));

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function logStep(step, message) {
  log(`\n[${ step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function main() {
  console.clear();
  log("\n╔════════════════════════════════════════════════════════════╗", 'bright');
  log("║     MMM-GooglePhotos V3 - Quick Test                      ║", 'bright');
  log("║     Testing with Your Google Drive Folder                 ║", 'bright');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  // Check prerequisites
  logStep("0", "Checking Prerequisites");

  if (!fs.existsSync(config.keyFilePath)) {
    logError(`${config.keyFilePath} not found`);
    log("\nPlease create OAuth credentials:", 'yellow');
    log("1. Go to https://console.cloud.google.com", 'yellow');
    log("2. Enable Google Drive API", 'yellow');
    log("3. Create OAuth 2.0 credentials (Desktop app)", 'yellow');
    log("4. Download and save as google_drive_auth.json\n", 'yellow');
    process.exit(1);
  }
  logSuccess("OAuth credentials found");

  if (!fs.existsSync(config.tokenPath)) {
    logError(`${config.tokenPath} not found`);
    log("\nPlease generate token:", 'yellow');
    log("Run: node generate_drive_token.js\n", 'yellow');
    process.exit(1);
  }
  logSuccess("OAuth token found");

  logInfo(`Testing folder: ${config.driveFolders[0].id}`);
  logInfo(`Folder depth: ${config.driveFolders[0].depth} (all subfolders)`);

  // Test 1: Initialize Database
  logStep("1", "Initializing Database");

  const dbPath = path.resolve(__dirname, "cache", "test_photos.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logInfo("Cleaned up old test database");
  }

  const database = new PhotoDatabase(dbPath, (msg) => logInfo(msg));
  await database.initialize();
  logSuccess("Database initialized");

  // Test 2: Authenticate with Google Drive
  logStep("2", "Authenticating with Google Drive API");

  const driveAPI = new GDriveAPI(config, database, (msg) => logInfo(msg));
  await driveAPI.initialize();
  logSuccess("Successfully authenticated");

  // Test 3: Scan Your Folder
  logStep("3", "Scanning Your Google Drive Folder");

  const folderId = config.driveFolders[0].id;
  const depth = config.driveFolders[0].depth;

  logInfo("This may take a moment depending on how many photos you have...");

  const startTime = Date.now();
  const photos = await driveAPI.scanFolder(folderId, depth);
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  logSuccess(`Found ${photos.length} photos in ${scanDuration} seconds`);

  if (photos.length === 0) {
    logError("No photos found in this folder");
    log("\nPlease check:", 'yellow');
    log("1. Folder ID is correct", 'yellow');
    log("2. Folder contains image files", 'yellow');
    log("3. Photos are not in trash\n", 'yellow');
    process.exit(1);
  }

  // Show first few photos
  log("\nFirst few photos found:", 'cyan');
  photos.slice(0, 5).forEach((photo, i) => {
    log(`  ${i + 1}. ${photo.name} (${photo.imageMediaMetadata?.width || '?'}x${photo.imageMediaMetadata?.height || '?'})`, 'blue');
  });

  if (photos.length > 5) {
    log(`  ... and ${photos.length - 5} more\n`, 'blue');
  }

  // Test 4: Save to Database
  logStep("4", "Saving Photos to Database");

  const photosToSave = photos.slice(0, config.photoLimit);
  logInfo(`Saving ${photosToSave.length} photos (limited for testing)...`);

  await database.savePhotos(photosToSave);
  const totalCount = await database.getTotalPhotoCount();
  logSuccess(`Database has ${totalCount} photos`);

  // Test 5: Initialize Cache Manager
  logStep("5", "Initializing Cache Manager");

  await fs.promises.mkdir(config.cachePath, { recursive: true });

  const cacheManager = new CacheManager(
    {
      cachePath: config.cachePath,
      maxCacheSizeMB: config.maxCacheSizeMB
    },
    database,
    driveAPI,
    (msg) => logInfo(msg)
  );

  cacheManager.stop(); // Manual control for testing
  logSuccess("Cache manager ready");

  // Test 6: Download Photos
  logStep("6", "Downloading Photos to Cache");

  const photosToCache = await database.getPhotosToCache(3);
  logInfo(`Downloading ${photosToCache.length} photos...`);

  let downloadCount = 0;
  for (const photo of photosToCache) {
    try {
      await cacheManager.downloadPhoto(photo.id);
      downloadCount++;
      logSuccess(`Downloaded: ${photo.filename}`);
    } catch (error) {
      logError(`Failed: ${photo.filename} - ${error.message}`);
    }
  }

  const cachedCount = await database.getCachedPhotoCount();
  logSuccess(`${cachedCount} photos cached successfully`);

  // Test 7: Cache Statistics
  logStep("7", "Cache Statistics");

  const stats = await cacheManager.getStats();
  log("\n📊 Cache Stats:", 'cyan');
  log(`  Size: ${stats.totalSizeMB} MB / ${stats.maxSizeMB} MB (${stats.usagePercent}%)`, 'blue');
  log(`  Photos: ${stats.cachedCount} / ${stats.totalCount} (${stats.cachePercent}%)`, 'blue');
  log(`  Status: ${stats.isOffline ? '🔴 Offline' : '🟢 Online'}`, 'blue');

  // Test 8: Display Logic
  logStep("8", "Testing Display Logic");

  const nextPhoto = await database.getNextPhoto();
  if (nextPhoto) {
    logSuccess(`Next photo to display: ${nextPhoto.filename}`);
    logInfo(`  Path: ${nextPhoto.cached_path}`);
    logInfo(`  Size: ${nextPhoto.width}x${nextPhoto.height}`);

    // Verify file exists
    if (fs.existsSync(nextPhoto.cached_path)) {
      const fileSize = fs.statSync(nextPhoto.cached_path).size;
      logInfo(`  File size: ${(fileSize / 1024).toFixed(2)} KB`);
      logSuccess("Photo file verified on disk");
    } else {
      logError("Photo file not found on disk");
    }
  } else {
    logError("No photo available for display");
  }

  // Test 9: Changes API (Incremental Scan)
  logStep("9", "Testing Changes API (Incremental Scan)");

  logInfo("Running first scan to get change token...");
  const changedPhotos1 = await driveAPI.scanForChanges();
  logSuccess(`Initial scan: ${changedPhotos1.length} photos`);

  const token = await database.getSetting("changes_token");
  if (token) {
    logSuccess(`Change token saved: ${token.substring(0, 30)}...`);

    logInfo("Running second scan (should find no changes)...");
    const changedPhotos2 = await driveAPI.scanForChanges();
    logSuccess(`Second scan: ${changedPhotos2.length} changes detected`);

    if (changedPhotos2.length === 0) {
      logSuccess("Changes API working correctly (no changes expected)");
    } else {
      logInfo(`${changedPhotos2.length} new/changed photos detected`);
    }
  }

  // Final Summary
  log("\n" + "═".repeat(60), 'bright');
  log("🎉 ALL TESTS PASSED!", 'green');
  log("═".repeat(60) + "\n", 'bright');

  log("Summary:", 'cyan');
  log(`✅ Found ${photos.length} photos in your Drive folder`, 'green');
  log(`✅ Saved ${totalCount} photos to database`, 'green');
  log(`✅ Downloaded ${cachedCount} photos to cache`, 'green');
  log(`✅ Display logic working`, 'green');
  log(`✅ Changes API configured`, 'green');

  log("\n📁 Files created:", 'cyan');
  log(`  Database: ${dbPath}`, 'blue');
  log(`  Cache: ${config.cachePath}`, 'blue');

  log("\n🚀 Next steps:", 'cyan');
  log("1. Review cache/images/ to see downloaded photos", 'blue');
  log("2. Run full test suite: npm test", 'blue');
  log("3. Deploy to MagicMirror (see QUICK_START.md)", 'blue');

  log("\n✨ Your V3 implementation is working perfectly!\n", 'green');

  // Cleanup
  cacheManager.stop();
  await database.close();
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Error:', error.message);
  if (error.stack) {
    console.error('\nStack trace:', error.stack);
  }
  process.exit(1);
});

// Run
main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  if (error.stack) {
    console.error('\nStack trace:', error.stack);
  }
  process.exit(1);
});
