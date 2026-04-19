import { readdirSync, statSync, existsSync } from 'fs'
import path from 'path'

export function buildFileTree(rootDir, { depth = 0, maxDepth = 8 } = {}) {
  if (!existsSync(rootDir) || depth > maxDepth) return []

  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes = []
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      // always recurse to find .aax files inside; include dir if it has .aax descendants
      const children = buildFileTree(fullPath, { depth: depth + 1, maxDepth })
      if (children.length > 0 || entry.name === 'converted') {
        nodes.push({
          type: 'dir',
          name: entry.name,
          path: fullPath,
          isConverted: entry.name === 'converted',
          children
        })
      }
    } else if (entry.isFile() && entry.name.endsWith('.aax')) {
      nodes.push({
        type: 'file',
        name: entry.name,
        path: fullPath,
        ext: '.aax'
      })
    }
  }
  return nodes
}

export function getConvertedFiles(dir) {
  const convertedDir = path.join(dir, 'converted')
  if (!existsSync(convertedDir)) return []
  try {
    return readdirSync(convertedDir).map((f) => path.join(convertedDir, f))
  } catch {
    return []
  }
}

export function fileInfo(filePath) {
  if (!existsSync(filePath)) return null
  const stat = statSync(filePath)
  return { size: stat.size, mtime: stat.mtimeMs }
}
