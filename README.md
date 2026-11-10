# Four Bars

A Wordle-style ear-training game for chord progressions.

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

## Running it

It's a static page with no build step or dependencies. Open `index.html` in a browser, or serve the
folder:

```sh
npm start            # python3 -m http.server 8000, then open http://localhost:8000
```

Sound is synthesised with the Web Audio API, so browsers only start it after you press a button.

## Tests

The game rules (chord spelling, random progressions, Wordle scoring, keypad colours, voicing) live in
`js/logic.js`, which has no DOM or audio code, and are tested with Node's built-in test runner
(Node 18+):

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
| `js/game.js`    | Board, keypad, input, round flow and stats                     |
| `test/`         | Unit tests for `js/logic.js`                                   |

## Settings

At the top of `js/game.js`:

- `KEY`: the major key the chords come from (`'C'`). Any major key works, e.g. `'G'`, `'Eb'`, `'F#'`;
  chord names are spelled for that key. The help text in `index.html` lists the C major chords, so
  update it if you change the key.
- `ALLOW_BACK_TO_BACK`: set to `true` to let the same chord play in two bars in a row.
- `CHORD_SECONDS`: how long each chord lasts on playback (`1.3`).

Win/loss stats are saved in the browser's `localStorage`.
