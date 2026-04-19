import { useState, useEffect, useCallback } from 'react'

export default function KeysTab({ accounts }) {
  const [keys, setKeys] = useState([])
  const [copied, setCopied] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newAccountId, setNewAccountId] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    setKeys(await window.api.keysList())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const copy = (key, id) => {
    navigator.clipboard.writeText(key)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const del = async (id) => {
    await window.api.keysDelete(id)
    refresh()
  }

  const add = async (e) => {
    e.preventDefault()
    if (!/^[0-9a-fA-F]{8}$/.test(newKey)) {
      alert('Activation key must be exactly 8 hex characters (e.g. a1b2c3d4)')
      return
    }
    setAdding(true)
    try {
      await window.api.keysAdd({
        hexKey: newKey,
        label: newLabel || newKey,
        accountId: newAccountId ? parseInt(newAccountId) : null
      })
      setNewKey('')
      setNewLabel('')
      setNewAccountId('')
      setShowAdd(false)
      refresh()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-200">Activation Keys</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm"
        >
          + Add key
        </button>
      </div>

      {showAdd && (
        <form onSubmit={add} className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Hex Key (8 chars)</label>
            <input
              type="text"
              required
              maxLength={8}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="a1b2c3d4"
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm font-mono w-32 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="My key"
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Account</label>
            <select
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-brand-500"
            >
              <option value="">None</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 text-sm"
          >
            Cancel
          </button>
        </form>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">
          <p>No activation keys stored yet.</p>
          <p className="mt-1">Keys are auto-extracted after the first conversion.</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">Label / Book</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-brand-300">{k.hex_key}</code>
                      <button
                        onClick={() => copy(k.hex_key, k.id)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                        title="Copy"
                      >
                        {copied === k.id ? '✓' : '⎘'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-300 truncate max-w-[200px]" title={k.label}>
                    {k.label || k.book_title || '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{k.account_email || '—'}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">
                    {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => del(k.id)}
                      className="text-xs text-slate-600 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
