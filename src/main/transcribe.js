// Speech-to-text for The AAXorcist.
//
// The app manages its own Python environment (userData/whisper/venv) with
// faster-whisper in it, plus a model cache next to it, so nothing has to be
// installed by hand beyond Python itself. This module has no Electron imports:
// every path is passed in, which keeps it testable with plain Node.

import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import {
  existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync
} from 'fs'
import path from 'path'
import crypto from 'crypto'
import { decodeToPcm } from './ffmpeg.js'
import { buildOutputs, countWords, safeBaseName } from './transcript-format.js'

const execFileP = promisify(execFile)

const EVT_PREFIX = '@@EVT '
const MIN_PYTHON = [3, 9]
const TEMP_MAX_AGE_MS = 12 * 3600 * 1000

// owner and repo match the Hugging Face cache folder name (models--owner--repo).
export const MODELS = [
  { id: 'large-v3-turbo', label: 'large-v3-turbo (fast, near large-v3 accuracy, recommended)', size: '1.6 GB', owner: 'mobiuslabsgmbh', repo: 'faster-whisper-large-v3-turbo' },
  { id: 'large-v3', label: 'large-v3 (most accurate, slowest)', size: '3 GB', owner: 'Systran', repo: 'faster-whisper-large-v3' },
  { id: 'distil-large-v3', label: 'distil-large-v3 (fast, English only)', size: '1.5 GB', owner: 'Systran', repo: 'faster-distil-whisper-large-v3' },
  { id: 'medium', label: 'medium', size: '1.5 GB', owner: 'Systran', repo: 'faster-whisper-medium' },
  { id: 'small', label: 'small (fastest, least accurate)', size: '0.5 GB', owner: 'Systran', repo: 'faster-whisper-small' }
]

// ── paths ────────────────────────────────────────────────────────────────────

export function enginePaths(userDataDir) {
  const root = path.join(userDataDir, 'whisper')
  const venv = path.join(root, 'venv')
  return {
    root,
    venv,
    models: path.join(root, 'models'),
    tmp: path.join(root, 'tmp'),
    partial: path.join(root, 'partial'),
    python: process.platform === 'win32'
      ? path.join(venv, 'Scripts', 'python.exe')
      : path.join(venv, 'bin', 'python')
  }
}

export function isModelInstalled(modelsDir, id) {
  const known = MODELS.find((m) => m.id === id)
  const owner = known ? known.owner : 'Systran'
  const repo = known ? known.repo : `faster-whisper-${id}`
  const snaps = path.join(modelsDir, `models--${owner}--${repo}`, 'snapshots')
  try {
    return readdirSync(snaps).some((d) => existsSync(path.join(snaps, d, 'model.bin')))
  } catch {
    return false
  }
}

// ── Python discovery and engine status ──────────────────────────────────────

async function tryPython(cmd, extra = []) {
  try {
    const { stdout, stderr } = await execFileP(cmd, [...extra, '--version'], { timeout: 10000 })
    const m = /Python (\d+)\.(\d+)\.(\d+)/.exec(`${stdout}${stderr}`)
    if (!m) return null
    const major = Number(m[1])
    const minor = Number(m[2])
    if (major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1])) return null
    return { cmd, extra, version: `${m[1]}.${m[2]}.${m[3]}` }
  } catch {
    return null
  }
}

export async function findSystemPython(override) {
  const candidates = []
  if (override) candidates.push([override, []])
  candidates.push(['python3', []], ['python', []])
  if (process.platform === 'win32') candidates.push(['py', ['-3']])
  for (const [cmd, extra] of candidates) {
    const found = await tryPython(cmd, extra)
    if (found) return found
  }
  return null
}

export async function getEngineStatus({ userDataDir, pythonOverride }) {
  const paths = enginePaths(userDataDir)
  const systemPython = await findSystemPython(pythonOverride)
  const venvReady = existsSync(paths.python)
  let fasterWhisper = null
  if (venvReady) {
    try {
      const { stdout } = await execFileP(
        paths.python,
        ['-c', "import importlib.metadata as m; print(m.version('faster-whisper'))"],
        { timeout: 20000 }
      )
      fasterWhisper = stdout.trim() || null
    } catch {
      fasterWhisper = null
    }
  }
  const models = MODELS.map((m) => ({
    id: m.id, label: m.label, size: m.size, installed: isModelInstalled(paths.models, m.id)
  }))
  return {
    systemPython: systemPython ? systemPython.version : null,
    venvReady,
    fasterWhisper,
    models,
    engineDir: paths.root,
    ready: Boolean(fasterWhisper)
  }
}

// ── process helpers ──────────────────────────────────────────────────────────

let active = null // { proc, cancelled }

export function isBusy() {
  return Boolean(active)
}

export function cancelActive() {
  if (!active) return false
  active.cancelled = true
  try { active.proc?.kill('SIGTERM') } catch { /* already gone */ }
  return true
}

