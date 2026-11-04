// sloppy: spellchecks the prompt box as you type. Misspelled words get an underline (burnt orange by default),
// the typeahead offers corrections for the word at the caret, shift+right / shift+left jump the caret to the
// next / previous misspelled word. Nothing it does reaches the model: no model call, no transcript row.
//   /sloppy              say whether it is on, and how many words it knows
//   /sloppy on|off       turn it on or off (kept across sessions)
//   /sloppy add <word>   accept a word from now on; remove takes it back; list shows them
import type { Register } from 'claude-code'

import { type Dict, type Span, fold, jump, misses, parseDict, suggest } from './lib'

const DEFAULT_COLOR = '#b8642a'
/** Drafts past this length are left unchecked: a check walks the whole draft on every key. */
const MAX_TEXT = 100_000

/** Module state, built again on a reload: the list, the personal words and the verdicts. */
let dict: Dict | undefined
const mine = new Set<string>()
const cache = new Map<string, boolean>()
let isOn = true
let last: { text: string; spans: Span[] } = { text: '', spans: [] }

function colorOf(value: unknown): string {
  return typeof value === 'string' && /^(#[0-9a-fA-F]{6}|[a-zA-Z]+)$/.test(value.trim()) ? value.trim() : DEFAULT_COLOR
}

function check(text: string, typing?: number): Span[] {
  if (!dict || text.length > MAX_TEXT) return []
  const spans = misses(text, dict, mine, cache, typing)
  last = { text, spans }

  return spans
}

export const register: Register = (on, options) => {
  const color = colorOf(options.color)
  const enabled = options.enabled !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sloppy',
      description: 'Spellcheck the prompt: /sloppy on|off, add|remove <word>, list',
      argumentHint: '[on|off|add <word>|remove <word>|list]',
      immediate: true,
    })
    const words = await $.store.get('words')
    mine.clear()
    if (Array.isArray(words)) for (const w of words) if (typeof w === 'string') mine.add(w)
    isOn = enabled && (await $.store.get('isOn')) !== false
    if (!dict) {
      try {
        dict = parseDict(await $.fs.read(`${$.plugin.root}/data/en.txt`))
      } catch (err) {
        $.ui.toast(`sloppy: could not read its word list (${String(err)})`)
      }
    }

    return next(e)
  })

  on('command.run', { command: 'sloppy' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const say = (text: string) => ($.ui.toast(text), {})
    const save = async () => {
      cache.clear()
      await $.store.set('words', [...mine].sort())
    }
    switch (verb) {
      case '':
        return say(`${isOn ? 'on' : 'off'}, ${dict?.size ?? 0} words, ${mine.size} of yours`)
      case 'on':
      case 'off':
        if (verb === 'on' && !enabled) return say('turned off in its settings (enabled)')
        isOn = verb === 'on'
        await $.store.set('isOn', isOn)
        return say(isOn ? 'on' : 'off')
      case 'add':
      case 'remove': {
        const ws = rest.map(fold)
        if (ws.length === 0) return say(`${verb} which word?`)
        for (const w of ws) verb === 'add' ? mine.add(w) : mine.delete(w)
        await save()
        return say(`${verb === 'add' ? 'added' : 'removed'} ${ws.join(', ')}`)
      }
      case 'list':
        return say(mine.size ? [...mine].sort().join(', ') : 'no words of yours yet')
      default:
        return say('on, off, add <word>, remove <word>, list')
    }
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (!isOn || !dict) return r
    const isMove = e.inputText === '' && e.end === e.start
    const spans = check(r.text, isMove ? undefined : r.cursor)
    let cursor = r.cursor
    // shift+right / shift+left: the caret to the end of the next / previous misspelled word, else the plain move
    if (isMove && e.key?.shift && !e.key.ctrl && !e.key.meta && (e.key.key === 'right' || e.key.key === 'left')) {
      const to = jump(spans, e.cursor, e.key.key === 'right' ? 1 : -1)
      if (to !== undefined) cursor = to
    }
    const ours = spans.map(s => ({ start: s.start, end: s.end, underline: true, color }))

    return { ...r, cursor, decorations: [...(r.decorations ?? []), ...ours] }
  })

  on('prompt.autocomplete', async ($, e, next) => {
    const r = await next(e)
    if (!isOn || !dict) return r
    const spans = last.text === e.text ? last.spans : check(e.text)
    // the misspelled word that ends the token, punctuation after it allowed: "teh," offers "the,"
    const s = spans.find(x => x.start >= e.start && x.end <= e.cursor && /^[^\p{L}\p{N}]*$/u.test(e.text.slice(x.end, e.cursor)))
    if (!s) return r
    const head = e.text.slice(e.start, s.start)
    const tail = e.text.slice(s.end, e.cursor)
    const rows = suggest(s.word, dict, mine).map(fix => ({ text: head + fix + tail, label: fix, description: `for ${s.word}` }))

    return { suggestions: [...r.suggestions, ...rows] }
  })
}
