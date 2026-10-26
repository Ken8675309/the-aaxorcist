import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clock, safeBaseName, tidy, groupParagraphs, renderMarkdown, renderTimestamps,
  renderSrt, buildOutputs, countWords, FORMATS
} from '../src/main/transcript-format.js'

const result = {
  model: 'tiny.en',
  language: 'en',
  duration: 100,
  chapters: [
    { index: 0, title: 'One', start: 0, end: 50, segments: [
      { start: 0, end: 4, text: ' Hello there.' },
      { start: 4.5, end: 8, text: 'Second line.' }
    ] },
    { index: 1, title: 'Two', start: 50, end: 100, segments: [
      { start: 51, end: 55, text: 'Squats, three sets.' }
    ] }
  ]
}

test('clock formats hours, minutes, seconds', () => {
  assert.equal(clock(0), '00:00:00')
  assert.equal(clock(3725), '01:02:05')
})

test('safeBaseName strips path separators but keeps the name', () => {
  const n = safeBaseName('a/b:c*d.aax')
  assert.ok(!/[\\/:*?"<>|]/.test(n))
  assert.ok(n.length > 0)
})

test('tidy collapses whitespace', () => {
  assert.equal(tidy('  a   b \n c '), 'a b c')
})

test('groupParagraphs splits on long pauses', () => {
  const paras = groupParagraphs([
    { start: 0, end: 2, text: 'A.' },
    { start: 2.2, end: 4, text: 'B.' },
    { start: 20, end: 22, text: 'C.' }
  ])
  assert.equal(paras.length, 2)
})

test('markdown has a heading per chapter and no empty text', () => {
  const md = renderMarkdown(result, { title: 'Book', source: 'book.m4b' })
  assert.match(md, /^# Book/)
  assert.match(md, /## One/)
  assert.match(md, /## Two/)
  assert.match(md, /Squats, three sets\./)
})

test('timestamps and srt render every segment', () => {
  const ts = renderTimestamps(result, { title: 'Book' })
  assert.match(ts, /\[00:00:51\] Squats/)
  const srt = renderSrt(result)
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,000\nHello there\./)
  assert.equal(srt.trim().split(/\n\n/).length, 3)
})

test('buildOutputs honours requested formats and file names', () => {
  const outs = buildOutputs(result, { baseName: 'Book', title: 'Book', source: 'b.m4b', formats: ['md', 'json'] })
  assert.deepEqual(outs.map((o) => o.kind).sort(), ['json', 'md'])
  assert.ok(outs.every((o) => o.filename.startsWith('Book.')))
  assert.equal(FORMATS.srt.ext, "transcript.srt")
  JSON.parse(outs.find((o) => o.kind === 'json').content)
})

test('countWords', () => {
  assert.equal(countWords(result), 7)
})
