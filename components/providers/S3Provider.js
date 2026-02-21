"use strict";

const fs = require("fs");
const path = require("path");
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const { fromIni } = require("@aws-sdk/credential-providers");
const BaseProvider = require("./BaseProvider");

/**
 * Sleep helper function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Amazon S3 Provider for MMM-CloudPhotos
 * Supports AWS S3 and S3-compatible storage services (MinIO, Backblaze B2, etc.)
 * @extends BaseProvider
 */
class S3Provider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   * @param {string} config.bucketName - S3 bucket name (required)
   * @param {string} config.region - AWS region (required)
   * @param {string} [config.credentialsPath] - Path to credentials JSON file
   * @param {string} [config.profile] - AWS profile name from ~/.aws/credentials
   * @param {string} [config.endpoint] - Custom endpoint for S3-compatible services
   * @param {boolean} [config.forcePathStyle] - Force path-style URLs (for MinIO, etc.)
   * @param {number} [config.maxKeys] - Max objects per LIST request (default: 1000)
   * @param {string} [config.bucketPrefix] - Default prefix to scan (default: "")
   * @param {Function} logger - Logging function
   */
  constructor(config, logger) {
    super(config, logger);
    this.s3Client = null;
    this.db = null;

    // Image file extensions to look for
    this.imageExtensions = new Set([
      ".jpg", ".jpeg", ".png", ".gif", ".webp",
      ".bmp", ".tiff", ".tif", ".heic", ".heif"
    ]);

    // Validate required config
    if (!config.bucketName) {
      throw new Error("S3Provider requires 'bucketName' in configuration");
    }
    if (!config.region) {
      throw new Error("S3Provider requires 'region' in configuration");
    }
  }

  /**
   * Set database reference (needed for incremental sync)
   * @param {Object} db - PhotoDatabase instance
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * Initialize S3 client with authentication
   * Supports three authentication methods:
   * 1. Credentials file (credentialsPath)
   * 2. Named profile (profile)
   * 3. Default credential chain (IAM role, env vars, etc.)
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.log("[S3] Initializing S3 client...");

      // Build S3 client configuration
      const clientConfig = {
        region: this.config.region
      };

      // Add custom endpoint if provided (for S3-compatible services)
      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
        this.log(`[S3] Using custom endpoint: ${this.config.endpoint}`);
      }

      // Force path-style URLs if needed (MinIO, some S3-compatible services)
      if (this.config.forcePathStyle) {
        clientConfig.forcePathStyle = true;
        this.log("[S3] Using path-style URLs");
      }

      // Authentication: Method 1 - Credentials file
      if (this.config.credentialsPath) {
        const credentialsPath = path.isAbsolute(this.config.credentialsPath)
          ? this.config.credentialsPath
          : path.resolve(__dirname, "../..", this.config.credentialsPath);

        this.log(`[S3] Loading credentials from: ${credentialsPath}`);

        const credentialsFile = JSON.parse(
          await fs.promises.readFile(credentialsPath, "utf8")
        );

        clientConfig.credentials = {
          accessKeyId: credentialsFile.accessKeyId,
          secretAccessKey: credentialsFile.secretAccessKey,
          ...(credentialsFile.sessionToken && { sessionToken: credentialsFile.sessionToken })
        };

        this.log("[S3] Using credentials from file");
      }
      // Authentication: Method 2 - Named profile
      else if (this.config.profile) {
        this.log(`[S3] Using AWS profile: ${this.config.profile}`);
        clientConfig.credentials = fromIni({ profile: this.config.profile });
      }
      // Authentication: Method 3 - Default credential chain
      else {
        this.log("[S3] Using default credential chain (IAM role, env vars, etc.)");
      }

      // Create S3 client
      this.s3Client = new S3Client(clientConfig);

      // Test connection by listing bucket (with limit 1)
      await this.testConnection();

      this.log("[S3] Initialization successful");
    } catch (error) {
      this.log(`[S3] Initialization failed: ${error.message}`);
      throw new Error(`S3 initialization failed: ${error.message}`);
    }
  }

  /**
   * Test S3 connection by attempting to list bucket
   * @returns {Promise<void>}
   * @private
   */
  async testConnection() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        MaxKeys: 1
      });

      await this.s3Client.send(command);
      this.log(`[S3] Successfully connected to bucket: ${this.config.bucketName}`);
    } catch (error) {
      if (error.name === "NoSuchBucket") {
        throw new Error(`Bucket '${this.config.bucketName}' does not exist`);
      } else if (error.name === "AccessDenied" || error.name === "Forbidden") {
        throw new Error(`Access denied to bucket '${this.config.bucketName}'`);
      } else if (error.name === "InvalidAccessKeyId") {
        throw new Error("Invalid AWS access key ID");
      } else if (error.name === "SignatureDoesNotMatch") {
        throw new Error("Invalid AWS secret access key");
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if a file is an image based on extension
   * @param {string} key - S3 object key
   * @returns {boolean}
   * @private
   */
  isImageFile(key) {
    const ext = path.extname(key).toLowerCase();
    return this.imageExtensions.has(ext);
  }

  /**
   * Scan a folder (prefix) for photos
   * @param {string} prefix - S3 prefix to scan (acts as folder path)
   * @param {number} maxDepth - Maximum depth to scan (-1 = unlimited)
   * @param {number} currentDepth - Current recursion depth
   * @param {Set<string>} visitedPrefixes - Set of already visited prefixes
   * @returns {Promise<Array<Object>>} Array of photo objects
   */
  async scanFolder(prefix, maxDepth = -1, currentDepth = 0, visitedPrefixes = new Set()) {
    try {
      // Normalize prefix (ensure trailing slash for non-root)
      const normalizedPrefix = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix || "";

      this.log(`[S3] Scanning prefix: '${normalizedPrefix}' (depth: ${currentDepth}/${maxDepth})`);

      // Prevent infinite loops
      if (visitedPrefixes.has(normalizedPrefix)) {
        this.log(`[S3] Already visited prefix: '${normalizedPrefix}', skipping`);
        return [];
      }
      visitedPrefixes.add(normalizedPrefix);

      // Check depth limit
      if (maxDepth >= 0 && currentDepth > maxDepth) {
        this.log(`[S3] Max depth reached at: '${normalizedPrefix}'`);
        return [];
      }

      const photos = [];
      const subPrefixes = new Set();
      let continuationToken = null;
      let totalObjects = 0;

      // Paginate through all objects
      do {
        const command = new ListObjectsV2Command({
          Bucket: this.config.bucketName,
          Prefix: normalizedPrefix,
          MaxKeys: this.config.maxKeys || 1000,
          ContinuationToken: continuationToken,
          Delimiter: "/" // Get immediate children only (simulate folders)
        });

        const response = await this.s3Client.send(command);

        // Process objects (files)
        if (response.Contents) {
          for (const obj of response.Contents) {
            totalObjects++;

            // Skip if not an image
            if (!this.isImageFile(obj.Key)) {
              continue;
            }

            // Skip folders (keys ending with /)
            if (obj.Key.endsWith("/")) {
              continue;
            }

            // Convert S3 object to photo metadata format
            const photo = {
              id: obj.Key, // Use full S3 key as ID
              name: path.basename(obj.Key),
              parents: [normalizedPrefix], // Parent is the prefix
              createdTime: obj.LastModified.toISOString(),
              size: obj.Size,
              // Note: S3 doesn't provide image dimensions without downloading
              // CacheManager will handle this when caching
              imageMediaMetadata: null
            };

            photos.push(photo);
          }
        }

        // Collect subdirectories (common prefixes)
        if (response.CommonPrefixes) {
          for (const commonPrefix of response.CommonPrefixes) {
            subPrefixes.add(commonPrefix.Prefix);
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      this.log(`[S3] Found ${photos.length} photos in '${normalizedPrefix}' (${totalObjects} total objects)`);

      // Recursively scan subdirectories if depth allows
      if (maxDepth === -1 || currentDepth < maxDepth) {
        for (const subPrefix of subPrefixes) {
          const subPhotos = await this.scanFolder(
            subPrefix,
            maxDepth,
            currentDepth + 1,
            visitedPrefixes
          );
          photos.push(...subPhotos);
        }
      }

      return photos;
    } catch (error) {
      this.log(`[S3] Error scanning prefix '${prefix}': ${error.message}`);
      throw new Error(`Failed to scan S3 prefix '${prefix}': ${error.message}`);
    }
  }

  /**
   * Download a photo by S3 key
   * @param {string} photoId - S3 object key
   * @param {Object} options - Download options
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @returns {Promise<stream.Readable>} Readable stream of photo data
   */
  async downloadPhoto(photoId, options = {}) {
    try {
      this.log(`[S3] Downloading photo: ${photoId}`);

      const commandInput = {
        Bucket: this.config.bucketName,
        Key: photoId
      };

      // Note: AWS SDK v3 handles timeouts at the client level via requestHandler
      // The timeout option is accepted but not used in the command
      // For per-request timeout, you would configure the HTTP handler

      const command = new GetObjectCommand(commandInput);
      const response = await this.s3Client.send(command);

      // Return the readable stream
      return response.Body;
    } catch (error) {
      if (error.name === "NoSuchKey") {
        throw new Error(`Photo not found: ${photoId}`);
      } else if (error.name === "AccessDenied" || error.name === "Forbidden") {
        throw new Error(`Access denied to photo: ${photoId}`);
      } else {
        this.log(`[S3] Error downloading photo '${photoId}': ${error.message}`);
        throw new Error(`Failed to download photo '${photoId}': ${error.message}`);
      }
    }
  }

  /**
   * Get the provider name
   * @returns {string}
   */
  getProviderName() {
    return "Amazon S3";
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.s3Client) {
      this.log("[S3] Cleaning up S3 client");
      this.s3Client.destroy();
      this.s3Client = null;
    }
  }

  /**
   * Get changes since last sync (incremental sync)
   * Note: S3 doesn't natively support change tracking
   * Future implementation could use S3 Event Notifications + SQS
   * @param {string} changeToken - Token from previous sync
   * @returns {Promise<Object>}
   */
  async getChanges(changeToken) {
    // Not implemented yet - would require S3 event notifications setup
    this.log("[S3] Incremental sync not yet supported");
    return { photos: [], deletedIds: [], nextToken: null };
  }

  /**
   * Get start page token for incremental sync
   * @returns {Promise<string|null>}
   */
  async getStartPageToken() {
    // Not supported yet
    return null;
  }
}

module.exports = S3Provider;
