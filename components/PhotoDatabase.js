"use strict";

const fs = require("fs");
const path = require("path");
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");

/**
 * Photo Database Manager - Simplified schema for V3
 * Manages photo metadata in SQLite with minimal overhead
 */
class PhotoDatabase {
  /**
   * @param {string} dbPath - Path to SQLite database file
   * @param {Function} logger - Logging function
   */
  constructor(dbPath, logger = console.log) {
    this.dbPath = dbPath;
    this.log = logger;
    this.db = null;
  }

  /**
   * Initialize database with simple corruption recovery
   * 12-line recovery vs 171 lines in original design
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.log("[DB] Initializing database...");

      // Ensure cache directory exists
      const dbDir = path.dirname(this.dbPath);
      await fs.promises.mkdir(dbDir, { recursive: true });

      // Try to open database with quick integrity check
      try {
        this.db = await sqlite.open({
          filename: this.dbPath,
          driver: sqlite3.Database
        });

        // Quick integrity check (5s timeout)
        const check = await Promise.race([
          this.db.get("PRAGMA integrity_check"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 5000)
          )
        ]);

        if (check?.integrity_check !== "ok") {
          throw new Error("Database corrupt");
        }

        this.log("[DB] Database opened successfully");

        // Ensure schema exists (handles first-time setup)
        await this.createSchema();

      } catch (error) {
        // Simple recovery: delete and rebuild
        this.log("[DB] Corrupt or missing database, rebuilding...");

        if (this.db) {
          await this.db.close().catch(() => {});
          this.db = null;
        }

        await fs.promises.unlink(this.dbPath).catch(() => {});

        this.db = await sqlite.open({
          filename: this.dbPath,
          driver: sqlite3.Database
        });

        await this.createSchema();

        this.log("[DB] Rebuild complete, will trigger full scan");
      }

      // Enable foreign keys and optimize settings
      await this.db.exec("PRAGMA foreign_keys = ON");
      await this.db.exec("PRAGMA journal_mode = DELETE"); // Standard mode (simpler than WAL)
      await this.db.exec("PRAGMA synchronous = NORMAL");

      this.log("[DB] Database initialized successfully");

    } catch (error) {
      this.log("[DB] Initialization failed:", error.message);
      throw error;
    }
  }

  /**
   * Create simplified database schema
   * @returns {Promise<void>}
   */
  async createSchema() {
    try {
      this.log("[DB] Creating schema...");

      await this.db.exec(`
        -- Photos metadata
        CREATE TABLE IF NOT EXISTS photos (
          id TEXT PRIMARY KEY,
          folder_id TEXT NOT NULL,
          filename TEXT,
          creation_time INTEGER,
          width INTEGER,
          height INTEGER,

          -- Simple view tracking (no analytics)
          last_viewed_at INTEGER,

          -- Cache tracking
          cached_path TEXT,
          cached_at INTEGER,
          cached_size_bytes INTEGER
        );

        -- Settings (for Changes API token)
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        -- Two indexes only
        CREATE INDEX IF NOT EXISTS idx_display ON photos(cached_path, last_viewed_at)
          WHERE cached_path IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_prefetch ON photos(last_viewed_at)
          WHERE cached_path IS NULL;
      `);

      this.log("[DB] Schema created successfully");

    } catch (error) {
      this.log("[DB] Schema creation failed:", error.message);
      throw error;
    }
  }

