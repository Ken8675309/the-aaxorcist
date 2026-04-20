import { spawn } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { app } from 'electron'
import * as db from '../db/queries.js'

function getResourcesPath() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources')
}

export function getTablesDir() {
  return path.join(getResourcesPath(), 'tables')
}

export function getRcrackPath() {
  const bundled = path.join(getTablesDir(), 'rcrack')
  if (existsSync(bundled)) return bundled
  return null
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

  const rcrackPath = getRcrackPath()
  if (!rcrackPath) {
    throw new Error('rcrack not found in resources/tables/. Reinstall the app.')
  }

  onStatus?.({ step: 'activation', state: 'active' })
  const activationBytes = await runRcrack(rcrackPath, getTablesDir(), checksum)
  onStatus?.({ step: 'activation', state: 'done', fromCache: false })

  const bookTitle = path.basename(aaxFilePath, '.aax')
  db.addKey({ hexKey: activationBytes, checksum, bookTitle, filePath: aaxFilePath })

  return { activationBytes, checksum, fromCache: false }
}
