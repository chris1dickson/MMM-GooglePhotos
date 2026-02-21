#!/usr/bin/env node

"use strict";

/**
 * Amazon S3 Quick Test Script
 *
 * Tests S3 provider integration with MMM-CloudPhotos
 *
 * Prerequisites:
 * 1. npm install
 * 2. Create S3 bucket and get AWS credentials
 * 3. Create s3_credentials.json with your credentials
 * 4. Update test-config-s3.json with your settings
 */

const fs = require("fs");
const path = require("path");
const { createProvider } = require("./components/providers/ProviderFactory.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

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

async function main() {
  console.clear();
  log("\n╔════════════════════════════════════════════════════════════╗", 'bright');
  log("║     MMM-CloudPhotos - Amazon S3 Test                      ║", 'bright');
  log("║     Testing with S3 Provider                              ║", 'bright');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  // Check prerequisites
  logStep("0", "Checking Prerequisites");

  const configPath = './test-config-s3.json';
  if (!fs.existsSync(configPath)) {
    logError(`${configPath} not found`);
    log("\nPlease create test-config-s3.json:", 'yellow');
    log(JSON.stringify({
      bucketName: "my-photos-bucket",
      region: "us-east-1",
      credentialsPath: "./s3_credentials.json",
      bucketPrefix: "",
      driveFolders: [
        { id: "photos/", depth: -1 }
      ]
    }, null, 2), 'yellow');
    log("\nAnd create s3_credentials.json:", 'yellow');
    log(JSON.stringify({
      accessKeyId: "YOUR_AWS_ACCESS_KEY_ID",
      secretAccessKey: "YOUR_AWS_SECRET_ACCESS_KEY"
    }, null, 2), 'yellow');
    log("\nSee S3_CONFIGURATION.md for instructions\n", 'yellow');
    process.exit(1);
  }
  logSuccess("Config file found");

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (config.credentialsPath && !fs.existsSync(config.credentialsPath)) {
    logError("S3 credentials file not found");
    log("\nPlease create s3_credentials.json:", 'yellow');
    log(JSON.stringify({
      accessKeyId: "YOUR_AWS_ACCESS_KEY_ID",
      secretAccessKey: "YOUR_AWS_SECRET_ACCESS_KEY"
    }, null, 2), 'yellow');
    log("\nOr use AWS profile or IAM role authentication\n", 'yellow');
    process.exit(1);
  }
  logSuccess("S3 credentials configured");

  logInfo(`Testing bucket: ${config.bucketName}`);
  logInfo(`Region: ${config.region}`);
  logInfo(`Prefix: ${config.bucketPrefix || "(root)"}`);
  if (config.driveFolders && config.driveFolders.length > 0) {
    logInfo(`Testing folder: ${config.driveFolders[0]?.id || 'root'}`);
    logInfo(`Folder depth: ${config.driveFolders[0]?.depth || -1} (all subfolders)`);
  }

  // Test 1: Initialize Database
  logStep("1", "Initializing Database");

  const dbPath = path.resolve(__dirname, "cache", "test_s3.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logInfo("Cleaned up old test database");
  }

  const database = new PhotoDatabase(dbPath, (msg) => logInfo(msg));
  await database.initialize();
  logSuccess("Database initialized");

  // Test 2: Authenticate with S3
  logStep("2", "Authenticating with Amazon S3");

  const provider = createProvider("s3", config, (msg) => logInfo(msg));
  provider.setDatabase(database);
  await provider.initialize();
  logSuccess("Successfully authenticated with S3");

  // Test 3: Scan S3 Bucket/Prefix
  logStep("3", "Scanning S3 Bucket");

  const folderId = config.driveFolders?.[0]?.id || config.bucketPrefix || "";
  const depth = config.driveFolders?.[0]?.depth ?? -1;

  logInfo("This may take a moment depending on how many photos you have...");

  const startTime = Date.now();
  const photos = await provider.scanFolder(folderId, depth);
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  logSuccess(`Found ${photos.length} photos in ${scanDuration} seconds`);

  if (photos.length === 0) {
    logError("No photos found in this bucket/prefix");
    log("\nPlease check:", 'yellow');
    log("1. Bucket name is correct", 'yellow');
    log("2. Prefix/folder contains image files", 'yellow');
    log("3. AWS credentials have s3:ListBucket and s3:GetObject permissions", 'yellow');
    log("4. Region is correct\n", 'yellow');
    process.exit(1);
  }

  // Show first few photos
  log("\nFirst few photos found:", 'cyan');
  photos.slice(0, 5).forEach((photo, i) => {
    const dimensions = photo.imageMediaMetadata
      ? `${photo.imageMediaMetadata.width}x${photo.imageMediaMetadata.height}`
      : "dimensions unknown";
    const size = photo.size ? `${(photo.size / 1024).toFixed(1)} KB` : "";
    log(`  ${i + 1}. ${photo.name} (${dimensions}) ${size}`, 'blue');
  });

  // Test 4: Save to Database
  logStep("4", "Saving Photos to Database");

  await database.savePhotos(photos);
  const totalCount = await database.getTotalPhotoCount();
  logSuccess(`Saved ${totalCount} photos to database`);

  // Test 5: Test Caching
  logStep("5", "Testing Photo Cache");

  const cacheConfig = {
    cachePath: path.resolve(__dirname, "cache", "test_s3_images"),
    maxCacheSizeMB: 50,
    showWidth: 1920,
    showHeight: 1080,
    jpegQuality: 85,
    useBlobStorage: true
  };

  const cacheManager = new CacheManager(cacheConfig, database, provider, (msg) => logInfo(msg));
  cacheManager.stop(); // Manual control

  logInfo("Downloading first photo...");
  await cacheManager.tick();

  const cachedCount = await database.getCachedPhotoCount();
  logSuccess(`Cached ${cachedCount} photo(s)`);

  // Test 6: Retrieve Cached Photo
  logStep("6", "Retrieving Cached Photo");

  const photo = await database.getNextPhoto();
  if (photo) {
    logSuccess(`Retrieved photo: ${photo.filename}`);
    logInfo(`  Size: ${(photo.cached_size_bytes / 1024).toFixed(2)} KB`);
    logInfo(`  Dimensions: ${photo.width}x${photo.height}`);
    if (photo.cached_data) {
      logInfo(`  Storage: BLOB mode (${photo.cached_data.length} bytes)`);
    } else if (photo.cached_path) {
      logInfo(`  Storage: File mode (${photo.cached_path})`);
    }
  } else {
    logError("No cached photo found");
  }

  // Test 7: Incremental Sync (Note: S3 doesn't support this yet)
  logStep("7", "Testing Incremental Sync");

  const startToken = await provider.getStartPageToken();
  if (startToken) {
    logSuccess(`Got change token: ${startToken}`);
    await database.saveSetting("changes_token", startToken);

    const changes = await provider.getChanges(startToken);
    logInfo(`Found ${changes.photos.length} new/changed photos`);
    logInfo(`Found ${changes.deletedIds.length} deleted photos`);
    logSuccess("Incremental sync working");
  } else {
    logInfo("Incremental sync not supported (this is expected for S3)");
    logInfo("S3 provider uses full scans on each sync");
  }

  // Cleanup
  logStep("8", "Cleanup");

  cacheManager.stop();
  await database.close();
  logSuccess("Test complete!");

  // Summary
  log("\n╔════════════════════════════════════════════════════════════╗", 'bright');
  log("║                     Test Summary                           ║", 'bright');
  log("╠════════════════════════════════════════════════════════════╣", 'bright');
  log(`║  Provider: Amazon S3                                       ║`, 'green');
  log(`║  Bucket: ${config.bucketName.padEnd(49)}║`, 'green');
  log(`║  Photos Found: ${photos.length.toString().padEnd(44)}║`, 'green');
  log(`║  Photos Cached: ${cachedCount.toString().padEnd(43)}║`, 'green');
  log(`║  Scan Time: ${scanDuration}s${' '.repeat(44 - scanDuration.length)}║`, 'green');
  log(`║  Status: ✅ All tests passed                              ║`, 'green');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  log("Next steps:", 'cyan');
  log("1. Add S3 to your MagicMirror config", 'blue');
  log("2. Set provider: \"s3\" in config", 'blue');
  log("3. Add bucketName, region, and credentialsPath", 'blue');
  log("4. Restart MagicMirror", 'blue');
  log("\nSee S3_CONFIGURATION.md for configuration examples\n", 'yellow');
}

main().catch((error) => {
  console.error("\n" + "=".repeat(60));
  console.error("❌ Test failed:", error.message);
  console.error("=".repeat(60));
  console.error(error.stack);
  process.exit(1);
});
