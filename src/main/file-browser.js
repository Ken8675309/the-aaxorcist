import { readdirSync, statSync, existsSync } from 'fs'
import { readdir } from 'fs/promises'
import path from 'path'

// Folders that never hold audiobooks and can be enormous.
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'site-packages', 'snap'])
const MAX_DIRS = 20000

// Finds .aax files under rootDir. Runs in the background (async) so scanning a big
// folder never freezes the app, skips hidden and dependency folders, does not
// follow symlinks, and gives up after MAX_DIRS folders.
export async function buildFileTree(rootDir, { maxDepth = 6, maxDirs = MAX_DIRS } = {}) {
  if (!existsSync(rootDir)) return []
  const budget = { dirs: 0 }

  async function walk(dir, depth) {
    if (depth > maxDepth || budget.dirs >= maxDirs) return []
    budget.dirs += 1

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const nodes = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const isConverted = entry.name === 'converted'
        if (!isConverted && (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))) continue
        const children = await walk(fullPath, depth + 1)
        // include a folder if it has .aax descendants (or is the converted folder)
        if (children.length > 0 || isConverted) {
          nodes.push({ type: 'dir', name: entry.name, path: fullPath, isConverted, children })
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.aax')) {
        nodes.push({ type: 'file', name: entry.name, path: fullPath, ext: '.aax' })
      }
    }
    return nodes
  }

  return walk(rootDir, 0)
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
