# sloppy: design

A Claude Code mod that spellchecks the prompt box as you type. Status: decisions taken 4 Nov 2026, first build starting.

## How it works inside

1. **Dictionary load, once per session.** On `session.start` the mod reads a plain word list shipped in
   its own folder into an in-memory `Set`, plus a frequency rank per word. The list is generated from
   SCOWL (the lists hunspell's English dictionaries are built from; permissive license). A hunspell
   `.dic` is not a word list (entries carry affix flags), and expanding those inside the mod is a lot
   of code for no gain.

2. **Check on every keystroke.** A `prompt.edit` hook calls `next(e)`, takes the new draft, splits it
   into words, looks each up in the set (with a cache, so repeated words cost nothing) and returns each
   miss as an underline in `decorations`. It runs synchronously on every key: lookups only, no
   processes, no disk. It keeps the decorations other plugins returned.

3. **What it skips.**
   - the word still being typed: a word is judged once a space or punctuation follows it, or the
     cursor leaves it, so nothing flashes red mid-word
   - inline code and code fences
   - URLs and paths
   - @mentions and a leading /command
   - words with digits
   - ALLCAPS acronyms
   - camelCase and snake_case identifiers
   - paste placeholders

   Case is folded (a capital at a sentence start still matches); apostrophes are handled ("don't").

4. **Suggestions in the typeahead.** When the cursor is on a misspelled word, a `prompt.autocomplete`
   hook returns corrections as rows; taking one replaces the word. The suggester runs in the mod: every
   spelling one edit away, then two edits if none match, kept if in the set, ranked by frequency. A few
   thousand set lookups, under a millisecond. The cursor must be on the word, since the typeahead only
   asks about the token at the cursor.

5. **Personal words.** `/sloppy add <word>` and `/sloppy remove <word>` keep a list in `$.store`
   (across sessions). `/sloppy on` and `/sloppy off` toggle the mod.

6. **Never changes what is sent.** `prompt.submit` is left alone: no autocorrect.

**No external binary.** A mod runs where the session runs, often a machine with no spellchecker
installed. Shipping the word list makes it work anywhere with no install.

## API facts it relies on (Claude Code 2.1.302)

- `prompt.edit` fires per edit (key, burst or paste) with the draft before and the splice;
  `next(e)` resolves the box after it. The result takes `decorations`: `{ start, end, underline,
  color, ... }`, paint only, offsets in UTF-16 code units.
- `prompt.autocomplete` fires for the non-whitespace token ending at the cursor; rows join beneath
  the engine's own; taking one writes its `text` over the token.
- `$.process.run` takes `input` for stdin but there is no long-lived pipe, so a hunspell process per
  keystroke is out.
- Decorations draw on the terminal and desktop surfaces only.

## Decisions (4 Nov 2026)

- **Dictionary:** a mid-size SCOWL English list shipped in the repo (roughly 1 to 2 MB), no hunspell.
- **Languages:** English only for now. The word set is one file, so a second language later is a second file
  behind a `language` option, not a redesign.
- **Style:** underline in burnt orange `#b8642a` by default, a `color` option for another hex or `red`.
- **Timing:** a word is judged once it is finished (a space, punctuation, or the cursor leaving it).
- **Token efficient:** the mod never calls a model and adds nothing to the prompt, the transcript or the
  context: underlines are paint only, suggestions live in the typeahead and die there, the personal list is
  in `$.store`. Nothing it does costs a token.
- **Keyboard only:** he rarely touches the mouse. Everything is reachable from the keys: the typeahead rows
  take the engine's own arrow / tab / enter, and a way to jump the cursor to the next (and previous)
  misspelled word so the typeahead can offer its rows there. If a mod cannot move the cursor, the fallback
  is an immediate `/sloppy next` that reports the word and its position, and `/sloppy fix <n>` that takes
  the n-th suggestion for the word at (or after) the cursor; the first build finds out which is possible.

## To verify in the first build

- that `$.fs.read` accepts a 1 to 2 MB file
- that typeahead rows appear for a plain word with no leading character
