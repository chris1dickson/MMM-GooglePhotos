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
    this.authRetryTimer = null;

    // Authentication retry state
    this.authRetryAttempts = 0;
    this.maxAuthRetries = Infinity; // Will be set from config during initialize
    this.maxBackoffMs = 120000; // Will be set from config during initialize
    this.providerInitialized = false;
    this.isRetryScheduled = false; // Prevent duplicate retry scheduling

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
   * Validate maxAuthRetries configuration
   * @param {number|undefined} value - User-provided maxAuthRetries
   * @returns {number} Validated maxAuthRetries value
   */
  validateMaxAuthRetries: function (value) {
    if (value === undefined) {
      return Infinity; // Default: retry forever
    }

    if (value === Infinity || value === "Infinity") {
      return Infinity;
    }

    const parsed = Number(value);
    if (isNaN(parsed) || parsed < 0) {
      this.log_warn(`Invalid maxAuthRetries: ${value}. Using default: Infinity`);
      return Infinity;
    }

    if (parsed === 0) {
      this.log_warn("maxAuthRetries set to 0 - module will NOT retry on failure!");
    }

    return Math.floor(parsed); // Ensure integer
  },

  /**
   * Validate maxAuthBackoffMs configuration
   * @param {number|undefined} value - User-provided maxAuthBackoffMs
   * @returns {number} Validated maxAuthBackoffMs value
   */
  validateMaxBackoffMs: function (value) {
    const DEFAULT = 120000; // 2 minutes
    const MIN = 5000;      // 5 seconds (minimum safe)
    const MAX = 600000;    // 10 minutes (maximum reasonable)

    if (value === undefined) {
      return DEFAULT;
    }

    const parsed = Number(value);
    if (isNaN(parsed) || parsed < MIN) {
      this.log_warn(`Invalid maxAuthBackoffMs: ${value}. Using default: ${DEFAULT}ms`);
      return DEFAULT;
    }

    if (parsed > MAX) {
      this.log_warn(`maxAuthBackoffMs too large: ${value}ms. Capping at ${MAX}ms`);
      return MAX;
    }

    return Math.floor(parsed); // Ensure integer
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

      // Validate and configure authentication retry behavior
      this.maxAuthRetries = this.validateMaxAuthRetries(config.maxAuthRetries);
      this.maxBackoffMs = this.validateMaxBackoffMs(config.maxAuthBackoffMs);

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

      // Initialize cloud storage provider with retry
      await this.initializeProvider();

      // Initialize cache manager (even if provider failed - for offline mode)
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
        () => this.photoProvider, // Use getter to prevent stale provider reference
        this.log_info.bind(this)
      );

      this.initialized = true;
      this.log_info("✅ Initialization complete!");

      // Check if we have cached photos
      const cachedCount = await this.database.getCachedPhotoCount();
      if (cachedCount > 0) {
        this.log_info(`Found ${cachedCount} cached photos - ready to display`);
      }

      // Start initial scan (only if provider initialized)
      if (this.providerInitialized) {
        this.sendSocketNotification("CONNECTION_STATUS", {
          status: "online",
          message: `Online - ${cachedCount} photos available`
        });
        await this.performInitialScan();
        this.startPeriodicScanning();
      } else {
        this.log_warn("Provider not initialized - running in offline mode");
        this.sendSocketNotification("CONNECTION_STATUS", {
          status: "offline",
          message: `Offline - ${cachedCount} cached photos`
        });
      }

      // Always start display timer (show cached photos)
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
   * Initialize cloud provider with retry logic
   */
  initializeProvider: async function () {
    const providerName = this.config.provider || "google-drive";
    const providerConfig = this.config.providerConfig || {
      keyFilePath: this.config.keyFilePath || "./google_drive_auth.json",
      tokenPath: this.config.tokenPath || "./token_drive.json",
      driveFolders: this.config.driveFolders || []
    };

    this.log_info(`Initializing cloud provider: ${providerName}...`);
    this.photoProvider = createProvider(providerName, providerConfig, this.log_info.bind(this));

    // Set database reference for providers that support incremental sync
    if (typeof this.photoProvider.setDatabase === 'function') {
      this.photoProvider.setDatabase(this.database);
    }

    // Try to initialize with immediate attempt
    try {
      await this.photoProvider.initialize();
      this.providerInitialized = true;
      this.authRetryAttempts = 0;
      this.log_info(`✅ Provider ${providerName} initialized successfully`);
      return;
    } catch (error) {
      this.log_warn(`Provider initialization failed: ${error.message}`);
      this.log_info("Will retry in background with exponential backoff");
      this.providerInitialized = false;

      // Start background retry
      this.scheduleProviderRetry();
    }
  },

  /**
   * Schedule provider initialization retry with exponential backoff
   */
  scheduleProviderRetry: function () {
    // Prevent race condition - only one retry can be scheduled at a time
    if (this.isRetryScheduled) {
      this.log_debug("Retry already scheduled, ignoring duplicate request");
      return;
    }
    this.isRetryScheduled = true;

    // Clear any existing retry timer
    if (this.authRetryTimer) {
      clearTimeout(this.authRetryTimer);
      this.authRetryTimer = null;
    }

    // Check if we've exceeded max retries
    if (this.authRetryAttempts >= this.maxAuthRetries) {
      this.log_error(`Maximum authentication retries (${this.maxAuthRetries}) reached. Staying in offline mode.`);
      this.sendSocketNotification("UPDATE_STATUS", "Offline - max retries exceeded");
      this.isRetryScheduled = false; // Clear flag
      return;
    }

    this.authRetryAttempts++;

    // Calculate backoff: 5s, 10s, 20s, 40s, 80s, 120s, 120s, ... (capped at maxBackoffMs)
    const backoffMs = Math.min(5000 * Math.pow(2, this.authRetryAttempts - 1), this.maxBackoffMs);

    const maxRetriesMsg = this.maxAuthRetries === Infinity ? '∞' : this.maxAuthRetries;
    this.log_info(`Scheduling authentication retry #${this.authRetryAttempts}/${maxRetriesMsg} in ${backoffMs / 1000}s`);

    // Update frontend with retry status
    this.sendSocketNotification("CONNECTION_STATUS", {
      status: "offline",
      message: `Offline - retrying in ${Math.ceil(backoffMs / 1000)}s`
    });

    this.authRetryTimer = setTimeout(async () => {
      this.isRetryScheduled = false; // Clear flag before retry
      await this.retryProviderInitialization();
    }, backoffMs);
  },

  /**
   * Retry provider initialization
   */
  retryProviderInitialization: async function () {
    if (this.providerInitialized) {
      this.log_info("Provider already initialized, skipping retry");
      return;
    }

    const maxRetriesMsg = this.maxAuthRetries === Infinity ? '∞' : this.maxAuthRetries;
    this.log_info(`Retrying provider initialization (attempt ${this.authRetryAttempts}/${maxRetriesMsg})...`);

    // Update frontend with retrying status
    this.sendSocketNotification("CONNECTION_STATUS", {
      status: "retrying",
      message: `Reconnecting (attempt ${this.authRetryAttempts})...`
    });

    try {
      await this.photoProvider.initialize();
      this.providerInitialized = true;
      this.authRetryAttempts = 0;

      this.log_info("✅ Provider initialized successfully after retry!");

      // Update frontend with success
      const cachedCount = await this.database.getCachedPhotoCount();
      this.sendSocketNotification("CONNECTION_STATUS", {
        status: "online",
        message: `Connected - syncing photos...`
      });

      // Now that we're online, start scanning and periodic sync
      await this.performInitialScan();
      this.startPeriodicScanning();

    } catch (error) {
      this.log_warn(`Retry ${this.authRetryAttempts} failed: ${error.message}`);

      // Schedule next retry
      this.scheduleProviderRetry();
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
      }

      // Always update status with current database counts (not just when photos.length > 0)
      const totalCount = await this.database.getTotalPhotoCount();
      const cachedCount = await this.database.getCachedPhotoCount();

      if (totalCount === 0) {
        this.log_warn("No photos found in configured folders");
        this.sendSocketNotification("CONNECTION_STATUS", {
          status: "online",
          message: "Online - no photos found"
        });
      } else {
        if (photos.length > 0) {
          this.log_info(`Database now has ${totalCount} photos (${cachedCount} cached)`);
        } else {
          this.log_info(`No changes detected. Database has ${totalCount} photos (${cachedCount} cached)`);
        }
        this.sendSocketNotification("CONNECTION_STATUS", {
          status: "online",
          message: `Online - ${totalCount} photos`
        });
      }

    } catch (error) {
      this.log_error("Initial scan failed:", error.message);

      // Check if this is a network error
      if (this.isNetworkError(error)) {
        this.log_warn("Network error during initial scan - marking provider as offline");

        // Mark provider as offline
        this.providerInitialized = false;

        // Update frontend status
        const cachedCount = await this.database.getCachedPhotoCount();
        this.sendSocketNotification("CONNECTION_STATUS", {
          status: "offline",
          message: `Offline - ${cachedCount} cached photos`
        });

        // Start retry mechanism
        this.authRetryAttempts = 0;
        this.scheduleProviderRetry();
      } else {
        // Non-network error - notify user
        this.sendSocketNotification("ERROR", `Scan failed: ${error.message}`);
      }
    }
  },

  /**
   * Start periodic scanning for new photos
   */
  startPeriodicScanning: function () {
    // Don't start if already running
    if (this.scanTimer) {
      this.log_warn("Periodic scanning already running");
      return;
    }

    const scanInterval = this.config.scanInterval || (6 * 60 * 60 * 1000); // Default: 6 hours

    this.log_info(`Setting up periodic scan every ${scanInterval / 1000 / 60} minutes`);

    this.scanTimer = setInterval(async () => {
      try {
        // Skip if provider not initialized
        if (!this.providerInitialized) {
          this.log_info("Periodic scan skipped - provider not initialized (offline mode)");
          return;
        }

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

        // Check if this is a network/authentication error
        if (this.isNetworkError(error)) {
          this.log_warn("Network error detected - marking provider as offline and starting retry");

          // Mark provider as offline
          this.providerInitialized = false;

          // Update frontend status
          const cachedCount = await this.database.getCachedPhotoCount();
          this.sendSocketNotification("CONNECTION_STATUS", {
            status: "offline",
            message: `Offline - ${cachedCount} cached photos`
          });

          // Start retry mechanism
          this.authRetryAttempts = 0; // Reset counter for fresh start
          this.scheduleProviderRetry();
        }
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
        height: photo.height,
        creation_time: photo.creation_time,
        location_name: photo.location_name
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
   * Check if an error is network-related (transient, retryable)
   * @param {Error} error - Error to check
   * @returns {boolean} True if transient network error (should retry)
   */
  isNetworkError: function (error) {
    if (!error) return false;

    const message = error.message ? error.message.toLowerCase() : '';
    const code = error.code ? error.code.toUpperCase() : '';

    // Permanent errors - do NOT retry
    const permanentPatterns = [
      'invalid_grant',      // OAuth token permanently revoked
      'permission denied',  // Insufficient permissions
      'folder not found',   // Invalid folder ID
      'invalid folder',     // Invalid configuration
      '403 forbidden'       // Permanent access denial
    ];

    // Check for permanent errors first
    if (permanentPatterns.some(pattern => message.includes(pattern))) {
      this.log_warn(`Permanent error detected: ${error.message}`);
      return false; // Not retryable
    }

    // Transient network error codes
    const networkCodes = [
      'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
      'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
      'EHOSTDOWN', 'ENETDOWN', 'EPIPE'
    ];

    // Transient network error messages
    const networkMessages = [
      'network', 'offline', 'timeout', 'connection',
      'authentication failed', 'auth', 'token expired', 'enotfound'
    ];

    return networkCodes.includes(code) ||
           networkMessages.some(msg => message.includes(msg));
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

    if (this.authRetryTimer) {
      clearTimeout(this.authRetryTimer);
      this.authRetryTimer = null;
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
