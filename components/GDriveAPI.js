"use strict";

const fs = require("fs");
const { google } = require("googleapis");

/**
 * Google Drive API integration for MMM-GooglePhotos
 * Handles authentication, folder scanning, and incremental changes detection
 */
class GDriveAPI {
  /**
   * @param {Object} config - Configuration options
   * @param {Object} db - PhotoDatabase instance
   * @param {Function} logger - Logging function
   */
  constructor(config, db, logger = console.log) {
    this.config = config;
    this.db = db;
    this.log = logger;
    this.drive = null;
    this.auth = null;
  }

  /**
   * Initialize Google Drive API with OAuth2 authentication
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.log("[GDRIVE] Initializing Google Drive API...");

      // Load credentials from google_drive_auth.json
      const credentialsPath = this.config.keyFilePath || "./google_drive_auth.json";
      const credentialsFile = JSON.parse(
        await fs.promises.readFile(credentialsPath, "utf8")
      );

      // Handle both "installed" and "web" credential types (same as generate_drive_token.js)
      const credentials = credentialsFile.installed || credentialsFile.web || credentialsFile;

      // Load token from token_drive.json
      const tokenPath = this.config.tokenPath || "./token_drive.json";
      const token = JSON.parse(
        await fs.promises.readFile(tokenPath, "utf8")
      );

      // Create OAuth2 client
      this.auth = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uri || credentials.redirect_uris?.[0]
      );

      // Set credentials
      this.auth.setCredentials(token);

      // Initialize Drive API
      this.drive = google.drive({ version: "v3", auth: this.auth });

      // Test the connection
      await this.drive.about.get({ fields: "user" });

      this.log("[GDRIVE] Successfully authenticated with Google Drive API");
    } catch (error) {
      this.log("[GDRIVE] Authentication failed:", error.message);
      throw new Error(`Google Drive authentication failed: ${error.message}`);
    }
  }

  /**
   * Scan a folder for photos with depth control and circular detection
   * @param {string|null} folderId - Folder ID (null for Drive root)
   * @param {number} maxDepth - Maximum depth (-1 = infinite, 0 = folder only, N = N levels)
   * @param {number} currentDepth - Current depth in recursion
   * @param {Set<string>} visitedFolders - Set of visited folder IDs to prevent cycles
   * @returns {Promise<Array>} Array of photo metadata
   */
  async scanFolder(folderId, maxDepth = -1, currentDepth = 0, visitedFolders = new Set()) {
    try {
      const photos = [];

      // Mark this folder as visited for circular detection
      if (folderId) {
        if (visitedFolders.has(folderId)) {
          this.log(`[GDRIVE] Skipping circular reference to folder: ${folderId}`);
          return photos;
        }
        visitedFolders.add(folderId);
      }

      this.log(`[GDRIVE] Scanning folder (depth ${currentDepth}/${maxDepth})...`);

      // Build query for images in this folder
      const parentQuery = folderId ? `'${folderId}' in parents` : "'root' in parents";
      const query = [
        parentQuery,
        "mimeType contains 'image/'",
        "trashed = false",
        "not name contains '.cr2'",  // Exclude RAW files
        "not name contains '.nef'",
        "not name contains '.CR2'",
        "not name contains '.NEF'"
      ].join(" and ");

      // Fetch images in current folder
      let pageToken = null;
      do {
        const response = await this.drive.files.list({
          q: query,
          fields: "nextPageToken, files(id, name, mimeType, imageMediaMetadata, createdTime, parents)",
          pageSize: 1000,
          pageToken: pageToken
        });

        if (response.data.files && response.data.files.length > 0) {
          photos.push(...response.data.files);
          this.log(`[GDRIVE] Found ${response.data.files.length} photos in current folder`);
        }

        pageToken = response.data.nextPageToken;
      } while (pageToken);

      // Recursively scan subfolders if within depth limit
      if (maxDepth === -1 || currentDepth < maxDepth) {
        const subfolderQuery = `${parentQuery} and mimeType='application/vnd.google-apps.folder' and trashed=false`;

        let subfolderPageToken = null;
        do {
          const subfoldersResponse = await this.drive.files.list({
            q: subfolderQuery,
            fields: "nextPageToken, files(id, name)",
            pageSize: 100,
            pageToken: subfolderPageToken
          });

          if (subfoldersResponse.data.files && subfoldersResponse.data.files.length > 0) {
            this.log(`[GDRIVE] Found ${subfoldersResponse.data.files.length} subfolders to scan`);

            for (const folder of subfoldersResponse.data.files) {
              if (!visitedFolders.has(folder.id)) {
                const subPhotos = await this.scanFolder(
                  folder.id,
                  maxDepth,
                  currentDepth + 1,
                  visitedFolders
                );
                photos.push(...subPhotos);
              }
            }
          }

          subfolderPageToken = subfoldersResponse.data.nextPageToken;
        } while (subfolderPageToken);
      }

      this.log(`[GDRIVE] Folder scan complete. Total photos: ${photos.length}`);
      return photos;

    } catch (error) {
      this.log(`[GDRIVE] Error scanning folder ${folderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Perform full scan of all configured Drive folders
   * @returns {Promise<Array>} Array of all photo metadata
   */
  async fullScan() {
    try {
      this.log("[GDRIVE] Starting full scan of all configured folders...");
      const allPhotos = [];
      const driveFolders = this.config.driveFolders || [];

      if (driveFolders.length === 0) {
        this.log("[GDRIVE] Warning: No driveFolders configured");
        return allPhotos;
      }

      for (const folderConfig of driveFolders) {
        const folderId = folderConfig.id || null;
        const depth = folderConfig.depth !== undefined ? folderConfig.depth : -1;

        this.log(`[GDRIVE] Scanning folder: ${folderId || 'root'} (depth: ${depth})`);

        const photos = await this.scanFolder(folderId, depth);
        allPhotos.push(...photos);
      }

      // Remove duplicates (same photo might be in multiple folders)
      const uniquePhotos = Array.from(
        new Map(allPhotos.map(photo => [photo.id, photo])).values()
      );

      this.log(`[GDRIVE] Full scan complete. Found ${uniquePhotos.length} unique photos`);
      return uniquePhotos;

    } catch (error) {
      this.log("[GDRIVE] Full scan failed:", error.message);
      throw error;
    }
  }

  /**
   * Scan for changes using Drive Changes API (incremental)
   * More efficient than full scan - only detects new/modified/deleted files
   * @returns {Promise<Array>} Array of changed photo metadata
   */
  async scanForChanges() {
    try {
      this.log("[GDRIVE] Starting incremental scan using Changes API...");

      // Get stored change token from database
      const token = await this.db.getSetting("changes_token");

      if (!token) {
        // First run: get start token and do full scan
        this.log("[GDRIVE] No change token found. Getting start token and performing full scan...");

        const startTokenResponse = await this.drive.changes.getStartPageToken();
        const startToken = startTokenResponse.data.startPageToken;

        await this.db.saveSetting("changes_token", startToken);
        this.log(`[GDRIVE] Saved start token: ${startToken}`);

        // Perform full scan
        return await this.fullScan();
      }

      // Incremental scan using saved token
      this.log(`[GDRIVE] Using change token for incremental scan: ${token}`);

      let pageToken = token;
      const changedPhotos = [];
      let changeCount = 0;

      do {
        const response = await this.drive.changes.list({
          pageToken: pageToken,
          pageSize: 1000,
          fields: "nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, parents, imageMediaMetadata, createdTime, trashed))"
        });

        if (response.data.changes && response.data.changes.length > 0) {
          for (const change of response.data.changes) {
            changeCount++;

            // Handle deletions and trashed files
            if (change.removed || change.file?.trashed) {
              this.log(`[GDRIVE] Photo deleted or trashed: ${change.fileId}`);
              await this.db.deletePhoto(change.fileId);
              continue;
            }

            // Only process image files
            if (change.file?.mimeType?.startsWith("image/")) {
              // Check if file is in one of our monitored folders
              if (await this.isPhotoInMonitoredFolders(change.file)) {
                this.log(`[GDRIVE] Photo changed: ${change.file.name}`);
                changedPhotos.push(change.file);
              }
            }
          }
        }

        pageToken = response.data.nextPageToken;

        // Save new start token when provided
        if (response.data.newStartPageToken) {
          await this.db.saveSetting("changes_token", response.data.newStartPageToken);
          this.log(`[GDRIVE] Updated change token: ${response.data.newStartPageToken}`);
        }

      } while (pageToken);

      this.log(`[GDRIVE] Incremental scan complete. Processed ${changeCount} changes, found ${changedPhotos.length} relevant photos`);
      return changedPhotos;

    } catch (error) {
      this.log("[GDRIVE] Incremental scan failed:", error.message);

      // If changes API fails, fall back to full scan
      this.log("[GDRIVE] Falling back to full scan...");
      await this.db.saveSetting("changes_token", null);
      return await this.fullScan();
    }
  }

  /**
   * Check if a photo is in one of the monitored folders
   * @param {Object} file - File metadata from Drive API
   * @returns {Promise<boolean>}
   */
  async isPhotoInMonitoredFolders(file) {
    try {
      const driveFolders = this.config.driveFolders || [];

      if (driveFolders.length === 0) {
        return true; // If no folders configured, accept all
      }

      // Check if file's parents include any monitored folders
      if (!file.parents || file.parents.length === 0) {
        return false;
      }

      for (const folderConfig of driveFolders) {
        const monitoredFolderId = folderConfig.id;

        // Check if any parent matches or is a descendant of monitored folder
        for (const parentId of file.parents) {
          if (parentId === monitoredFolderId) {
            return true;
          }

          // Check if parent is a descendant of monitored folder
          if (await this.isDescendantOf(parentId, monitoredFolderId)) {
            return true;
          }
        }
      }

      return false;

    } catch (error) {
      this.log("[GDRIVE] Error checking folder membership:", error.message);
      // On error, be conservative and include the file
      return true;
    }
  }

  /**
   * Check if a folder is a descendant of another folder
   * @param {string} folderId - Folder to check
   * @param {string} ancestorId - Potential ancestor folder
   * @returns {Promise<boolean>}
   */
  async isDescendantOf(folderId, ancestorId) {
    try {
      let currentId = folderId;
      const visited = new Set();
      const maxDepth = 20; // Prevent infinite loops
      let depth = 0;

      while (currentId && depth < maxDepth) {
        if (visited.has(currentId)) {
          return false; // Circular reference detected
        }
        visited.add(currentId);

        if (currentId === ancestorId) {
          return true;
        }

        // Get parent folder
        const response = await this.drive.files.get({
          fileId: currentId,
          fields: "parents"
        });

        if (!response.data.parents || response.data.parents.length === 0) {
          return false; // Reached root
        }

        currentId = response.data.parents[0]; // Take first parent
        depth++;
      }

      return false;

    } catch (error) {
      this.log("[GDRIVE] Error checking folder ancestry:", error.message);
      return false;
    }
  }

  /**
   * Download a photo from Drive
   * @param {string} photoId - Photo file ID
   * @param {Object} options - Download options
   * @returns {Promise<Stream>} Readable stream of photo data
   */
  async downloadPhoto(photoId, options = {}) {
    try {
      const timeout = options.timeout || 30000;

      const response = await this.drive.files.get(
        { fileId: photoId, alt: "media" },
        { responseType: "stream", timeout: timeout }
      );

      return response.data;

    } catch (error) {
      this.log(`[GDRIVE] Failed to download photo ${photoId}:`, error.message);
      throw error;
    }
  }
}

module.exports = GDriveAPI;
