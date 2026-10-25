// Pure formatting helpers for transcripts. No Electron or filesystem access,
// so they can be tested with plain Node.
//
// A "result" is what resources/transcribe/transcribe.py writes:
//   { model, language, duration, chapters: [{ index, title, start, end,
//     segments: [{ start, end, text }] }] }

export const FORMATS = {
  md: { ext: 'transcript.md', label: 'Readable (Markdown)' },
  txt: { ext: 'transcript.timestamps.txt', label: 'Timestamped text' },
  srt: { ext: 'transcript.srt', label: 'Subtitles (SRT)' },
  json: { ext: 'transcript.json', label: 'Raw data (JSON)' }
}

export function pad(n, w = 2) {
  return String(n).padStart(w, '0')
}

// 3725.5 -> "01:02:05" (or "01:02:05,500" / "01:02:05.500" with ms)
export function clock(sec, { ms = false, sep = '.' } = {}) {
  const total = Math.max(0, sec || 0)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`
  if (!ms) return base
  return `${base}${sep}${pad(Math.round((total - Math.floor(total)) * 1000), 3)}`
}

export function safeBaseName(name) {
  const cleaned = String(name || 'transcript')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
  return cleaned || 'transcript'
}

export function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

// Group segments into paragraphs: break on a long pause, or after a sentence
// end once the paragraph is long enough.
export function groupParagraphs(segments, { pauseSec = 2.0, softChars = 600, hardChars = 1100 } = {}) {
  const paragraphs = []
  let cur = null
  let prevEnd = null
  for (const seg of segments) {
    const text = tidy(seg.text)
    if (!text) continue
    const gap = prevEnd === null ? 0 : seg.start - prevEnd
    const endsSentence = cur && /[.!?]["')\]]*$/.test(cur.text)
    const breakHere =
      cur && (gap > pauseSec || (endsSentence && cur.text.length >= softChars) || cur.text.length >= hardChars)
    if (!cur || breakHere) {
      if (cur) paragraphs.push(cur)
      cur = { start: seg.start, end: seg.end, text }
    } else {
      cur.text += ' ' + text
      cur.end = seg.end
    }
    prevEnd = seg.end
  }
  if (cur) paragraphs.push(cur)
  return paragraphs
}

function hasChapterTitles(result) {
  return result.chapters.length > 1 || (result.chapters[0] && result.chapters[0].title)
}

function chapterHeading(ch) {
  const n = ch.index + 1
  return ch.title ? ch.title : `Chapter ${n}`
}

export function renderMarkdown(result, { title, source } = {}) {
  const lines = []
  lines.push(`# ${title || 'Transcript'}`, '')
  const meta = [`Duration ${clock(result.duration)}`, `Whisper ${result.model}`, `Language ${result.language}`]
  if (source) meta.unshift(`Source: ${source}`)
  lines.push(`*${meta.join(' · ')}*`, '')
  const withHeadings = hasChapterTitles(result)
  for (const ch of result.chapters) {
    const paras = groupParagraphs(ch.segments)
    if (withHeadings) {
      lines.push(`## ${chapterHeading(ch)}`, '', `*starts ${clock(ch.start)}*`, '')
    }
    if (paras.length === 0) {
      lines.push('*(no speech detected)*', '')
      continue
    }
    for (const p of paras) lines.push(p.text, '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function renderTimestamps(result, { title } = {}) {
  const lines = []
  if (title) lines.push(title, '='.repeat(Math.min(title.length, 72)), '')
  const withHeadings = hasChapterTitles(result)
  for (const ch of result.chapters) {
    if (withHeadings) lines.push(`--- ${chapterHeading(ch)} [${clock(ch.start)}] ---`)
    for (const seg of ch.segments) {
      const text = tidy(seg.text)
      if (text) lines.push(`[${clock(seg.start)}] ${text}`)
    }
    if (withHeadings) lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export function renderSrt(result) {
  const out = []
  let n = 1
  for (const ch of result.chapters) {
    for (const seg of ch.segments) {
      const text = tidy(seg.text)
      if (!text) continue
      const end = Math.max(seg.end, seg.start + 0.2)
      out.push(
        `${n++}\n${clock(seg.start, { ms: true, sep: ',' })} --> ${clock(end, { ms: true, sep: ',' })}\n${text}\n`
      )
    }
  }
  return out.join('\n')
}

// Returns [{ kind, filename, content }] for the requested formats.
export function buildOutputs(result, { baseName, title, source, formats }) {
  const base = safeBaseName(baseName)
  const wanted = (formats && formats.length ? formats : ['md', 'txt']).filter((f) => FORMATS[f])
  return wanted.map((kind) => {
    let content
    if (kind === 'md') content = renderMarkdown(result, { title: title || base, source })
    else if (kind === 'txt') content = renderTimestamps(result, { title: title || base })
    else if (kind === 'srt') content = renderSrt(result)
    else content = JSON.stringify(result, null, 2) + '\n'
    return { kind, filename: `${base}.${FORMATS[kind].ext}`, content }
  })
}

export function countWords(result) {
  let n = 0
  for (const ch of result.chapters) {
    for (const seg of ch.segments) n += tidy(seg.text).split(' ').filter(Boolean).length
  }
  return n
}
