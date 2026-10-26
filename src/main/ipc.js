import { dialog, app, safeStorage, shell } from 'electron'
import path from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as db from '../db/queries.js'
import { detectFfmpeg, probeFile, convert, installFfmpegLinux } from './ffmpeg.js'
import { getActivationBytes, extractAaxChecksum, getRcrackPath, getTablesDir } from './activation.js'
import { buildFileTree } from './file-browser.js'
import {
  getEngineStatus, setupEngine, runTranscription, cancelActive, chaptersFromProbe
} from './transcribe.js'

// The Whisper worker is a plain Python script. When packaged it ships outside
// the asar (see build.extraResources in package.json) so Python can run it.
function getTranscribeScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'transcribe', 'transcribe.py')
    : path.join(app.getAppPath(), 'resources', 'transcribe', 'transcribe.py')
}

// ── Active conversions ─────────────────────────────────────────────────────

const activeConversions = new Map()

export function setupIpc(ipcMain, getWindow) {
  // ── App info ──────────────────────────────────────────────────────────────

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }))

  // ── FFmpeg ────────────────────────────────────────────────────────────────

  ipcMain.handle('ffmpeg:detect', () => {
    const custom = db.getSetting('ffmpegPath')
    const found = detectFfmpeg(custom)
    return { path: found, found: !!found }
  })

  ipcMain.handle('ffmpeg:install', async () => {
    if (process.platform !== 'linux') throw new Error('Auto-install only supported on Linux')
    await installFfmpegLinux()
    return detectFfmpeg(null)
  })

  ipcMain.handle('ffmpeg:probe', async (_, filePath) => {
    const ffPath = detectFfmpeg(db.getSetting('ffmpegPath'))
    if (!ffPath) throw new Error('ffmpeg not found')
    return probeFile(ffPath, filePath)
  })

  // ── Convert ───────────────────────────────────────────────────────────────

  ipcMain.handle('convert:start', async (event, opts) => {
    const win = getWindow()
    const {
      inputPath,
      format = 'm4b',
      quality = '128k',
      outputFolder,
      manualActivationBytes
    } = opts

    const ffPath = detectFfmpeg(db.getSetting('ffmpegPath'))
    if (!ffPath) throw new Error('ffmpeg not found. Please install ffmpeg first.')

    let activationBytes = null

    if (manualActivationBytes) {
      activationBytes = manualActivationBytes.toLowerCase().trim()
    } else {
      const result = await getActivationBytes(ffPath, inputPath, (status) => {
        win?.webContents.send('convert:step', status)
      })
      activationBytes = result.activationBytes
    }

    win?.webContents.send('convert:step', { step: 'converting', state: 'active' })

    const basename = path.basename(inputPath, '.aax')
    const outDir = outputFolder || path.join(path.dirname(inputPath), 'converted')
    mkdirSync(outDir, { recursive: true })
    const outputPath = path.join(outDir, `${basename}.${format}`)

    const convId = Date.now().toString()
    let killed = false

    const promise = convert({
      ffmpegPath: ffPath,
      inputPath,
      outputPath,
      format,
      quality,
      activationBytes,
      onProgress: (prog) => win?.webContents.send('convert:progress', prog)
    })

    activeConversions.set(convId, { kill: () => { killed = true } })

    try {
      await promise
      const fileName = path.basename(outputPath)
      db.addHistory({ inputPath, outputPath, filename: path.basename(inputPath), format, quality })
      return { convId, outputPath, fileName, format }
    } catch (err) {
      if (!killed) {
        db.addHistoryError({ inputPath, filename: path.basename(inputPath), format, error: err.message })
      }
      throw err
    } finally {
      activeConversions.delete(convId)
    }
  })

  ipcMain.handle('convert:cancel', (_, convId) => {
    const conv = activeConversions.get(convId)
    if (conv) { conv.kill(); activeConversions.delete(convId) }
  })

  // ── Transcription (Séance) ────────────────────────────────────────────────

  const engineOpts = () => ({
    userDataDir: app.getPath('userData'),
    pythonOverride: db.getSetting('pythonPath')
  })

  ipcMain.handle('whisper:status', () => getEngineStatus(engineOpts()))

  ipcMain.handle('whisper:setup', async (_, opts = {}) => {
    const win = getWindow()
    return setupEngine({
      ...engineOpts(),
      scriptPath: getTranscribeScript(),
      model: opts.model || 'large-v3-turbo',
      onPhase: (p) => win?.webContents.send('whisper:phase', p),
      onLog: (line) => win?.webContents.send('whisper:log', line)
    })
  })

  // Cancels engine setup or a running transcription, whichever is active.
  ipcMain.handle('transcribe:cancel', () => cancelActive())

  ipcMain.handle('transcribe:start', async (_, opts) => {
    const win = getWindow()
    const {
      inputPath, manualActivationBytes, model, language, device, computeType,
      glossary, carryContext, vad, formats, outputFolder
    } = opts

    if (!inputPath || !existsSync(inputPath)) throw new Error('Choose an audio file first.')
    const ffPath = detectFfmpeg(db.getSetting('ffmpegPath'))
    if (!ffPath) throw new Error('ffmpeg not found. Please install ffmpeg first.')
    const status = await getEngineStatus(engineOpts())
    if (!status.ready) throw new Error('The transcription engine is not installed yet. Install it first.')

    let activationBytes = null
    if (inputPath.toLowerCase().endsWith('.aax')) {
      if (manualActivationBytes) {
        activationBytes = manualActivationBytes.toLowerCase().trim()
      } else {
        const found = await getActivationBytes(ffPath, inputPath, (s) => {
          win?.webContents.send('transcribe:step', s)
        })
        activationBytes = found.activationBytes
      }
    }

    let chapters = []
    try {
      chapters = chaptersFromProbe(await probeFile(ffPath, inputPath))
    } catch {
      // chapters are optional; fall back to fixed-length blocks
    }

    const baseName = path.basename(inputPath, path.extname(inputPath))
    const outputDir = outputFolder
      || db.getSetting('defaultTranscriptFolder')
      || path.join(path.dirname(inputPath), 'transcripts')

    const result = await runTranscription({
      ...engineOpts(),
      scriptPath: getTranscribeScript(),
      ffmpegPath: ffPath,
      inputPath, activationBytes, chapters, outputDir, baseName,
      formats, model, language, device, computeType, glossary, carryContext, vad,
      onStep: (s) => win?.webContents.send('transcribe:step', s),
      onProgress: (p) => win?.webContents.send('transcribe:progress', p)
    })

    // Hand-entered bytes just decoded a whole book, so they are right: remember
    // them against this file's checksum so they never need entering again.
    if (manualActivationBytes && activationBytes) {
      try {
        const checksum = await extractAaxChecksum(ffPath, inputPath)
        db.addKey({
          hexKey: activationBytes, checksum,
          bookTitle: path.basename(inputPath, '.aax'), filePath: inputPath
        })
      } catch {
        // storing the key is a convenience; the transcript is already done
      }
    }
    return result
  })

  ipcMain.handle('shell:open-file', (_, filePath) => shell.openPath(filePath))
  // showItemInFolder can block the whole window on some Linux desktops while it
  // waits for the file manager, so open the containing folder asynchronously.
  ipcMain.handle('shell:open-folder', async (_, filePath) => {
    if (process.platform === 'linux') {
      try {
        const err = await shell.openPath(path.dirname(filePath))
        if (!err) return
      } catch {
        // fall through to the default behaviour
      }
    }
    shell.showItemInFolder(filePath)
  })

  // ── Activation ────────────────────────────────────────────────────────────

  ipcMain.handle('activation:checksum', async (_, filePath) => {
    const ffPath = detectFfmpeg(db.getSetting('ffmpegPath'))
    if (!ffPath) throw new Error('ffmpeg not found')
    return await extractAaxChecksum(ffPath, filePath)
  })

  ipcMain.handle('activation:status', () => ({
    rcrackFound: !!getRcrackPath(),
    tablesDir: getTablesDir()
  }))

  // ── File browser ──────────────────────────────────────────────────────────

  ipcMain.handle('files:tree', async (_, rootDir) => {
    if (!rootDir || !existsSync(rootDir)) return []
    return await buildFileTree(rootDir)
  })

  ipcMain.handle('files:pick-folder', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('files:pick-file', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      filters: [{ name: 'Audible AAX', extensions: ['aax'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('files:pick-audio', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      filters: [{
        name: 'Audio',
        extensions: ['aax', 'm4b', 'm4a', 'mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'mp4', 'wma', 'webm']
      }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('files:pick-output', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Output Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Keys ──────────────────────────────────────────────────────────────────

  ipcMain.handle('keys:list', () => db.getKeys())
  ipcMain.handle('keys:add', (_, payload) => db.addKey(payload))
  ipcMain.handle('keys:delete', (_, id) => { db.deleteKey(id); return true })

  // ── History ───────────────────────────────────────────────────────────────

  ipcMain.handle('history:list', () => db.getHistory())

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get-all', () => db.getAllSettings())
  ipcMain.handle('settings:set', (_, key, value) => { db.setSetting(key, value); return true })

  ipcMain.handle('settings:detect-tools', () => ({
    ffmpeg: detectFfmpeg(db.getSetting('ffmpegPath')),
    rcrack: getRcrackPath(),
    tablesDir: getTablesDir()
  }))
}
