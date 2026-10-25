import { spawn } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, chmodSync } from 'fs'
import path from 'path'
import { app } from 'electron'
import * as db from '../db/queries.js'

// Public RainbowCrack plugin and tables (about 56 MB) used to recover your own
// Audible activation bytes offline. Non-commercial use; see its README.
export const TABLES_REPO = 'https://github.com/inAudible-NG/tables.git'

function getResourcesPath() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources')
}

// Two places the tables can live: a copy shipped inside the app (resources/tables,
// for builds that bundle them) or one the app fetched itself into its data folder.
// A packaged app's own folder is read-only, so the fetched copy goes in userData.
function bundledTablesDir() {
  return path.join(getResourcesPath(), 'tables')
}

function fetchedTablesDir() {
  return path.join(app.getPath('userData'), 'tables')
}

export function getTablesDir() {
  const bundled = bundledTablesDir()
  if (existsSync(path.join(bundled, 'rcrack'))) return bundled
  return fetchedTablesDir()
}

export function getRcrackPath() {
  const candidate = path.join(getTablesDir(), 'rcrack')
  return existsSync(candidate) ? candidate : null
}

let fetching = null

// Makes sure rcrack and the tables are present, fetching them once if not.
// Needs git on the PATH. Safe to call concurrently and to call repeatedly.
export function ensureTables(onStatus) {
  if (getRcrackPath()) return Promise.resolve(getRcrackPath())
  if (fetching) return fetching
  fetching = (async () => {
    onStatus?.({ step: 'tables', state: 'active' })
    const dest = fetchedTablesDir()
    const tmp = `${dest}.partial`
    rmSync(tmp, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(path.dirname(dest), { recursive: true })
    await new Promise((resolve, reject) => {
      let err = ''
      const proc = spawn('git', ['clone', '--depth', '1', TABLES_REPO, tmp], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
        stdio: ['ignore', 'ignore', 'pipe']
      })
      proc.stderr.on('data', (d) => { err = (err + d).slice(-800) })
      proc.on('error', (e) => reject(new Error(
        e.code === 'ENOENT'
          ? 'git is needed once to fetch the key tables, and it is not installed. Install git, or enter your activation bytes manually below.'
          : `Could not run git: ${e.message}`
      )))
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(
        `Could not download the key tables (git exited ${code}). Check your internet connection, or enter your activation bytes manually below. ${err.trim()}`
      )))
    })
    if (!existsSync(path.join(tmp, 'rcrack'))) {
      rmSync(tmp, { recursive: true, force: true })
      throw new Error('The downloaded key tables were missing rcrack. Enter your activation bytes manually below.')
    }
    try { chmodSync(path.join(tmp, 'rcrack'), 0o755) } catch { /* best effort */ }
    renameSync(tmp, dest)
    onStatus?.({ step: 'tables', state: 'done' })
    return getRcrackPath()
  })().finally(() => { fetching = null })
  return fetching
}

function deriveFFprobePath(ffmpegPath) {
  const dir = path.dirname(ffmpegPath)
  const candidate = path.join(dir, 'ffprobe')
  return existsSync(candidate) ? candidate : 'ffprobe'
}

// Spawns ffprobe and collects stderr, then extracts the AAX checksum.
// Uses spawn so the file path is passed as a discrete argument — no shell
// interpretation, so spaces in paths are handled correctly.
export function extractAaxChecksum(ffmpegPath, aaxFilePath) {
  const ffprobe = deriveFFprobePath(ffmpegPath)

  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobe, ['-v', 'debug', '-i', aaxFilePath], {
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    proc.on('close', () => {
      console.log('[activation] ffprobe stderr (first 2000 chars):\n', stderr.slice(0, 2000))

      // Matches both:
      //   [aax] file checksum == XXXX
      //   [mov,...] [aax] file checksum == XXXX
      const m = stderr.match(/file checksum == ([0-9a-f]+)/i)
      if (m) return resolve(m[1].toLowerCase())

      reject(new Error('Could not extract checksum — is this a valid .aax file?'))
    })

    proc.on('error', (err) => {
      reject(new Error(`ffprobe failed to start: ${err.message}`))
    })
  })
}

// Runs rcrack with cwd=tablesDir so it finds the .rtc files via relative paths.
function runRcrack(rcrackPath, tablesDir, checksum) {
  return new Promise((resolve, reject) => {
    const proc = spawn(rcrackPath, ['.', '-h', checksum], {
      cwd: tablesDir,
      env: { ...process.env, LD_LIBRARY_PATH: tablesDir },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    proc.on('close', () => {
      console.log('[activation] rcrack output:', (stdout + stderr).slice(0, 500))
      const m = (stdout + stderr).match(/hex:([0-9a-fA-F]{8})/i)
      if (m) return resolve(m[1].toLowerCase())
      reject(new Error(
        `Activation bytes not found in rainbow tables for checksum ${checksum}. ` +
        'Enter them manually below.'
      ))
    })

    proc.on('error', (err) => {
      reject(new Error(`rcrack failed to start: ${err.message}`))
    })
  })
}

// Main entry point. Returns { activationBytes, checksum, fromCache }.
// onStatus({ step, state, fromCache? }) fires as each sub-step starts/finishes.
// Throws if rcrack misses — caller can then ask the user for manual bytes.
export async function getActivationBytes(ffmpegPath, aaxFilePath, onStatus) {
  onStatus?.({ step: 'checksum', state: 'active' })
  const checksum = await extractAaxChecksum(ffmpegPath, aaxFilePath)
  onStatus?.({ step: 'checksum', state: 'done' })

  const cached = db.findKeyByChecksum(checksum)
  if (cached) {
    onStatus?.({ step: 'activation', state: 'done', fromCache: true })
    return { activationBytes: cached.activation_bytes, checksum, fromCache: true }
  }

  let rcrackPath = getRcrackPath()
  if (!rcrackPath) {
    try {
      rcrackPath = await ensureTables(onStatus)
    } catch (e) {
      // The UI offers manual entry when the message mentions the rainbow tables.
      throw new Error(`The rainbow tables are unavailable. ${e.message}`)
    }
  }

  onStatus?.({ step: 'activation', state: 'active' })
  const activationBytes = await runRcrack(rcrackPath, getTablesDir(), checksum)
  onStatus?.({ step: 'activation', state: 'done', fromCache: false })

  const bookTitle = path.basename(aaxFilePath, '.aax')
  db.addKey({ hexKey: activationBytes, checksum, bookTitle, filePath: aaxFilePath })

  return { activationBytes, checksum, fromCache: false }
}
