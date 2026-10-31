import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Function to calculate CRC32 for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function generatePng(width, height, isMaskable = false) {
  // 1. Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // 2. IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color type
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  // 3. Pixel data
  // Scanlines with filter byte 0x00 at start of each line
  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(rowBytes * height);

  // Gradient: from indigo (#4338ca / #4f46e5) to violet (#7c3aed / #8b5cf6)
  // Let's create the official "1 social" icon
  const cornerRadius = isMaskable ? 0 : Math.round(width * 0.22); // Rounded squircle for standard, full bleed for maskable

  // Coordinates for the numeral "1"
  // Safe zone for maskable: within center 60-70%
  const scale = width / 512;
  const oneWidth = 140 * scale;
  const oneHeight = 280 * scale;
  const startX = (width - oneWidth) / 2;
  const startY = (height - oneHeight) / 2;

  // Numeral "1" geometry:
  // Stem: vertical bar from (startX + 60*scale) to (startX + 140*scale), from startY to startY + 280*scale
  // Serif / beak: diagonal flag from (startX) up to (startX + 90*scale)
  // Base: optional horizontal bar at bottom from (startX + 20*scale) to (startX + 180*scale)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Check if inside rounded squircle
      let insideShape = true;
      if (!isMaskable && cornerRadius > 0) {
        // Distance from corners
        const inLeft = x < cornerRadius;
        const inRight = x >= width - cornerRadius;
        const inTop = y < cornerRadius;
        const inBottom = y >= height - cornerRadius;

        if ((inLeft || inRight) && (inTop || inBottom)) {
          const cx = inLeft ? cornerRadius : width - cornerRadius - 1;
          const cy = inTop ? cornerRadius : height - cornerRadius - 1;
          const distSq = (x - cx) ** 2 + (y - cy) ** 2;
          if (distSq > cornerRadius ** 2) {
            insideShape = false;
          }
        }
      }

      if (!insideShape) {
        // Transparent
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
        continue;
      }

      // Background gradient: top-left (79, 70, 229) to bottom-right (147, 51, 234)
      const gradT = (x / width) * 0.5 + (y / height) * 0.5;
      const bgR = Math.round(67 + gradT * (139 - 67));
      const bgG = Math.round(56 + gradT * (92 - 56));
      const bgB = Math.round(202 + gradT * (246 - 202));

      // Check if inside the numeral "1"
      let isOne = false;

      // Vertical stem of "1"
      const stemLeft = startX + 50 * scale;
      const stemRight = startX + 115 * scale;
      const stemTop = startY + 20 * scale;
      const stemBottom = startY + 260 * scale;

      if (x >= stemLeft && x <= stemRight && y >= stemTop && y <= stemBottom) {
        isOne = true;
      }

      // Top flag/serif of "1"
      // Slanted line from (startX + 10*scale, startY + 90*scale) to (stemLeft, startY + 20*scale)
      if (x >= startX + 5 * scale && x <= stemLeft && y >= startY + 20 * scale && y <= startY + 110 * scale) {
        const expectedY = startY + 20 * scale + ((stemLeft - x) / (stemLeft - (startX + 5 * scale))) * (70 * scale);
        if (y >= expectedY - 35 * scale && y <= expectedY + 30 * scale) {
          isOne = true;
        }
      }

      // Base bar of "1"
      const baseLeft = startX + 15 * scale;
      const baseRight = startX + 150 * scale;
      const baseTop = startY + 225 * scale;
      const baseBottom = startY + 260 * scale;
      if (x >= baseLeft && x <= baseRight && y >= baseTop && y <= baseBottom) {
        isOne = true;
      }

      if (isOne) {
        // White foreground for numeral 1
        rawData[pixelOffset] = 255;
        rawData[pixelOffset + 1] = 255;
        rawData[pixelOffset + 2] = 255;
        rawData[pixelOffset + 3] = 255;
      } else {
        rawData[pixelOffset] = bgR;
        rawData[pixelOffset + 1] = bgG;
        rawData[pixelOffset + 2] = bgB;
        rawData[pixelOffset + 3] = 255;
      }
    }
  }

  // 4. Compress IDAT
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createPngChunk('IDAT', compressed);

  // 5. IEND
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate the required icons
console.log('Generating 1 social PWA icons...');

fs.writeFileSync(path.join(publicDir, 'icon-192.png'), generatePng(192, 192, false));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), generatePng(512, 512, false));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-192.png'), generatePng(192, 192, true));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-512.png'), generatePng(512, 512, true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), generatePng(180, 180, false));

// Also generate SVG version for high-DPI desktop browser tabs
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#8b5cf6" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)" />
  <path d="M 230 150 L 190 190 L 210 215 L 235 190 L 235 340 L 200 340 L 200 370 L 310 370 L 310 340 L 275 340 L 275 150 Z" fill="#ffffff" />
</svg>`;
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgIcon.trim());

console.log('Successfully generated all PWA icon assets in /public');
