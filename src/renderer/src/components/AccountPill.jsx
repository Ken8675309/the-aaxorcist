import { useState, useRef, useEffect } from 'react'
import AddAccountModal from './AddAccountModal'

export default function AccountPill({ accounts, activeAccount, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const switchTo = async (id) => {
    await window.api.accountsSwitch(id)
    onRefresh()
    setOpen(false)
  }

  const signOut = async (e, id) => {
    e.stopPropagation()
    await window.api.accountsRemove(id)
    onRefresh()
  }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-slate-300 max-w-[140px] truncate">
            {activeAccount ? activeAccount.label : 'No account'}
          </span>
          <ChevronIcon />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                onClick={() => switchTo(acc.id)}
                className="flex items-center justify-between px-3 py-2 hover:bg-slate-700 cursor-pointer group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {acc.is_active ? (
                    <span className="text-brand-500 shrink-0">✓</span>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="text-sm text-slate-300 truncate">{acc.label}</span>
                </div>
                <button
                  onClick={(e) => signOut(e, acc.id)}
                  className="text-xs text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                >
                  Sign out
                </button>
              </div>
            ))}
            {accounts.length > 0 && <div className="border-t border-slate-700 my-1" />}
            <button
              onClick={() => { setShowAdd(true); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-brand-400 hover:bg-slate-700 hover:text-brand-300"
            >
              + Add account…
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { onRefresh(); setShowAdd(false) }}
        />
      )}
    </>
  )
}

function ChevronIcon() {
  return (
    <svg className="w-3 h-3 text-slate-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4l4 4 4-4" />
    </svg>
  )
}
