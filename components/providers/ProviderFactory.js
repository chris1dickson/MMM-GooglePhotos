"use strict";

/**
 * ProviderFactory - Registry and factory for cloud storage providers
 *
 * Manages available providers and creates instances based on configuration.
 */

// Provider registry: Maps provider names to their implementation modules
const PROVIDERS = {
  "google-drive": () => require("./GoogleDriveProvider"),
  "onedrive": () => require("./OneDriveProvider"),
  "s3": () => require("./S3Provider"),
  // Future providers:
  // "dropbox": () => require("./DropboxProvider"),
  // "icloud": () => require("./iCloudProvider"),
  // "local": () => require("./LocalFileProvider")
};

/**
 * Create a provider instance
 * @param {string} providerName - Name of the provider (e.g., "google-drive")
 * @param {Object} config - Provider-specific configuration
 * @param {Function} logger - Logging function
 * @returns {BaseProvider} Provider instance
 * @throws {Error} If provider not found or initialization fails
 */
function createProvider(providerName, config, logger) {
  const log = logger || console.log;

  // Validate provider name
  if (!providerName) {
    throw new Error("Provider name is required");
  }

  // Check if provider exists
  if (!PROVIDERS[providerName]) {
    const available = Object.keys(PROVIDERS).join(", ");
    throw new Error(
      `Unknown provider: "${providerName}". Available providers: ${available}`
    );
  }

  try {
    // Load provider module (lazy loading)
    const ProviderClass = PROVIDERS[providerName]();

    // Create instance
    const provider = new ProviderClass(config, log);

    log(`[CLOUDPHOTOS] Created provider: ${provider.getProviderName()}`);

    return provider;
  } catch (error) {
    throw new Error(`Failed to create provider "${providerName}": ${error.message}`);
  }
}

/**
 * Get list of available providers
 * @returns {string[]} Array of provider names
 */
function getAvailableProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * Check if a provider is available
 * @param {string} providerName - Name of the provider
 * @returns {boolean} True if provider exists
 */
function isProviderAvailable(providerName) {
  return PROVIDERS.hasOwnProperty(providerName);
}

/**
 * Register a custom provider (for extensions/plugins)
 * @param {string} name - Provider name
 * @param {Function} loader - Function that returns provider class
 */
function registerProvider(name, loader) {
  if (PROVIDERS[name]) {
    console.warn(`[CLOUDPHOTOS] Provider "${name}" is already registered. Overwriting.`);
  }
  PROVIDERS[name] = loader;
}

module.exports = {
  createProvider,
  getAvailableProviders,
  isProviderAvailable,
  registerProvider
};
