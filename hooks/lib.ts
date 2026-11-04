// sloppy's pure parts: the word list, the splitter with its skip rules, the lookup and the suggester.
// No engine calls here, so the tests reach every rule directly.

/** The word list as loaded: every word, lower-cased, to its SCOWL size (smaller = more common). */
export type Dict = Map<string, number>

/** A word the splitter hands over: `[start, end)` in UTF-16 code units of the draft. */
export type Span = { start: number; end: number; word: string }

/** Reads the shipped list: one word per line, "#N" opens the words of SCOWL size N, "# " is a comment. */
export function parseDict(text: string): Dict {
  const dict: Dict = new Map()
  let size = 100
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (line.charCodeAt(0) === 35 /* # */) {
      const n = Number(line.slice(1))
      if (Number.isInteger(n) && n > 0) size = n
      continue
    }
    if (!dict.has(line)) dict.set(line, size)
  }

  return dict
}

/** Ranges of the draft that are not prose: code fences, inline code, paste placeholders, a leading /command. */
export function maskedRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  // a fence runs from a line opening with ``` or ~~~ to the line closing it, or to the end while open
  let open: { at: number; mark: string } | undefined
  let at = 0
  for (const line of text.split('\n')) {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line)
    if (open && m && m[1][0] === open.mark[0] && m[1].length >= open.mark.length) {
      out.push([open.at, at + line.length])
      open = undefined
    } else if (!open && m) open = { at, mark: m[1] }
    at += line.length + 1
  }
  if (open) out.push([open.at, text.length])
  // inline code: a backtick run to the same run on the same line, or to the line's end while open
  for (const m of text.matchAll(/(`+)[^`\n]*(?:\1|$|(?=\n))/g)) out.push([m.index, m.index + m[0].length])
  // what the box shows for a paste or an image: [Pasted text #1 +20 lines], [Image #2]
  for (const m of text.matchAll(/\[(?:Pasted text|Image|File|Pasted)[^\]\n]*\]/g)) out.push([m.index, m.index + m[0].length])
  // a leading /command (its name, not its arguments)
  const cmd = /^\s*\/\S+/.exec(text)
  if (cmd) out.push([0, cmd[0].length])

  return out
}

