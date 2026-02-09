"use strict";

/**
 * BaseProvider - Abstract interface for cloud storage providers
 *
 * All cloud photo providers must extend this class and implement its methods.
 * This ensures consistent behavior across different storage backends.
 */
class BaseProvider {
  /**
   * @param {Object} config - Provider-specific configuration
   * @param {Function} logger - Logging function
   */
  constructor(config, logger) {
    if (new.target === BaseProvider) {
      throw new TypeError("Cannot instantiate abstract class BaseProvider directly");
    }

    this.config = config;
    this.log = logger || console.log;
  }

  /**
   * Initialize the provider (authenticate, setup API clients, etc.)
   * @returns {Promise<void>}
   * @abstract
   */
  async initialize() {
    throw new Error("Method 'initialize()' must be implemented by provider");
  }

  /**
   * Scan a folder for photos
   * @param {string} folderId - The folder ID to scan
   * @param {number} depth - How many levels deep to scan (0 = current folder only)
   * @param {boolean} recursive - Whether to scan recursively
   * @returns {Promise<Array<Object>>} Array of photo objects with standard format:
   *   {
   *     id: string,
   *     name: string,
   *     parents: string[],
   *     createdTime: string (ISO 8601),
   *     imageMediaMetadata: { width: number, height: number }
   *   }
   * @abstract
   */
  async scanFolder(folderId, depth = 0, recursive = false) {
    throw new Error("Method 'scanFolder()' must be implemented by provider");
  }

  /**
   * Download a photo by ID
   * @param {string} photoId - The photo ID to download
   * @param {Object} options - Download options (e.g., { timeout: 30000 })
   * @returns {Promise<stream.Readable>} Readable stream of photo data
   * @abstract
   */
  async downloadPhoto(photoId, options = {}) {
    throw new Error("Method 'downloadPhoto()' must be implemented by provider");
  }

  /**
   * Get changes since a given token (for incremental sync)
   * @param {string} changeToken - Token from previous sync
   * @returns {Promise<Object>} Object with:
   *   {
   *     photos: Array<Object>,    // New/modified photos
   *     deletedIds: Array<string>, // Deleted photo IDs
   *     nextToken: string          // Token for next sync
   *   }
   * @optional - Not all providers support this
   */
  async getChanges(changeToken) {
    // Default: Not supported
    this.log(`[${this.getProviderName()}] Incremental sync not supported`);
    return { photos: [], deletedIds: [], nextToken: null };
  }

  /**
   * Get a start page token for incremental sync
   * @returns {Promise<string|null>} Change token, or null if not supported
   * @optional - Not all providers support this
   */
  async getStartPageToken() {
    // Default: Not supported
    return null;
  }

  /**
   * Get the provider name (for logging and identification)
   * @returns {string} Provider name (e.g., "Google Drive", "OneDrive")
   * @abstract
   */
  getProviderName() {
    throw new Error("Method 'getProviderName()' must be implemented by provider");
  }

  /**
   * Clean up resources (close connections, clear caches, etc.)
   * @returns {Promise<void>}
   * @optional - Override if cleanup needed
   */
  async cleanup() {
    // Default: No cleanup needed
  }
}

module.exports = BaseProvider;
