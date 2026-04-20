import { useState, useEffect, useCallback } from 'react'

export default function KeysTab() {
  const [keys, setKeys] = useState([])
  const [copied, setCopied] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newChecksum, setNewChecksum] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    setKeys(await window.api.keysList())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const copy = (text, id) => {
    navigator.clipboard.writeText(text)
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
      alert('Activation bytes must be exactly 8 hex characters (e.g. a1b2c3d4)')
      return
    }
    setAdding(true)
    try {
      await window.api.keysAdd({
        hexKey: newKey.toLowerCase(),
        checksum: newChecksum.toLowerCase() || undefined,
        bookTitle: newTitle || undefined,
        filePath: undefined
      })
      setNewKey('')
      setNewChecksum('')
      setNewTitle('')
      setShowAdd(false)
      refresh()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">Activation Keys</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Keys are auto-extracted on first conversion and cached here.
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm"
        >
          + Add manually
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={add}
          className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Activation Bytes <span className="text-slate-600">(8 hex chars)</span>
            </label>
            <input
              type="text"
              required
              maxLength={8}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="1a2b3c4d"
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm font-mono w-32 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Checksum <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={newChecksum}
              onChange={(e) => setNewChecksum(e.target.value)}
              placeholder="40-char hex"
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm font-mono w-52 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Book title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Optional"
              className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-brand-500"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {adding ? 'Saving…' : 'Save'}
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
          <p className="mt-1">Convert a .aax file and the key will appear here automatically.</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2">Activation Bytes</th>
                <th className="px-4 py-2">Checksum</th>
                <th className="px-4 py-2">Book</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-brand-300">{k.activation_bytes}</code>
                      <button
                        onClick={() => copy(k.activation_bytes, k.id)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                        title="Copy"
                      >
                        {copied === k.id ? '✓' : '⎘'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {k.checksum ? (
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-xs text-slate-500 truncate max-w-[120px]" title={k.checksum}>
                          {k.checksum}
                        </code>
                        <button
                          onClick={() => copy(k.checksum, `cs-${k.id}`)}
                          className="text-xs text-slate-600 hover:text-slate-400"
                          title="Copy checksum"
                        >
                          {copied === `cs-${k.id}` ? '✓' : '⎘'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-300 truncate max-w-[180px]" title={k.book_title}>
                    {k.book_title || k.label || '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">
                    {k.date_added ? new Date(k.date_added).toLocaleDateString() : '—'}
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