const TOKEN = /\S+/g
// a run of letters, digits, underscores and apostrophes: what the identifier rules look at
const RUN = /[\p{L}\p{M}\p{N}_'’]+/gu
const HAS_DIGIT = /\p{N}/u
const HAS_LOWER = /\p{Ll}/u
const CAMEL = /\p{Ll}\p{Lu}|\p{Lu}{2}\p{Ll}/u
const LETTER = /\p{L}/u

/** A whole whitespace-separated token that is a URL, a path, a file name, an e-mail or a @mention. */
function skipToken(tok: string): boolean {
  if (tok.includes('://') || /^www\./i.test(tok)) return true
  if (/^[@~$%{]/.test(tok)) return true
  if (/[/\\|<>=]/.test(tok)) return true
  if (/[\p{L}\p{N}]@[\p{L}\p{N}]/u.test(tok)) return true
  // an inner dot between letters or digits: lib.ts, example.com, e.g.
  if (/[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(tok)) return true

  return false
}

/**
 * Splits the draft into the words to check, leaving out everything the design skips: code, URLs and paths,
 * mentions, a leading /command, paste placeholders, words with digits, ALLCAPS, camelCase and snake_case,
 * single letters. Hyphenated words come out as their parts. Offsets are UTF-16 code units.
 */
export function words(text: string): Span[] {
  const masked = maskedRanges(text)
  const inMask = (a: number, b: number) => masked.some(([s, e]) => a < e && b > s)
  const out: Span[] = []
  for (const t of text.matchAll(TOKEN)) {
    const tok = t[0]
    const at = t.index
    if (inMask(at, at + tok.length) || skipToken(tok)) continue
    for (const r of tok.matchAll(RUN)) {
      let run = r[0]
      let start = at + r.index
      if (HAS_DIGIT.test(run) || run.includes('_') || CAMEL.test(run)) continue
      // quotes around a word are not part of it: 'word' or ‘word’
      const lead = /^['’]+/.exec(run)?.[0].length ?? 0
      run = run.slice(lead)
      start += lead
      run = run.replace(/['’]+$/, '')
      if (run.length < 2 || !LETTER.test(run)) continue
      if (!HAS_LOWER.test(run)) continue
      if (inMask(start, start + run.length)) continue
      out.push({ start, end: start + run.length, word: run })
    }
  }

  return out
}

/** The form a word is looked up in: lower case, typographic apostrophes as plain ones. */
export function fold(word: string): string {
  return word.toLowerCase().replace(/’/g, "'")
}

/** Whether a folded word is spelled right: in the list or the personal words, possessives and plurals' apostrophes allowed. */
export function known(w: string, dict: Dict, mine: ReadonlySet<string>): boolean {
  if (dict.has(w) || mine.has(w)) return true
  if (w.endsWith("'s") && w.length > 2) return known(w.slice(0, -2), dict, mine)
  if (w.endsWith("'")) return known(w.slice(0, -1), dict, mine)

  return false
}

/**
 * The words the draft gets wrong, with a cache of verdicts (cleared by the caller when the personal words
 * change). `typing` is where the caret stands while a word is being typed: the word holding it is left out.
 */
export function misses(text: string, dict: Dict, mine: ReadonlySet<string>, cache: Map<string, boolean>, typing?: number): Span[] {
  const out: Span[] = []
  for (const s of words(text)) {
    if (typing !== undefined && s.start <= typing && typing <= s.end) continue
    const w = fold(s.word)
    let ok = cache.get(w)
    if (ok === undefined) {
      ok = known(w, dict, mine)
      if (cache.size > 5000) cache.clear()
      cache.set(w, ok)
    }
    if (!ok) out.push(s)
  }

  return out
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz'"

/**
 * Every string one edit away (a letter deleted, two neighbours swapped, one replaced, one inserted), each with
 * how unlikely the slip is: a swap 0, the others 1, one more when the first letter changed.
 */
export function edits1(w: string): Map<string, number> {
  const out = new Map<string, number>()
  const add = (x: string, cost: number) => {
    if (x === w) return
    const c = cost + (x[0] === w[0] ? 0 : 1)
    const was = out.get(x)
    if (was === undefined || c < was) out.set(x, c)
  }
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i)
    const b = w.slice(i)
    if (b.length > 1) add(a + b[1] + b[0] + b.slice(2), 0)
    if (b) add(a + b.slice(1), 1)
    for (const c of ALPHABET) {
      if (b) add(a + c + b.slice(1), 1)
      add(a + c + b, 1)
    }
  }

  return out
}

/** Writes a suggestion in the case the person typed: Capitalised stays Capitalised. */
export function inCase(typed: string, fix: string): string {
  const first = typed[0]
  if (first && first !== first.toLowerCase() && typed.slice(1) === typed.slice(1).toLowerCase()) return fix[0].toUpperCase() + fix.slice(1)

  return fix
}

/**
 * Corrections for a word: everything one edit away that the list or the personal words hold, else two edits
 * away; ranked by how likely the slip is (a swap first, the first letter kept), then by how common the word
 * is (SCOWL size), then alphabetically; at most `limit`.
 */
export function suggest(typed: string, dict: Dict, mine: ReadonlySet<string>, limit = 5): string[] {
  const w = fold(typed)
  const rank = (x: string) => dict.get(x) ?? (mine.has(x) ? 50 : 1000)
  const has = (x: string) => dict.has(x) || mine.has(x)
  const one = edits1(w)
  let found = new Map([...one].filter(([x]) => has(x)))
  if (found.size === 0 && w.length <= 10) {
    for (const [e, c1] of one) {
      for (const [f, c2] of edits1(e)) {
        if (f === w || !has(f)) continue
        const was = found.get(f)
        if (was === undefined || c1 + c2 < was) found.set(f, c1 + c2)
      }
    }
  }
  const order = ([a, ca]: [string, number], [b, cb]: [string, number]) => ca - cb || rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)

  return [...found].sort(order).slice(0, limit).map(([f]) => inCase(typed, f))
}

/** The next misspelled word after the caret (`dir` 1) or the one before it (`dir` -1): where to stand the caret, its end. */
export function jump(spans: readonly Span[], cursor: number, dir: 1 | -1): number | undefined {
  if (dir === 1) return spans.find(s => s.end > cursor)?.end

  return [...spans].reverse().find(s => s.end < cursor)?.end
}
