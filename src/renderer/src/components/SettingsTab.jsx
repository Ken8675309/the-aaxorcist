import { useState, useEffect, useCallback } from 'react'
import AddAccountModal from './AddAccountModal'

export default function SettingsTab({ accounts, activeAccount, onRefresh }) {
  const [tools, setTools] = useState({})
  const [settings, setSettings] = useState({})
  const [saved, setSaved] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [appInfo, setAppInfo] = useState(null)

  const refresh = useCallback(async () => {
    const [t, s, info] = await Promise.all([
      window.api.settingsDetectTools(),
      window.api.settingsGetAll(),
      window.api.getInfo()
    ])
    setTools(t)
    setSettings(s)
    setAppInfo(info)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const set = async (key, value) => {
    await window.api.settingsSet(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved((prev) => ({ ...prev, [key]: true }))
    setTimeout(() => setSaved((prev) => ({ ...prev, [key]: false })), 1500)
  }

  const switchTo = async (id) => {
    await window.api.accountsSwitch(id)
    onRefresh()
  }

  const signOut = async (id) => {
    if (!confirm('Remove this account?')) return
    await window.api.accountsRemove(id)
    onRefresh()
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold text-slate-200">Settings</h2>

      {/* Accounts */}
      <section>
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">Accounts</h3>
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden mb-2">
          {accounts.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No accounts connected.</p>
          ) : (
            accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${acc.is_active ? 'bg-green-400' : 'bg-slate-600'}`} />
                  <div>
                    <p className="text-sm text-slate-300">{acc.label}</p>
                    <p className="text-xs text-slate-500">{acc.email}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!acc.is_active && (
                    <button
                      onClick={() => switchTo(acc.id)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                    >
                      Switch
                    </button>
                  )}
                  <button
                    onClick={() => signOut(acc.id)}
                    className="text-xs px-2 py-1 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="text-sm text-brand-400 hover:text-brand-300 px-1"
        >
          + Add account…
        </button>
      </section>

      {/* Defaults */}
      <section>
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">Defaults</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Default Format</label>
            <select
              value={settings.defaultFormat || 'm4b'}
              onChange={(e) => set('defaultFormat', e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
            >
              {['m4b', 'mp3', 'm4a', 'flac', 'ogg', 'wav', 'opus', 'aac'].map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Default Quality</label>
            <select
              value={settings.defaultQuality || '128k'}
              onChange={(e) => set('defaultQuality', e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
            >
              <option value="copy">Copy / Lossless</option>
              <option value="128k">128 kbps</option>
              <option value="64k">64 kbps</option>
              <option value="32k">32 kbps</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-slate-400 mb-1">Default Output Folder</label>
          <PathInput
            value={settings.defaultOutputFolder || ''}
            onChange={(v) => set('defaultOutputFolder', v)}
            placeholder="Defaults to input_folder/converted/"
            onBrowse={async () => {
              const dir = await window.api.filesPickOutput()
              if (dir) set('defaultOutputFolder', dir)
            }}
            saved={saved.defaultOutputFolder}
          />
        </div>
      </section>

      {/* Tool paths */}
      <section>
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">Tool Paths</h3>
        <div className="space-y-3">
          <ToolPathRow
            label="ffmpeg"
            detected={tools.ffmpeg}
            value={settings.ffmpegPath || ''}
            onChange={(v) => set('ffmpegPath', v)}
            saved={saved.ffmpegPath}
          />
          <ToolPathRow
            label="audible-activator.py"
            detected={tools.activator}
            value={settings.activatorPath || ''}
            onChange={(v) => set('activatorPath', v)}
            saved={saved.activatorPath}
          />
          <ToolPathRow
            label="python3"
            detected={tools.python}
            value={settings.pythonPath || ''}
            onChange={(v) => set('pythonPath', v)}
            saved={saved.pythonPath}
          />
        </div>
        <button
          onClick={refresh}
          className="mt-2 text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800"
        >
          Re-detect tools
        </button>
      </section>

      {/* App info */}
      {appInfo && (
        <section>
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">About</h3>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm space-y-1">
            <Row label="Version" value={`v${appInfo.version}`} />
            <Row label="Platform" value={appInfo.platform} />
            <Row label="Data folder" value={appInfo.userData} mono />
          </div>
        </section>
      )}

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { onRefresh(); setShowAdd(false) }}
        />
      )}
    </div>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`text-slate-300 ${mono ? 'font-mono text-xs' : ''} truncate ml-4 max-w-[300px]`}>
        {value}
      </span>
    </div>
  )
}

function ToolPathRow({ label, detected, value, onChange, saved }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs text-slate-400">{label}</label>
        {detected ? (
          <span className="text-xs text-green-400">✓ {detected}</span>
        ) : (
          <span className="text-xs text-amber-400">Not detected</span>
        )}
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
        placeholder="Override path (optional)"
        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm font-mono text-slate-300 focus:outline-none focus:border-brand-500"
      />
    </div>
  )
}

function PathInput({ value, onChange, placeholder, onBrowse, saved }) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-brand-500"
      />
      <button onClick={onBrowse} className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-300">
        Browse
      </button>
      {saved && <span className="text-xs text-green-400 self-center">Saved</span>}
    </div>
  )
}
