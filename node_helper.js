"use strict";

/**
 * MMM-CloudPhotos Node Helper - V3 (Multi-Provider Architecture)
 *
 * Supports multiple cloud storage providers through a provider abstraction layer
 */

const fs = require("fs");
const path = require("path");
const NodeHelper = require("node_helper");
const Log = require("logger");

// Import provider system and components
const { createProvider } = require("./components/providers/ProviderFactory.js");
const PhotoDatabase = require("./components/PhotoDatabase.js");
const CacheManager = require("./components/CacheManager.js");

const NodeHelperObject = {
  start: function () {
    this.config = {};
    this.initialized = false;

    // Component instances
    this.photoProvider = null;
    this.database = null;
    this.cacheManager = null;

    // Timers
    this.scanTimer = null;
    this.displayTimer = null;

    // Paths
    this.dbPath = path.resolve(this.path, "cache", "photos.db");
    this.cachePath = path.resolve(this.path, "cache", "images");

    this.log_info("Node helper started");
  },

  socketNotificationReceived: async function (notification, payload) {
    switch (notification) {
      case "INIT":
        await this.initialize(payload);
        break;

      case "IMAGE_LOADED":
        {
          const { id } = payload;
          this.log_debug("Image loaded:", id);
          // Mark photo as viewed in database
          if (this.database) {
            await this.database.markPhotoViewed(id).catch(() => {});
          }
        }
        break;

      case "NEED_MORE_PICS":
        this.log_debug("Frontend needs more photos");
        await this.sendNextPhoto();
        break;

      case "MODULE_SUSPENDED_SKIP_UPDATE":
        this.log_debug("Module is suspended");
        break;

      case "GET_CACHE_STATS":
        await this.sendCacheStats();
        break;

      default:
        this.log_warn("Unknown notification received:", notification);
    }
  },

  log_debug: function (...args) {
    Log.debug("[CLOUDPHOTOS]", ...args);
  },

  log_info: function (...args) {
    Log.info("[CLOUDPHOTOS]", ...args);
  },

  log_error: function (...args) {
    Log.error("[CLOUDPHOTOS]", ...args);
  },

  log_warn: function (...args) {
    Log.warn("[CLOUDPHOTOS]", ...args);
  },

  /**
   * Initialize all components
   */
  initialize: async function (config) {
    if (this.initialized) {
      this.log_warn("Already initialized, skipping...");
      return;
    }

    try {
      this.log_info("Initializing MMM-CloudPhotos V3...");
      this.config = config;

      // Ensure cache directories exist
      await fs.promises.mkdir(this.cachePath, { recursive: true });

      // Initialize database
      this.log_info("Initializing database...");
      this.database = new PhotoDatabase(
        this.dbPath,
        this.log_info.bind(this),
        {
          sortMode: config.sortMode || 'sequential'
        }
      );
      await this.database.initialize();

      // Initialize cloud storage provider
      const providerName = config.provider || "google-drive";
      const providerConfig = config.providerConfig || {
        keyFilePath: config.keyFilePath || "./google_drive_auth.json",
        tokenPath: config.tokenPath || "./token_drive.json",
        driveFolders: config.driveFolders || []
      };

      this.log_info(`Initializing cloud provider: ${providerName}...`);
      this.photoProvider = createProvider(providerName, providerConfig, this.log_info.bind(this));

      // Set database reference for providers that support incremental sync
      if (typeof this.photoProvider.setDatabase === 'function') {
        this.photoProvider.setDatabase(this.database);
      }

      await this.photoProvider.initialize();

      // Initialize cache manager
      this.log_info("Initializing cache manager...");
      this.cacheManager = new CacheManager(
        {
          cachePath: this.cachePath,
          maxCacheSizeMB: config.maxCacheSizeMB || 200,
          showWidth: config.showWidth,
          showHeight: config.showHeight,
          jpegQuality: config.jpegQuality,
          useBlobStorage: config.useBlobStorage
        },
        this.database,
        this.photoProvider,
        this.log_info.bind(this)
      );

      this.initialized = true;
      this.log_info("✅ Initialization complete!");

      // Send success notification to frontend
      this.sendSocketNotification("INITIALIZED", { success: true });

      // Start initial scan
      await this.performInitialScan();

      // Start periodic scanning
      this.startPeriodicScanning();

      // Start display timer
      this.startDisplayTimer();

    } catch (error) {
      this.log_error("Initialization failed:", error.message);
      this.log_error(error.stack);
      this.sendSocketNotification("ERROR", {
        message: `Initialization failed: ${error.message}`,
        details: error.stack
      });
    }
  },

  /**
   * Perform initial scan of cloud storage
   */
  performInitialScan: async function () {
    try {
      this.log_info(`Starting initial scan of ${this.photoProvider.getProviderName()}...`);
      this.sendSocketNotification("UPDATE_STATUS", `Scanning ${this.photoProvider.getProviderName()}...`);

      // Try incremental sync first (will fall back to full scan if needed)
      let photos = [];

      // Check if provider supports incremental sync
      const token = await this.database.getSetting("changes_token");

      if (token && typeof this.photoProvider.getChanges === 'function') {
        // Use incremental sync
        const changes = await this.photoProvider.getChanges(token);
        photos = changes.photos;

        // Handle deletions
        if (changes.deletedIds && changes.deletedIds.length > 0) {
          for (const id of changes.deletedIds) {
            await this.database.deletePhoto(id);
          }
        }

        // Save new token
        if (changes.nextToken) {
          await this.database.saveSetting("changes_token", changes.nextToken);
        }
      } else {
        // Full scan (first run or provider doesn't support incremental)
        if (typeof this.photoProvider.fullScan === 'function') {
          photos = await this.photoProvider.fullScan();
        } else {
          // Provider doesn't have fullScan, use scanFolder on all configured folders
          const folders = this.config.providerConfig?.driveFolders || this.config.driveFolders || [];
          for (const folderConfig of folders) {
            const folderPhotos = await this.photoProvider.scanFolder(
              folderConfig.id || null,
              folderConfig.depth !== undefined ? folderConfig.depth : -1
            );
            photos.push(...folderPhotos);
          }
        }

        // Get start token for future incremental syncs
        if (typeof this.photoProvider.getStartPageToken === 'function') {
          const startToken = await this.photoProvider.getStartPageToken();
          await this.database.saveSetting("changes_token", startToken);
        }
      }

      if (photos.length > 0) {
        this.log_info(`Found ${photos.length} photos, saving to database...`);
        await this.database.savePhotos(photos);

        const totalCount = await this.database.getTotalPhotoCount();
        const cachedCount = await this.database.getCachedPhotoCount();

        this.log_info(`Database now has ${totalCount} photos (${cachedCount} cached)`);
        this.sendSocketNotification("UPDATE_STATUS", `Found ${totalCount} photos`);
      } else {
        this.log_warn("No photos found in configured folders");
        this.sendSocketNotification("UPDATE_STATUS", "No photos found");
      }

    } catch (error) {
      this.log_error("Initial scan failed:", error.message);
      this.sendSocketNotification("ERROR", `Scan failed: ${error.message}`);
    }
  },

  /**
   * Start periodic scanning for new photos
   */
  startPeriodicScanning: function () {
    const scanInterval = this.config.scanInterval || (6 * 60 * 60 * 1000); // Default: 6 hours

    this.log_info(`Setting up periodic scan every ${scanInterval / 1000 / 60} minutes`);

    this.scanTimer = setInterval(async () => {
      try {
        this.log_info("Running periodic scan...");

        let photos = [];
        const token = await this.database.getSetting("changes_token");

        // Use incremental sync if supported and we have a token
        if (token && typeof this.photoProvider.getChanges === 'function') {
          const changes = await this.photoProvider.getChanges(token);
          photos = changes.photos;

          // Handle deletions
          if (changes.deletedIds && changes.deletedIds.length > 0) {
            for (const id of changes.deletedIds) {
              await this.database.deletePhoto(id);
            }
            this.log_info(`Removed ${changes.deletedIds.length} deleted photos`);
          }

          // Save new token
          if (changes.nextToken) {
            await this.database.saveSetting("changes_token", changes.nextToken);
          }
        } else {
          // Fall back to full scan
          if (typeof this.photoProvider.fullScan === 'function') {
            photos = await this.photoProvider.fullScan();
          }
        }

        if (photos.length > 0) {
          this.log_info(`Found ${photos.length} new/changed photos`);
          await this.database.savePhotos(photos);
        } else {
          this.log_info("No changes detected");
        }

      } catch (error) {
        this.log_error("Periodic scan failed:", error.message);
      }
    }, scanInterval);
  },

  /**
   * Start display timer to send photos to frontend
   */
  startDisplayTimer: function () {
    const updateInterval = this.config.updateInterval || 60000; // Default: 60 seconds

    this.log_info(`Starting display timer (${updateInterval / 1000}s per photo)`);

    this.displayTimer = setInterval(async () => {
      await this.sendNextPhoto();
    }, updateInterval);

    // Send first photo immediately
    setTimeout(() => this.sendNextPhoto(), 2000);
  },

  /**
   * Send next photo to frontend
   */
  sendNextPhoto: async function () {
    try {
      // Get next photo from database
      const photo = await this.database.getNextPhoto();

      if (!photo) {
        this.log_warn("No cached photos available to display");
        this.sendSocketNotification("UPDATE_STATUS", "Waiting for photos to cache...");
        return;
      }

      // Get image buffer (BLOB or file-based)
      let imageBuffer;

      if (photo.cached_data) {
        // BLOB mode: Data already in database
        imageBuffer = photo.cached_data;
        this.log_debug(`Loaded photo from BLOB: ${photo.filename}`);
      } else if (photo.cached_path) {
        // Legacy mode: Read from file
        imageBuffer = await fs.promises.readFile(photo.cached_path);
        this.log_debug(`Loaded photo from file: ${photo.filename}`);
      } else {
        this.log_error(`Photo ${photo.id} has no cached data`);
        return;
      }

      // Send to frontend
      this.sendSocketNotification("DISPLAY_PHOTO", {
        id: photo.id,
        image: imageBuffer.toString("base64"),
        filename: photo.filename,
        width: photo.width,
        height: photo.height
      });

      // Mark as viewed (fire-and-forget)
      this.database.markPhotoViewed(photo.id).catch(() => {});

      this.log_debug(`Sent photo: ${photo.filename}`);

    } catch (error) {
      this.log_error("Error sending photo:", error.message);
    }
  },

  /**
   * Send cache statistics to frontend
   */
  sendCacheStats: async function () {
    try {
      if (!this.cacheManager) {
        return;
      }

      const stats = await this.cacheManager.getStats();

      if (stats) {
        this.sendSocketNotification("CACHE_STATS", stats);
        this.log_debug("Cache stats:", stats);
      }

    } catch (error) {
      this.log_error("Error getting cache stats:", error.message);
    }
  },

  /**
   * Stop the module
   */
  stop: function () {
    this.log_info("Stopping module...");

    // Clear timers
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (this.displayTimer) {
      clearInterval(this.displayTimer);
      this.displayTimer = null;
    }

    // Stop cache manager
    if (this.cacheManager) {
      this.cacheManager.stop();
    }

    // Close database
    if (this.database) {
      this.database.close().catch(() => {});
    }

    this.log_info("Module stopped");
  }
};

module.exports = NodeHelper.create(NodeHelperObject);
