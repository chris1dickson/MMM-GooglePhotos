# S3 Provider Configuration Design

## Overview
Configuration schema for the S3 storage provider, supporting multiple authentication methods and S3-compatible services.

## Configuration Structure

### MagicMirror Config Example

```javascript
{
  module: "MMM-CloudPhotos",
  config: {
    provider: "s3",

    // S3-specific configuration
    bucketName: "my-photos-bucket",        // Required: S3 bucket name
    region: "us-east-1",                   // Required: AWS region

    // Authentication Method 1: Credentials File (Recommended - like Google Drive)
    credentialsPath: "./s3_credentials.json",

    // OR Authentication Method 2: Named Profile
    // profile: "my-aws-profile",

    // OR Authentication Method 3: IAM Role (automatic)
    // Leave credentialsPath empty for automatic IAM role detection

    // Optional: Specify prefix to scan (acts as "folder")
    bucketPrefix: "photos/vacation/",      // Default: "" (root)

    // Optional: For S3-compatible services (MinIO, DigitalOcean Spaces, etc.)
    endpoint: "https://s3.us-west-002.backblazeb2.com",  // Default: undefined (AWS S3)
    forcePathStyle: true,                  // Default: false

    // Optional: S3 listing configuration
    maxKeys: 1000,                         // Default: 1000 (max per request)

    // Standard provider configuration (works like Google Drive/OneDrive)
    driveFolders: [
      { id: "photos/", depth: -1 },        // Scan "photos/" prefix recursively
      { id: "family/", depth: 0 }          // Scan "family/" prefix only (no subdirs)
    ],

    // Standard MMM-CloudPhotos settings
    maxCacheSizeMB: 200,
    showWidth: 1920,
    showHeight: 1080
  }
}
```

## Configuration Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `bucketName` | string | S3 bucket name (e.g., "my-photos") |
| `region` | string | AWS region (e.g., "us-east-1", "eu-west-1") |

### Authentication Fields (Choose One Method)

#### Method 1: Credentials File (Recommended)
| Field | Type | Description |
|-------|------|-------------|
| `credentialsPath` | string | Path to S3 credentials JSON file (e.g., "./s3_credentials.json") |

**Credentials File Format** (`s3_credentials.json`):
```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "sessionToken": "optional-session-token"
}
```

#### Method 2: Named Profile
| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | AWS credential profile name from `~/.aws/credentials` |

#### Method 3: IAM Role (Automatic)
- Leave all authentication fields empty
- Provider will use default credential chain (IAM role, environment variables, etc.)

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bucketPrefix` | string | `""` | Prefix to scan (e.g., "photos/") acts as root folder |
| `endpoint` | string | undefined | Custom endpoint for S3-compatible services |
| `forcePathStyle` | boolean | false | Use path-style URLs (needed for MinIO, some S3-compatible services) |
| `maxKeys` | number | 1000 | Maximum objects per S3 LIST request |
| `driveFolders` | Array | `[]` | Folders (prefixes) to scan with depth control |

## Authentication Methods Explained

### 1. Credentials File (Recommended for Development/Personal Use)
**MagicMirror Config:**
```javascript
{
  credentialsPath: "./s3_credentials.json"
}
```

**Create `s3_credentials.json`:**
```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

- Best for: Testing, development, personal use
- Credentials in separate file (not in config.js)
- Similar pattern to Google Drive provider
- **Security Note**: Add `s3_credentials.json` to `.gitignore`

### 2. Named Profile (Recommended for Multi-Account)
```javascript
{
  profile: "my-photos-account"
}
```
- Best for: Multiple AWS accounts, shared credentials
- Uses `~/.aws/credentials` file
- Example credentials file:
  ```ini
  [my-photos-account]
  aws_access_key_id = AKIAIOSFODNN7EXAMPLE
  aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
  ```

### 3. IAM Role (Recommended for Production)
```javascript
{
  // No credentials specified
}
```
- Best for: EC2 instances, ECS containers, production deployments
- Automatic credential rotation
- No credentials in configuration files
- Uses AWS SDK default credential provider chain

