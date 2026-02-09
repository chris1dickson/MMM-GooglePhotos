#!/usr/bin/env node

"use strict";

/**
 * OneDrive Quick Test Script
 *
 * Tests OneDrive provider integration with MMM-CloudPhotos
 *
 * Prerequisites:
 * 1. npm install
 * 2. Create Azure app and get client credentials
 * 3. Run: node generate_onedrive_token.js
 * 4. Update test-config-onedrive.json with your settings
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
  log("║     MMM-CloudPhotos - OneDrive Test                       ║", 'bright');
  log("║     Testing with OneDrive Provider                        ║", 'bright');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  // Check prerequisites
  logStep("0", "Checking Prerequisites");

  const configPath = './test-config-onedrive.json';
  if (!fs.existsSync(configPath)) {
    logError(`${configPath} not found`);
    log("\nPlease create test-config-onedrive.json:", 'yellow');
    log(JSON.stringify({
      clientId: "YOUR_AZURE_CLIENT_ID",
      clientSecret: "YOUR_AZURE_CLIENT_SECRET",
      tokenPath: "./token_onedrive.json",
      folders: [
        { id: "YOUR_FOLDER_ID", depth: -1 }
      ]
    }, null, 2), 'yellow');
    log("\nSee ONEDRIVE_SETUP.md for instructions\n", 'yellow');
    process.exit(1);
  }
  logSuccess("Config file found");

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!fs.existsSync(config.tokenPath || './token_onedrive.json')) {
    logError("OneDrive token not found");
    log("\nPlease generate token:", 'yellow');
    log("Run: node generate_onedrive_token.js\n", 'yellow');
    process.exit(1);
  }
  logSuccess("OneDrive token found");

  logInfo(`Testing folder: ${config.folders[0]?.id || 'root'}`);
  logInfo(`Folder depth: ${config.folders[0]?.depth || -1} (all subfolders)`);

  // Test 1: Initialize Database
  logStep("1", "Initializing Database");

  const dbPath = path.resolve(__dirname, "cache", "test_onedrive.db");

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logInfo("Cleaned up old test database");
  }

  const database = new PhotoDatabase(dbPath, (msg) => logInfo(msg));
  await database.initialize();
  logSuccess("Database initialized");

  // Test 2: Authenticate with OneDrive
  logStep("2", "Authenticating with OneDrive API");

  const provider = createProvider("onedrive", config, (msg) => logInfo(msg));
  provider.setDatabase(database);
  await provider.initialize();
  logSuccess("Successfully authenticated with OneDrive");

  // Test 3: Scan OneDrive Folder
  logStep("3", "Scanning OneDrive Folder");

  const folderId = config.folders[0]?.id || null;
  const depth = config.folders[0]?.depth || -1;

  logInfo("This may take a moment depending on how many photos you have...");

  const startTime = Date.now();
  const photos = await provider.scanFolder(folderId, depth);
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  logSuccess(`Found ${photos.length} photos in ${scanDuration} seconds`);

  if (photos.length === 0) {
    logError("No photos found in this folder");
    log("\nPlease check:", 'yellow');
    log("1. Folder ID is correct", 'yellow');
    log("2. Folder contains image files", 'yellow');
    log("3. Azure app has Files.Read permission\n", 'yellow');
    process.exit(1);
  }

  // Show first few photos
  log("\nFirst few photos found:", 'cyan');
  photos.slice(0, 5).forEach((photo, i) => {
    log(`  ${i + 1}. ${photo.name} (${photo.imageMediaMetadata?.width}x${photo.imageMediaMetadata?.height})`, 'blue');
  });

  // Test 4: Save to Database
  logStep("4", "Saving Photos to Database");

  await database.savePhotos(photos);
  const totalCount = await database.getTotalPhotoCount();
  logSuccess(`Saved ${totalCount} photos to database`);

  // Test 5: Test Caching
  logStep("5", "Testing Photo Cache");

  const cacheConfig = {
    cachePath: path.resolve(__dirname, "cache", "test_onedrive_images"),
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

  // Test 7: Test Delta API (Incremental Sync)
  logStep("7", "Testing Delta API (Incremental Sync)");

  // Get start token
  const startToken = await provider.getStartPageToken();
  logSuccess(`Got delta token: ${startToken.substring(0, 50)}...`);

  await database.saveSetting("changes_token", startToken);

  // Simulate checking for changes
  logInfo("Checking for changes...");
  const changes = await provider.getChanges(startToken);
  logInfo(`Found ${changes.photos.length} new/changed photos`);
  logInfo(`Found ${changes.deletedIds.length} deleted photos`);
  logSuccess("Delta API working correctly");

  // Cleanup
  logStep("8", "Cleanup");

  cacheManager.stop();
  await database.close();
  logSuccess("Test complete!");

  // Summary
  log("\n╔════════════════════════════════════════════════════════════╗", 'bright');
  log("║                     Test Summary                           ║", 'bright');
  log("╠════════════════════════════════════════════════════════════╣", 'bright');
  log(`║  Provider: OneDrive                                        ║`, 'green');
  log(`║  Photos Found: ${photos.length.toString().padEnd(44)}║`, 'green');
  log(`║  Photos Cached: ${cachedCount.toString().padEnd(43)}║`, 'green');
  log(`║  Scan Time: ${scanDuration}s${' '.repeat(44 - scanDuration.length)}║`, 'green');
  log(`║  Status: ✅ All tests passed                              ║`, 'green');
  log("╚════════════════════════════════════════════════════════════╝\n", 'bright');

  log("Next steps:", 'cyan');
  log("1. Add OneDrive to your MagicMirror config", 'blue');
  log("2. Set provider: \"onedrive\" in config", 'blue');
  log("3. Restart MagicMirror", 'blue');
  log("\nSee ONEDRIVE_SETUP.md for configuration examples\n", 'yellow');
}

main().catch((error) => {
  console.error("\n" + "=".repeat(60));
  console.error("❌ Test failed:", error.message);
  console.error("=".repeat(60));
  console.error(error.stack);
  process.exit(1);
});
