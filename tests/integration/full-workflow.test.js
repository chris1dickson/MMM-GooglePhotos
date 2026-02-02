/**
 * Integration Tests - Full Workflow
 * Tests complete workflow with real components (no Drive API calls)
 *
 * These tests verify that all components work together correctly
 * WITHOUT requiring Google Drive credentials.
 */

const fs = require('fs');
const path = require('path');
const PhotoDatabase = require('../../components/PhotoDatabase');
const CacheManager = require('../../components/CacheManager');

describe('Integration: Full Workflow', () => {
  let db;
  let cacheManager;
  let testDbPath;
  let cachePath;

  // Mock Drive API for integration tests
  const mockDriveAPI = {
    downloadPhoto: jest.fn((photoId) => {
      // Simulate download by returning a readable stream
      const { Readable } = require('stream');
      return Promise.resolve(Readable.from(['mock photo data for ' + photoId]));
    })
  };

  beforeAll(async () => {
    // Setup test environment
    const testDir = path.resolve(__dirname, '../temp/integration');
    testDbPath = path.join(testDir, 'test.db');
    cachePath = path.join(testDir, 'cache');

    await fs.promises.mkdir(cachePath, { recursive: true });
  });

  beforeEach(async () => {
    // Clean up from previous test
    if (fs.existsSync(testDbPath)) {
      await fs.promises.unlink(testDbPath);
    }
    if (fs.existsSync(cachePath)) {
      const files = await fs.promises.readdir(cachePath);
      for (const file of files) {
        await fs.promises.unlink(path.join(cachePath, file));
      }
    }

    // Initialize components
    db = new PhotoDatabase(testDbPath, () => {});
    await db.initialize();

    cacheManager = new CacheManager(
      {
        cachePath: cachePath,
        maxCacheSizeMB: 1 // Small cache for testing
      },
      db,
      mockDriveAPI,
      () => {}
    );

    cacheManager.stop(); // Manual control

    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    if (cacheManager) {
      cacheManager.stop();
    }
  });

  afterAll(async () => {
    // Final cleanup
    const testDir = path.resolve(__dirname, '../temp/integration');
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    }
  });

  test('Complete workflow: Add photos → Cache → Display', async () => {
    // Step 1: Add photos to database
    const mockPhotos = [
      {
        id: 'photo1',
        name: 'sunset.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      },
      {
        id: 'photo2',
        name: 'beach.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-02T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      },
      {
        id: 'photo3',
        name: 'mountain.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-03T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      }
    ];

    await db.savePhotos(mockPhotos);

    // Verify photos are in database
    const totalCount = await db.getTotalPhotoCount();
    expect(totalCount).toBe(3);

    // Step 2: Cache photos
    await cacheManager.tick();

    // Verify downloads were called
    expect(mockDriveAPI.downloadPhoto).toHaveBeenCalledTimes(3);

    // Verify photos are cached in database
    const cachedCount = await db.getCachedPhotoCount();
    expect(cachedCount).toBe(3);

    // Verify files exist on disk
    const files = await fs.promises.readdir(cachePath);
    expect(files.length).toBe(3);

    // Step 3: Get photos for display
    const photo1 = await db.getNextPhoto();
    expect(photo1).toBeDefined();
    expect(photo1.cached_path).toBeTruthy();
    expect(fs.existsSync(photo1.cached_path)).toBe(true);

    // Mark as viewed
    await db.markPhotoViewed(photo1.id);

    // Get next photo (should be different or random)
    const photo2 = await db.getNextPhoto();
    expect(photo2).toBeDefined();

    // Step 4: Verify cache statistics
    const stats = await cacheManager.getStats();
    expect(stats.cachedCount).toBe(3);
    expect(stats.totalCount).toBe(3);
    expect(stats.cachePercent).toBe('100.0'); // Returns string from toFixed()
  });

  test('Cache eviction workflow', async () => {
    // Add many photos
    const photos = [];
    for (let i = 0; i < 10; i++) {
      photos.push({
        id: `photo${i}`,
        name: `photo${i}.jpg`,
        parents: ['folder1'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      });
    }

    await db.savePhotos(photos);

    // Cache all photos (tick() caches 5 at a time, so call twice)
    await cacheManager.tick();
    await cacheManager.tick();

    const cachedBefore = await db.getCachedPhotoCount();
    expect(cachedBefore).toBe(10);

    // Evict 3 photos
    await cacheManager.evictOldest(3);

    const cachedAfter = await db.getCachedPhotoCount();
    expect(cachedAfter).toBe(7);

    // Verify files were deleted
    const files = await fs.promises.readdir(cachePath);
    expect(files.length).toBe(7);
  });

  test('Incremental caching workflow', async () => {
    // Initial batch
    const batch1 = [
      {
        id: 'batch1_photo1',
        name: 'photo1.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      }
    ];

    await db.savePhotos(batch1);
    await cacheManager.tick();

    expect(await db.getCachedPhotoCount()).toBe(1);

    // Add more photos
    const batch2 = [
      {
        id: 'batch2_photo1',
        name: 'photo2.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-02T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      },
      {
        id: 'batch2_photo2',
        name: 'photo3.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-03T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      }
    ];

    await db.savePhotos(batch2);
    await cacheManager.tick();

    // Should have cached all 3
    expect(await db.getCachedPhotoCount()).toBe(3);
    expect(await db.getTotalPhotoCount()).toBe(3);
  });

  test('Display rotation workflow', async () => {
    // Add and cache photos
    const photos = [
      {
        id: 'rotate1',
        name: 'photo1.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      },
      {
        id: 'rotate2',
        name: 'photo2.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-02T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      },
      {
        id: 'rotate3',
        name: 'photo3.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-03T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      }
    ];

    await db.savePhotos(photos);
    await cacheManager.tick();

    // Simulate display cycle
    const displayed = new Set();

    for (let i = 0; i < 6; i++) {
      const photo = await db.getNextPhoto();
      expect(photo).toBeDefined();

      displayed.add(photo.id);
      await db.markPhotoViewed(photo.id);

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Should have displayed all 3 photos (possibly some twice)
    expect(displayed.size).toBeGreaterThanOrEqual(3);
  });

  test('Failure recovery workflow', async () => {
    // Simulate download failures (each tick tries 3 times, so need 9 failures total for 3 ticks)
    mockDriveAPI.downloadPhoto = jest.fn()
      // First tick - all 3 retries fail
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      // Second tick - all 3 retries fail
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      // Third tick - all 3 retries fail
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      // Fourth tick - succeeds
      .mockResolvedValue(require('stream').Readable.from(['recovered data']));

    const photos = [
      {
        id: 'fail1',
        name: 'photo1.jpg',
        parents: ['folder1'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      }
    ];

    await db.savePhotos(photos);

    // First 3 ticks should fail
    await cacheManager.tick();
    expect(cacheManager.consecutiveFailures).toBe(1);

    await cacheManager.tick();
    expect(cacheManager.consecutiveFailures).toBe(2);

    await cacheManager.tick();
    expect(cacheManager.consecutiveFailures).toBe(3);

    // 4th tick should trigger offline mode and reset counter
    await cacheManager.tick();
    expect(cacheManager.consecutiveFailures).toBe(0); // Reset

    // Next tick should succeed
    await cacheManager.tick();
    expect(await db.getCachedPhotoCount()).toBe(1);
  });

  test('Settings persistence workflow', async () => {
    // Save change token
    await db.saveSetting('changes_token', 'token123');

    // Close and reopen database
    await db.close();

    db = new PhotoDatabase(testDbPath, () => {});
    await db.initialize();

    // Verify token persisted
    const token = await db.getSetting('changes_token');
    expect(token).toBe('token123');
  });
});
