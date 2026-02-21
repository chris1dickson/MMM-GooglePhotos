/**
 * Integration Tests for S3Provider with PhotoDatabase and CacheManager
 * Tests the complete workflow of scanning, downloading, and caching photos from S3
 */

const fs = require('fs');
const path = require('path');
const S3Provider = require('../../components/providers/S3Provider');
const PhotoDatabase = require('../../components/PhotoDatabase');
const { Readable } = require('stream');

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

describe('S3Provider Integration Tests', () => {
  let provider;
  let database;
  let testDbPath;
  let mockS3Send;
  let mockLogger;

  beforeEach(async () => {
    // Clear mocks
    jest.clearAllMocks();

    // Create mock logger
    mockLogger = jest.fn();

    // Setup test database
    testDbPath = path.resolve(__dirname, `../temp/s3_integration_${Date.now()}.db`);
    await fs.promises.mkdir(path.dirname(testDbPath), { recursive: true });

    database = new PhotoDatabase(testDbPath, mockLogger);
    await database.initialize();

    // Mock S3Client
    mockS3Send = jest.fn();
    S3Client.mockImplementation(() => ({
      send: mockS3Send,
      destroy: jest.fn()
    }));

    // Mock successful connection test
    mockS3Send.mockResolvedValue({ Contents: [] });

    // Create provider
    provider = new S3Provider({
      bucketName: 'test-photos-bucket',
      region: 'us-east-1'
    }, mockLogger);

    provider.setDatabase(database);
    await provider.initialize();

    // Clear initialization calls
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (provider) {
      await provider.cleanup();
    }

    if (database) {
      await database.close();
    }

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      await fs.promises.unlink(testDbPath);
    }
  });

  describe('Complete Workflow: Scan and Save to Database', () => {
    test('should scan S3 and save photos to database', async () => {
      // Mock S3 response with photos
      mockS3Send.mockResolvedValue({
        Contents: [
          {
            Key: 'photos/vacation/beach.jpg',
            LastModified: new Date('2024-01-01'),
            Size: 2048000
          },
          {
            Key: 'photos/vacation/sunset.png',
            LastModified: new Date('2024-01-02'),
            Size: 3072000
          },
          {
            Key: 'photos/family/party.jpg',
            LastModified: new Date('2024-01-03'),
            Size: 1536000
          }
        ],
        CommonPrefixes: []
      });

      // Scan S3
      const photos = await provider.scanFolder('photos/', -1);

      // Should find 3 photos
      expect(photos).toHaveLength(3);

      // Save to database
      await database.savePhotos(photos);

      // Verify database contents
      const count = await database.getTotalPhotoCount();
      expect(count).toBe(3);

      // Verify we can retrieve photos for caching
      const photosToCache = await database.getPhotosToCache(10);
      expect(photosToCache.length).toBeGreaterThan(0);
      expect(photosToCache.length).toBeLessThanOrEqual(3);

      // Verify photo data exists
      const beachPhoto = photosToCache.find(p => p.name === 'beach.jpg');
      if (beachPhoto) {
        expect(beachPhoto.id).toBe('photos/vacation/beach.jpg');
        expect(beachPhoto.size).toBe(2048000);
      }
    });

    test('should handle incremental updates', async () => {
      // Initial scan
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'photos/img1.jpg',
            LastModified: new Date('2024-01-01'),
            Size: 1024000
          },
          {
            Key: 'photos/img2.jpg',
            LastModified: new Date('2024-01-02'),
            Size: 2048000
          }
        ],
        CommonPrefixes: []
      });

      const photos1 = await provider.scanFolder('photos/');
      await database.savePhotos(photos1);

      expect(await database.getTotalPhotoCount()).toBe(2);

      // Second scan with new photo
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'photos/img1.jpg',
            LastModified: new Date('2024-01-01'),
            Size: 1024000
          },
          {
            Key: 'photos/img2.jpg',
            LastModified: new Date('2024-01-02'),
            Size: 2048000
          },
          {
            Key: 'photos/img3.jpg',
            LastModified: new Date('2024-01-03'),
            Size: 3072000
          }
        ],
        CommonPrefixes: []
      });

      const photos2 = await provider.scanFolder('photos/');
      await database.savePhotos(photos2);

      expect(await database.getTotalPhotoCount()).toBe(3);
    });

    test('should handle multiple folders with depth control', async () => {
      // Folder 1: photos/ (recursive)
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        CommonPrefixes: [
          { Prefix: 'photos/vacation/' }
        ]
      });

      // Subfolder: photos/vacation/
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/vacation/img2.jpg', LastModified: new Date(), Size: 2048 }
        ],
        CommonPrefixes: []
      });

      // Folder 2: family/ (no recursion)
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'family/img3.jpg', LastModified: new Date(), Size: 3072 }
        ],
        CommonPrefixes: [
          { Prefix: 'family/events/' }
        ]
      });

      // Scan both folders
      const photosRecursive = await provider.scanFolder('photos/', -1); // Unlimited depth
      const photosFlat = await provider.scanFolder('family/', 0); // Current level only

      // Should find 2 photos in photos/ (including vacation/)
      expect(photosRecursive).toHaveLength(2);

      // Should find 1 photo in family/ (not including events/)
      expect(photosFlat).toHaveLength(1);

      // Save all to database
      await database.savePhotos([...photosRecursive, ...photosFlat]);

      expect(await database.getTotalPhotoCount()).toBe(3);
    });
  });

  describe('Download Workflow', () => {
    test('should download photo as stream', async () => {
      // Create mock readable stream
      const mockImageData = Buffer.from('fake-image-data');
      const mockStream = Readable.from([mockImageData]);

      mockS3Send.mockResolvedValue({
        Body: mockStream
      });

      // Download photo
      const stream = await provider.downloadPhoto('photos/test.jpg');

      // Verify stream
      expect(stream).toBeDefined();

      // Read stream data
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks);
      expect(data.toString()).toBe('fake-image-data');
    });

    test('should handle download errors gracefully', async () => {
      mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

      await expect(provider.downloadPhoto('nonexistent.jpg')).rejects.toThrow(
        'Photo not found: nonexistent.jpg'
      );
    });
  });

  describe('Provider Registration with ProviderFactory', () => {
    test('should be registered in ProviderFactory', () => {
      const { isProviderAvailable } = require('../../components/providers/ProviderFactory');

      expect(isProviderAvailable('s3')).toBe(true);
    });

    test('should create S3 provider via ProviderFactory', () => {
      const { createProvider } = require('../../components/providers/ProviderFactory');

      // Mock S3 connection test
      mockS3Send.mockResolvedValue({ Contents: [] });

      const config = {
        bucketName: 'test-bucket',
        region: 'us-east-1'
      };

      const provider = createProvider('s3', config, mockLogger);

      expect(provider).toBeDefined();
      expect(provider.getProviderName()).toBe('Amazon S3');
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle network errors during scan', async () => {
      mockS3Send.mockRejectedValue(new Error('Network timeout'));

      await expect(provider.scanFolder('photos/')).rejects.toThrow(
        'Failed to scan S3 prefix'
      );
    });

    test('should handle partial scan failures', async () => {
      // First page succeeds
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        NextContinuationToken: 'token123',
        CommonPrefixes: []
      });

      // Second page fails
      mockS3Send.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      await expect(provider.scanFolder('photos/')).rejects.toThrow();
    });

    test('should handle database save errors', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [
          { Key: 'photos/img1.jpg', LastModified: new Date(), Size: 1024 }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/');

      // Close database to simulate error
      await database.close();

      await expect(database.savePhotos(photos)).rejects.toThrow();
    });
  });

  describe('Performance and Pagination', () => {
    test('should handle large number of photos with pagination', async () => {
      const pageSize = 100;
      const totalPhotos = 250;

      // Generate mock photos
      const generateMockPage = (start, count) => {
        return Array.from({ length: count }, (_, i) => ({
          Key: `photos/img${start + i}.jpg`,
          LastModified: new Date(),
          Size: 1024 * (start + i)
        }));
      };

      // Page 1
      mockS3Send.mockResolvedValueOnce({
        Contents: generateMockPage(0, pageSize),
        NextContinuationToken: 'token1',
        CommonPrefixes: []
      });

      // Page 2
      mockS3Send.mockResolvedValueOnce({
        Contents: generateMockPage(pageSize, pageSize),
        NextContinuationToken: 'token2',
        CommonPrefixes: []
      });

      // Page 3
      mockS3Send.mockResolvedValueOnce({
        Contents: generateMockPage(pageSize * 2, totalPhotos - pageSize * 2),
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('photos/');

      expect(photos).toHaveLength(totalPhotos);
      expect(mockS3Send).toHaveBeenCalledTimes(3);

      // Save to database
      await database.savePhotos(photos);

      const count = await database.getTotalPhotoCount();
      expect(count).toBe(totalPhotos);
    });

    test('should handle empty prefixes efficiently', async () => {
      mockS3Send.mockResolvedValue({
        Contents: [],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('empty-folder/');

      expect(photos).toHaveLength(0);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world Scenarios', () => {
    test('should simulate full photo frame workflow', async () => {
      // Step 1: Initial scan
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'vacation/beach1.jpg', LastModified: new Date('2024-01-01'), Size: 2048000 },
          { Key: 'vacation/beach2.jpg', LastModified: new Date('2024-01-02'), Size: 3072000 },
          { Key: 'family/party.jpg', LastModified: new Date('2024-01-03'), Size: 1536000 }
        ],
        CommonPrefixes: []
      });

      const photos = await provider.scanFolder('', -1); // Scan entire bucket
      await database.savePhotos(photos);

      expect(await database.getTotalPhotoCount()).toBe(3);

      // Step 2: Mark some photos as cached
      await database.updatePhotoCache('vacation/beach1.jpg', 'beach1.jpg', 1024000);

      // Step 3: Get uncached photos
      const uncached = await database.getPhotosToCache(10);
      expect(uncached.length).toBeGreaterThan(0);

      // Step 4: Download a photo
      const mockStream = Readable.from([Buffer.from('image-data')]);
      mockS3Send.mockResolvedValueOnce({ Body: mockStream });

      const stream = await provider.downloadPhoto(uncached[0].id);
      expect(stream).toBeDefined();

      // Step 5: Mark as cached
      await database.updatePhotoCache(uncached[0].id, 'cached-file.jpg', 1024000);

      // Verify cached count increased
      const cachedCount = await database.getCachedPhotoCount();
      expect(cachedCount).toBeGreaterThanOrEqual(2);
    });
  });
});
