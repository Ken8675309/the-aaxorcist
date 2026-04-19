import { useState, useEffect, useCallback } from 'react'

function FileNode({ node, selectedFile, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2)

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className="flex items-center gap-1 px-2 py-0.5 hover:bg-slate-700/50 cursor-pointer text-sm"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="text-slate-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
          <span className={`${node.isConverted ? 'text-green-400' : 'text-slate-400'} truncate`}>
            {node.name}
          </span>
        </div>
        {expanded && node.children.map((child, i) => (
          <FileNode key={i} node={child} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} />
        ))}
      </div>
    )
  }

  const isSelected = selectedFile === node.path
  return (
    <div
      className={`flex items-center gap-2 px-2 py-0.5 cursor-pointer text-sm truncate ${
        isSelected ? 'bg-brand-600/30 text-brand-300' : 'hover:bg-slate-700/50 text-slate-300'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onSelect(node.path)}
      title={node.path}
    >
      <span className="text-slate-500 shrink-0">🔒</span>
      <span className="truncate">{node.name}</span>
    </div>
  )
}

export default function FileBrowser({ selectedFile, onSelect }) {
  const [rootDir, setRootDir] = useState('')
  const [tree, setTree] = useState([])

  const refresh = useCallback(async (dir) => {
    if (!dir) return
    const t = await window.api.filesTree(dir)
    setTree(t)
  }, [])

  useEffect(() => {
    refresh(rootDir)
  }, [rootDir, refresh])

  const pickFolder = async () => {
    const dir = await window.api.filesPickFolder()
    if (dir) { setRootDir(dir); refresh(dir) }
  }

  const pickFile = async () => {
    const file = await window.api.filesPickFile()
    if (file) onSelect(file)
  }

  return (
    <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <div className="px-2 py-2 border-b border-slate-800 flex flex-col gap-1">
        <button
          onClick={pickFolder}
          className="w-full text-left text-xs px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 truncate"
          title={rootDir || 'Choose folder'}
        >
          {rootDir ? `📁 ${rootDir.split('/').pop() || rootDir}` : '📁 Choose folder…'}
        </button>
        <button
          onClick={pickFile}
          className="w-full text-left text-xs px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
        >
          Browse for .aax file…
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && rootDir && (
          <p className="text-xs text-slate-600 px-3 py-4 text-center">No .aax files found</p>
        )}
        {tree.length === 0 && !rootDir && (
          <p className="text-xs text-slate-600 px-3 py-4 text-center">Select a folder to browse files</p>
        )}
        {tree.map((node, i) => (
          <FileNode key={i} node={node} selectedFile={selectedFile} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}
