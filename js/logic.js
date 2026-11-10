/*
 * Four Bars: game rules with no DOM or audio, so they can be unit-tested in Node.
 * Loaded in the browser as window.FourBarsLogic; in Node via require().
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FourBarsLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SLOTS = 4;        // chords per progression
  const MAX_GUESSES = 4;  // guesses per round
  const POOL_SIZE = 6;    // I through vi

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  // The twelve major keys by pitch class, spelled the way they are usually written.
  const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  const mod = (n, m) => ((n % m) + m) % m;

  function parseNote(name) {
    const match = /^([A-G])(#{1,2}|b{1,2})?$/.exec(name);
    if (!match) throw new Error('Unrecognised note name: ' + name);
    const accidental = match[2] || '';
    const offset = accidental.startsWith('#') ? accidental.length : -accidental.length;
    return { letter: match[1], pc: mod(NATURAL_PC[match[1]] + offset, 12) };
  }

  // Name a pitch class with a given letter: spell('B', 10) -> 'Bb', spell('F', 6) -> 'F#'.
  function spell(letter, pc) {
    let diff = mod(pc - NATURAL_PC[letter], 12);
    if (diff > 6) diff -= 12;
    return letter + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
  }

  const pitchClass = (name) => parseNote(name).pc;

  /** Pitch classes of the major scale on a tonic pitch class. */
  const majorScalePcs = (tonicPc) => MAJOR_STEPS.map((step) => mod(tonicPc + step, 12));

  /** Display form of a note or chord name: 'Bb' -> 'B♭', 'F#m' -> 'F♯m'. */
  function prettyName(name) {
    return name.replace(/^([A-G])(#{1,2}|b{1,2})/, (_, letter, acc) =>
      letter + acc.replace(/#/g, '\u266F').replace(/b/g, '\u266D'));
  }

  function majorScale(tonicName) {
    const tonic = parseNote(tonicName);
    const start = LETTERS.indexOf(tonic.letter);
    return MAJOR_STEPS.map((step, i) => {
      const pc = mod(tonic.pc + step, 12);
      return { name: spell(LETTERS[(start + i) % 7], pc), pc };
    });
  }

  /**
   * The diatonic triads of a major key, in scale-degree order.
   * Each chord: { degree, numeral, name, quality, rootPc, pcs, notes }.
   */
  function diatonicChords(tonicName = 'C', count = POOL_SIZE) {
    const scale = majorScale(tonicName);
    const chords = [];
    for (let i = 0; i < count; i++) {
      const root = scale[i];
      const third = scale[(i + 2) % 7];
      const fifth = scale[(i + 4) % 7];
      const isMajorThird = mod(third.pc - root.pc, 12) === 4;
      const isPerfectFifth = mod(fifth.pc - root.pc, 12) === 7;
      const quality = isMajorThird ? 'major' : isPerfectFifth ? 'minor' : 'diminished';
      const numeral = quality === 'major' ? ROMAN[i]
        : quality === 'minor' ? ROMAN[i].toLowerCase()
        : ROMAN[i].toLowerCase() + '°';
      const suffix = quality === 'minor' ? 'm' : quality === 'diminished' ? 'dim' : '';
      chords.push({
        degree: i + 1,
        numeral,
        name: root.name + suffix,
        quality,
        rootPc: root.pc,
        pcs: [root.pc, third.pc, fifth.pc],
        notes: [root.name, third.name, fifth.name],
      });
    }
    return chords;
  }

  /**
   * A random progression of scale degrees (1-based).
   * By default the same chord never sounds twice in a row, since a repeated
   * chord is hard to hear as two separate bars. With startOnTonic the first
   * chord is always I, which establishes the key.
   */
  function randomProgression({
    length = SLOTS,
    poolSize = POOL_SIZE,
    allowAdjacentRepeats = false,
    startOnTonic = false,
    rng = Math.random,
  } = {}) {
    const pool = Array.from({ length: poolSize }, (_, i) => i + 1);
    const out = startOnTonic ? [1] : [];
    for (let i = out.length; i < length; i++) {
      const prev = out[i - 1];
      const choices = allowAdjacentRepeats ? pool : pool.filter((d) => d !== prev);
      out.push(choices[Math.floor(rng() * choices.length)]);
    }
    return out;
  }

  /**
   * Score a guess against the answer with Wordle's rules:
   * 'correct' = right chord, right bar; 'present' = in the progression, other bar;
   * 'absent' = not in it, or already used up by other marks.
   */
  function scoreGuess(guess, answer) {
    if (guess.length !== answer.length) {
      throw new Error(`Guess has ${guess.length} chords; expected ${answer.length}`);
    }
    const result = new Array(answer.length).fill('absent');
    const unmatched = new Map();
    for (let i = 0; i < answer.length; i++) {
      if (guess[i] === answer[i]) result[i] = 'correct';
      else unmatched.set(answer[i], (unmatched.get(answer[i]) || 0) + 1);
    }
    for (let i = 0; i < answer.length; i++) {
      if (result[i] === 'correct') continue;
      const left = unmatched.get(guess[i]) || 0;
      if (left > 0) {
        result[i] = 'present';
        unmatched.set(guess[i], left - 1);
      }
    }
    return result;
  }

  const isSolved = (result) => result.every((s) => s === 'correct');

  /**
   * Key mode: score a guessed key (pitch class) against the real key.
   * 'correct' = the right key; 'present' = wrong key, but its tonic note is in
   * the real key's major scale; 'absent' = that note is not in the scale.
   * Notes compare by sound, so F# and Gb count as the same note.
   */
  function scoreKeyGuess(guessPc, answerPc) {
    if (guessPc === answerPc) return 'correct';
    return majorScalePcs(answerPc).includes(guessPc) ? 'present' : 'absent';
  }

  const randomKey = (rng = Math.random) => Math.floor(rng() * 12);

  const RANK = { absent: 1, present: 2, correct: 3 };

  /** Best mark each item has earned, from [item, mark] pairs. */
  function bestMarks(pairs) {
    const states = {};
    for (const [item, s] of pairs) {
      if (!states[item] || RANK[s] > RANK[states[item]]) states[item] = s;
    }
    return states;
  }

  /** Best mark each chord has earned so far, for colouring the keypad. */
  function keyStates(guesses) {
    return bestMarks(guesses.flatMap(({ degrees, result }) => degrees.map((d, i) => [d, result[i]])));
  }

  /** Place each chord tone in the octave starting at `low` (MIDI), giving smooth voice leading. */
  function voiceChord(pcs, low = 55) {
    return pcs.map((pc) => low + mod(pc - low, 12)).sort((a, b) => a - b);
  }

  /** Root of the chord in the bass octave starting at `low` (MIDI 40 = E2). */
  function bassNote(rootPc, low = 40) {
    return low + mod(rootPc - low, 12);
  }

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  return {
    SLOTS,
    MAX_GUESSES,
    POOL_SIZE,
    MAJOR_KEYS,
    pitchClass,
    majorScale,
    majorScalePcs,
    prettyName,
    diatonicChords,
    randomProgression,
    scoreGuess,
    isSolved,
    scoreKeyGuess,
    randomKey,
    bestMarks,
    keyStates,
    voiceChord,
    bassNote,
    midiToFreq,
  };
});
