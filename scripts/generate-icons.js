#!/usr/bin/env node

/**
 * Icon Generation Script
 * 
 * This script generates placeholder icons for the app.
 * 
 * For production, replace the generated icons with your actual app icons.
 * 
 * Usage: node scripts/generate-icons.js
 * 
 * Requirements for production icons:
 * - resources/icon.icns (macOS)
 * - resources/icon.ico (Windows)
 * - resources/icons/NxN.png (Linux, multiple sizes: 16, 32, 48, 64, 128, 256, 512, 1024)
 * 
 * Recommended tools for icon generation:
 * - macOS: iconutil (built-in)
 * - Windows/Linux: ImageMagick, electron-icon-builder
 * - Cross-platform: https://www.npmjs.com/package/electron-icon-maker
 */

const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const ICONS_DIR = path.join(__dirname, '..', 'resources', 'icons');

// Create a 1-pixel PNG as placeholder (actual icon generation requires canvas or external tools)
function createPlaceholderPng(size) {
  // PNG header for a simple blue square
  // This is a minimal valid PNG that represents a colored square
  // For production, use proper icon generation tools
  
  // Create a simple data URL representation for documentation
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect fill="#4F46E5" width="100" height="100" rx="15"/>
  <text x="50" y="65" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="50" font-weight="bold">M</text>
</svg>`;
  
  return svgContent;
}

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

console.log('Generating placeholder icons...');
console.log('Note: For production, replace these with actual PNG icons using tools like:');
console.log('  - electron-icon-maker (npm)');
console.log('  - ImageMagick');
console.log('  - iconutil (macOS)');
console.log('');

SIZES.forEach(size => {
  const svgPath = path.join(ICONS_DIR, `${size}x${size}.svg`);
  fs.writeFileSync(svgPath, createPlaceholderPng(size));
  console.log(`Created: ${size}x${size}.svg`);
});

console.log('');
console.log('SVG placeholder icons created successfully!');
console.log('');
console.log('To convert to PNG for production builds:');
console.log('');
console.log('Option 1: Install electron-icon-maker');
console.log('  npm install -g electron-icon-maker');
console.log('  electron-icon-maker --input=icon-source.png --output=resources/');
console.log('');
console.log('Option 2: Use ImageMagick (if installed)');
console.log('  for size in 16 32 48 64 128 256 512 1024; do');
console.log('    convert icon-source.png -resize ${size}x${size} resources/icons/${size}x${size}.png');
console.log('  done');
console.log('');
console.log('Option 3: Use online tools');
console.log('  - https://makeappicon.com');
console.log('  - https://cloudconvert.com/png-to-icns');
