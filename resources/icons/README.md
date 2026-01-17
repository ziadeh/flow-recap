# Application Icons

This directory contains the application icons for all supported platforms.

## Directory Structure

```
resources/icons/
├── icon.icns          # macOS application icon (1024x1024 or larger)
├── icon.ico           # Windows application icon (multi-size: 16-256px)
├── icon.png           # Source PNG (512x512 or larger)
├── 16x16.png          # Linux icon (16x16)
├── 32x32.png          # Linux icon (32x32)
├── 64x64.png          # Linux icon (64x64)
├── 128x128.png        # Linux icon (128x128)
├── 256x256.png        # Linux icon (256x256)
├── 512x512.png        # Linux icon (512x512)
├── build/             # Source files for icon generation
│   └── icon.svg       # Source SVG (optional)
└── README.md          # This file
```

## Icon Format Requirements

### macOS (.icns)
- **File:** `icon.icns`
- **Format:** Apple Icon Image format
- **Sizes:** Should contain multiple sizes (16x16 to 1024x1024)
- **Used for:** Dock, Finder, application window, DMG installer
- **Note:** 1024x1024 is required for Retina displays

### Windows (.ico)
- **File:** `icon.ico`
- **Format:** Windows Icon format (multi-resolution container)
- **Required sizes:** 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- **Used for:** Taskbar, File Explorer, shortcuts, installer
- **Note:** 256x256 is displayed on modern high-DPI Windows systems

### Linux (.png)
- **Files:** Individual PNG files at each size
- **Sizes:** 16x16, 32x32, 64x64, 128x128, 256x256, 512x512
- **Used for:** Application menu, window decorations, taskbar, file manager
- **Note:** electron-builder uses the `resources/icons/` directory to find these

### Electron Tray Icon
- **File:** `icon.png` or `512x512.png`
- **Format:** PNG, 512x512 or larger
- **Used for:** System tray icon, notifications

## Generating Platform-Specific Icons from Source

### Prerequisites
- Source image: High-resolution PNG (1024x1024 recommended) or SVG
- Place source files in `resources/icons/build/` directory

### Option 1: Using ImageMagick (Recommended for Linux/Windows icons)

```bash
# Install ImageMagick
# macOS: brew install imagemagick
# Ubuntu: sudo apt-get install imagemagick
# Windows: choco install imagemagick

# Generate PNG sizes for Linux
for size in 16 32 64 128 256 512; do
  convert build/icon.png -resize ${size}x${size} ${size}x${size}.png
done

# Generate Windows .ico (multi-size)
convert build/icon.png \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 -colors 256 icon.ico
```

### Option 2: Using iconutil (macOS only)

```bash
# Create iconset directory
mkdir icon.iconset

# Generate all required sizes
sips -z 16 16     build/icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 build/icon.png --out icon.iconset/icon_512x512@2x.png

# Convert to .icns
iconutil -c icns icon.iconset -o icon.icns

# Clean up
rm -rf icon.iconset
```

### Option 3: Using electron-icon-maker (Cross-platform)

```bash
# Install globally
npm install -g electron-icon-maker

# Generate all icons from source PNG
electron-icon-maker --input=build/icon.png --output=./

# This creates:
# - icons/mac/icon.icns
# - icons/win/icon.ico
# - icons/png/*.png (various sizes)
```

### Option 4: Using png2icons (Cross-platform)

```bash
# Install
npm install -g png2icons

# Generate icns
png2icons build/icon.png icon -icns

# Generate ico
png2icons build/icon.png icon -ico
```

## Recommended Tools

| Tool | Platform | Purpose |
|------|----------|---------|
| `iconutil` | macOS (built-in) | Generate .icns from iconset |
| `sips` | macOS (built-in) | Resize PNG images |
| ImageMagick | All | Generate .ico and resize PNGs |
| electron-icon-maker | All | All-in-one icon generation |
| png2icons | All | Convert PNG to icns/ico |
| Inkscape | All | SVG to PNG conversion |

## Update Procedure

To update the application icons:

1. **Prepare your source icon:**
   - Create a high-resolution PNG (1024x1024 minimum) or SVG
   - Place it in `resources/icons/build/` directory

2. **Generate platform-specific icons:**
   - Use one of the methods above to generate `.icns`, `.ico`, and sized `.png` files
   - Place the generated files in `resources/icons/`

3. **Verify files are in place:**
   ```
   resources/icons/
   ├── icon.icns      ✓ Required for macOS
   ├── icon.ico       ✓ Required for Windows
   ├── icon.png       ✓ Required for tray/source
   ├── 16x16.png      ✓ Required for Linux
   ├── 32x32.png      ✓ Required for Linux
   ├── 64x64.png      ✓ Required for Linux
   ├── 128x128.png    ✓ Required for Linux
   ├── 256x256.png    ✓ Required for Linux
   └── 512x512.png    ✓ Required for Linux
   ```

4. **Rebuild the application:**
   ```bash
   npm run build
   ```
   This will regenerate the installers with the new icons.

5. **Test the icons:**
   - macOS: Check Dock, Finder, and DMG
   - Windows: Check taskbar, shortcuts, and installer
   - Linux: Check application menu and window decorations

## Icon Specifications

### Color Depth
- **macOS:** 32-bit RGBA (with alpha transparency)
- **Windows:** 32-bit RGBA or 8-bit indexed color
- **Linux:** 32-bit RGBA PNG

### Transparency
All formats support transparency. Use PNG with alpha channel as your source.

### Design Guidelines
- Use simple, recognizable shapes
- Ensure the icon is legible at 16x16 pixels
- Test against both light and dark backgrounds
- Avoid fine details that won't be visible at small sizes

## Troubleshooting

### Icons not showing in macOS Dock
- Clear icon cache: `sudo rm -rf /Library/Caches/com.apple.iconservices.store`
- Restart Finder: `killall Finder`

### Windows icon appears blurry
- Ensure all required sizes are in the .ico file
- Use 256x256 as the largest size for best quality

### Linux icons not updating
- Clear icon cache: `gtk-update-icon-cache -f ~/.local/share/icons/hicolor`
- Log out and back in

## Fallback Behavior

If custom icons are missing, the build system will:
1. Check for icon files in `resources/icons/`
2. If missing, generate placeholder icons using `scripts/generate-icons.js`
3. Log a warning to remind you to add production icons

To generate placeholder icons manually:
```bash
node scripts/generate-icons.js
```
