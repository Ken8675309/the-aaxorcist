import { useState, useEffect, useCallback } from 'react'

export default function HistoryTab() {
  const [history, setHistory] = useState([])

  const refresh = useCallback(async () => {
    setHistory(await window.api.historyList())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-200">Conversion History</h2>
        <button onClick={refresh} className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800">
          Refresh
        </button>
      </div>

      {history.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">No conversions yet.</div>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Format</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-4 py-2 max-w-[240px]">
                    <p className="text-slate-300 truncate" title={h.input_path}>{h.filename}</p>
                    {h.output_path && (
                      <p className="text-xs text-slate-600 truncate" title={h.output_path}>{h.output_path}</p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 uppercase">
                      {h.format}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{h.account_email || '—'}</td>
                  <td className="px-4 py-2">
                    {h.status === 'success' ? (
                      <span className="text-xs text-green-400">✓ Success</span>
                    ) : (
                      <span className="text-xs text-red-400" title={h.error}>✗ Error</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">
                    {h.created_at ? new Date(h.created_at).toLocaleString() : '—'}
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
