/**
 * Unit Tests for S3Provider
 * Tests S3 provider operations with mocked AWS SDK
 */

const fs = require('fs');
const path = require('path');
const S3Provider = require('../../components/providers/S3Provider');

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/credential-providers');

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { fromIni } = require('@aws-sdk/credential-providers');

describe('S3Provider', () => {
  let provider;
  let mockS3Send;
  let mockLogger;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock logger
    mockLogger = jest.fn();

    // Mock S3Client.send()
    mockS3Send = jest.fn();
    S3Client.mockImplementation(() => ({
      send: mockS3Send,
      destroy: jest.fn()
    }));
  });

  describe('Constructor', () => {
    test('should create instance with valid config', () => {
      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1'
      };

      expect(() => {
        provider = new S3Provider(config, mockLogger);
      }).not.toThrow();
    });

    test('should throw error without bucketName', () => {
      const config = { region: 'us-east-1' };

      expect(() => {
        provider = new S3Provider(config, mockLogger);
      }).toThrow("S3Provider requires 'bucketName'");
    });

    test('should throw error without region', () => {
      const config = { bucketName: 'test-bucket' };

      expect(() => {
        provider = new S3Provider(config, mockLogger);
      }).toThrow("S3Provider requires 'region'");
    });
  });

  describe('Initialization', () => {
    beforeEach(() => {
      // Mock successful connection test
      mockS3Send.mockResolvedValue({
        Contents: []
      });
    });

    test('should initialize with default credentials', async () => {
      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1'
      };

      provider = new S3Provider(config, mockLogger);
      await provider.initialize();

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1'
        })
      );
      expect(mockS3Send).toHaveBeenCalled();
    });

    test('should initialize with credentials file', async () => {
      // Create temporary credentials file
      const tempDir = path.resolve(__dirname, '../temp');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const credPath = path.join(tempDir, `s3_creds_${Date.now()}.json`);

      const creds = {
        accessKeyId: 'TEST_KEY_ID',
        secretAccessKey: 'TEST_SECRET_KEY'
      };
      await fs.promises.writeFile(credPath, JSON.stringify(creds));

      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1',
        credentialsPath: credPath
      };

      provider = new S3Provider(config, mockLogger);
      await provider.initialize();

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
          credentials: expect.objectContaining({
            accessKeyId: 'TEST_KEY_ID',
            secretAccessKey: 'TEST_SECRET_KEY'
          })
        })
      );

      // Cleanup
      await fs.promises.unlink(credPath);
    });

    test('should initialize with named profile', async () => {
      fromIni.mockReturnValue({
        accessKeyId: 'PROFILE_KEY',
        secretAccessKey: 'PROFILE_SECRET'
      });

      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1',
        profile: 'my-profile'
      };

      provider = new S3Provider(config, mockLogger);
      await provider.initialize();

      expect(fromIni).toHaveBeenCalledWith({ profile: 'my-profile' });
    });

    test('should initialize with custom endpoint', async () => {
      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'https://s3.custom.com',
        forcePathStyle: true
      };

      provider = new S3Provider(config, mockLogger);
      await provider.initialize();

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://s3.custom.com',
          forcePathStyle: true
        })
      );
    });

    test('should handle NoSuchBucket error', async () => {
      mockS3Send.mockRejectedValue({ name: 'NoSuchBucket' });

      const config = {
        bucketName: 'nonexistent-bucket',
        region: 'us-east-1'
      };

      provider = new S3Provider(config, mockLogger);

      await expect(provider.initialize()).rejects.toThrow(
        "Bucket 'nonexistent-bucket' does not exist"
      );
    });

    test('should handle AccessDenied error', async () => {
      mockS3Send.mockRejectedValue({ name: 'AccessDenied' });

      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1'
      };

      provider = new S3Provider(config, mockLogger);

      await expect(provider.initialize()).rejects.toThrow(
        "Access denied to bucket 'test-bucket'"
      );
    });

    test('should handle invalid credentials', async () => {
      mockS3Send.mockRejectedValue({ name: 'InvalidAccessKeyId' });

      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1'
      };

      provider = new S3Provider(config, mockLogger);

      await expect(provider.initialize()).rejects.toThrow(
        'Invalid AWS access key ID'
      );
    });
  });

  describe('scanFolder', () => {
    beforeEach(async () => {
      mockS3Send.mockResolvedValue({ Contents: [] });

      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      await provider.initialize();
      jest.clearAllMocks(); // Clear initialization calls
    });

    test('should scan folder and return photos', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [
          {
            Key: 'photos/image1.jpg',
            LastModified: new Date('2024-01-01'),
            Size: 1024
          },
          {
            Key: 'photos/image2.png',
            LastModified: new Date('2024-01-02'),
            Size: 2048
          }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/');

      expect(photos).toHaveLength(2);
      expect(photos[0]).toMatchObject({
        id: 'photos/image1.jpg',
        name: 'image1.jpg',
        parents: ['photos/'],
        size: 1024
      });
      expect(photos[1]).toMatchObject({
        id: 'photos/image2.png',
        name: 'image2.png',
        parents: ['photos/'],
        size: 2048
      });
    });

    test('should filter out non-image files', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [
          { Key: 'photos/image1.jpg', LastModified: new Date(), Size: 1024 },
          { Key: 'photos/document.pdf', LastModified: new Date(), Size: 2048 },
          { Key: 'photos/video.mp4', LastModified: new Date(), Size: 4096 }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/');

      expect(photos).toHaveLength(1);
      expect(photos[0].name).toBe('image1.jpg');
    });

    test('should handle pagination', async () => {
      // First page
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        NextContinuationToken: 'token123',
        CommonPrefixes: []
      });

      // Second page
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/img2.jpg', LastModified: new Date(), Size: 2048 }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/');

      expect(photos).toHaveLength(2);
      expect(mockS3Send).toHaveBeenCalledTimes(2);
    });

    test('should scan subdirectories recursively', async () => {
      // Root folder response
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        CommonPrefixes: [
          { Prefix: 'photos/vacation/' }
        ]
      });

      // Subdirectory response
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/vacation/img2.jpg', LastModified: new Date(), Size: 2048 }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/', -1); // Unlimited depth

      expect(photos).toHaveLength(2);
      expect(photos[0].name).toBe('img1.jpg');
      expect(photos[1].name).toBe('img2.jpg');
    });

    test('should respect maxDepth limit', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        CommonPrefixes: [
          { Prefix: 'photos/vacation/' }
        ]
      });

      const photos = await provider.scanFolder('photos/', 0); // Only current level

      expect(photos).toHaveLength(1);
      expect(mockS3Send).toHaveBeenCalledTimes(1); // Should not scan subdirectory
    });

    test('should handle empty folders', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('empty/');

      expect(photos).toHaveLength(0);
    });

    test('should prevent circular references', async () => {
      // This shouldn't happen in S3, but test the safety mechanism
      const visitedPrefixes = new Set(['photos/']);

      const photos = await provider.scanFolder('photos/', -1, 0, visitedPrefixes);

      expect(photos).toHaveLength(0);
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    test('should normalize prefix with trailing slash', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [],
        CommonPrefixes: []
      });

      await provider.scanFolder('photos');

      // AWS SDK v3: command is created with input, check that ListObjectsV2Command was called
      expect(mockS3Send).toHaveBeenCalled();
      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          Prefix: 'photos/'
        })
      );
    });
  });

  describe('downloadPhoto', () => {
    beforeEach(async () => {
      mockS3Send.mockResolvedValue({ Contents: [] });

      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      await provider.initialize();
      jest.clearAllMocks();
    });

    test('should download photo and return stream', async () => {
      const mockStream = { pipe: jest.fn() };
      mockS3Send.mockResolvedValue({
        Body: mockStream
      });

      const stream = await provider.downloadPhoto('photos/image.jpg');

      expect(stream).toBe(mockStream);
      expect(mockS3Send).toHaveBeenCalled();
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'photos/image.jpg'
        })
      );
    });

    test('should handle NoSuchKey error', async () => {
      mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

      await expect(provider.downloadPhoto('nonexistent.jpg')).rejects.toThrow(
        'Photo not found: nonexistent.jpg'
      );
    });

    test('should handle AccessDenied error', async () => {
      mockS3Send.mockRejectedValue({ name: 'AccessDenied' });

      await expect(provider.downloadPhoto('secret.jpg')).rejects.toThrow(
        'Access denied to photo: secret.jpg'
      );
    });

    test('should accept timeout option without error', async () => {
      const mockStream = { pipe: jest.fn() };
      mockS3Send.mockResolvedValue({ Body: mockStream });

      // AWS SDK v3 handles timeouts at client level, not per-request
      // This test verifies the method accepts the option without throwing
      const stream = await provider.downloadPhoto('image.jpg', { timeout: 30000 });

      expect(stream).toBe(mockStream);
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('Provider Methods', () => {
    test('getProviderName should return "Amazon S3"', () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      expect(provider.getProviderName()).toBe('Amazon S3');
    });

    test('setDatabase should store database reference', () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      const mockDb = { some: 'database' };
      provider.setDatabase(mockDb);

      expect(provider.db).toBe(mockDb);
    });

    test('getChanges should return empty changes (not supported)', async () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      const changes = await provider.getChanges('token');

      expect(changes).toEqual({
        photos: [],
        deletedIds: [],
        nextToken: null
      });
    });

    test('getStartPageToken should return null (not supported)', async () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      const token = await provider.getStartPageToken();

      expect(token).toBeNull();
    });
  });

  describe('cleanup', () => {
    test('should destroy S3 client', async () => {
      mockS3Send.mockResolvedValue({ Contents: [] });

      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      await provider.initialize();

      const mockDestroy = jest.fn();
      provider.s3Client.destroy = mockDestroy;

      await provider.cleanup();

      expect(mockDestroy).toHaveBeenCalled();
      expect(provider.s3Client).toBeNull();
    });

    test('should handle cleanup when client not initialized', async () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      await expect(provider.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Image File Detection', () => {
    test('should recognize common image extensions', () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      expect(provider.isImageFile('photo.jpg')).toBe(true);
      expect(provider.isImageFile('photo.jpeg')).toBe(true);
      expect(provider.isImageFile('photo.png')).toBe(true);
      expect(provider.isImageFile('photo.gif')).toBe(true);
      expect(provider.isImageFile('photo.webp')).toBe(true);
      expect(provider.isImageFile('photo.bmp')).toBe(true);
      expect(provider.isImageFile('photo.tiff')).toBe(true);
      expect(provider.isImageFile('photo.heic')).toBe(true);
    });

    test('should reject non-image files', () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      expect(provider.isImageFile('document.pdf')).toBe(false);
      expect(provider.isImageFile('video.mp4')).toBe(false);
      expect(provider.isImageFile('text.txt')).toBe(false);
      expect(provider.isImageFile('data.json')).toBe(false);
    });

    test('should be case-insensitive', () => {
      provider = new S3Provider({
        bucketName: 'test-bucket',
        region: 'us-east-1'
      }, mockLogger);

      expect(provider.isImageFile('PHOTO.JPG')).toBe(true);
      expect(provider.isImageFile('Photo.Png')).toBe(true);
    });
  });
});
