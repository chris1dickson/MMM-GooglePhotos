"use strict";

const fs = require("fs");
const path = require("path");
const { finished } = require("stream/promises");

/**
 * Cache Manager with Graceful Degradation
 * Manages photo downloading and cache eviction with network resilience
 */
class CacheManager {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} db - PhotoDatabase instance
   * @param {Object} driveAPI - GDriveAPI instance
   * @param {Function} logger - Logging function
   */
  constructor(config, db, driveAPI, logger = console.log) {
    this.config = config;
    this.db = db;
    this.drive = driveAPI;
    this.log = logger;

    this.isRunning = false;
    this.consecutiveFailures = 0;  // Track failures for graceful degradation
    this.tickInterval = 30000;     // Fixed 30-second tick

    // Start the tick timer
    this.timer = setInterval(() => this.tick(), this.tickInterval);

    this.log("[CACHE] Cache manager initialized");
  }

  /**
   * Main tick function - runs every 30 seconds
   * Manages cache size and downloads new photos
   * @returns {Promise<void>}
   */
  async tick() {
    if (this.isRunning) {
      return; // Skip if previous tick still running
    }

    this.isRunning = true;

    try {
      // Step 1: Check cache size
      const cacheSize = await this.db.getCacheSizeBytes();
      const maxCacheSizeMB = this.config.maxCacheSizeMB || 200;
      const maxCacheBytes = maxCacheSizeMB * 1024 * 1024;

      this.log(`[CACHE] Current cache size: ${(cacheSize / 1024 / 1024).toFixed(2)}MB / ${maxCacheSizeMB}MB`);

      // Step 2: Evict if over limit
      if (cacheSize > maxCacheBytes) {
        this.log("[CACHE] Cache over limit, evicting oldest photos...");
        await this.evictOldest(10);
      }

      // Step 3: Graceful degradation - skip downloads if offline
      if (this.consecutiveFailures > 3) {
        this.log(`[CACHE] Offline detected (${this.consecutiveFailures} consecutive failures) - skipping downloads`);
        await this.sleep(60000); // Wait 1 minute before retry
        this.consecutiveFailures = 0; // Reset to try again
        return;
      }

      // Step 4: Download next batch (FIXED: 5 photos)
      const photos = await this.db.getPhotosToCache(5);

      if (photos.length === 0) {
        this.log("[CACHE] No photos need caching");
        return;
      }

      this.log(`[CACHE] Downloading batch of ${photos.length} photos...`);

      // Step 5: Batch download with failure tracking
      const results = await Promise.allSettled(
        photos.map(p => this.downloadPhoto(p.id))
      );

      const failures = results.filter(r => r.status === "rejected").length;
      const successes = results.filter(r => r.status === "fulfilled").length;

      this.log(`[CACHE] Batch complete: ${successes} succeeded, ${failures} failed`);

      // Track failures for graceful degradation
      if (failures === photos.length) {
        // All downloads failed
        this.consecutiveFailures++;
        this.log(`[CACHE] All downloads failed (${this.consecutiveFailures}/3)`);
      } else {
        // At least one success - reset counter
        this.consecutiveFailures = 0;
      }

    } catch (error) {
      this.log("[CACHE] Tick error:", error.message);
      this.consecutiveFailures++;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Download a single photo from Drive
   * @param {string} photoId - Photo ID
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} Download result
   */
  async downloadPhoto(photoId, maxRetries = 3) {
    try {
      // Retry loop with exponential backoff
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Get cache directory
          const cacheDir = this.config.cachePath || path.resolve(__dirname, "..", "cache", "images");
          await fs.promises.mkdir(cacheDir, { recursive: true });

          // Download from Drive with timeout
          this.log(`[CACHE] Downloading photo ${photoId} (attempt ${attempt}/${maxRetries})...`);

          const stream = await this.drive.downloadPhoto(photoId, { timeout: 30000 });

          // Save to file
          const filePath = path.join(cacheDir, `${photoId}.jpg`);
          const writeStream = fs.createWriteStream(filePath);

          await finished(stream.pipe(writeStream));

          // Get file size
          const stats = await fs.promises.stat(filePath);

          // Update database
          await this.db.updatePhotoCache(photoId, filePath, stats.size);

          this.log(`[CACHE] Successfully downloaded ${photoId} (${(stats.size / 1024).toFixed(2)}KB)`);

          return { success: true, photoId, size: stats.size };

        } catch (error) {
          if (attempt === maxRetries) {
            throw error; // Give up after max retries
          }

          // Exponential backoff: 1s, 2s, 3s
          this.log(`[CACHE] Attempt ${attempt} failed for ${photoId}, retrying...`);
          await this.sleep(attempt * 1000);
        }
      }

    } catch (error) {
      this.log(`[CACHE] Failed to download ${photoId}:`, error.message);
      throw error;
    }
  }

  /**
   * Evict oldest cached photos
   * @param {number} count - Number of photos to evict
   * @returns {Promise<void>}
   */
  async evictOldest(count) {
    try {
      this.log(`[CACHE] Evicting ${count} oldest photos...`);

      const photos = await this.db.getOldestCachedPhotos(count);

      if (photos.length === 0) {
        this.log("[CACHE] No photos to evict");
        return;
      }

      // Delete files in parallel (use allSettled to continue even if some fail)
      const deleteResults = await Promise.allSettled(
        photos.map(p => fs.promises.unlink(p.cached_path))
      );

      const deletedCount = deleteResults.filter(r => r.status === "fulfilled").length;

      // Update database (clear cache info)
      for (const photo of photos) {
        await this.db.clearPhotoCache(photo.id);
      }

      this.log(`[CACHE] Evicted ${deletedCount}/${photos.length} photos`);

    } catch (error) {
      this.log("[CACHE] Eviction error:", error.message);
      throw error;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache stats
   */
  async getStats() {
    try {
      const totalSize = await this.db.getCacheSizeBytes();
      const cachedCount = await this.db.getCachedPhotoCount();
      const totalCount = await this.db.getTotalPhotoCount();
      const maxSizeMB = this.config.maxCacheSizeMB || 200;

      return {
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        maxSizeMB: maxSizeMB,
        usagePercent: ((totalSize / (maxSizeMB * 1024 * 1024)) * 100).toFixed(1),
        cachedCount: cachedCount,
        totalCount: totalCount,
        cachePercent: ((cachedCount / totalCount) * 100).toFixed(1),
        consecutiveFailures: this.consecutiveFailures,
        isOffline: this.consecutiveFailures > 3
      };

    } catch (error) {
      this.log("[CACHE] Error getting stats:", error.message);
      return null;
    }
  }

  /**
   * Manually trigger cache cleanup
   * @param {number} targetSizeMB - Target cache size in MB
   * @returns {Promise<void>}
   */
  async cleanup(targetSizeMB) {
    try {
      this.log(`[CACHE] Manual cleanup to ${targetSizeMB}MB...`);

      const currentSize = await this.db.getCacheSizeBytes();
      const targetBytes = targetSizeMB * 1024 * 1024;

      if (currentSize <= targetBytes) {
        this.log("[CACHE] Cache already under target size");
        return;
      }

      // Calculate how many photos to evict
      const photos = await this.db.getOldestCachedPhotos(100);
      let totalEvicted = 0;
      let photosToEvict = [];

      for (const photo of photos) {
        photosToEvict.push(photo);
        totalEvicted += photo.cached_size_bytes || 0;

        if ((currentSize - totalEvicted) <= targetBytes) {
          break;
        }
      }

      // Evict selected photos
      for (const photo of photosToEvict) {
        await fs.promises.unlink(photo.cached_path).catch(() => {});
        await this.db.clearPhotoCache(photo.id);
      }

      this.log(`[CACHE] Cleanup complete. Evicted ${photosToEvict.length} photos`);

    } catch (error) {
      this.log("[CACHE] Cleanup error:", error.message);
      throw error;
    }
  }

  /**
   * Reset consecutive failures counter (for testing/recovery)
   */
  resetFailureCounter() {
    this.log("[CACHE] Resetting failure counter");
    this.consecutiveFailures = 0;
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Stop the cache manager
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log("[CACHE] Cache manager stopped");
    }
  }
}

module.exports = CacheManager;