function begin() {
  if (active) throw new Error('Another transcription task is already running.')
  active = { proc: null, cancelled: false }
  return active
}

function runStreaming(cmd, args, { env, onLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    onSpawn?.(proc)
    const tail = []
    const handle = (line, tag) => {
      tail.push(line)
      if (tail.length > 40) tail.shift()
      onLine?.(line, tag)
    }
    const feed = (stream, tag) => {
      let buf = ''
      stream.on('data', (d) => {
        buf += d.toString()
        const parts = buf.split(/\r\n|\r|\n/)
        buf = parts.pop()
        for (const line of parts) if (line.trim()) handle(line, tag)
      })
      stream.on('end', () => { if (buf.trim()) handle(buf, tag) })
    }
    feed(proc.stdout, 'out')
    feed(proc.stderr, 'err')
    proc.on('error', reject)
    proc.on('close', (code, signal) => resolve({ code, signal, tail }))
  })
}

const PY_ENV = {
  PYTHONUNBUFFERED: '1',
  PYTHONIOENCODING: 'utf-8',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  HF_HUB_DISABLE_TELEMETRY: '1',
  HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
  TOKENIZERS_PARALLELISM: 'false'
}

// ── engine setup ─────────────────────────────────────────────────────────────

// Creates the venv, installs faster-whisper, and downloads the chosen model.
// Safe to run again: finished steps are skipped or finish quickly.
export async function setupEngine({
  userDataDir, pythonOverride, scriptPath, model = 'large-v3', onPhase, onLog
}) {
  const act = begin()
  try {
    const paths = enginePaths(userDataDir)
    mkdirSync(paths.models, { recursive: true })
    const log = (line) => onLog?.(line)
    const track = (p) => { act.proc = p }
    const check = () => { if (act.cancelled) throw new Error('Cancelled') }

    onPhase?.({ phase: 'python', state: 'active' })
    const sys = await findSystemPython(pythonOverride)
    if (!sys) {
      throw new Error(
        'Python 3.9 or newer was not found. Install it (Fedora: sudo dnf install python3, ' +
        'Debian/Ubuntu: sudo apt install python3 python3-venv), then try again.'
      )
    }
    onPhase?.({ phase: 'python', state: 'done', detail: sys.version })

    if (!existsSync(paths.python)) {
      onPhase?.({ phase: 'venv', state: 'active' })
      const r = await runStreaming(sys.cmd, [...sys.extra, '-m', 'venv', paths.venv], {
        env: PY_ENV, onLine: log, onSpawn: track
      })
      check()
      if (r.code !== 0) {
        const text = r.tail.join(' ')
        throw new Error(
          'Could not create the Python environment. ' +
          (/ensurepip|venv/i.test(text)
            ? 'On Debian/Ubuntu install python3-venv (sudo apt install python3-venv). '
            : '') + r.tail.slice(-2).join(' ')
        )
      }
    }
    onPhase?.({ phase: 'venv', state: 'done' })

    onPhase?.({ phase: 'pip', state: 'active' })
    // Upgrading pip is best effort; installing faster-whisper is not.
    await runStreaming(paths.python,
      ['-m', 'pip', 'install', '--upgrade', '--progress-bar', 'off', 'pip'],
      { env: PY_ENV, onLine: log, onSpawn: track })
    check()
    const pip = await runStreaming(paths.python,
      ['-m', 'pip', 'install', '--upgrade', '--progress-bar', 'off', 'faster-whisper>=1.1.0'],
      { env: PY_ENV, onLine: log, onSpawn: track })
    check()
    if (pip.code !== 0) {
      throw new Error(`Installing faster-whisper failed. ${pip.tail.slice(-3).join(' ')}`)
    }
    onPhase?.({ phase: 'pip', state: 'done' })

    onPhase?.({ phase: 'model', state: 'active', detail: model })
    const dl = await runStreaming(paths.python,
      [scriptPath, '--download-only', '--model', model, '--model-dir', paths.models],
      { env: PY_ENV, onLine: (line, tag) => { if (!line.startsWith(EVT_PREFIX)) log(line, tag) }, onSpawn: track })
    check()
    if (dl.code !== 0) {
      throw new Error(`Downloading the ${model} model failed. ${dl.tail.slice(-3).join(' ')}`)
    }
    onPhase?.({ phase: 'model', state: 'done', detail: model })
    return { ok: true }
  } finally {
    active = null
  }
}

// ── transcription ────────────────────────────────────────────────────────────

export function chaptersFromProbe(probe) {
  return (probe?.chapters || [])
    .map((c) => ({
      title: (c.tags && (c.tags.title || c.tags.TITLE)) || '',
      start: parseFloat(c.start_time),
      end: parseFloat(c.end_time)
    }))
    .filter((c) => Number.isFinite(c.start))
}

