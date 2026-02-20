"use strict";

const fs = require("fs");
const path = require("path");
const { finished } = require("stream/promises");
const { Readable } = require("stream");
const fetch = require("node-fetch");

// Optional: Sharp for image processing (install with: npm install sharp)
let sharp = null;
try {
  sharp = require("sharp");
} catch (e) {
  console.log("[CACHE] Sharp not available, using file-based caching");
}

/**
 * Cache Manager with Graceful Degradation
 * Manages photo downloading and cache eviction with network resilience
 */
class CacheManager {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} db - PhotoDatabase instance
   * @param {Object} photoProvider - Cloud storage provider instance (BaseProvider)
   * @param {Function} logger - Logging function
   */
  constructor(config, db, photoProvider, logger = console.log) {
    this.config = config;
    this.db = db;
    this.provider = photoProvider;
    this.log = logger;

    this.isRunning = false;
    this.consecutiveFailures = 0;  // Track failures for graceful degradation
    this.tickInterval = 30000;     // Fixed 30-second tick

    // BLOB storage mode (enabled when sharp is available)
    this.useBlobStorage = sharp !== null && (config.useBlobStorage !== false);

    // Image processing settings
    this.screenWidth = config.showWidth || 1920;
    this.screenHeight = config.showHeight || 1080;
    this.jpegQuality = config.jpegQuality || 85;

    // Geocoding cache
    this.geocodeCache = {};

    // Start the tick timer
    this.timer = setInterval(() => this.tick(), this.tickInterval);

    this.log(`[CACHE] Cache manager initialized (BLOB mode: ${this.useBlobStorage ? 'enabled' : 'disabled'})`);
    if (this.useBlobStorage) {
      this.log(`[CACHE] Image processing: ${this.screenWidth}x${this.screenHeight} @ ${this.jpegQuality}% quality`);
    }
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

      // Step 3: Skip downloads if provider not available
      if (!this.provider) {
        this.log("[CACHE] Provider not initialized - skipping downloads (offline mode)");
        return;
      }

      // Step 4: Graceful degradation - skip downloads if offline
      if (this.consecutiveFailures > 3) {
        this.log(`[CACHE] Offline detected (${this.consecutiveFailures} consecutive failures) - skipping downloads`);
        await this.sleep(60000); // Wait 1 minute before retry
        this.consecutiveFailures = 0; // Reset to try again
        return;
      }

      // Step 5: Download next batch (FIXED: 5 photos)
      const photos = await this.db.getPhotosToCache(5);

      if (photos.length === 0) {
        this.log("[CACHE] No photos need caching");
        return;
      }

      this.log(`[CACHE] Downloading batch of ${photos.length} photos...`);

      // Step 6: Batch download with failure tracking
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
      // Check if provider is available
      if (!this.provider) {
        throw new Error("Provider not initialized - offline mode");
      }

      // Retry loop with exponential backoff
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.log(`[CACHE] Downloading photo ${photoId} (attempt ${attempt}/${maxRetries})...`);

          const stream = await this.provider.downloadPhoto(photoId, { timeout: 30000 });

          // BLOB mode: Process and store in database
          if (this.useBlobStorage) {
            return await this.processAndStoreBlob(photoId, stream);
          }

          // File mode: Save to file (with resizing if Sharp available)
          const cacheDir = this.config.cachePath || path.resolve(__dirname, "..", "cache", "images");
          await fs.promises.mkdir(cacheDir, { recursive: true });

          const filePath = path.join(cacheDir, `${photoId}.jpg`);

          // If Sharp is available, resize even in file mode
          if (sharp) {
            // Stream to buffer
            const chunks = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            const originalBuffer = Buffer.concat(chunks);

            this.log(`[CACHE] Processing ${photoId} (${(originalBuffer.length / 1024).toFixed(2)}KB)`);

            // Resize and compress with sharp
            const processedBuffer = await sharp(originalBuffer)
              .resize(this.screenWidth, this.screenHeight, {
                fit: 'inside',          // Maintain aspect ratio
                withoutEnlargement: true // Don't upscale small images
              })
              .jpeg({
                quality: this.jpegQuality,
                progressive: true,
                mozjpeg: true
              })
              .toBuffer();

            // Write processed buffer to file
            await fs.promises.writeFile(filePath, processedBuffer);

            this.log(`[CACHE] Saved ${photoId}: ${(originalBuffer.length / 1024).toFixed(2)}KB → ${(processedBuffer.length / 1024).toFixed(2)}KB`);

            await this.db.updatePhotoCache(photoId, filePath, processedBuffer.length);

            // Perform reverse geocoding if photo has location data (fire and forget)
            this.reverseGeocodePhoto(photoId).catch(() => {});

            return { success: true, photoId, size: processedBuffer.length };

          } else {
            // No Sharp - download directly without resizing
            const writeStream = fs.createWriteStream(filePath);
            await finished(stream.pipe(writeStream));

            const stats = await fs.promises.stat(filePath);
            await this.db.updatePhotoCache(photoId, filePath, stats.size);

            this.log(`[CACHE] Downloaded ${photoId} (${(stats.size / 1024).toFixed(2)}KB) - no resizing (Sharp not available)`);

            // Perform reverse geocoding if photo has location data (fire and forget)
            this.reverseGeocodePhoto(photoId).catch(() => {});

            return { success: true, photoId, size: stats.size };
          }

        } catch (error) {
          if (attempt === maxRetries) {
            throw error;
          }

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
   * Process image stream and store as BLOB with resizing
   * @param {string} photoId - Photo ID
   * @param {Stream} stream - Image stream from Drive
   * @returns {Promise<Object>} Processing result
   */
  async processAndStoreBlob(photoId, stream) {
    try {
      // Stream to buffer
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const originalBuffer = Buffer.concat(chunks);

      this.log(`[CACHE] Processing ${photoId} (${(originalBuffer.length / 1024).toFixed(2)}KB)`);

      // Resize and compress with sharp
      const processedBuffer = await sharp(originalBuffer)
        .resize(this.screenWidth, this.screenHeight, {
          fit: 'inside',          // Maintain aspect ratio
          withoutEnlargement: true // Don't upscale small images
        })
        .jpeg({
          quality: this.jpegQuality,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();

      // Store in database
      await this.db.updatePhotoCacheBlob(photoId, processedBuffer, 'image/jpeg');

      this.log(`[CACHE] Stored BLOB ${photoId}: ${(originalBuffer.length / 1024).toFixed(2)}KB → ${(processedBuffer.length / 1024).toFixed(2)}KB`);

      // Perform reverse geocoding if photo has location data (fire and forget)
      this.reverseGeocodePhoto(photoId).catch(() => {});

      return { success: true, photoId, size: processedBuffer.length };

    } catch (error) {
      this.log(`[CACHE] Failed to process ${photoId}:`, error.message);
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
   * Reverse geocode a photo's location
   * @param {string} photoId - Photo ID
   * @returns {Promise<void>}
   */
  async reverseGeocodePhoto(photoId) {
    try {
      // Get photo metadata from database
      const photo = await this.db.db.get(
        "SELECT latitude, longitude FROM photos WHERE id = ?",
        [photoId]
      );

      if (!photo || photo.latitude == null || photo.longitude == null) {
        // No location data, nothing to geocode
        return;
      }

      const { latitude, longitude } = photo;
      const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`; // Round to ~1km precision

      // Check cache first
      if (this.geocodeCache[cacheKey]) {
        await this.db.updateLocationName(photoId, this.geocodeCache[cacheKey]);
        this.log(`[GEOCODE] Cached location for ${photoId}: ${this.geocodeCache[cacheKey]}`);
        return;
      }

      // Perform API request with timeout
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'MMM-CloudPhotos'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.log(`[GEOCODE] API error for ${photoId}: ${response.status}`);
        return;
      }

      const data = await response.json();

      if (data && data.address) {
        // Build location string from most to least specific
        const parts = [];

        if (data.address.city) {
          parts.push(data.address.city);
        } else if (data.address.town) {
          parts.push(data.address.town);
        } else if (data.address.village) {
          parts.push(data.address.village);
        }

        if (data.address.state) {
          parts.push(data.address.state);
        }

        if (data.address.country) {
          parts.push(data.address.country);
        }

        const locationName = parts.join(", ");

        if (locationName) {
          // Update database and cache
          await this.db.updateLocationName(photoId, locationName);
          this.geocodeCache[cacheKey] = locationName;
          this.log(`[GEOCODE] Resolved ${photoId}: ${locationName}`);
        }
      }

      // Respect Nominatim usage policy: max 1 request per second
      await this.sleep(1000);

    } catch (error) {
      // Silently fail - geocoding is non-critical
      if (error.name !== 'AbortError') {
        this.log(`[GEOCODE] Failed for ${photoId}:`, error.message);
      }
    }
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
