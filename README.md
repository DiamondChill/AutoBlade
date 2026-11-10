# Four Bars

A Wordle-style ear-training game for chord progressions, with two modes:

- **Name the chords**: hear four chords in C major and name them by Roman numeral.
- **Name the key**: hear four chords in a random major key and name the key.

Switch modes with the buttons under the title. Each mode keeps its own round in progress and its own
stats.

## Name the chords

Each round, a random four-chord progression plays in C major. Every chord comes from the first six
degrees of the scale:

| Key | Numeral | Chord | Notes |
| --- | ------- | ----- | ----- |
| 1   | I       | C     | C E G |
| 2   | ii      | Dm    | D F A |
| 3   | iii     | Em    | E G B |
| 4   | IV      | F     | F A C |
| 5   | V       | G     | G B D |
| 6   | vi      | Am    | A C E |

Enter a numeral for each of the four bars and submit. You get four guesses per round. After each guess
the bars are marked with the usual Wordle rules:

- **Green**: right chord in the right bar.
- **Yellow**: the chord is in the progression, but in a different bar.
- **Gray**: the chord isn't in the progression, or you used it more times than it appears.

Repeated chords are scored like repeated letters in Wordle: exact matches count first, and each chord in
the answer can only turn one wrong-bar guess yellow.

The same chord never plays in two bars in a row (a repeated chord is hard to hear as two bars), but it
can return later in the progression, e.g. `I V I IV`.

You can replay the progression as often as you like, play the I chord to hear the key, and replay any
past guess to compare it with the answer.

### Keyboard

| Key           | Action                 |
| ------------- | ---------------------- |
| `1`–`6`       | Enter a chord          |
| `Backspace`   | Delete the last chord  |
| `Enter`       | Submit / next round    |
| `Space`       | Play or stop           |
| `T`           | Play the I chord       |

## Name the key

Each round, a random progression from the same six chords (I ii iii IV V vi) plays in one of the 12
major keys. The first chord is always the I chord, so the key is clear. Pick the key on the one-octave
piano and submit; you get four guesses:

- **Green**: the right key.
- **Yellow**: wrong key, but that note is in the real key's major scale (e.g. guessing G when the key is
  C major, since G is in C major).
- **Gray**: wrong key, and that note isn't in the real key's scale (e.g. F♯ when the key is C major).

Notes are compared by sound, so F♯ and G♭ count as the same note. Four guesses is always enough with
careful deduction alone (checked by brute force), so a good ear just gets you there sooner.

**Hear a C** plays a reference pitch, so you can name the key by relative pitch. The play button beside
a past guess plays the progression in the key you guessed, so you can compare it with the real one.
When the round ends, the answer shows the four chords and their notes in that key.

### Keyboard

| Key           | Action                                       |
| ------------- | -------------------------------------------- |
| `A`–`G`       | Pick that key                                |
| `←` / `→`     | Move the key down / up a semitone (E then ← is E♭) |
| `Backspace`   | Clear the key                                |
| `Enter`       | Submit / next round                          |
| `Space`       | Play or stop                                 |
| `R`           | Play the reference C                         |

## Running it

It's a static page with no build step or dependencies. Open `index.html` in a browser, or serve the
folder:

```sh
npm start            # python3 -m http.server 8000, then open http://localhost:8000
```

Sound is synthesised with the Web Audio API, so browsers only start it after you press a button.

## Tests

The game rules (chord spelling, random progressions and keys, both scoring rules, keypad colours,
voicing) live in `js/logic.js`, which has no DOM or audio code, and are tested with Node's built-in
test runner (Node 18+):

```sh
npm test
```

## Layout

| File            | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `index.html`    | Page markup                                                    |
| `style.css`     | Styles, light and dark themes                                  |
| `js/logic.js`   | Pure game rules (works in the browser and in Node)             |
| `js/audio.js`   | Web Audio synth that plays the chords                          |
| `js/game.js`    | Board, keypads, input, round flow, modes and stats             |
| `test/`         | Unit tests for `js/logic.js`                                   |

## Settings

At the top of `js/game.js`:

- `CHORDS_MODE_KEY`: the major key used by Name the chords (`'C'`). Any major key works, e.g. `'G'`,
  `'Eb'`, `'F#'`; chord names are spelled for that key. The help text in `index.html` lists the C major
  chords, so update it if you change the key.
- `ALLOW_BACK_TO_BACK`: set to `true` to let the same chord play in two bars in a row.
- `KEY_MODE_STARTS_ON_I`: set to `false` to let Name the key progressions start on any chord. Some
  progressions then fit two keys (I V vi iii in C is IV I ii vi in G), so the key can be ambiguous.
- `CHORD_SECONDS`: how long each chord lasts on playback (`1.3`).

Win/loss stats (per mode) and the last mode you played are saved in the browser's `localStorage`.
