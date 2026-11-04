import type { On, PromptAutocompleteInput, PromptAutocompleteResult, PromptEditInput, PromptEditResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const LIST = ['#10', 'the', 'cat', 'sat', 'on', 'mat', 'world', 'hello', '#50', 'than', 'then'].join('\n')

/** The engine beneath the mod: its list on disk, a store, toasts and the editor's own splice. */
function engine(on: On, store = new Map<string, unknown>(), toasts: string[] = []) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.read', () => ({ value: LIST }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(String(e.text ?? e)), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
    decorations: [{ start: 0, end: 1, bold: true }],
  }))
  on('prompt.autocomplete', () => ({ suggestions: [{ text: 'engine' }] }))

  return { store, toasts }
}

// prompt.edit and prompt.autocomplete are raised on the test's `$` as the composer raises them.
type Prompt = {
  edit: (e: PromptEditInput) => Promise<PromptEditResult>
  autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
}
const promptOf = ($: unknown) => ($ as { prompt: Prompt }).prompt
const composer = { kind: 'composer' } as const
const typed = (text: string, inputText: string, at = text.length) => ({ origin: composer, text, cursor: at, start: at, end: at, inputText })
const run = (args: string) => ({ command: 'sloppy', args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 120 } })
const start = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('a finished misspelled word is underlined in burnt orange, the others decorations kept', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const r = await promptOf($).edit(typed('the wrold', ' '))
  expect(r.text).toBe('the wrold ')
  expect(r.decorations).toEqual([
    { start: 0, end: 1, bold: true },
    { start: 4, end: 9, underline: true, color: '#b8642a' },
  ])
})

test('the word being typed is not underlined yet', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const r = await promptOf($).edit(typed('the wrol', 'd'))
  expect(r.decorations).toEqual([{ start: 0, end: 1, bold: true }])
})

test('offsets count UTF-16 code units after emoji and accents', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const text = '🙂 naïve café hte'
  const r = await promptOf($).edit(typed(text, '.'))
  const marks = (r.decorations ?? []).filter(d => d.underline)
  expect(marks.map(d => r.text.slice(d.start, d.end))).toEqual(['naïve', 'café', 'hte'])
})

test('the colour option paints the underline', { options: { color: 'red' } }, async ($, on) => {
  engine(on)
  await $.session.start(start)
  const r = await promptOf($).edit(typed('wrold', ' '))
  expect(r.decorations?.[1]).toEqual({ start: 0, end: 5, underline: true, color: 'red' })
})

test('shift+right and shift+left jump to the end of the next and previous misspelled word', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const text = 'wrold the cat hte mat'
  const move = (cursor: number, key: 'left' | 'right') => ({ origin: composer, key: { key, shift: true as const }, text, cursor, start: cursor, end: cursor, inputText: '' })
  expect((await promptOf($).edit(move(0, 'right'))).cursor).toBe(5)
  expect((await promptOf($).edit(move(5, 'right'))).cursor).toBe(17)
  expect((await promptOf($).edit(move(21, 'left'))).cursor).toBe(17)
  // nothing further that way: the plain move the editor made
  expect((await promptOf($).edit({ ...move(17, 'right'), start: 18, end: 18 })).cursor).toBe(18)
})

test('the typeahead offers corrections for the misspelled word at the caret, after the engine rows', async ($, on) => {
  engine(on)
  await $.session.start(start)
  await promptOf($).edit({ origin: composer, key: { key: 'left' }, text: 'the wrold, cat', cursor: 11, start: 10, end: 10, inputText: '' })
  const r = await promptOf($).autocomplete({ text: 'the wrold, cat', cursor: 10, token: 'wrold,', start: 4 })
  expect(r.suggestions).toEqual([{ text: 'engine' }, { text: 'world,', label: 'world', description: 'for wrold' }])
  const none = await promptOf($).autocomplete({ text: 'the wrold, cat', cursor: 14, token: 'cat', start: 11 })
  expect(none.suggestions).toEqual([{ text: 'engine' }])
})

test('/sloppy add accepts a word across sessions and answers with a toast, no transcript text', async ($, on) => {
  const { store, toasts } = engine(on)
  await $.session.start(start)
  const r = await $.command.run(run('add Wrold'))
  expect(r.text).toBeUndefined()
  expect(store.get('words')).toEqual(['wrold'])
  expect(toasts.at(-1)).toBe('sloppy: added wrold')
  const e = await promptOf($).edit(typed('wrold', ' '))
  expect((e.decorations ?? []).filter(d => d.underline)).toEqual([])
  await $.command.run(run('remove wrold'))
  expect(store.get('words')).toEqual([])
})

test('/sloppy off stops the underlines and is kept; on brings them back', async ($, on) => {
  const { store, toasts } = engine(on)
  await $.session.start(start)
  await $.command.run(run('off'))
  expect(store.get('isOn')).toBe(false)
  expect((await promptOf($).edit(typed('wrold', ' '))).decorations).toEqual([{ start: 0, end: 1, bold: true }])
  await $.command.run(run('on'))
  expect((await promptOf($).edit(typed('wrold', ' '))).decorations?.length).toBe(2)
  await $.command.run(run(''))
  expect(toasts.at(-1)).toBe('sloppy: on, 9 words, 0 of yours')
})

test('personal words stored by an earlier session are read at start', async ($, on) => {
  engine(on, new Map<string, unknown>([['words', ['wrold']]]))
  await $.session.start(start)
  expect((await promptOf($).edit(typed('wrold', ' '))).decorations?.length).toBe(1)
})

test('the enabled option off leaves the box alone', { options: { enabled: false } }, async ($, on) => {
  const { toasts } = engine(on)
  await $.session.start(start)
  expect((await promptOf($).edit(typed('wrold', ' '))).decorations?.length).toBe(1)
  await $.command.run(run('on'))
  expect(toasts.at(-1)).toBe('sloppy: turned off in its settings (enabled)')
})
