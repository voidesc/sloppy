#!/usr/bin/env python3
"""Build sloppy's English word list from SCOWL.

Usage: python3 -I scripts/build_dict.py <scowl final/ directory> <out file> [max size]

Reads SCOWL's final/ lists (english, american, british and british_z; words, upper,
proper names, contractions, abbreviations) up to the given size (default 70), lower-cases
every entry, drops possessives ("dog's": the mod strips a trailing 's itself) and writes one
word per line, grouped by the smallest SCOWL size the word appears in. A line "#<size>"
opens each group, so a smaller number means a more common word. Input files are Latin-1.
"""
import os
import re
import sys

SIZES = (10, 20, 35, 40, 50, 55, 60, 70, 80, 95)
SPELLINGS = ('english', 'american', 'british', 'british_z')
KINDS = ('words', 'upper', 'proper-names', 'contractions', 'abbreviations')
# letters (accented ones too), inner apostrophes, hyphens and dots; nothing else
WORD = re.compile(r"^[^\W\d_](?:[^\W\d_]|['.\-])*$")


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    src, out = argv[1], argv[2]
    top = int(argv[3]) if len(argv) > 3 else 70
    level = {}
    for size in (s for s in SIZES if s <= top):
        for spelling in SPELLINGS:
            for kind in KINDS:
                path = os.path.join(src, f'{spelling}-{kind}.{size}')
                if not os.path.isfile(path):
                    continue
                with open(path, encoding='latin-1') as f:
                    for line in f:
                        w = line.strip().lower()
                        if not w or w.endswith("'s") or not WORD.match(w):
                            continue
                        w = w.rstrip('.')
                        if w and w not in level:
                            level[w] = size
    lines = [
        '# sloppy English word list, generated from SCOWL by scripts/build_dict.py',
        f'# sizes up to {top}; "#N" opens the words first found at SCOWL size N (smaller = more common)',
    ]
    for size in SIZES:
        words = sorted(w for w, s in level.items() if s == size)
        if words:
            lines.append(f'#{size}')
            lines.extend(words)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'{len(level)} words, {os.path.getsize(out)} bytes -> {out}')


if __name__ == '__main__':
    main(sys.argv)