export function parseWorkerEvent(line) {
  if (!line.startsWith(EVT_PREFIX)) return null
  try {
    return JSON.parse(line.slice(EVT_PREFIX.length))
  } catch {
    return null
  }
}

function cleanOldTemp(dir) {
  try {
    const now = Date.now()
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      if (now - statSync(p).mtimeMs > TEMP_MAX_AGE_MS) rmSync(p, { force: true, recursive: true })
    }
  } catch { /* nothing to clean */ }
}

export async function runTranscription({
  userDataDir, scriptPath, ffmpegPath, inputPath, activationBytes, chapters,
  outputDir, baseName, title, formats,
  model = 'large-v3', language = 'en', device = 'auto', computeType = 'auto',
  glossary = '', carryContext = false, vad = true, beamSize = 5, threads = 0,
  onStep, onProgress, onLog
}) {
  const act = begin()
  const paths = enginePaths(userDataDir)
  const id = crypto.randomBytes(4).toString('hex')
  const pcmPath = path.join(paths.tmp, `${id}.pcm`)
  const chaptersPath = path.join(paths.tmp, `${id}.chapters.json`)
  const resultPath = path.join(paths.tmp, `${id}.result.json`)
  const check = () => { if (act.cancelled) throw new Error('Cancelled') }

  try {
    if (!existsSync(paths.python)) {
      throw new Error('The transcription engine is not installed yet. Install it first.')
    }
    mkdirSync(paths.tmp, { recursive: true })
    mkdirSync(paths.partial, { recursive: true })
    mkdirSync(outputDir, { recursive: true })
    cleanOldTemp(paths.tmp)

    const st = statSync(inputPath)
    const key = crypto.createHash('sha1')
      .update(`${inputPath}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
    const partialPath = path.join(paths.partial, `${key}.jsonl`)

    onStep?.({ step: 'decoding', state: 'active' })
    await decodeToPcm({
      ffmpegPath, inputPath, outputPath: pcmPath, activationBytes,
      onSpawn: (p) => { act.proc = p },
      onProgress: (p) => onProgress?.({ phase: 'decode', pct: p.pct })
    }).catch((err) => { check(); throw err })
    check()
    onStep?.({ step: 'decoding', state: 'done' })

    writeFileSync(chaptersPath, JSON.stringify(chapters || []))

    const args = [
      scriptPath,
      '--audio', pcmPath,
      '--model', model,
      '--model-dir', paths.models,
      '--device', device,
      '--compute-type', computeType,
      '--language', language,
      '--beam-size', String(beamSize),
      '--chapters-json', chaptersPath,
      '--partial', partialPath,
      '--out-json', resultPath
    ]
    if (threads) args.push('--threads', String(threads))
    if (glossary && glossary.trim()) args.push('--glossary', glossary.trim())
    if (carryContext) args.push('--carry-context')
    if (!vad) args.push('--no-vad')
    if (isModelInstalled(paths.models, model)) args.push('--local-only')

    onStep?.({ step: 'loading', state: 'active' })
    let lastError = null
    let doneEvent = null
    let started = false
    const r = await runStreaming(paths.python, args, {
      env: PY_ENV,
      onSpawn: (p) => { act.proc = p },
      onLine: (line, tag) => {
        const evt = tag === 'out' ? parseWorkerEvent(line) : null
        if (!evt) { onLog?.(line); return }
        if (evt.event === 'start') {
          started = true
          onStep?.({ step: 'loading', state: 'done', detail: `${evt.device}, ${evt.compute_type}` })
          onStep?.({ step: 'transcribing', state: 'active', detail: evt })
        } else if (evt.event === 'progress') {
          onProgress?.({ phase: 'transcribe', ...evt })
        } else if (evt.event === 'done') {
          doneEvent = evt
        } else if (evt.event === 'error') {
          lastError = evt.message
        }
      }
    })
    check()
    if (r.code !== 0) {
      throw new Error(lastError || `The Whisper worker stopped (exit ${r.code}). ${r.tail.slice(-3).join(' ')}`)
    }
    if (!started || !existsSync(resultPath)) {
      throw new Error('The Whisper worker finished without producing a transcript.')
    }

    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    const base = safeBaseName(baseName)
    const files = buildOutputs(result, { baseName: base, title, source: path.basename(inputPath), formats })
    const outputs = files.map((f) => {
      const p = path.join(outputDir, f.filename)
      writeFileSync(p, f.content, 'utf8')
      return { kind: f.kind, path: p, filename: f.filename }
    })
    rmSync(partialPath, { force: true })

    return {
      outputs,
      stats: {
        words: countWords(result),
        segments: doneEvent?.segments ?? null,
        durationSec: result.duration,
        elapsedSec: doneEvent?.elapsed ?? null,
        language: result.language,
        model: result.model
      }
    }
  } finally {
    for (const f of [pcmPath, chaptersPath, resultPath, `${resultPath}.tmp`]) {
      rmSync(f, { force: true })
    }
    active = null
  }
}
