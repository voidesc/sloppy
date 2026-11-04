import { expect, test } from 'claude-code/testing'

import { inCase, jump, misses, parseDict, suggest, words } from '../hooks/lib'

const DICT = parseDict(['# test list', '#10', 'the', 'cat', 'sat', 'on', 'mat', 'a', "don't", 'well', 'known', 'hello', 'world', '#50', 'than', 'then', 'thee', 'cafe', 'café', '#70', 'teh'].join('\n'))
const NONE = new Set<string>()
const list = (text: string) => words(text).map(s => s.word)
const bad = (text: string, typing?: number) => misses(text, DICT, NONE, new Map(), typing).map(s => s.word)

test('the list keeps each word at the smallest size it appears', () => {
  expect(DICT.get('the')).toBe(10)
  expect(DICT.get('than')).toBe(50)
  expect(DICT.has('# test list')).toBe(false)
})

test('plain words and hyphenated parts are split out with their offsets', () => {
  expect(words('the cat, well-known.')).toEqual([
    { start: 0, end: 3, word: 'the' },
    { start: 4, end: 7, word: 'cat' },
    { start: 9, end: 13, word: 'well' },
    { start: 14, end: 19, word: 'known' },
  ])
})

test('code, URLs, paths, mentions, a leading command and paste placeholders are skipped', () => {
  expect(list('/review teh `wrold here` cat')).toEqual(['teh', 'cat'])
  expect(list('see https://exmaple.com/a and ~/wrk/x and lib/foo.ts and @alekesy')).toEqual(['see', 'and', 'and', 'and'])
  expect(list('look\n```\nfnuction x\n```\nafter')).toEqual(['look', 'after'])
  expect(list('open\n```js\nstill typing cdoe')).toEqual(['open'])
  expect(list('[Pasted text #1 +20 lines] and [Image #2] now')).toEqual(['and', 'now'])
  expect(list('mail me at bob@exmple.org or read e.g. README.md')).toEqual(['mail', 'me', 'at', 'or', 'read'])
})

test('digits, ALLCAPS, camelCase, PascalCase acronyms and snake_case are not words', () => {
  expect(list('h264 NASA getUser HTTPServer user_id 3rd ok')).toEqual(['ok'])
})

test("apostrophes: don't is a word, possessives and quotes fold away", () => {
  expect(list("don't 'cat' ‘mat’")).toEqual(["don't", 'cat', 'mat'])
  expect(bad("don’t the cat's toys' hello")).toEqual(['toys'])
})

test('case folds: a capital at a sentence start still matches', () => {
  expect(bad('The Cat sat. Teh mat')).toEqual([])
  expect(bad('Hte cat')).toEqual(['Hte'])
})

test('the word holding the caret while typing is not judged yet', () => {
  expect(bad('cat wrold', 9)).toEqual([])
  expect(bad('cat wrold ', 10)).toEqual(['wrold'])
  expect(bad('wrold cat', 2)).toEqual([])
})

test('offsets are UTF-16 code units, emoji and accents before the word included', () => {
  const text = '🙂 café wrold'
  const [s] = misses(text, DICT, NONE, new Map())
  expect(s.word).toBe('wrold')
  expect(text.slice(s.start, s.end)).toBe('wrold')
  expect(s.start).toBe(8)
})

test('personal words are accepted', () => {
  expect(misses('wrold', DICT, new Set(['wrold']), new Map())).toEqual([])
})

test('suggestions: one edit first, ranked by how common, at most five', () => {
  expect(suggest('teh', DICT, NONE)).toEqual(['the'])
  expect(suggest('wrold', DICT, NONE)).toEqual(['world'])
  expect(suggest('thn', DICT, NONE)).toEqual(['the', 'than', 'then'])
  expect(suggest('xyzzyq', DICT, NONE)).toEqual([])
  expect(suggest('Wrold', DICT, NONE)).toEqual(['World'])
  expect(suggest('helo', DICT, NONE)[0]).toBe('hello')
  expect(suggest('hllo', DICT, NONE)[0]).toBe('hello')
})

test('suggestions fall back to two edits', () => {
  expect(suggest('hlelo', DICT, NONE)).toContain('hello')
  expect(suggest('wrodl', DICT, NONE)).toContain('world')
})

test('the case of a capitalised word carries over', () => {
  expect(inCase('Teh', 'the')).toBe('The')
  expect(inCase('teh', 'the')).toBe('the')
})

test('jump finds the next and the previous misspelled word', () => {
  const spans = misses('wrold the cat hte mat', DICT, NONE, new Map())
  expect(spans.map(s => s.end)).toEqual([5, 17])
  expect(jump(spans, 0, 1)).toBe(5)
  expect(jump(spans, 5, 1)).toBe(17)
  expect(jump(spans, 17, 1)).toBeUndefined()
  expect(jump(spans, 21, -1)).toBe(17)
  expect(jump(spans, 17, -1)).toBe(5)
  expect(jump(spans, 5, -1)).toBeUndefined()
})
