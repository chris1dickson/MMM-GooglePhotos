"use strict";

/**
 * Google Drive OAuth2 Token Generator
 *
 * This script helps you generate the OAuth token needed for Google Drive API access.
 *
 * Prerequisites:
 * 1. Enable Google Drive API in Google Cloud Console
 * 2. Create OAuth 2.0 Desktop credentials
 * 3. Download credentials as google_drive_auth.json
 *
 * Usage:
 *   node generate_drive_token.js
 */

const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");

// OAuth2 scope for read-only Drive access
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// File paths
const CREDENTIALS_PATH = "./google_drive_auth.json";
const TOKEN_PATH = "./token_drive.json";

/**
 * Read credentials from file
 */
function readCredentials() {
  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error("\n❌ Error reading credentials file:");
    console.error(`   ${error.message}`);
    console.error("\n📋 Please ensure you have created google_drive_auth.json:");
    console.error("   1. Go to https://console.cloud.google.com");
    console.error("   2. Enable Google Drive API");
    console.error("   3. Create OAuth 2.0 Desktop credentials");
    console.error("   4. Download as google_drive_auth.json\n");
    process.exit(1);
  }
}

/**
 * Create OAuth2 client
 */
function createOAuthClient(credentials) {
  try {
    // Handle both "installed" and "web" credential types
    const creds = credentials.installed || credentials.web || credentials;
    const { client_id, client_secret, redirect_uris } = creds;

    if (!client_id || !client_secret) {
      throw new Error("Invalid credentials format - missing client_id or client_secret");
    }

    const redirectUri = redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob";

    return new google.auth.OAuth2(client_id, client_secret, redirectUri);
  } catch (error) {
    console.error("\n❌ Error creating OAuth client:");
    console.error(`   ${error.message}`);
    console.error("\n📋 Please check your google_drive_auth.json format");
    console.error("   Expected format: {\"installed\": {...}} or {\"web\": {...}}\n");
    process.exit(1);
  }
}

/**
 * Get authorization URL
 */
function getAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent" // Force consent screen to get refresh token
  });
}

/**
 * Get authorization code from user
 */
function getAuthCode(authUrl) {
  console.log("\n🔐 Google Drive Authorization");
  console.log("━".repeat(60));
  console.log("\n1. Open this URL in your browser:\n");
  console.log(`   ${authUrl}\n`);
  console.log("2. Authorize the application");
  console.log("3. Copy the authorization code\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question("Enter the authorization code: ", (code) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

/**
 * Exchange code for token
 */
async function getToken(oAuth2Client, code) {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    return tokens;
  } catch (error) {
    console.error("\n❌ Error getting token:");
    console.error(`   ${error.message}`);
    console.error("\n💡 Please make sure you:");
    console.error("   - Copied the full authorization code");
    console.error("   - Haven't used this code before");
    console.error("   - Try again with a fresh authorization\n");
    process.exit(1);
  }
}

/**
 * Save token to file
 */
function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
    console.log("\n✅ Success! Token saved to token_drive.json");
  } catch (error) {
    console.error("\n❌ Error saving token:");
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Test the token by making a simple API call
 */
async function testToken(oAuth2Client, token) {
  try {
    console.log("\n🔍 Testing token...");

    oAuth2Client.setCredentials(token);
    const drive = google.drive({ version: "v3", auth: oAuth2Client });

    const response = await drive.about.get({ fields: "user" });

    console.log(`✅ Token works! Authenticated as: ${response.data.user.emailAddress}`);

  } catch (error) {
    console.error("\n⚠️  Warning: Token saved but test failed:");
    console.error(`   ${error.message}`);
    console.error("\n💡 The token might still work. Try using it with the module.\n");
  }
}

/**
 * Main function
 */
async function main() {
  console.clear();
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   Google Drive Token Generator for MMM-GooglePhotos       ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Check if token already exists
  if (fs.existsSync(TOKEN_PATH)) {
    console.log("⚠️  Warning: token_drive.json already exists!");
    console.log("   This will overwrite the existing token.\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl.question("Continue? (y/N): ", (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer !== "y" && answer !== "yes") {
      console.log("\n❌ Cancelled\n");
      process.exit(0);
    }
  }

  // Read credentials
  const credentials = readCredentials();
  console.log("✅ Credentials loaded from google_drive_auth.json");

  // Create OAuth client
  const oAuth2Client = createOAuthClient(credentials);
  console.log("✅ OAuth client created");

  // Get authorization URL
  const authUrl = getAuthUrl(oAuth2Client);

  // Get authorization code from user
  const code = await getAuthCode(authUrl);

  if (!code) {
    console.error("\n❌ No authorization code provided\n");
    process.exit(1);
  }

  console.log("\n⏳ Exchanging code for token...");

  // Exchange code for token
  const token = await getToken(oAuth2Client, code);

  // Save token
  saveToken(token);

  // Test token
  await testToken(oAuth2Client, token);

  // Done!
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   Setup Complete!                                          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\n📋 Next steps:");
  console.log("   1. Configure your driveFolders in config.js");
  console.log("   2. Restart MagicMirror");
  console.log("   3. Enjoy your photos!\n");
}

// Run
main().catch((error) => {
  console.error("\n❌ Unexpected error:");
  console.error(`   ${error.message}\n`);
  process.exit(1);
});
