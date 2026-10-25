import { useState, useEffect, useCallback } from 'react'

const LANGUAGES = [
  ['en', 'English'], ['auto', 'Auto-detect'], ['es', 'Spanish'], ['fr', 'French'],
  ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian']
]

const ACCURACY = [
  ['auto', 'Automatic (recommended)'],
  ['int8', 'Fast (int8)'],
  ['float32', 'Most precise (float32, slower on CPU)']
]

const OUTPUTS = [
  ['md', 'Readable (.md)'],
  ['txt', 'Timestamped (.txt)'],
  ['srt', 'Subtitles (.srt)'],
  ['json', 'Raw data (.json)']
]

const SETUP_PHASES = [
  ['python', 'Find Python'],
  ['venv', 'Create a private environment'],
  ['pip', 'Install faster-whisper'],
  ['model', 'Download the speech model']
]

const STEP_LABELS = {
  checksum: { active: 'Extracting checksum…', done: 'Checksum extracted' },
  tables: { active: 'Fetching the key tables (first time only)…', done: 'Key tables ready' },
  activation: {
    active: 'Looking up activation bytes (this can take a few minutes)…',
    done: (fromCache) => (fromCache ? 'Activation bytes found (cached)' : 'Activation bytes found')
  },
  decoding: { active: 'Decoding audio…', done: 'Audio decoded' },
  loading: { active: 'Loading the speech model…', done: (_c, detail) => `Model loaded${detail ? ` (${detail})` : ''}` },
  transcribing: { active: 'Listening…' }
}

function formatDuration(sec) {
  if (!sec) return '-'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}

