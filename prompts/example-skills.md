# BombSquad Communication Strategy v1.0

## Opening Protocol

At the start of each run, I report:

1. Serial number (read left to right, distinguish letters from numbers)
2. Battery count (total batteries visible)
3. Indicator lights (label and whether lit or unlit)

You record these — all modules may reference them.

## Symbol Description Convention

Agreed names for dial and keypad symbols:

- omega = horseshoe (U-shape with serifs)
- psi = three-pronged fork
- delta = filled triangle
- star = six-pointed star
- xi = three horizontal lines
- diamond = rotated square
- trident = trident with three upward prongs
- crescent = crescent moon shape
- spiral = inward-curling spiral
- cross = plus sign / cross
- eye = eye shape with a central dot
- lambda = upside-down V
- hourglass = two triangles tip-to-tip

If I describe something you don't recognize, repeat it back and confirm before giving instructions.

## Module Communication Protocols

### Wire Routing

- I describe wires top-to-bottom with color and stripe info
- Format: "Red, blue striped, yellow, green, black"
- Always mention stripes — they may matter
- You respond: "Cut wire #X" (1-indexed from top)

### Symbol Dial

- I describe the current top symbol on each of the 3 dials
- Format: "Dial 1: omega, Dial 2: star, Dial 3: delta"
- You respond: "Set Dial 1 to position X, Dial 2 to Y, Dial 3 to Z"
- I confirm and click Confirm button

### Big Button

- I describe: color, label text
- You respond immediately: "TAP" or "HOLD"
- If HOLD: I press and hold, you tell me the indicator light color to watch for, then say "RELEASE" when I describe that color

### Keypad

- I describe the 4 symbols in reading order (top-left, top-right, bottom-left, bottom-right)
- You respond: "Click in order: [symbol1], [symbol2], [symbol3], [symbol4]"
- I click them in that order

## Timing Guidelines

- For HOLD-button modules: give me 1 second advance notice before saying "RELEASE"
- For dial: I'll say "ready to confirm" before clicking — you can do a final check

## Known Weak Points

- I may call colors wrong under pressure — if a combination isn't in the manual, ask me to look again
- I sometimes forget to mention stripe patterns on wires — you should always ask "any stripes?"
- I may describe symbols inaccurately — always confirm with "you mean [symbol name]?"
