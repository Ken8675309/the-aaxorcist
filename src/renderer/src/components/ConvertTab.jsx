import { useState, useEffect, useCallback } from 'react'

const FORMATS = ['m4b', 'mp3', 'm4a', 'flac', 'ogg', 'wav', 'opus', 'aac']
const QUALITIES = [
  { value: 'copy', label: 'Copy / Lossless' },
  { value: '128k', label: '128 kbps' },
  { value: '64k', label: '64 kbps' },
  { value: '32k', label: '32 kbps' }
]

const STEP_LABELS = {
  checksum: { active: 'Extracting checksum…', done: 'Checksum extracted' },
  tables: { active: 'Fetching the key tables (first time only)…', done: 'Key tables ready' },
  activation: {
    active: 'Looking up activation bytes (this can take a few minutes)…',
    done: (fromCache) => fromCache ? 'Activation bytes found (cached)' : 'Activation bytes found'
  },
  converting: { active: 'Purging…' }
}

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

export default function ConvertTab({ selectedFile }) {
  const [format, setFormat] = useState('m4b')
  const [quality, setQuality] = useState('128k')
  const [outputFolder, setOutputFolder] = useState('')
  const [probe, setProbe] = useState(null)
  const [probeError, setProbeError] = useState('')
  const [converting, setConverting] = useState(false)
  const [completedSteps, setCompletedSteps] = useState([])
  const [activeStepLabel, setActiveStepLabel] = useState('')
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [needsManualBytes, setNeedsManualBytes] = useState(false)
  const [manualBytes, setManualBytes] = useState('')
  const [checksum, setChecksum] = useState('')

  useEffect(() => {
    window.api.settingsGetAll().then((s) => {
      if (s.defaultFormat) setFormat(s.defaultFormat)
      if (s.defaultQuality) setQuality(s.defaultQuality)
      if (s.defaultOutputFolder) setOutputFolder(s.defaultOutputFolder)
    })
  }, [])

  useEffect(() => {
    if (!selectedFile) { setProbe(null); return }
    setProbeError(''); setDone(null); setError(''); setProgress(null)
    setNeedsManualBytes(false); setManualBytes(''); setChecksum('')
    setCompletedSteps([]); setActiveStepLabel('')
    window.api.ffmpegProbe(selectedFile).then(setProbe).catch((e) => setProbeError(e.message))
  }, [selectedFile])

  useEffect(() => {
    const offProgress = window.api.onConvertProgress((data) => setProgress(data))
    const offStep = window.api.onConvertStep((data) => {
      const { step, state, fromCache } = data
      if (state === 'active') {
        setActiveStepLabel(STEP_LABELS[step]?.active || step)
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
    setDone(null); setError(''); setProgress(null)
    setCompletedSteps([]); setActiveStepLabel('')
    setNeedsManualBytes(false); setManualBytes(''); setChecksum('')
  }

  const startConvert = useCallback(async (manualActivationBytes) => {
    if (!selectedFile) return
    setConverting(true); setError(''); setDone(null); setProgress(null)
    setCompletedSteps([]); setActiveStepLabel(''); setNeedsManualBytes(false)
    try {
      const result = await window.api.convertStart({
        inputPath: selectedFile, format, quality,
        outputFolder: outputFolder || undefined,
        manualActivationBytes: manualActivationBytes || undefined
      })
      setConverting(false); setActiveStepLabel('')
      setDone({ outputPath: result.outputPath, fileName: result.fileName, format: result.format })
    } catch (err) {
      setConverting(false); setActiveStepLabel('')
      if (err.message?.includes('rainbow tables')) {
        setError(err.message); setNeedsManualBytes(true)
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
    <div style={{ padding: 16, maxWidth: 680 }}>

      {/* The Possessed */}
      <div className="ex-panel" style={{ marginTop: 6 }}>
        <div className="panel-label">The Possessed</div>
        {selectedFile ? (
          <div className="selected-file-display">
            <span style={{ fontSize: 26, flexShrink: 0 }}>📕</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ex-gold)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFile.split('/').pop()}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ex-muted)' }}>
                {probe && (
                  <>
                    {formatDuration(duration)}
                    {fileSize > 0 && <> &nbsp;·&nbsp; {formatSize(fileSize)}</>}
                    {chapterCount > 0 && <> &nbsp;·&nbsp; {chapterCount} chapters</>}
                  </>
                )}
                {probeError && <span style={{ color: 'var(--ex-gold)' }}>{probeError}</span>}
                {!probe && !probeError && <span>Probing…</span>}
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--ex-red2)', fontStyle: 'italic', textAlign: 'right', flexShrink: 0 }}>
              awaiting<br />exorcism
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 11, color: 'var(--ex-muted)', fontStyle: 'italic' }}>
            Select a .aax file from the sidebar to begin
          </p>
        )}
      </div>

      {/* Format + Settings — hide during/after conversion */}
      {!isConverting && !done && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginTop: 0 }}>
          <div className="ex-panel">
            <div className="panel-label">Choose Your Vessel</div>
            <div className="format-grid">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  className={`format-chip${format === f ? ' selected' : ''}`}
                  onClick={() => setFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="ex-panel">
            <div className="panel-label">The Ritual</div>
            <div className="tog-row">
              <span>Quality</span>
              <select
                className="ex-select"
                style={{ width: 'auto', padding: '2px 6px', fontSize: 11 }}
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                {QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="panel-label">Output Sanctuary</div>
              <div className="output-row">
                <div className="output-path" title={outputFolder}>
                  {outputFolder || 'input_folder/converted/'}
                </div>
                <button className="smol-btn" onClick={pickOutput}>change</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline steps + progress */}
      {(isConverting || completedSteps.length > 0) && !done && (
        <div className="ex-panel">
          <div className="panel-label">Exorcism Progress</div>

          {completedSteps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ex-green2)', padding: '3px 0' }}>
              <span>✓</span><span>{s.label}</span>
            </div>
          ))}

          {activeStepLabel && !progress && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ex-text)', padding: '3px 0' }}>
              <Spinner /><span>{activeStepLabel}</span>
            </div>
          )}

          {progress !== null && (
            <div style={{ marginTop: 6 }}>
              <div className="ex-progress-bg">
                <div className="ex-progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ex-muted)', marginTop: 4, fontStyle: 'italic' }}>
                <span>
                  {chapterCount > 0 && progress.currentChapter
                    ? `Purging chapter ${progress.currentChapter} of ${chapterCount}…`
                    : 'Purging…'}
                </span>
                <span>{progress.pct}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success */}
      {done && (
        <div className="liberated-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: 'var(--ex-green2)', fontSize: 18 }}>✝</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ex-green2)' }}>{done.fileName}</div>
              <div style={{ fontSize: 10, color: 'var(--ex-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={done.outputPath}>
                {done.outputPath}
              </div>
              {duration > 0 && (
                <div style={{ fontSize: 10, color: 'var(--ex-muted)', marginTop: 2 }}>
                  {done.format?.toUpperCase()} · {formatDuration(duration)}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="smol-btn" onClick={() => window.api.shellOpenFile(done.outputPath)}>
              Open file
            </button>
            <button className="smol-btn" onClick={() => window.api.shellOpenFolder(done.outputPath)}>
              Open folder
            </button>
            <button className="smol-btn" onClick={resetForm}>
              Exorcise another
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-card">{error}</div>}

      {/* Manual activation bytes */}
      {needsManualBytes && !converting && (
        <div className="ex-panel">
          <div className="panel-label">Inscribe Activation Bytes</div>
          {checksum && (
            <p style={{ fontSize: 10, color: 'var(--ex-muted)', fontFamily: 'monospace', marginBottom: 8 }}>
              Checksum: <span style={{ color: 'var(--ex-text)', userSelect: 'all' }}>{checksum}</span>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={manualBytes}
              onChange={(e) => setManualBytes(e.target.value.toLowerCase())}
              placeholder="e.g. 1a2b3c4d"
              maxLength={8}
              className="ex-input mono"
              style={{ width: 140 }}
            />
            <button className="smol-btn" onClick={submitManualBytes}>
              Inscribe & Exorcise
            </button>
          </div>
        </div>
      )}

      {/* Exorcise button */}
      {!done && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <button
            className="exorcise-btn"
            onClick={() => startConvert()}
            disabled={!selectedFile || converting}
          >
            ✝ &nbsp; Exorcise &nbsp; ✝
          </button>
          {converting && (
            <button
              className="smol-btn"
              onClick={async () => {
                await window.api.convertCancel('')
                setConverting(false); setProgress(null); setActiveStepLabel('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <div className="ex-verse">"The power of open formats compels you."</div>
    </div>
  )
}

function Spinner() {
  return (
    <svg style={{ width: 14, height: 14, flexShrink: 0 }} className="animate-spin" viewBox="0 0 24 24" fill="none">
      <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="var(--ex-gold)" strokeWidth="4" />
      <path style={{ opacity: 0.75 }} fill="var(--ex-gold)" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
