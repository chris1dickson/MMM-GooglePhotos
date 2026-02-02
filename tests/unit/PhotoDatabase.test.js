/**
 * Unit Tests for PhotoDatabase
 * Tests database operations without external dependencies
 */

const fs = require('fs');
const path = require('path');
const PhotoDatabase = require('../../components/PhotoDatabase');

describe('PhotoDatabase', () => {
  let db;
  let testDbPath;

  beforeEach(async () => {
    // Create a temporary test database
    testDbPath = path.resolve(__dirname, `../temp/test_${Date.now()}.db`);
    await fs.promises.mkdir(path.dirname(testDbPath), { recursive: true });

    db = new PhotoDatabase(testDbPath, () => {}); // Silent logger
    await db.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      await fs.promises.unlink(testDbPath);
    }
  });

  describe('Initialization', () => {
    test('should create database file', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    test('should initialize with zero photos', async () => {
      const count = await db.getTotalPhotoCount();
      expect(count).toBe(0);
    });

    test('should recover from corruption', async () => {
      await db.close();

      // Corrupt the database
      await fs.promises.writeFile(testDbPath, 'corrupted data');

      // Should rebuild automatically
      const newDb = new PhotoDatabase(testDbPath, () => {});
      await newDb.initialize();

      const count = await newDb.getTotalPhotoCount();
      expect(count).toBe(0);

      await newDb.close();
    });
  });

  describe('Photo Operations', () => {
    const mockPhoto = {
      id: 'test123',
      name: 'test.jpg',
      parents: ['folder123'],
      createdTime: '2024-01-01T00:00:00Z',
      imageMediaMetadata: {
        width: 1920,
        height: 1080
      }
    };

    test('should save a photo', async () => {
      await db.savePhoto(mockPhoto);

      const count = await db.getTotalPhotoCount();
      expect(count).toBe(1);
    });

    test('should update existing photo', async () => {
      await db.savePhoto(mockPhoto);

      // Update with new data
      const updated = { ...mockPhoto, name: 'updated.jpg' };
      await db.savePhoto(updated);

      const count = await db.getTotalPhotoCount();
      expect(count).toBe(1); // Still only one photo
    });

    test('should save multiple photos', async () => {
      const photos = [
        { ...mockPhoto, id: 'test1' },
        { ...mockPhoto, id: 'test2' },
        { ...mockPhoto, id: 'test3' }
      ];

      await db.savePhotos(photos);

      const count = await db.getTotalPhotoCount();
      expect(count).toBe(3);
    });

    test('should delete a photo', async () => {
      await db.savePhoto(mockPhoto);
      await db.deletePhoto(mockPhoto.id);

      const count = await db.getTotalPhotoCount();
      expect(count).toBe(0);
    });
  });

  describe('Cache Operations', () => {
    beforeEach(async () => {
      const photo = {
        id: 'cached123',
        name: 'cached.jpg',
        parents: ['folder123'],
        createdTime: '2024-01-01T00:00:00Z',
        imageMediaMetadata: { width: 1920, height: 1080 }
      };
      await db.savePhoto(photo);
    });

    test('should update photo cache info', async () => {
      await db.updatePhotoCache('cached123', '/path/to/cache.jpg', 1024000);

      const cachedCount = await db.getCachedPhotoCount();
      expect(cachedCount).toBe(1);
    });

    test('should clear photo cache', async () => {
      await db.updatePhotoCache('cached123', '/path/to/cache.jpg', 1024000);
      await db.clearPhotoCache('cached123');

      const cachedCount = await db.getCachedPhotoCount();
      expect(cachedCount).toBe(0);
    });

    test('should get photos to cache', async () => {
      const photos = await db.getPhotosToCache(5);

      expect(photos).toHaveLength(1);
      expect(photos[0].id).toBe('cached123');
    });

    test('should calculate cache size', async () => {
      await db.updatePhotoCache('cached123', '/path/to/cache.jpg', 1024000);

      const size = await db.getCacheSizeBytes();
      expect(size).toBe(1024000);
    });
  });

  describe('Display Operations', () => {
    beforeEach(async () => {
      const photos = [
        {
          id: 'display1',
          name: 'photo1.jpg',
          parents: ['folder123'],
          createdTime: '2024-01-01T00:00:00Z',
          imageMediaMetadata: { width: 1920, height: 1080 }
        },
        {
          id: 'display2',
          name: 'photo2.jpg',
          parents: ['folder123'],
          createdTime: '2024-01-02T00:00:00Z',
          imageMediaMetadata: { width: 1920, height: 1080 }
        }
      ];

      await db.savePhotos(photos);
      await db.updatePhotoCache('display1', '/path/photo1.jpg', 1024);
      await db.updatePhotoCache('display2', '/path/photo2.jpg', 2048);
    });

    test('should get next photo to display', async () => {
      const photo = await db.getNextPhoto();

      expect(photo).toBeDefined();
      expect(photo.cached_path).toBeTruthy();
    });

    test('should mark photo as viewed', async () => {
      const photo = await db.getNextPhoto();
      await db.markPhotoViewed(photo.id);

      // Should still get a photo
      const nextPhoto = await db.getNextPhoto();
      expect(nextPhoto).toBeDefined();
    });

    test('should return null when no cached photos', async () => {
      await db.clearPhotoCache('display1');
      await db.clearPhotoCache('display2');

      const photo = await db.getNextPhoto();
      expect(photo).toBeNull();
    });
  });

  describe('Settings Operations', () => {
    test('should save and retrieve settings', async () => {
      await db.saveSetting('test_key', 'test_value');

      const value = await db.getSetting('test_key');
      expect(value).toBe('test_value');
    });

    test('should update existing setting', async () => {
      await db.saveSetting('test_key', 'value1');
      await db.saveSetting('test_key', 'value2');

      const value = await db.getSetting('test_key');
      expect(value).toBe('value2');
    });

    test('should return null for non-existent setting', async () => {
      const value = await db.getSetting('nonexistent');
      expect(value).toBeNull();
    });
  });

  describe('Eviction Operations', () => {
    beforeEach(async () => {
      const photos = [];
      for (let i = 0; i < 10; i++) {
        photos.push({
          id: `evict${i}`,
          name: `photo${i}.jpg`,
          parents: ['folder123'],
          createdTime: '2024-01-01T00:00:00Z',
          imageMediaMetadata: { width: 1920, height: 1080 }
        });
      }

      await db.savePhotos(photos);

      // Cache all photos
      for (let i = 0; i < 10; i++) {
        await db.updatePhotoCache(`evict${i}`, `/path/photo${i}.jpg`, 1024 * (i + 1));
      }

      // Mark some as viewed (to test LRU)
      await db.markPhotoViewed('evict5');
      await db.markPhotoViewed('evict6');
    });

    test('should get oldest cached photos', async () => {
      const oldest = await db.getOldestCachedPhotos(3);

      expect(oldest).toHaveLength(3);
    });

    test('should prioritize least recently viewed', async () => {
      const oldest = await db.getOldestCachedPhotos(5);

      // Photos 5 and 6 were viewed, so should not be first
      const ids = oldest.map(p => p.id);
      expect(ids).not.toContain('evict5');
      expect(ids).not.toContain('evict6');
    });
  });
});
