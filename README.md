# AAX Converter

Convert Audible `.aax` audiobooks to open formats — M4B, MP3, FLAC, OGG, WAV, OPUS, AAC.

## Features

- Multi-account Audible support with automatic activation-byte extraction
- Stores activation keys in SQLite (no need to re-run audible-activator each time)
- File browser sidebar for `.aax` files with converted status icons
- Per-chapter progress bar during conversion
- Full conversion history log
- Chapter splitting, cover art and metadata embedding
- Cross-platform: Linux (AppImage + RPM), Windows (NSIS), macOS (DMG)

## Prerequisites

### Required
- **Node.js** 18+ and npm
- **ffmpeg** in your PATH (or configure the path in Settings)
  - Linux: `sudo apt install ffmpeg` / `sudo dnf install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from https://ffmpeg.org/download.html

### For activation-byte extraction
- **Python 3** in your PATH
- **audible-activator** — the app will auto-clone it to its userData folder on first use, or you can set the path in Settings

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens the app in dev mode with hot-reload.

## Build

```bash
npm run build
```

## Package for distribution

```bash
# All platforms (requires appropriate OS/SDK)
npm run package

# Linux only (AppImage + RPM)
npm run package:linux

# Windows only (NSIS installer)
npm run package:win

# macOS only (DMG)
npm run package:mac
```

Output is placed in the `dist/` folder.

## Architecture

```
src/
├── main/           Electron main process
│   ├── index.js    App bootstrap, BrowserWindow
│   ├── ipc.js      All IPC handlers
│   ├── ffmpeg.js   ffmpeg detection, probe, convert
│   └── audible-activator.js  Python tool integration
├── preload/
│   └── index.js    Context bridge (exposes window.api)
├── renderer/       React + Vite UI
│   └── src/
│       ├── App.jsx
│       └── components/
└── db/
    ├── schema.js   SQLite table definitions
    └── queries.js  All DB operations
```

## Notes on audible-activator

`audible-activator` uses Audible's account credentials to derive the 8-hex-character activation bytes needed to decrypt `.aax` files. These bytes are stored locally in SQLite after first use so re-entry isn't needed.

The tool is cloned from https://github.com/inAudible-NG/audible-activator into your app userData folder automatically. You can also set a custom path in Settings.
