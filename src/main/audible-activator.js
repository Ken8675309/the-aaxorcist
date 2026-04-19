import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { app } from 'electron'

const REPO_URL = 'https://github.com/inAudible-NG/audible-activator'

export function getActivatorDir() {
  return path.join(app.getPath('userData'), 'audible-activator')
}

export function detectPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const v = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8' })
      if (v.includes('Python 3')) return cmd
    } catch {
      // try next
    }
  }
  return null
}

export function detectActivator(customPath) {
  if (customPath && existsSync(customPath)) return customPath
  const local = path.join(getActivatorDir(), 'audible-activator.py')
  if (existsSync(local)) return local
  return null
}

export async function ensureActivator(onStatus) {
  const dir = getActivatorDir()
  const script = path.join(dir, 'audible-activator.py')
  if (existsSync(script)) return script

  onStatus?.('Cloning audible-activator…')
  await git(['clone', REPO_URL, dir])

  const python = detectPython()
  if (!python) throw new Error('Python 3 not found. Please install Python 3.')

  const req = path.join(dir, 'requirements.txt')
  if (existsSync(req)) {
    onStatus?.('Installing Python dependencies…')
    await runPython([python, '-m', 'pip', 'install', '-r', req, '--user'])
  }
  return script
}

function git(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed`))))
  })
}

function runPython(cmdArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmdArgs[0], cmdArgs.slice(1))
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('pip install failed'))))
  })
}

export function extractActivationBytes({ activatorPath, pythonPath, email, password, onStatus }) {
  return new Promise((resolve, reject) => {
    const python = pythonPath || detectPython()
    if (!python) return reject(new Error('Python 3 not found'))
    if (!activatorPath || !existsSync(activatorPath)) {
      return reject(new Error('audible-activator.py not found'))
    }

    onStatus?.('Running audible-activator…')
    const args = [activatorPath, '-e', email, '-p', password]
    const proc = spawn(python, args, { cwd: path.dirname(activatorPath) })

    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => {
      out += d
      onStatus?.(d.toString().trim())
    })
    proc.stderr.on('data', (d) => {
      err += d
    })

    proc.on('close', (code) => {
      const hexMatch = out.match(/[0-9a-fA-F]{8}/)
      if (hexMatch) return resolve(hexMatch[0])
      reject(new Error(`audible-activator failed (exit ${code}): ${err.slice(-300)}`))
    })
    proc.on('error', reject)
  })
}