## S3 Folder Structure

S3 doesn't have real folders - it uses **prefixes** to simulate folder structure:

### Prefix Examples

| Config | S3 Objects Matched |
|--------|-------------------|
| `bucketPrefix: ""` | All objects in bucket |
| `bucketPrefix: "photos/"` | `photos/img1.jpg`, `photos/vacation/img2.jpg` |
| `bucketPrefix: "photos/2024/"` | `photos/2024/img1.jpg`, `photos/2024/summer/img2.jpg` |

### Using driveFolders for Multiple Prefixes

```javascript
driveFolders: [
  { id: "photos/", depth: -1 },      // Recursively scan all under photos/
  { id: "albums/2024/", depth: 0 },  // Only photos/2024/* (no subdirs)
  { id: "family/", depth: 2 }        // 2 levels deep
]
```

**Note**: The `id` field is the S3 prefix (acts as folder path)

## S3-Compatible Services

The provider supports S3-compatible services (MinIO, Backblaze B2, DigitalOcean Spaces, etc.):

### MinIO Example
```javascript
{
  provider: "s3",
  bucketName: "photos",
  region: "us-east-1",  // MinIO doesn't care about region
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  accessKeyId: "minioadmin",
  secretAccessKey: "minioadmin"
}
```

### Backblaze B2 Example
```javascript
{
  provider: "s3",
  bucketName: "my-b2-bucket",
  region: "us-west-002",
  endpoint: "https://s3.us-west-002.backblazeb2.com",
  accessKeyId: "YOUR_B2_KEY_ID",
  secretAccessKey: "YOUR_B2_APPLICATION_KEY"
}
```

### DigitalOcean Spaces Example
```javascript
{
  provider: "s3",
  bucketName: "my-space",
  region: "nyc3",
  endpoint: "https://nyc3.digitaloceanspaces.com",
  accessKeyId: "YOUR_SPACES_KEY",
  secretAccessKey: "YOUR_SPACES_SECRET"
}
```

## Photo Metadata Handling

S3 objects have limited metadata. The provider will:

1. **Use S3 object metadata** when available:
   - `createdTime`: Uses `LastModified` timestamp
   - `name`: Object key (filename)
   - `id`: Full S3 key (acts as unique identifier)

2. **Extract EXIF metadata** for dimensions:
   - If `imageMediaMetadata` is not available from S3
   - Provider can optionally download first bytes to read EXIF
   - Falls back to `null` if unavailable (CacheManager will handle)

## Security Best Practices

1. **Use IAM Roles in production** - No credentials in config files
2. **Limit IAM permissions** - Grant only required S3 permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "s3:GetObject",
         "s3:ListBucket"
       ],
       "Resource": [
         "arn:aws:s3:::my-photos-bucket",
         "arn:aws:s3:::my-photos-bucket/*"
       ]
     }]
   }
   ```
3. **Use bucket policies** - Restrict access by IP or VPC
4. **Encrypt sensitive data** - Use AWS Secrets Manager for credentials

## Implementation Checklist

- [ ] Support all three authentication methods
- [ ] Handle S3 pagination (ListObjectsV2)
- [ ] Support prefix-based folder structure
- [ ] Map S3 metadata to BaseProvider format
- [ ] Handle S3-specific errors (NoSuchBucket, AccessDenied, etc.)
- [ ] Support S3-compatible services (custom endpoint)
- [ ] Filter image files by extension (.jpg, .png, .gif, etc.)
- [ ] Implement retry logic with exponential backoff
- [ ] Optional: Read EXIF for image dimensions
- [ ] Optional: Incremental sync via S3 event notifications

## Future Enhancements

1. **Incremental Sync**: Use S3 Event Notifications + SQS
2. **Performance**: Implement parallel downloads
3. **Filtering**: Support S3 object tags for photo selection
4. **Metadata**: Store extended metadata in S3 object metadata or separate JSON
