const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'icon.png');
const icoPath = path.join(__dirname, 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error("icon.png not found!");
  process.exit(1);
}

const pngData = fs.readFileSync(pngPath);
const pngSize = pngData.length;

// Create ICO Header (6 bytes)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // Reserved
header.writeUInt16LE(1, 2); // Type (1 = Icon)
header.writeUInt16LE(1, 4); // Number of images (1)

// Create Directory Entry (16 bytes)
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0, 0); // Width (0 means 256px)
dirEntry.writeUInt8(0, 1); // Height (0 means 256px)
dirEntry.writeUInt8(0, 2); // Colors (0 = no palette)
dirEntry.writeUInt8(0, 3); // Reserved
dirEntry.writeUInt16LE(1, 4); // Color planes (1)
dirEntry.writeUInt16LE(32, 6); // Bits per pixel (32)
dirEntry.writeUInt32LE(pngSize, 8); // Size of PNG data in bytes
dirEntry.writeUInt32LE(22, 12); // Offset of PNG data (6 bytes header + 16 bytes entry = 22)

// Combine header, entry, and raw PNG data
const icoData = Buffer.concat([header, dirEntry, pngData]);

fs.writeFileSync(icoPath, icoData);
console.log("Successfully created icon.ico!");
