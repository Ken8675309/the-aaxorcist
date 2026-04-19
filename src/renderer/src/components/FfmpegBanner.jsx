import { useState } from 'react'

export default function FfmpegBanner({ onInstalled }) {
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')

  const install = async () => {
    setInstalling(true)
    setError('')
    try {
      await window.api.ffmpegInstall()
      onInstalled()
    } catch (err) {
      setError(err.message)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span className="text-amber-400">⚠</span>
        <span className="text-amber-200">
          ffmpeg not found.{' '}
          {process.platform === 'linux'
            ? 'Install it automatically or run: sudo apt/dnf install ffmpeg'
            : 'Download ffmpeg and set the path in Settings.'}
        </span>
        {error && <span className="text-red-400 ml-2">{error}</span>}
      </div>
      {process.platform === 'linux' && (
        <button
          onClick={install}
          disabled={installing}
          className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs disabled:opacity-50 shrink-0 ml-4"
        >
          {installing ? 'Installing…' : 'Install ffmpeg'}
        </button>
      )}
    </div>
  )
}
