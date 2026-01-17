#!/usr/bin/env node
/**
 * Icon Generation Script for Meeting Notes
 *
 * This script generates placeholder icons for development/testing.
 * For production, replace with professionally designed icons.
 *
 * Usage:
 *   node scripts/generate-icons.cjs
 *
 * Requirements:
 *   - Node.js canvas library (optional): npm install canvas
 *   - Or manually create icons using design software
 *
 * Output:
 *   - resources/icon.png (1024x1024 source)
 *   - resources/icon.icns (macOS)
 *   - resources/icon.ico (Windows)
 *   - resources/icons/*.png (Linux, various sizes)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const ICONS_DIR = path.join(RESOURCES_DIR, 'icons');

// Icon sizes for Linux
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

// Ensure directories exist
function ensureDirectories() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }
}

// Check if a command exists
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Generate a simple SVG placeholder icon
function generatePlaceholderSVG() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="1024" height="1024" rx="200" fill="#4F46E5"/>

  <!-- Gradient overlay -->
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366F1;stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#4F46E5;stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#grad)"/>

  <!-- Microphone icon -->
  <g transform="translate(312, 200)">
    <!-- Mic body -->
    <rect x="100" y="0" width="200" height="340" rx="100" fill="white"/>
    <!-- Mic stand arc -->
    <path d="M 60 280 Q 60 460 200 460 Q 340 460 340 280"
          fill="none" stroke="white" stroke-width="40" stroke-linecap="round"/>
    <!-- Stand -->
    <rect x="180" y="460" width="40" height="100" fill="white"/>
    <!-- Base -->
    <rect x="120" y="540" width="160" height="40" rx="20" fill="white"/>
  </g>

  <!-- Sound waves -->
  <g fill="none" stroke="white" stroke-width="20" stroke-linecap="round" opacity="0.6">
    <path d="M 700 350 Q 750 450 700 550"/>
    <path d="M 760 300 Q 830 450 760 600"/>
  </g>

  <!-- Text "MN" -->
  <text x="512" y="880" font-family="Arial, sans-serif" font-size="120"
        font-weight="bold" fill="white" text-anchor="middle" opacity="0.8">
    MN
  </text>
</svg>`;
}

// Generate PNG from SVG using ImageMagick or rsvg-convert
function generatePNG(svgPath, pngPath, size) {
  if (commandExists('rsvg-convert')) {
    execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`);
    return true;
  } else if (commandExists('convert')) {
    execSync(`convert -background none -resize ${size}x${size} "${svgPath}" "${pngPath}"`);
    return true;
  }
  return false;
}

// Generate ICO file using ImageMagick
function generateICO(pngPath, icoPath) {
  if (commandExists('convert')) {
    execSync(`convert "${pngPath}" -define icon:auto-resize=256,128,64,48,32,16 "${icoPath}"`);
    return true;
  }
  return false;
}

// Generate ICNS file using iconutil (macOS only)
function generateICNS(sourcePng, icnsPath) {
  const iconsetDir = path.join(RESOURCES_DIR, 'icon.iconset');

  // Create iconset directory
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }

  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  // Generate all sizes
  if (commandExists('sips')) {
    for (const { name, size } of sizes) {
      const outPath = path.join(iconsetDir, name);
      execSync(`sips -z ${size} ${size} "${sourcePng}" --out "${outPath}"`);
    }

    // Convert to icns
    if (commandExists('iconutil')) {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
      // Clean up iconset
      fs.rmSync(iconsetDir, { recursive: true, force: true });
      return true;
    }
  }
  return false;
}

// Main function
async function main() {
  console.log('Meeting Notes Icon Generator');
  console.log('============================\n');

  ensureDirectories();

  // Generate SVG
  const svgPath = path.join(RESOURCES_DIR, 'icon.svg');
  const svg = generatePlaceholderSVG();
  fs.writeFileSync(svgPath, svg);
  console.log('✓ Generated icon.svg (source)');

  // Generate PNG (1024x1024)
  const pngPath = path.join(RESOURCES_DIR, 'icon.png');
  if (generatePNG(svgPath, pngPath, 1024)) {
    console.log('✓ Generated icon.png (1024x1024)');
  } else {
    console.log('✗ Could not generate PNG (install rsvg-convert or ImageMagick)');
    console.log('  Install with: brew install librsvg');
    return;
  }

  // Generate Linux icons
  let linuxIconsGenerated = 0;
  for (const size of LINUX_SIZES) {
    const outPath = path.join(ICONS_DIR, `${size}x${size}.png`);
    if (generatePNG(svgPath, outPath, size)) {
      linuxIconsGenerated++;
    }
  }
  if (linuxIconsGenerated > 0) {
    console.log(`✓ Generated ${linuxIconsGenerated} Linux icon sizes`);
  }

  // Generate ICO (Windows)
  const icoPath = path.join(RESOURCES_DIR, 'icon.ico');
  if (generateICO(pngPath, icoPath)) {
    console.log('✓ Generated icon.ico (Windows)');
  } else {
    console.log('✗ Could not generate ICO (install ImageMagick)');
    console.log('  Install with: brew install imagemagick');
  }

  // Generate ICNS (macOS)
  const icnsPath = path.join(RESOURCES_DIR, 'icon.icns');
  if (process.platform === 'darwin') {
    if (generateICNS(pngPath, icnsPath)) {
      console.log('✓ Generated icon.icns (macOS)');
    } else {
      console.log('✗ Could not generate ICNS (requires macOS with iconutil)');
    }
  } else {
    console.log('⊘ Skipped icon.icns (macOS only, run on Mac to generate)');
  }

  console.log('\n============================');
  console.log('Icon generation complete!');
  console.log('\nNote: These are placeholder icons.');
  console.log('Replace with professionally designed icons before release.');
}

main().catch(console.error);
