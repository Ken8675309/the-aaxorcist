import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'

export function detectFfmpeg(customPath) {
  if (customPath && existsSync(customPath)) return customPath
  try {
    const p = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul', {
      encoding: 'utf8'
    }).trim()
    if (p) return p
  } catch {
    // not in PATH
  }
  // common install paths
  const candidates = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'ffmpeg', 'bin', 'ffmpeg.exe')
  ]
  return candidates.find(existsSync) || null
}

export function probeFile(ffmpegPath, inputPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', inputPath]
    const proc = spawn(ffprobe, args)
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe error: ${err}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('Failed to parse ffprobe output'))
      }
    })
  })
}

const FORMAT_ARGS = {
  m4b: ['-c', 'copy', '-f', 'mp4'],
  m4a: ['-c', 'copy', '-f', 'mp4'],
  mp3: ['-c:a', 'libmp3lame'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis'],
  wav: ['-c:a', 'pcm_s16le'],
  opus: ['-c:a', 'libopus'],
  aac: ['-c:a', 'aac']
}

const COPY_FORMATS = new Set(['m4b', 'm4a'])

function qualityArgs(format, quality) {
  if (quality === 'copy' || COPY_FORMATS.has(format)) return []
  const map = { '128k': '128k', '64k': '64k', '32k': '32k' }
  const q = map[quality] || '128k'
  return ['-b:a', q]
}

export function convert({ ffmpegPath, inputPath, outputPath, format, quality, activationBytes, onProgress }) {
  return new Promise((resolve, reject) => {
    const fmtArgs = FORMAT_ARGS[format] || FORMAT_ARGS.m4b
    const qArgs = qualityArgs(format, quality)

    const args = [
      '-y',
      ...(activationBytes ? ['-activation_bytes', activationBytes] : []),
      '-i', inputPath,
      ...fmtArgs,
      ...qArgs,
      '-map_metadata', '0',
      '-map_chapters', '0',
      outputPath
    ]

    const proc = spawn(ffmpegPath, args)
    let totalDuration = 0
    let currentTime = 0
    let chapterCount = 0
    let stderr = ''

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text

      // parse total duration from ffmpeg header
      const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
      if (durMatch && !totalDuration) {
        totalDuration =
          parseInt(durMatch[1]) * 3600 +
          parseInt(durMatch[2]) * 60 +
          parseInt(durMatch[3])
      }

      // parse chapter count from Chapters line
      const chapMatch = stderr.match(/Chapters:\s*(\d+)/i)
      if (chapMatch) chapterCount = parseInt(chapMatch[1])

      // parse current time from progress line
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
      if (timeMatch) {
        currentTime =
          parseInt(timeMatch[1]) * 3600 +
          parseInt(timeMatch[2]) * 60 +
          parseInt(timeMatch[3])
        const pct = totalDuration ? Math.round((currentTime / totalDuration) * 100) : 0
        const currentChapter = chapterCount
          ? Math.max(1, Math.ceil((currentTime / totalDuration) * chapterCount))
          : null
        onProgress?.({ pct, currentTime, totalDuration, currentChapter, chapterCount })
      }
    })

    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath)
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })

    proc.on('error', reject)

    return { kill: () => proc.kill('SIGTERM') }
  })
}

export function installFfmpegLinux() {
  return new Promise((resolve, reject) => {
    let cmd
    try {
      execSync('which dnf 2>/dev/null', { encoding: 'utf8' })
      cmd = 'pkexec dnf install -y ffmpeg'
    } catch {
      cmd = 'pkexec apt-get install -y ffmpeg'
    }
    const proc = spawn('bash', ['-c', cmd], { stdio: 'inherit' })
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Install failed'))))
  })
}
