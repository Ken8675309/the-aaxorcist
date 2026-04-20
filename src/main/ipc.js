import { dialog, app, safeStorage, shell } from 'electron'
import path from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as db from '../db/queries.js'
import { detectFfmpeg, probeFile, convert, installFfmpegLinux } from './ffmpeg.js'
import { getActivationBytes, extractAaxChecksum, getRcrackPath, getTablesDir } from './activation.js'
import { buildFileTree } from './file-browser.js'

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

  ipcMain.handle('shell:open-file', (_, filePath) => shell.openPath(filePath))
  ipcMain.handle('shell:open-folder', (_, filePath) => shell.showItemInFolder(filePath))

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

  ipcMain.handle('files:tree', (_, rootDir) => {
    if (!rootDir || !existsSync(rootDir)) return []
    return buildFileTree(rootDir)
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
