import { dialog, app } from 'electron'
import path from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as db from '../db/queries.js'
import { detectFfmpeg, probeFile, convert, installFfmpegLinux } from './ffmpeg.js'
import {
  detectPython,
  detectActivator,
  ensureActivator,
  extractActivationBytes
} from './audible-activator.js'
import { buildFileTree } from './file-browser.js'

// Track active conversion processes for cancellation
const activeConversions = new Map()

export function setupIpc(ipcMain, getWindow) {
  // ── App info ──────────────────────────────────────────────────────────────

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData')
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
      splitChapters = false,
      embedCover = true,
      embedChapters = true,
      accountId
    } = opts

    const ffPath = detectFfmpeg(db.getSetting('ffmpegPath'))
    if (!ffPath) throw new Error('ffmpeg not found. Please install ffmpeg first.')

    // Resolve activation bytes
    let activationBytes = null
    const account = accountId ? db.getAccounts().find((a) => a.id === accountId) : db.getActiveAccount()

    if (account) {
      const stored = db.findKey(account.id)
      if (stored) {
        activationBytes = stored.hex_key
      } else {
        // run audible-activator
        try {
          const credentials = JSON.parse(account.credentials || '{}')
          const activatorPath = detectActivator(db.getSetting('activatorPath'))
          const resolved = activatorPath || (await ensureActivator((msg) => {
            win?.webContents.send('convert:status', { msg })
          }))
          activationBytes = await extractActivationBytes({
            activatorPath: resolved,
            pythonPath: db.getSetting('pythonPath'),
            email: credentials.email,
            password: credentials.password,
            onStatus: (msg) => win?.webContents.send('convert:status', { msg })
          })
          const filename = path.basename(inputPath)
          db.addKey({ hexKey: activationBytes, bookTitle: filename, accountId: account.id })
        } catch (err) {
          throw new Error(`Could not get activation bytes: ${err.message}`)
        }
      }
    }

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
      onProgress: (prog) => {
        win?.webContents.send('convert:progress', { convId, ...prog })
      }
    })

    activeConversions.set(convId, { kill: () => { killed = true; promise.kill?.() } })

    try {
      await promise
      db.addHistory({
        inputPath,
        outputPath,
        filename: path.basename(inputPath),
        format,
        quality,
        accountId: account?.id
      })
      win?.webContents.send('convert:done', { convId, outputPath })
      return { convId, outputPath }
    } catch (err) {
      if (!killed) {
        db.addHistoryError({
          inputPath,
          filename: path.basename(inputPath),
          format,
          accountId: account?.id,
          error: err.message
        })
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

  // ── File browser ──────────────────────────────────────────────────────────

  ipcMain.handle('files:tree', (_, rootDir) => {
    if (!rootDir || !existsSync(rootDir)) return []
    return buildFileTree(rootDir)
  })

  ipcMain.handle('files:pick-folder', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('files:pick-file', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Audible AAX', extensions: ['aax'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('files:pick-output', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Output Folder'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Accounts ──────────────────────────────────────────────────────────────

  ipcMain.handle('accounts:list', () => db.getAccounts())
  ipcMain.handle('accounts:active', () => db.getActiveAccount())
  ipcMain.handle('accounts:add', (_, payload) => db.addAccount(payload))
  ipcMain.handle('accounts:switch', (_, id) => { db.switchAccount(id); return true })
  ipcMain.handle('accounts:remove', (_, id) => { db.removeAccount(id); return true })

  ipcMain.handle('accounts:connect', async (event, { email, password, label }) => {
    const win = getWindow()
    // Store credentials and try to extract activation bytes immediately
    db.addAccount({ email, label: label || email, credentials: { email, password } })
    const account = db.getActiveAccount()
    try {
      const activatorPath = detectActivator(db.getSetting('activatorPath'))
      const resolved = activatorPath || (await ensureActivator((msg) => {
        win?.webContents.send('accounts:status', { msg })
      }))
      const bytes = await extractActivationBytes({
        activatorPath: resolved,
        pythonPath: db.getSetting('pythonPath'),
        email,
        password,
        onStatus: (msg) => win?.webContents.send('accounts:status', { msg })
      })
      db.addKey({ hexKey: bytes, label: email, accountId: account.id })
      return { success: true, account, activationBytes: bytes }
    } catch (err) {
      return { success: true, account, warning: err.message }
    }
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
    python: detectPython(),
    activator: detectActivator(db.getSetting('activatorPath'))
  }))
}
