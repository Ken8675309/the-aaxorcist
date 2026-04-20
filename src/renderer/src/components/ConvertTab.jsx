import { useState, useEffect, useCallback, useRef } from 'react'

const FORMATS = ['m4b', 'mp3', 'm4a', 'flac', 'ogg', 'wav', 'opus', 'aac']
const QUALITIES = [
  { value: 'copy', label: 'Copy / Lossless' },
  { value: '128k', label: '128 kbps' },
  { value: '64k', label: '64 kbps' },
  { value: '32k', label: '32 kbps' }
]

function formatDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}

function formatSize(bytes) {
  if (!bytes) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`
}

const STEP_LABELS = {
  checksum: { active: 'Extracting checksum…', done: 'Checksum extracted' },
  activation: {
    active: 'Looking up activation bytes…',
    done: (fromCache) => fromCache ? 'Activation bytes found (cached)' : 'Activation bytes found'
  },
  converting: { active: 'Converting…' }
}

export default function ConvertTab({ selectedFile }) {
  const [format, setFormat] = useState('m4b')
  const [quality, setQuality] = useState('128k')
  const [outputFolder, setOutputFolder] = useState('')
  const [probe, setProbe] = useState(null)
  const [probeError, setProbeError] = useState('')

  const [converting, setConverting] = useState(false)
  const [completedSteps, setCompletedSteps] = useState([])  // { label }[]
  const [activeStepLabel, setActiveStepLabel] = useState('')
  const [progress, setProgress] = useState(null)            // { pct, currentTime, totalDuration }

  const [done, setDone] = useState(null)    // { outputPath, fileName, format }
  const [error, setError] = useState('')
  const [needsManualBytes, setNeedsManualBytes] = useState(false)
  const [manualBytes, setManualBytes] = useState('')
  const [checksum, setChecksum] = useState('')

  // Load defaults from settings once
  useEffect(() => {
    window.api.settingsGetAll().then((s) => {
      if (s.defaultFormat) setFormat(s.defaultFormat)
      if (s.defaultQuality) setQuality(s.defaultQuality)
      if (s.defaultOutputFolder) setOutputFolder(s.defaultOutputFolder)
    })
  }, [])

  // Probe file on selection
  useEffect(() => {
    if (!selectedFile) { setProbe(null); return }
    setProbeError('')
    setDone(null)
    setError('')
    setProgress(null)
    setNeedsManualBytes(false)
    setManualBytes('')
    setChecksum('')
    setCompletedSteps([])
    setActiveStepLabel('')
    window.api.ffmpegProbe(selectedFile).then(setProbe).catch((e) => setProbeError(e.message))
  }, [selectedFile])

  // Listen to conversion events — no convId filter (one conversion at a time)
  useEffect(() => {
    const offProgress = window.api.onConvertProgress((data) => {
      setProgress(data)
    })

    const offStep = window.api.onConvertStep((data) => {
      const { step, state, fromCache } = data
      if (state === 'active') {
        const label = STEP_LABELS[step]?.active || step
        setActiveStepLabel(label)
      } else if (state === 'done') {
        const labelFn = STEP_LABELS[step]?.done
        const label = typeof labelFn === 'function' ? labelFn(fromCache) : (labelFn || step)
        setCompletedSteps((prev) => [...prev, { label }])
        setActiveStepLabel('')
      }
    })

    return () => { offProgress(); offStep() }
  }, [])

  const pickOutput = async () => {
    const dir = await window.api.filesPickOutput()
    if (dir) setOutputFolder(dir)
  }

  const resetForm = () => {
    setDone(null)
    setError('')
    setProgress(null)
    setCompletedSteps([])
    setActiveStepLabel('')
    setNeedsManualBytes(false)
    setManualBytes('')
    setChecksum('')
  }

  const startConvert = useCallback(async (manualActivationBytes) => {
    if (!selectedFile) return
    setConverting(true)
    setError('')
    setDone(null)
    setProgress(null)
    setCompletedSteps([])
    setActiveStepLabel('')
    setNeedsManualBytes(false)

    try {
      const result = await window.api.convertStart({
        inputPath: selectedFile,
        format,
        quality,
        outputFolder: outputFolder || undefined,
        manualActivationBytes: manualActivationBytes || undefined
      })
      setConverting(false)
      setActiveStepLabel('')
      setDone({ outputPath: result.outputPath, fileName: result.fileName, format: result.format })
    } catch (err) {
      setConverting(false)
      setActiveStepLabel('')
      if (err.message?.includes('rainbow tables')) {
        setError(err.message)
        setNeedsManualBytes(true)
        window.api.activationChecksum(selectedFile).then(setChecksum).catch(() => {})
      } else {
        setError(err.message)
      }
    }
  }, [selectedFile, format, quality, outputFolder])

  const submitManualBytes = () => {
    if (!/^[0-9a-fA-F]{8}$/.test(manualBytes)) {
      setError('Activation bytes must be exactly 8 hex characters (e.g. 1a2b3c4d)')
      return
    }
    startConvert(manualBytes)
  }

  const duration = probe?.format?.duration ? parseFloat(probe.format.duration) : 0
  const chapterCount = probe?.chapters?.length || 0
  const fileSize = probe?.format?.size ? parseInt(probe.format.size) : 0
  const isConverting = converting || (progress && !done)

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4 text-slate-200">Convert</h2>

      {/* File info */}
      <div className="bg-slate-800 rounded-lg p-4 mb-4 border border-slate-700">
        {selectedFile ? (
          <div>
            <p className="text-sm font-medium text-slate-200 truncate" title={selectedFile}>
              {selectedFile.split('/').pop()}
            </p>
            <p className="text-xs text-slate-500 truncate mt-0.5" title={selectedFile}>
              {selectedFile}
            </p>
            {probe && (
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span>Duration: {formatDuration(duration)}</span>
                <span>Size: {formatSize(fileSize)}</span>
                {chapterCount > 0 && <span>Chapters: {chapterCount}</span>}
              </div>
            )}
            {probeError && <p className="text-xs text-amber-400 mt-1">{probeError}</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Select a .aax file from the sidebar</p>
        )}
      </div>

      {/* Format + quality — hide during/after conversion */}
      {!isConverting && !done && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Output Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-500"
              >
                {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-500"
              >
                {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm text-slate-400 mb-1">Output Folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={outputFolder}
                placeholder="Default: input_folder/converted/"
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-300 cursor-default focus:outline-none"
              />
              <button onClick={pickOutput} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300">
                Browse
              </button>
            </div>
          </div>
        </>
      )}

      {/* Pipeline steps + progress */}
      {(isConverting || completedSteps.length > 0) && !done && (
        <div className="mb-4 bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
          {completedSteps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-slate-400">
              <span className="text-green-400 font-bold shrink-0">✓</span>
              <span>{s.label}</span>
            </div>
          ))}

          {activeStepLabel && !progress && (
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <Spinner className="shrink-0 text-brand-400" />
              <span>{activeStepLabel}</span>
            </div>
          )}

          {progress !== null && (
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-200 mb-2">
                <Spinner className="shrink-0 text-brand-400" />
                <span>
                  Converting…
                  {chapterCount > 0 && progress.currentChapter
                    ? ` chapter ${progress.currentChapter} of ${chapterCount}`
                    : ''}
                </span>
                <span className="ml-auto text-slate-400 tabular-nums">{progress.pct}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success card */}
      {done && (
        <div className="mb-4 bg-green-950/40 border border-green-700/50 rounded-lg p-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-green-300">{done.fileName}</p>
              <p className="text-xs text-slate-500 truncate mt-0.5" title={done.outputPath}>
                {done.outputPath}
              </p>
              {duration > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {done.format?.toUpperCase()} · {formatDuration(duration)}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.api.shellOpenFile(done.outputPath)}
              className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm"
            >
              Open file
            </button>
            <button
              onClick={() => window.api.shellOpenFolder(done.outputPath)}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm"
            >
              Open folder
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 text-sm"
            >
              Convert another
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Manual activation bytes fallback */}
      {needsManualBytes && !converting && (
        <div className="mb-4 bg-slate-800 border border-slate-600 rounded-lg p-4">
          <p className="text-sm font-medium text-slate-200 mb-1">Enter activation bytes manually</p>
          {checksum && (
            <p className="text-xs text-slate-500 font-mono mb-3">
              File checksum: <span className="text-slate-400 select-all">{checksum}</span>
            </p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={manualBytes}
              onChange={(e) => setManualBytes(e.target.value.toLowerCase())}
              placeholder="e.g. 1a2b3c4d"
              maxLength={8}
              className="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono w-36 focus:outline-none focus:border-brand-500 text-slate-200"
            />
            <button
              onClick={submitManualBytes}
              className="px-4 py-2 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm"
            >
              Convert with this key
            </button>
          </div>
        </div>
      )}

      {/* Convert button */}
      {!done && (
        <div className="flex gap-3">
          <button
            onClick={() => startConvert()}
            disabled={!selectedFile || converting}
            className="px-6 py-2 rounded bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {converting ? 'Converting…' : 'Convert'}
          </button>
          {converting && (
            <button
              onClick={async () => {
                await window.api.convertCancel('')
                setConverting(false)
                setProgress(null)
                setActiveStepLabel('')
              }}
              className="px-4 py-2 rounded bg-slate-700 hover:bg-red-800 text-slate-300 text-sm transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Spinner({ className = '' }) {
  return (
    <svg className={`w-4 h-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
