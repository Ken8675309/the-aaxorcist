import { useState, useEffect, useCallback } from 'react'

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

export default function ConvertTab({ selectedFile, activeAccount, accounts }) {
  const [format, setFormat] = useState('m4b')
  const [quality, setQuality] = useState('128k')
  const [splitChapters, setSplitChapters] = useState(false)
  const [embedCover, setEmbedCover] = useState(true)
  const [embedChapters, setEmbedChapters] = useState(true)
  const [outputFolder, setOutputFolder] = useState('')
  const [accountId, setAccountId] = useState(null)
  const [probe, setProbe] = useState(null)
  const [probeError, setProbeError] = useState('')
  const [converting, setConverting] = useState(false)
  const [convId, setConvId] = useState(null)
  const [progress, setProgress] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')

  // Set default accountId from active account
  useEffect(() => {
    if (activeAccount) setAccountId(activeAccount.id)
  }, [activeAccount])

  // Probe file on selection
  useEffect(() => {
    if (!selectedFile) { setProbe(null); return }
    setProbeError('')
    setDone(null)
    setError('')
    setProgress(null)
    window.api.ffmpegProbe(selectedFile).then(setProbe).catch((e) => setProbeError(e.message))
  }, [selectedFile])

  // Subscribe to conversion events
  useEffect(() => {
    const offProgress = window.api.onConvertProgress((data) => {
      if (data.convId === convId) setProgress(data)
    })
    const offDone = window.api.onConvertDone((data) => {
      if (data.convId === convId) { setDone(data.outputPath); setConverting(false) }
    })
    const offStatus = window.api.onConvertStatus(({ msg }) => setStatusMsg(msg))
    return () => { offProgress(); offDone(); offStatus() }
  }, [convId])

  const pickOutput = async () => {
    const dir = await window.api.filesPickOutput()
    if (dir) setOutputFolder(dir)
  }

  const startConvert = async () => {
    if (!selectedFile) return
    setConverting(true)
    setError('')
    setDone(null)
    setProgress(null)
    setStatusMsg('')
    try {
      const result = await window.api.convertStart({
        inputPath: selectedFile,
        format,
        quality,
        outputFolder: outputFolder || undefined,
        splitChapters,
        embedCover,
        embedChapters,
        accountId
      })
      setConvId(result.convId)
    } catch (err) {
      setError(err.message)
      setConverting(false)
    }
  }

  const cancel = async () => {
    if (convId) await window.api.convertCancel(convId)
    setConverting(false)
    setProgress(null)
  }

  const duration = probe?.format?.duration ? parseFloat(probe.format.duration) : 0
  const chapterCount = probe?.chapters?.length || 0
  const fileSize = probe?.format?.size ? parseInt(probe.format.size) : 0

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

      {/* Account selector */}
      <div className="mb-4">
        <label className="block text-sm text-slate-400 mb-1">Account</label>
        <select
          value={accountId || ''}
          onChange={(e) => setAccountId(e.target.value ? parseInt(e.target.value) : null)}
          className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-500"
        >
          <option value="">None (manual key only)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* Format + quality row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Output Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-500"
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>{f.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Quality</label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-500"
          >
            {QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex flex-wrap gap-4 mb-4">
        <Toggle label="Split into chapters" value={splitChapters} onChange={setSplitChapters} />
        <Toggle label="Embed cover art" value={embedCover} onChange={setEmbedCover} />
        <Toggle label="Embed chapter metadata" value={embedChapters} onChange={setEmbedChapters} />
      </div>

      {/* Output folder */}
      <div className="mb-6">
        <label className="block text-sm text-slate-400 mb-1">Output Folder</label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={outputFolder}
            placeholder="Default: input_folder/converted/"
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-300 focus:outline-none cursor-default"
          />
          <button
            onClick={pickOutput}
            className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300"
          >
            Browse
          </button>
        </div>
      </div>

      {/* Progress */}
      {(converting || progress) && (
        <div className="mb-4 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>
              {progress
                ? progress.chapterCount
                  ? `Converting… chapter ${progress.currentChapter} of ${progress.chapterCount}`
                  : 'Converting…'
                : statusMsg || 'Preparing…'}
            </span>
            <span>{progress ? `${progress.pct}%` : ''}</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-brand-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress?.pct || 0}%` }}
            />
          </div>
        </div>
      )}

      {done && (
        <div className="mb-4 bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-3 text-sm text-green-300">
          ✓ Done: {done}
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={startConvert}
          disabled={!selectedFile || converting}
          className="px-6 py-2 rounded bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {converting ? 'Converting…' : 'Convert'}
        </button>
        {converting && (
          <button
            onClick={cancel}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-red-800 text-slate-300 text-sm transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors shrink-0 ${value ? 'bg-brand-600' : 'bg-slate-700'}`}
      >
        <span
          className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${value ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
      {label}
    </label>
  )
}
