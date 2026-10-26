# The AAXorcist

Convert Audible `.aax` audiobooks to open formats — M4B, MP3, FLAC, OGG, WAV, OPUS, AAC.

## Features

- Multi-account Audible support with automatic activation-byte extraction
- Stores activation keys in SQLite (no need to re-run audible-activator each time)
- File browser sidebar for `.aax` files with converted status icons
- Per-chapter progress bar during conversion
- Full conversion history log
- Chapter splitting, cover art and metadata embedding
- **Transcription (the Séance tab)**: turn an audiobook into text with a local Whisper model, chapter by chapter, nothing sent to the cloud
- Cross-platform: Linux (AppImage + RPM), Windows (NSIS), macOS (DMG)

## Prerequisites

### Required
- **Node.js** 18+ and npm
- **ffmpeg** in your PATH (or configure the path in Settings)
  - Linux: `sudo apt install ffmpeg` / `sudo dnf install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: Download from https://ffmpeg.org/download.html

### For activation bytes (opening .aax files)
- **git** in your PATH. The first time you use an `.aax` file, the app downloads the public [inAudible-NG/tables](https://github.com/inAudible-NG/tables) key tables (about 56 MB) into its data folder and uses them to recover your activation bytes automatically. This happens once, the key is then stored, and the same key works for every book on your Audible account. If you cannot use git, you can still enter the 8-character bytes by hand.
- The tables are for recovering the keys of audiobooks you own, for non-commercial use (see their licence note).

### For transcription (optional)
- **Python 3.9+** in your PATH (`sudo dnf install python3` / `sudo apt install python3 python3-venv`)
- Nothing else by hand. The app creates its own virtual environment, installs `faster-whisper` into it and downloads the speech model you pick, all inside its userData folder (`whisper/`). Nothing is installed system-wide.

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

## Transcription

Open the **Séance** tab, pick an `.aax` (or any audio or `.m4b`) file, and press **Transcribe**.

1. **First run:** click *Install engine* in *The Medium*. It sets up a private Python environment and downloads the model (large-v3-turbo is about 1.6 GB, large-v3 about 3 GB, small about 0.5 GB). This happens once.
2. **Accuracy:** large-v3-turbo is the default: several times faster than large-v3 with accuracy close to it. large-v3 is the most accurate but slowest. Add unusual names or jargon to *Names and terms* to help Whisper spell them. Voice activity detection skips silence and music.
3. **Long books:** the book is split at chapter boundaries (and at quiet moments inside very long chapters), and progress is checkpointed. If you cancel or the app closes, running the same book with the same settings resumes where it stopped.
4. **Output:** Markdown (readable, with a heading per chapter), timestamped text, SRT subtitles and JSON. Files go to `transcripts/` beside the input file unless you choose a folder.
5. **GPU:** an NVIDIA GPU is used automatically when CUDA is available; otherwise it runs on the CPU (int8). CPU speed varies a lot, so try the *small* model first on a slow machine.

`.aax` files use the same activation bytes as conversion: stored keys first, then the automatic table lookup (the first lookup downloads the tables and can take a few minutes), then manual entry.

Run the formatter tests with `npm test`.

### Linux launcher

`bash scripts/install-linux-launcher.sh` adds an app-menu entry and a desktop icon for a source checkout.

## Architecture

```
src/
├── main/           Electron main process
│   ├── index.js    App bootstrap, BrowserWindow
│   ├── ipc.js      All IPC handlers
│   ├── ffmpeg.js   ffmpeg detection, probe, convert, decode for Whisper
│   ├── transcribe.js  Whisper engine setup and transcription runner
│   ├── transcript-format.js  Markdown, text, SRT and JSON writers
│   └── audible-activator.js  Python tool integration
├── preload/
│   └── index.js    Context bridge (exposes window.api)
├── renderer/       React + Vite UI
│   └── src/
│       ├── App.jsx
│       └── components/
├── (resources/transcribe/transcribe.py  Python worker run by the app)
└── db/
    ├── schema.js   SQLite table definitions
    └── queries.js  All DB operations
```

## Notes on audible-activator

`audible-activator` uses Audible's account credentials to derive the 8-hex-character activation bytes needed to decrypt `.aax` files. These bytes are stored locally in SQLite after first use so re-entry isn't needed.

The tool is cloned from https://github.com/inAudible-NG/audible-activator into your app userData folder automatically. You can also set a custom path in Settings.
