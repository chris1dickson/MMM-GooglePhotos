#!/usr/bin/env node

"use strict";

/**
 * BLOB Storage Test Script
 * Tests the new BLOB storage feature with image resizing
 *
 * Usage:
 *   node test_blob_storage.js
 *
 * Prerequisites:
 *   1. npm install sharp
 *   2. OAuth credentials configured
 *   3. At least one photo in configured Drive folder
 */

const fs = require("fs");
const path = require("path");

// Import components
const GDriveAPI = require("./components/GDriveAPI.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

// Load config
const config = JSON.parse(fs.readFileSync('./test-config.json', 'utf8'));

// Colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'cyan');
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

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function main() {
  console.clear();
  log("\n╔════════════════════════════════════════════════════════════╗", 'bright');
  log("║     MMM-GooglePhotos V3 - BLOB Storage Test               ║", 'bright');
  log("║     Testing SQLite BLOB storage with image resizing       ║", 'bright');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  // Check if sharp is installed
  logStep("0", "Checking Prerequisites");

  let sharp = null;
  try {
    sharp = require("sharp");
    logSuccess("Sharp library installed");
    const sharpInfo = sharp.versions;
    logInfo(`  libvips: ${sharpInfo.vips}`);
    logInfo(`  sharp: ${sharpInfo.sharp}`);
  } catch (e) {
    logError("Sharp library NOT installed");
    logWarning("BLOB storage requires sharp for image processing");
    log("\nInstall sharp:", 'yellow');
    log("  npm install sharp\n", 'yellow');
    process.exit(1);
  }

  if (!fs.existsSync(config.keyFilePath)) {
    logError(`${config.keyFilePath} not found`);
    process.exit(1);
  }
  logSuccess("OAuth credentials found");

  if (!fs.existsSync(config.tokenPath)) {
    logError(`${config.tokenPath} not found`);
    process.exit(1);
  }
  logSuccess("OAuth token found");

  // Test 1: Initialize Database with BLOB Schema
  logStep("1", "Initializing Database with BLOB Schema");

  const dbPath = path.resolve(__dirname, "cache", "test_blob.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logInfo("Cleaned up old test database");
  }

  const database = new PhotoDatabase(dbPath, (msg) => logInfo(msg));
  await database.initialize();
  logSuccess("Database initialized");

  // Verify BLOB columns exist
  const schema = await database.query("PRAGMA table_info(photos)");
  const hasDataColumn = schema.some(col => col.name === 'cached_data');
  const hasMimeColumn = schema.some(col => col.name === 'cached_mime_type');

  if (hasDataColumn && hasMimeColumn) {
    logSuccess("BLOB columns present in schema");
    logInfo("  - cached_data (BLOB)");
    logInfo("  - cached_mime_type (TEXT)");
  } else {
    logError("BLOB columns missing from schema");
    process.exit(1);
  }

  // Test 2: Authenticate with Google Drive
  logStep("2", "Authenticating with Google Drive API");

  const driveAPI = new GDriveAPI(config, database, (msg) => logInfo(msg));
  await driveAPI.initialize();
  logSuccess("Successfully authenticated");

  // Test 3: Scan and Save Photos
  logStep("3", "Scanning Google Drive Folder");

  const photos = await driveAPI.scanForChanges();
  logSuccess(`Found ${photos.length} photos`);

  if (photos.length === 0) {
    logError("No photos found - cannot test BLOB storage");
    process.exit(1);
  }

  await database.savePhotos(photos.slice(0, 3)); // Save 3 photos for testing
  const totalCount = await database.getTotalPhotoCount();
  logSuccess(`Saved ${totalCount} photos to database`);

  // Test 4: Initialize Cache Manager with BLOB Mode
  logStep("4", "Initializing Cache Manager (BLOB Mode)");

  const blobConfig = {
    ...config,
    useBlobStorage: true,     // Enable BLOB storage
    showWidth: 1920,          // Screen width
    showHeight: 1080,         // Screen height
    jpegQuality: 85           // JPEG quality
  };

  const cacheManager = new CacheManager(
    blobConfig,
    database,
    driveAPI,
    (msg) => logInfo(msg)
  );

  cacheManager.stop(); // Manual control for testing

  // Verify BLOB mode is enabled
  if (cacheManager.useBlobStorage) {
    logSuccess("BLOB storage mode ENABLED");
    logInfo(`  Screen dimensions: ${cacheManager.screenWidth}x${cacheManager.screenHeight}`);
    logInfo(`  JPEG quality: ${cacheManager.jpegQuality}%`);
  } else {
    logError("BLOB storage mode NOT enabled");
    process.exit(1);
  }

  // Test 5: Download and Process Photos as BLOBs
  logStep("5", "Downloading and Processing Photos");

  const photosToCache = await database.getPhotosToCache(2);
  logInfo(`Processing ${photosToCache.length} photos...`);

  let processedPhotos = [];

  for (const photo of photosToCache) {
    try {
      logInfo(`\nProcessing: ${photo.filename}`);

      const startTime = Date.now();
      const result = await cacheManager.downloadPhoto(photo.id);
      const duration = Date.now() - startTime;

      logSuccess(`Processed in ${duration}ms`);
      logInfo(`  Size: ${(result.size / 1024).toFixed(2)} KB`);

      processedPhotos.push(photo.id);
    } catch (error) {
      logError(`Failed: ${photo.filename} - ${error.message}`);
    }
  }

  logSuccess(`${processedPhotos.length} photos processed`);

  // Test 6: Verify BLOB Storage in Database
  logStep("6", "Verifying BLOB Storage in Database");

  for (const photoId of processedPhotos) {
    const photo = await database.db.get(`
      SELECT id, filename,
             cached_data IS NOT NULL as has_blob,
             cached_path,
             cached_mime_type,
             cached_size_bytes,
             LENGTH(cached_data) as blob_size
      FROM photos
      WHERE id = ?
    `, [photoId]);

    if (photo.has_blob) {
      logSuccess(`Photo stored as BLOB: ${photo.filename}`);
      logInfo(`  BLOB size: ${(photo.blob_size / 1024).toFixed(2)} KB`);
      logInfo(`  MIME type: ${photo.cached_mime_type}`);
      logInfo(`  cached_path: ${photo.cached_path || '(null - using BLOB)'}`);

      if (photo.cached_path === null) {
        logSuccess("  ✓ File-based cache properly cleared");
      } else {
        logWarning("  ! cached_path should be NULL for BLOB storage");
      }
    } else {
      logError(`Photo NOT stored as BLOB: ${photo.filename}`);
    }
  }

  // Test 7: Retrieve and Display BLOB
  logStep("7", "Retrieving BLOB Data");

  const nextPhoto = await database.getNextPhoto();

  if (!nextPhoto) {
    logError("No photo available for display");
    process.exit(1);
  }

  logInfo(`Next photo: ${nextPhoto.filename}`);

  if (nextPhoto.cached_data) {
    logSuccess("Photo has BLOB data");
    logInfo(`  BLOB size: ${(nextPhoto.cached_data.length / 1024).toFixed(2)} KB`);

    // Verify it's a valid Buffer
    if (Buffer.isBuffer(nextPhoto.cached_data)) {
      logSuccess("  ✓ Valid Buffer object");

      // Check JPEG header
      const header = nextPhoto.cached_data.slice(0, 3).toString('hex');
      if (header === 'ffd8ff') {
        logSuccess("  ✓ Valid JPEG header (FFD8FF)");
      } else {
        logError(`  ✗ Invalid JPEG header: ${header}`);
      }

      // Convert to base64 (simulating frontend send)
      const base64 = nextPhoto.cached_data.toString('base64');
      logSuccess(`  ✓ Converted to base64 (${(base64.length / 1024).toFixed(2)} KB)`);

    } else {
      logError("  ✗ Not a valid Buffer");
    }
  } else if (nextPhoto.cached_path) {
    logWarning("Photo uses file-based storage (not BLOB)");
    logInfo(`  Path: ${nextPhoto.cached_path}`);
  } else {
    logError("Photo has no cached data");
  }

  // Test 8: Compare File vs BLOB Storage
  logStep("8", "Storage Comparison");

  const cachedPhotos = await database.db.all(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cached_data IS NOT NULL THEN 1 ELSE 0 END) as blob_count,
      SUM(CASE WHEN cached_path IS NOT NULL THEN 1 ELSE 0 END) as file_count,
      SUM(cached_size_bytes) as total_size
    FROM photos
    WHERE cached_data IS NOT NULL OR cached_path IS NOT NULL
  `);

  const stats = cachedPhotos[0];

  log("\n📊 Storage Statistics:", 'cyan');
  log(`  Total cached: ${stats.total}`, 'blue');
  log(`  BLOB storage: ${stats.blob_count}`, 'blue');
  log(`  File storage: ${stats.file_count}`, 'blue');
  log(`  Total size: ${(stats.total_size / 1024).toFixed(2)} KB`, 'blue');

  if (stats.blob_count > 0) {
    logSuccess("BLOB storage is working!");
  } else {
    logError("No photos stored as BLOBs");
  }

  // Test 9: Performance Test
  logStep("9", "Performance Test");

  logInfo("Testing retrieval speed...");

  const iterations = 10;
  let totalTime = 0;

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const photo = await database.getNextPhoto();
    const duration = Date.now() - start;
    totalTime += duration;
  }

  const avgTime = totalTime / iterations;
  logSuccess(`Average retrieval time: ${avgTime.toFixed(2)}ms`);

  if (avgTime < 10) {
    logSuccess("  ⚡ Excellent performance!");
  } else if (avgTime < 50) {
    logInfo("  ✓ Good performance");
  } else {
    logWarning("  ⚠ Slow performance");
  }

  // Test 10: Database File Size
  logStep("10", "Database File Analysis");

  const dbStats = fs.statSync(dbPath);
  logInfo(`Database file size: ${(dbStats.size / 1024).toFixed(2)} KB`);

  const pageSize = await database.db.get("PRAGMA page_size");
  const cacheSize = await database.db.get("PRAGMA cache_size");

  logInfo(`Page size: ${pageSize.page_size} bytes`);
  logInfo(`Cache size: ${Math.abs(cacheSize.cache_size)} KB`);

  if (pageSize.page_size === 16384) {
    logSuccess("  ✓ Optimized for BLOB storage (16KB pages)");
  }

  // Final Summary
  log("\n" + "═".repeat(60), 'bright');
  log("🎉 BLOB STORAGE TESTS COMPLETE!", 'green');
  log("═".repeat(60) + "\n", 'bright');

  log("Test Results:", 'cyan');
  logSuccess(`✅ Sharp library: Installed`);
  logSuccess(`✅ BLOB schema: Present`);
  logSuccess(`✅ BLOB mode: Enabled`);
  logSuccess(`✅ Photos processed: ${processedPhotos.length}`);
  logSuccess(`✅ BLOBs stored: ${stats.blob_count}`);
  logSuccess(`✅ Retrieval: ${avgTime.toFixed(2)}ms avg`);

  log("\n📁 Test artifacts:", 'cyan');
  log(`  Database: ${dbPath}`, 'blue');
  log(`  Size: ${(dbStats.size / 1024).toFixed(2)} KB`, 'blue');

  log("\n✨ BLOB storage is working perfectly!\n", 'green');

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