function formatEta(sec) {
  if (sec == null) return ''
  if (sec < 90) return `${Math.max(1, Math.round(sec))}s`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function TranscribeTab({ selectedFile }) {
  const [source, setSource] = useState(selectedFile || null)
  const [probe, setProbe] = useState(null)
  const [probeError, setProbeError] = useState('')

  const [engine, setEngine] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [phases, setPhases] = useState({})
  const [logLine, setLogLine] = useState('')
  const [setupError, setSetupError] = useState('')

  const [model, setModel] = useState('large-v3-turbo')
  const [language, setLanguage] = useState('en')
  const [compute, setCompute] = useState('auto')
  const [glossary, setGlossary] = useState('')
  const [carry, setCarry] = useState(false)
  const [vad, setVad] = useState(true)
  const [formats, setFormats] = useState(['md', 'txt'])
  const [outputFolder, setOutputFolder] = useState('')

  const [running, setRunning] = useState(false)
  const [completedSteps, setCompletedSteps] = useState([])
  const [activeStepLabel, setActiveStepLabel] = useState('')
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needsManualBytes, setNeedsManualBytes] = useState(false)
  const [manualBytes, setManualBytes] = useState('')
  const [checksum, setChecksum] = useState('')

  const refreshEngine = useCallback(async () => {
    try { setEngine(await window.api.whisperStatus()) } catch (e) { setSetupError(cleanError(e)) }
  }, [])

  const save = (key, value) => window.api.settingsSet(key, value)

  // initial load
  useEffect(() => {
    refreshEngine()
    window.api.settingsGetAll().then((s) => {
      if (s.transcribeModel) setModel(s.transcribeModel)
      if (s.transcribeLanguage) setLanguage(s.transcribeLanguage)
      if (s.transcribeCompute) setCompute(s.transcribeCompute)
      if (typeof s.transcribeGlossary === 'string') setGlossary(s.transcribeGlossary)
      if (typeof s.transcribeCarry === 'boolean') setCarry(s.transcribeCarry)
      if (typeof s.transcribeVad === 'boolean') setVad(s.transcribeVad)
      if (Array.isArray(s.transcribeFormats) && s.transcribeFormats.length) setFormats(s.transcribeFormats)
      if (s.defaultTranscriptFolder) setOutputFolder(s.defaultTranscriptFolder)
    })
  }, [refreshEngine])

  // the sidebar selection feeds the source, but a picked audio file can override it
  useEffect(() => { if (selectedFile) setSource(selectedFile) }, [selectedFile])

  useEffect(() => {
    setProbe(null); setProbeError('')
    setDone(null); setError(''); setNotice(''); setProgress(null)
    setCompletedSteps([]); setActiveStepLabel('')
    setNeedsManualBytes(false); setManualBytes(''); setChecksum('')
    if (!source) return
    window.api.ffmpegProbe(source).then(setProbe).catch((e) => setProbeError(cleanError(e)))
  }, [source])

  useEffect(() => {
    const offs = [
      window.api.onWhisperPhase((p) => setPhases((prev) => ({ ...prev, [p.phase]: p }))),
      window.api.onWhisperLog((line) => setLogLine(line)),
      window.api.onTranscribeStep((data) => {
        const { step, state, fromCache, detail } = data
        if (state === 'active') {
          setActiveStepLabel(STEP_LABELS[step]?.active || step)
        } else if (state === 'done') {
          const labelFn = STEP_LABELS[step]?.done
          const label = typeof labelFn === 'function' ? labelFn(fromCache, detail) : (labelFn || step)
          setCompletedSteps((prev) => [...prev, { label }])
          setActiveStepLabel('')
          if (step === 'decoding') setProgress(null)
        }
      }),
      window.api.onTranscribeProgress((p) => setProgress(p))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const modelInfo = engine?.models?.find((m) => m.id === model)
  const modelInstalled = Boolean(modelInfo?.installed)
  const isAax = Boolean(source && source.toLowerCase().endsWith('.aax'))
  const duration = probe?.format?.duration ? parseFloat(probe.format.duration) : 0
  const chapterCount = probe?.chapters?.length || 0

  const installEngine = async () => {
    setInstalling(true); setSetupError(''); setPhases({}); setLogLine('')
    try {
      await window.api.whisperSetup({ model })
    } catch (e) {
      const msg = cleanError(e)
      if (!msg.includes('Cancelled')) setSetupError(msg)
    }
    setInstalling(false); setLogLine('')
    refreshEngine()
  }

  const pickAudio = async () => {
    const file = await window.api.filesPickAudio()
    if (file) setSource(file)
  }

  const pickOutput = async () => {
    const dir = await window.api.filesPickOutput()
    if (dir) { setOutputFolder(dir); save('defaultTranscriptFolder', dir) }
  }

  const toggleFormat = (id) => {
    const next = formats.includes(id) ? formats.filter((f) => f !== id) : [...formats, id]
    if (next.length === 0) return
    setFormats(next); save('transcribeFormats', next)
  }

  const resetRun = () => {
    setDone(null); setError(''); setNotice(''); setProgress(null)
    setCompletedSteps([]); setActiveStepLabel('')
    setNeedsManualBytes(false); setManualBytes(''); setChecksum('')
  }

  const start = useCallback(async (manualActivationBytes) => {
    if (!source) return
    setRunning(true); setError(''); setNotice(''); setDone(null); setProgress(null)
    setCompletedSteps([]); setActiveStepLabel(''); setNeedsManualBytes(false)
    try {
      const result = await window.api.transcribeStart({
        inputPath: source, model, language, computeType: compute, glossary,
        carryContext: carry, vad, formats,
        outputFolder: outputFolder || undefined,
        manualActivationBytes: manualActivationBytes || undefined
      })
      setDone(result)
    } catch (err) {
      const msg = cleanError(err)
      if (msg.includes('Cancelled')) {
        setNotice('Cancelled. Finished sections are saved, so starting again resumes where it stopped.')
      } else if (msg.includes('rainbow tables')) {
        setError(msg); setNeedsManualBytes(true)
        window.api.activationChecksum(source).then(setChecksum).catch(() => {})
      } else {
        setError(msg)
      }
    }
    setRunning(false); setActiveStepLabel(''); setProgress(null)
  }, [source, model, language, compute, glossary, carry, vad, formats, outputFolder])

  const submitManualBytes = () => {
    if (!/^[0-9a-fA-F]{8}$/.test(manualBytes)) {
      setError('Activation bytes must be exactly 8 hex characters (e.g. 1a2b3c4d)')
      return
    }
    start(manualBytes)
  }

  const canStart = Boolean(source && engine?.ready && modelInstalled && !running && !installing)

  return (
    <div style={{ padding: 16, maxWidth: 680 }}>

      {/* The Voice */}
      <div className="ex-panel" style={{ marginTop: 6 }}>
        <div className="panel-label">The Voice</div>
        {source ? (
          <div className="selected-file-display">
            <span style={{ fontSize: 26, flexShrink: 0 }}>{isAax ? '📕' : '🎧'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ex-gold)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={source}>
                {source.split('/').pop()}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ex-muted)' }}>
                {probe && (
                  <>
                    {formatDuration(duration)}
                    {chapterCount > 0 && <> &nbsp;·&nbsp; {chapterCount} chapters</>}
                    {chapterCount === 0 && <> &nbsp;·&nbsp; no chapters (split at quiet moments)</>}
                  </>
                )}
                {probeError && <span style={{ color: 'var(--ex-gold)' }}>{probeError}</span>}
                {!probe && !probeError && <span>Probing…</span>}
              </div>
            </div>
            <button className="smol-btn" onClick={pickAudio} disabled={running}>change</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 11, color: 'var(--ex-muted)', fontStyle: 'italic', flex: 1 }}>
              Select a .aax file from the sidebar, or pick any audio file
            </p>
            <button className="smol-btn" onClick={pickAudio}>choose audio</button>
          </div>
        )}
      </div>

      {/* The Medium (engine) */}
      <div className="ex-panel">
        <div className="panel-label">The Medium</div>

        {engine === null && !setupError && (
          <p style={{ fontSize: 11, color: 'var(--ex-muted)' }}>Checking the speech engine…</p>
        )}

        {engine && !engine.ready && !installing && (
          <>
            <div className="tog-row">
              <span>Python 3.9+</span>
              {engine.systemPython
                ? <span style={{ color: 'var(--ex-green2)' }}>✓ {engine.systemPython}</span>
                : <span style={{ color: 'var(--ex-gold)' }}>not found</span>}
            </div>
            <div className="tog-row">
              <span>faster-whisper</span>
              <span style={{ color: 'var(--ex-gold)' }}>not installed</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--ex-muted)', margin: '8px 0', lineHeight: 1.5 }}>
              One-time setup. It creates a private Python environment inside the app's data folder and
              downloads the speech model ({modelInfo?.size || 'about 3 GB'} for {model}). Nothing is
              installed system-wide, and transcription runs entirely on this computer.
            </p>
            <button className="smol-btn" onClick={installEngine} disabled={!engine.systemPython}>
              Install transcription engine
            </button>
          </>
        )}

        {installing && (
          <>
            {SETUP_PHASES.map(([id, label]) => {
              const p = phases[id]
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0',
                  color: p?.state === 'done' ? 'var(--ex-green2)' : p?.state === 'active' ? 'var(--ex-text)' : 'var(--ex-muted)' }}>
                  {p?.state === 'done' ? <span>✓</span> : p?.state === 'active' ? <Spinner /> : <span>·</span>}
                  <span>{label}{p?.detail && p.state === 'done' ? ` (${p.detail})` : ''}</span>
                </div>
              )
            })}
            {logLine && <div className="log-line" title={logLine}>{logLine}</div>}
            <button className="smol-btn" style={{ marginTop: 10 }} onClick={() => window.api.transcribeCancel()}>
              Cancel
            </button>
          </>
        )}

        {engine?.ready && !installing && (
          <>
            <div className="tog-row">
              <span>faster-whisper</span>
              <span style={{ color: 'var(--ex-green2)' }}>✓ {engine.fasterWhisper}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="field-label">Speech model</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className="ex-select"
                  value={model}
                  disabled={running}
                  onChange={(e) => { setModel(e.target.value); save('transcribeModel', e.target.value) }}
                >
                  {engine.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} {m.installed ? '(installed)' : `(${m.size} download)`}
                    </option>
                  ))}
                </select>
                {!modelInstalled && (
                  <button className="smol-btn" onClick={installEngine} style={{ flexShrink: 0 }}>
                    Download
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {setupError && <div className="error-card">{setupError}</div>}
      </div>

      {/* Options */}
      {!running && !done && (
        <div className="ex-panel">
          <div className="panel-label">The Ritual</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="field-label">Language</div>
              <select className="ex-select" value={language}
                onChange={(e) => { setLanguage(e.target.value); save('transcribeLanguage', e.target.value) }}>
                {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Precision</div>
              <select className="ex-select" value={compute}
                onChange={(e) => { setCompute(e.target.value); save('transcribeCompute', e.target.value) }}>
                {ACCURACY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="field-label">Names and terms (optional)</div>
            <textarea
              className="ex-textarea"
              value={glossary}
              placeholder="Unusual names or jargon the narrator says, separated by commas. Keep it short."
              onChange={(e) => setGlossary(e.target.value)}
              onBlur={() => save('transcribeGlossary', glossary)}
              rows={2}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="check-row">
              <input type="checkbox" checked={vad}
                onChange={(e) => { setVad(e.target.checked); save('transcribeVad', e.target.checked) }} />
              <span>Skip silence and music (voice activity detection)</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={carry}
                onChange={(e) => { setCarry(e.target.checked); save('transcribeCarry', e.target.checked) }} />
              <span>Carry context between sentences (nicer punctuation, but one mistake can repeat)</span>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="field-label">Save as</div>
            <div className="format-grid">
              {OUTPUTS.map(([id, label]) => (
                <button key={id} className={`format-chip${formats.includes(id) ? ' selected' : ''}`}
                  onClick={() => toggleFormat(id)} title={label}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="field-label">Output Sanctuary</div>
            <div className="output-row">
              <div className="output-path" title={outputFolder}>
                {outputFolder || 'input_folder/transcripts/'}
              </div>
              <button className="smol-btn" onClick={pickOutput}>change</button>
              {outputFolder && (
                <button className="smol-btn" onClick={() => { setOutputFolder(''); save('defaultTranscriptFolder', '') }}>
                  reset
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {running && (
        <div className="ex-panel">
          <div className="panel-label">The Séance</div>
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
          {progress && (
            <div style={{ marginTop: 6 }}>
              <div className="ex-progress-bg">
                <div className="ex-progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ex-muted)', marginTop: 4, fontStyle: 'italic' }}>
                <span>
                  {progress.phase === 'decode'
                    ? 'Decoding audio…'
                    : <>
                        {progress.chapters > 1 ? `Chapter ${progress.chapter} of ${progress.chapters}` : 'Listening'}
                        {progress.rate ? ` · ${progress.rate.toFixed(1)}x realtime` : ''}
                        {progress.eta != null ? ` · about ${formatEta(progress.eta)} left` : ''}
                      </>}
                </span>
                <span>{progress.pct}%</span>
              </div>
              {progress.phase === 'transcribe' && progress.heard && (
                <div className="heard-line">“{progress.heard}”</div>
              )}
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
              <div style={{ fontSize: 12, color: 'var(--ex-green2)' }}>Transcript written</div>
              <div style={{ fontSize: 10, color: 'var(--ex-muted)', marginTop: 2 }}>
                {done.stats.words.toLocaleString()} words · {formatDuration(done.stats.durationSec)} of audio
                {done.stats.elapsedSec != null && <> · took {formatDuration(done.stats.elapsedSec)}</>}
                {' '}· {done.stats.model}
              </div>
            </div>
          </div>
          {done.outputs.map((o) => (
            <div key={o.path} className="out-file">
              <span className="log-line" style={{ margin: 0, flex: 1 }} title={o.path}>{o.filename}</span>
              <button className="smol-btn" onClick={() => window.api.shellOpenFile(o.path)}>Open</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="smol-btn" onClick={() => window.api.shellOpenFolder(done.outputs[0].path)}>
              Open folder
            </button>
            <button className="smol-btn" onClick={resetRun}>Transcribe another</button>
          </div>
        </div>
      )}

      {error && <div className="error-card">{error}</div>}
      {notice && <div className="liberated-card" style={{ fontSize: 11, color: 'var(--ex-text)' }}>{notice}</div>}

      {/* Manual activation bytes (same fallback as the Exorcise tab) */}
      {needsManualBytes && !running && (
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
            <button className="smol-btn" onClick={submitManualBytes}>Inscribe &amp; Transcribe</button>
          </div>
        </div>
      )}

      {/* Go */}
      {!done && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <button className="exorcise-btn" onClick={() => start()} disabled={!canStart}>
            ✝ &nbsp; Transcribe &nbsp; ✝
          </button>
          {running && (
            <button className="smol-btn" onClick={() => window.api.transcribeCancel()}>Cancel</button>
          )}
        </div>
      )}
      {!done && engine?.ready && !modelInstalled && (
        <p style={{ fontSize: 10, color: 'var(--ex-gold)', marginTop: 8 }}>
          Download the {model} model above to enable transcription.
        </p>
      )}

      <div className="ex-verse">"Speak, and be written."</div>
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
