const fs = require('fs');
const path = require('path');

// Simple JPEG dimension reader (reads JPEG header)
function getJpegDimensions(filepath) {
  try {
    const buffer = fs.readFileSync(filepath);
    let offset = 2; // Skip SOI marker

    while (offset < buffer.length) {
      // Check for marker
      if (buffer[offset] !== 0xFF) break;

      const marker = buffer[offset + 1];
      offset += 2;

      // SOF (Start of Frame) markers
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        offset += 3; // Skip length and precision
        const height = buffer.readUInt16BE(offset);
        const width = buffer.readUInt16BE(offset + 2);
        return { width, height };
      }

      // Skip this segment
      const segmentLength = buffer.readUInt16BE(offset);
      offset += segmentLength;
    }
  } catch (e) {
    return null;
  }
  return null;
}

const cacheDir = './cache/images';
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.jpg'));

console.log('\nCached Image Analysis:\n');
console.log('Filename                                  Resolution     Size      Bytes/Pixel  Compression');
console.log('='.repeat(100));

const results = [];

files.forEach(filename => {
  const filepath = path.join(cacheDir, filename);
  const stats = fs.statSync(filepath);
  const dims = getJpegDimensions(filepath);

  if (dims) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const pixels = dims.width * dims.height;
    const bytesPerPixel = (stats.size / pixels).toFixed(2);
    const megapixels = (pixels / 1000000).toFixed(1);

    results.push({
      filename,
      resolution: `${dims.width}x${dims.height}`,
      megapixels,
      sizeMB,
      bytesPerPixel,
      orientation: dims.width > dims.height ? 'landscape' : 'portrait'
    });
  }
});

// Sort by size
results.sort((a, b) => parseFloat(a.sizeMB) - parseFloat(b.sizeMB));

results.forEach(r => {
  console.log(
    `${r.filename.padEnd(42)} ${r.resolution.padEnd(12)} ${r.sizeMB.padStart(6)}MB  ${r.bytesPerPixel.padStart(4)} b/px   ${r.orientation} (${r.megapixels}MP)`
  );
});

console.log('\n' + '='.repeat(100));
console.log('\nSummary:');
console.log(`  Total images: ${results.length}`);
console.log(`  Size range: ${results[0].sizeMB}MB - ${results[results.length-1].sizeMB}MB`);
console.log(`  Variation: ${(parseFloat(results[results.length-1].sizeMB) / parseFloat(results[0].sizeMB)).toFixed(1)}x difference`);
console.log('\nWhy the variation?');
console.log('  - Different original resolutions (megapixels)');
console.log('  - Different image complexity (detail affects JPEG compression)');
console.log('  - Different JPEG quality settings when photos were taken');
console.log('  - Portrait vs landscape orientation affects compression\n');
