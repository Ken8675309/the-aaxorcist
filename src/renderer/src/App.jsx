import { useState, useEffect, useRef } from 'react'
import FileBrowser from './components/FileBrowser'
import ConvertTab from './components/ConvertTab'
import TranscribeTab from './components/TranscribeTab'
import KeysTab from './components/KeysTab'
import HistoryTab from './components/HistoryTab'
import SettingsTab from './components/SettingsTab'
import FfmpegBanner from './components/FfmpegBanner'

const TABS = [
  { id: 'convert', label: 'Exorcise' },
  { id: 'transcribe', label: 'Séance' },
  { id: 'keys', label: 'Sacred Keys' },
  { id: 'history', label: 'Book of the Dead' },
  { id: 'settings', label: 'Relics' }
]

if (!window.api) {
  document.body.innerHTML =
    '<div style="color:#cc0000;font-family:monospace;padding:2rem">window.api not found — preload script failed to load.</div>'
  throw new Error('window.api is undefined — preload bridge missing')
}

export default function App() {
  const [tab, setTab] = useState('convert')
  const [selectedFile, setSelectedFile] = useState(null)
  const [ffmpegOk, setFfmpegOk] = useState(null)
  const [accountLabel, setAccountLabel] = useState('Soul Bound')
  const [purgedPct, setPurgedPct] = useState(0)
  const fly1Ref = useRef(null)
  const fly2Ref = useRef(null)

  useEffect(() => {
    window.api.ffmpegDetect().then((r) => setFfmpegOk(r.found))

    Promise.all([window.api.keysList(), window.api.historyList()]).then(([keys, hist]) => {
      const exorcised = hist.filter((h) => h.status === 'success').length
      const total = hist.length
      if (total > 0) setPurgedPct(Math.round((exorcised / total) * 100))
      if (keys.length > 0) setAccountLabel(`${keys.length} key${keys.length > 1 ? 's' : ''} stored`)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const flies = [fly1Ref.current, fly2Ref.current]
    flies.forEach((fly) => { if (fly) fly.style.opacity = '0' })

    function moveFly(fly) {
      fly.style.left = Math.random() * (window.innerWidth - 30) + 'px'
      fly.style.top = Math.random() * (window.innerHeight - 30) + 'px'
      fly.style.transform = `rotate(${Math.random() * 360}deg) scale(${0.8 + Math.random() * 0.6})`
    }

    function flyRoutine(fly, delay) {
      if (!fly) return
      setTimeout(function loop() {
        moveFly(fly)
        fly.style.opacity = '1'
        let crawls = 0
        const crawlInterval = setInterval(() => {
          fly.style.left = (parseFloat(fly.style.left) + (Math.random() - 0.5) * 8) + 'px'
          fly.style.top = (parseFloat(fly.style.top) + (Math.random() - 0.5) * 8) + 'px'
          fly.style.transform = `rotate(${Math.random() * 360}deg)`
          crawls++
          if (crawls > 6) {
            clearInterval(crawlInterval)
            fly.style.opacity = '0.5'
            setTimeout(() => { fly.style.opacity = '0.2' }, 100)
            setTimeout(() => { fly.style.opacity = '0.8' }, 180)
            setTimeout(() => { fly.style.opacity = '0' }, 300)
            setTimeout(loop, 4000 + Math.random() * 8000)
          }
        }, 200)
      }, delay)
    }

    flyRoutine(flies[0], 2000)
    flyRoutine(flies[1], 5000)
  }, [])

  return (
    <>
      <div className="wall" />
      <div className="grain" />
      <div className="fly" ref={fly1Ref}>🪰</div>
      <div className="fly" ref={fly2Ref}>🪰</div>

      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <header className="ex-topbar drag-region">
          <div className="no-drag">
            <div className="logo-main">👻 The AAXorcist</div>
            <div className="logo-sub">✝ &nbsp; DRM Exorcism &nbsp; ✝ &nbsp; Audible Liberation System</div>
          </div>

          <nav style={{ display: 'flex', gap: '2px' }} className="no-drag">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`ex-tab${tab === t.id ? ' active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="no-drag" style={{ textAlign: 'right' }}>
            <div className="account-pill">
              <div className="dot-g" />
              {accountLabel}
            </div>
            <div className="possession-meter">
              <span>DRM PURGED</span>
              <div className="meter-bar">
                <div className="meter-fill" style={{ width: `${purgedPct || 35}%` }} />
              </div>
              <span>{purgedPct || 35}%</span>
            </div>
          </div>
        </header>

        {ffmpegOk === false && <FfmpegBanner onInstalled={() => setFfmpegOk(true)} />}

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <FileBrowser selectedFile={selectedFile} onSelect={setSelectedFile} />
          <main style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 12 }}>
            {tab === 'convert' && <ConvertTab selectedFile={selectedFile} />}
            {tab === 'transcribe' && <TranscribeTab selectedFile={selectedFile} />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'history' && <HistoryTab />}
            {tab === 'settings' && <SettingsTab />}
          </main>
        </div>
      </div>
    </>
  )
}
