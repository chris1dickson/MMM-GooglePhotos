const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

(async () => {
  const db = await sqlite.open({
    filename: './cache/photos.db',
    driver: sqlite3.Database
  });

  const rows = await db.all(`
    SELECT filename, width, height, cached_size_bytes
    FROM photos
    WHERE cached_path IS NOT NULL
    ORDER BY cached_size_bytes
  `);

  console.log('\nCached Image Analysis:\n');
  console.log('Filename                      Resolution    File Size  Size/Pixel');
  console.log('='.repeat(75));

  rows.forEach(r => {
    const sizeMB = (r.cached_size_bytes / 1024 / 1024).toFixed(2);
    const pixels = r.width * r.height;
    const bytesPerPixel = (r.cached_size_bytes / pixels).toFixed(2);
    console.log(
      `${r.filename.padEnd(30)} ${`${r.width}x${r.height}`.padEnd(12)} ${sizeMB.padStart(6)}MB  ${bytesPerPixel} bytes/px`
    );
  });

  await db.close();
})();
