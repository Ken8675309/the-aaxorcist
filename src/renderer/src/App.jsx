import { useState, useEffect, useCallback } from 'react'
import FileBrowser from './components/FileBrowser'
import ConvertTab from './components/ConvertTab'
import KeysTab from './components/KeysTab'
import HistoryTab from './components/HistoryTab'
import SettingsTab from './components/SettingsTab'
import AccountPill from './components/AccountPill'
import FfmpegBanner from './components/FfmpegBanner'

const TABS = [
  { id: 'convert', label: 'Convert' },
  { id: 'keys', label: 'Keys' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
]

if (!window.api) {
  document.body.innerHTML =
    '<div style="color:#f87171;font-family:monospace;padding:2rem">window.api not found — preload script failed to load. Check Electron preload path.</div>'
  throw new Error('window.api is undefined — preload bridge missing')
}

export default function App() {
  const [tab, setTab] = useState('convert')
  const [selectedFile, setSelectedFile] = useState(null)
  const [ffmpegOk, setFfmpegOk] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)

  const refreshAccounts = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.api.accountsList(),
      window.api.accountsActive()
    ])
    setAccounts(list)
    setActiveAccount(active)
  }, [])

  useEffect(() => {
    window.api.ffmpegDetect().then((r) => setFfmpegOk(r.found))
    refreshAccounts()
  }, [refreshAccounts])

  return (
    <div className="flex flex-col h-screen">
      {/* Title bar */}
      <header className="drag-region flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 no-drag">
          <span className="text-brand-500 font-bold text-sm tracking-wide">AAX</span>
          <span className="text-slate-400 text-sm">Converter</span>
        </div>
        <nav className="flex gap-1 no-drag">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="no-drag">
          <AccountPill
            accounts={accounts}
            activeAccount={activeAccount}
            onRefresh={refreshAccounts}
          />
        </div>
      </header>

      {ffmpegOk === false && (
        <FfmpegBanner onInstalled={() => setFfmpegOk(true)} />
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <FileBrowser selectedFile={selectedFile} onSelect={setSelectedFile} />
        <main className="flex-1 overflow-auto">
          {tab === 'convert' && (
            <ConvertTab
              selectedFile={selectedFile}
              activeAccount={activeAccount}
              accounts={accounts}
            />
          )}
          {tab === 'keys' && <KeysTab accounts={accounts} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'settings' && (
            <SettingsTab accounts={accounts} activeAccount={activeAccount} onRefresh={refreshAccounts} />
          )}
        </main>
      </div>
    </div>
  )
}