  /**
   * Save or update a photo in the database
   * @param {Object} photo - Photo metadata from Drive API
   * @returns {Promise<void>}
   */
  async savePhoto(photo) {
    try {
      const creationTime = photo.createdTime ? new Date(photo.createdTime).getTime() : Date.now();
      const width = photo.imageMediaMetadata?.width || null;
      const height = photo.imageMediaMetadata?.height || null;
      const folderId = photo.parents?.[0] || "root";

      await this.db.run(`
        INSERT INTO photos (id, folder_id, filename, creation_time, width, height)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          folder_id = excluded.folder_id,
          filename = excluded.filename,
          creation_time = excluded.creation_time,
          width = excluded.width,
          height = excluded.height
      `, [photo.id, folderId, photo.name, creationTime, width, height]);

    } catch (error) {
      this.log(`[DB] Error saving photo ${photo.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Save multiple photos in a transaction (faster)
   * @param {Array} photos - Array of photo metadata
   * @returns {Promise<void>}
   */
  async savePhotos(photos) {
    try {
      this.log(`[DB] Saving ${photos.length} photos...`);

      await this.db.exec("BEGIN TRANSACTION");

      for (const photo of photos) {
        await this.savePhoto(photo);
      }

      await this.db.exec("COMMIT");

      this.log(`[DB] Successfully saved ${photos.length} photos`);

    } catch (error) {
      this.log("[DB] Error saving photos:", error.message);
      await this.db.exec("ROLLBACK").catch(() => {});
      throw error;
    }
  }

  /**
   * Delete a photo from the database
   * @param {string} photoId - Photo ID
   * @returns {Promise<void>}
   */
  async deletePhoto(photoId) {
    try {
      await this.db.run("DELETE FROM photos WHERE id = ?", [photoId]);
      this.log(`[DB] Deleted photo: ${photoId}`);

    } catch (error) {
      this.log(`[DB] Error deleting photo ${photoId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get next photo to display (cached photos only)
   * @returns {Promise<Object|null>} Photo metadata or null
   */
  async getNextPhoto() {
    try {
      const photo = await this.db.get(`
        SELECT id, cached_path, filename, width, height
        FROM photos
        WHERE cached_path IS NOT NULL
        ORDER BY last_viewed_at ASC NULLS FIRST, RANDOM()
        LIMIT 1
      `);

      return photo || null;

    } catch (error) {
      this.log("[DB] Error getting next photo:", error.message);
      throw error;
    }
  }

  /**
   * Update last_viewed_at timestamp for a photo
   * @param {string} photoId - Photo ID
   * @returns {Promise<void>}
   */
  async markPhotoViewed(photoId) {
    try {
      await this.db.run(
        "UPDATE photos SET last_viewed_at = ? WHERE id = ?",
        [Date.now(), photoId]
      );

    } catch (error) {
      this.log(`[DB] Error marking photo viewed ${photoId}:`, error.message);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Get photos that need caching (no cached_path)
   * @param {number} limit - Maximum number to return
   * @returns {Promise<Array>} Array of photos
   */
  async getPhotosToCache(limit = 5) {
    try {
      const photos = await this.db.all(`
        SELECT id, filename
        FROM photos
        WHERE cached_path IS NULL
        ORDER BY last_viewed_at ASC NULLS FIRST
        LIMIT ?
      `, [limit]);

      return photos;

    } catch (error) {
      this.log("[DB] Error getting photos to cache:", error.message);
      throw error;
    }
  }

  /**
   * Update cache information for a photo
   * @param {string} photoId - Photo ID
   * @param {string} cachedPath - Path to cached file
   * @param {number} sizeBytes - File size in bytes
   * @returns {Promise<void>}
   */
  async updatePhotoCache(photoId, cachedPath, sizeBytes) {
    try {
      await this.db.run(`
        UPDATE photos
        SET cached_path = ?, cached_at = ?, cached_size_bytes = ?
        WHERE id = ?
      `, [cachedPath, Date.now(), sizeBytes, photoId]);

    } catch (error) {
      this.log(`[DB] Error updating cache for ${photoId}:`, error.message);
      throw error;
    }
  }

  /**
   * Clear cache information for a photo
   * @param {string} photoId - Photo ID
   * @returns {Promise<void>}
   */
  async clearPhotoCache(photoId) {
    try {
      await this.db.run(`
        UPDATE photos
        SET cached_path = NULL, cached_at = NULL, cached_size_bytes = NULL
        WHERE id = ?
      `, [photoId]);

    } catch (error) {
      this.log(`[DB] Error clearing cache for ${photoId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get oldest cached photos (for eviction)
   * @param {number} limit - Number of photos to return
   * @returns {Promise<Array>} Array of photos with cache info
   */
  async getOldestCachedPhotos(limit = 10) {
    try {
      const photos = await this.db.all(`
        SELECT id, cached_path, cached_size_bytes
        FROM photos
        WHERE cached_path IS NOT NULL
        ORDER BY last_viewed_at ASC
        LIMIT ?
      `, [limit]);

      return photos;

    } catch (error) {
      this.log("[DB] Error getting oldest cached photos:", error.message);
      throw error;
    }
  }

  /**
   * Get total cache size in bytes
   * @returns {Promise<number>} Total size in bytes
   */
  async getCacheSizeBytes() {
    try {
      const result = await this.db.get(`
        SELECT COALESCE(SUM(cached_size_bytes), 0) as total_size
        FROM photos
        WHERE cached_path IS NOT NULL
      `);

      return result?.total_size || 0;

    } catch (error) {
      this.log("[DB] Error getting cache size:", error.message);
      return 0;
    }
  }

  /**
   * Get count of cached photos
   * @returns {Promise<number>} Number of cached photos
   */
  async getCachedPhotoCount() {
    try {
      const result = await this.db.get(`
        SELECT COUNT(*) as count
        FROM photos
        WHERE cached_path IS NOT NULL
      `);

      return result?.count || 0;

    } catch (error) {
      this.log("[DB] Error getting cached photo count:", error.message);
      return 0;
    }
  }

  /**
   * Get total photo count
   * @returns {Promise<number>} Total number of photos
   */
  async getTotalPhotoCount() {
    try {
      const result = await this.db.get("SELECT COUNT(*) as count FROM photos");
      return result?.count || 0;

    } catch (error) {
      this.log("[DB] Error getting total photo count:", error.message);
      return 0;
    }
  }

  /**
   * Save a setting
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<void>}
   */
  async saveSetting(key, value) {
    try {
      await this.db.run(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [key, value]);

    } catch (error) {
      this.log(`[DB] Error saving setting ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Get a setting
   * @param {string} key - Setting key
   * @returns {Promise<string|null>} Setting value or null
   */
  async getSetting(key) {
    try {
      const result = await this.db.get(
        "SELECT value FROM settings WHERE key = ?",
        [key]
      );

      return result?.value || null;

    } catch (error) {
      this.log(`[DB] Error getting setting ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Execute a custom query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    try {
      return await this.db.all(sql, params);

    } catch (error) {
      this.log("[DB] Query error:", error.message);
      throw error;
    }
  }

  /**
   * Execute a custom statement
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<Object>} Statement result
   */
  async run(sql, params = []) {
    try {
      return await this.db.run(sql, params);

    } catch (error) {
      this.log("[DB] Run error:", error.message);
      throw error;
    }
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    try {
      if (this.db) {
        await this.db.close();
        this.db = null;
        this.log("[DB] Database closed");
      }

    } catch (error) {
      this.log("[DB] Error closing database:", error.message);
      throw error;
    }
  }
}

module.exports = PhotoDatabase;
