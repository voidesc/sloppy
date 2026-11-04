# sloppy

A Claude Code mod that spellchecks the prompt box as you type.

- A misspelled word gets an underline (burnt orange by default) once you have finished it: a space or
  punctuation after it, or the caret moved away. Nothing flashes mid-word.
- With the caret at the end of a misspelled word, the typeahead lists up to five corrections. Tab takes the
  first, the arrow keys pick another.
- **shift+right** / **shift+left** move the caret to the end of the next / previous misspelled word, so the
  corrections come up there. With no misspelled word that way they move one character as usual.
- Skipped: inline code and code fences, URLs, paths and file names, e-mail addresses, @mentions, a leading
  `/command`, paste placeholders, words with digits, ALLCAPS, camelCase and snake_case. Case is folded and
  apostrophes are handled (`don't`, `cat's`).
- It never changes what you send and never calls a model: the underlines and the typeahead rows are paint
  only, the commands answer with a toast, so nothing reaches the transcript or the context.

English only for now (US and British spellings both accepted).

## Install

Clone the repository and load the folder:

```sh
claude --plugin-dir /path/to/sloppy
# or, for every session
export CLAUDE_CODE_PLUGIN_DIRS=/path/to/sloppy
```

Needs a Claude Code build with function-hook mods (2.1.318 tested).

## Commands

| Command | What it does |
| --- | --- |
| `/sloppy` | says whether it is on and how many words it knows |
| `/sloppy on`, `/sloppy off` | turns it on or off, kept across sessions |
| `/sloppy add <word>...` | accepts the words from now on, kept across sessions |
| `/sloppy remove <word>...` | takes them back |
| `/sloppy list` | shows your words |

## Options

Set in `/config` (or `pluginConfigs` in settings):

- `color`: the underline colour, `#rrggbb` or a colour name such as `red`; default `#b8642a`
- `enabled`: `false` turns the mod off whatever `/sloppy on` says; default `true`

## The dictionary

`data/en.txt` is generated from [SCOWL](http://wordlist.aspell.net/) 2020.12.07 (Spell Checker Oriented Word
Lists, by Kevin Atkinson): the english, american, british and british_z lists (words, upper-case words,
proper names, contractions, abbreviations) up to size 70, lower-cased, possessives dropped, about 132,000
words in 1.3 MB. Words are grouped by the smallest SCOWL size they appear in, which ranks the corrections
(smaller is more common). SCOWL's copyright and permission notice is in `data/SCOWL-LICENSE.txt`.

To rebuild it, unpack a SCOWL release and run:

```sh
python3 -I scripts/build_dict.py <scowl>/final data/en.txt 70
```

## Development

```sh
claude plugin validate .
claude plugin test .
```

## License

MIT for the code (`LICENSE`); the word list under SCOWL's own terms (`data/SCOWL-LICENSE.txt`).
