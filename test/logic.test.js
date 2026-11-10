'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

test('C major gives I ii iii IV V vi with the right chord names and notes', () => {
  const chords = L.diatonicChords('C');
  assert.deepEqual(chords.map((c) => c.numeral), ['I', 'ii', 'iii', 'IV', 'V', 'vi']);
  assert.deepEqual(chords.map((c) => c.name), ['C', 'Dm', 'Em', 'F', 'G', 'Am']);
  assert.deepEqual(chords.map((c) => c.notes.join(' ')), ['C E G', 'D F A', 'E G B', 'F A C', 'G B D', 'A C E']);
  assert.deepEqual(chords.map((c) => c.degree), [1, 2, 3, 4, 5, 6]);
});

test('other keys are spelled with the correct accidentals', () => {
  assert.deepEqual(L.diatonicChords('G').map((c) => c.name), ['G', 'Am', 'Bm', 'C', 'D', 'Em']);
  assert.deepEqual(L.diatonicChords('F').map((c) => c.name), ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm']);
  assert.deepEqual(L.diatonicChords('Eb').map((c) => c.name), ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm']);
  assert.deepEqual(L.diatonicChords('D').map((c) => c.name), ['D', 'Em', 'F#m', 'G', 'A', 'Bm']);
  const vii = L.diatonicChords('C', 7)[6];
  assert.equal(vii.numeral, 'vii°');
  assert.equal(vii.name, 'Bdim');
});

test('scoreGuess marks an exact match all correct', () => {
  assert.deepEqual(L.scoreGuess([1, 5, 6, 4], [1, 5, 6, 4]), ['correct', 'correct', 'correct', 'correct']);
  assert.ok(L.isSolved(L.scoreGuess([1, 5, 6, 4], [1, 5, 6, 4])));
});

test('scoreGuess marks chords in the wrong bar as present and missing chords as absent', () => {
  // answer I V vi IV, guess IV V ii I
  assert.deepEqual(L.scoreGuess([4, 5, 2, 1], [1, 5, 6, 4]), ['present', 'correct', 'absent', 'present']);
  assert.deepEqual(L.scoreGuess([2, 3, 2, 3], [1, 5, 6, 4]), ['absent', 'absent', 'absent', 'absent']);
  assert.ok(!L.isSolved(L.scoreGuess([4, 5, 2, 1], [1, 5, 6, 4])));
});

test('scoreGuess follows Wordle rules for repeated chords', () => {
  // Only one I in the answer, and it is already matched in bar 1.
  assert.deepEqual(L.scoreGuess([1, 1, 1, 1], [1, 5, 6, 4]), ['correct', 'absent', 'absent', 'absent']);
  // Two I chords in the answer; the exact match is counted first, then one present.
  assert.deepEqual(L.scoreGuess([4, 1, 1, 1], [1, 4, 1, 5]), ['present', 'present', 'correct', 'absent']);
  // Guessing a chord twice when the answer has it once elsewhere: only the first is present.
  assert.deepEqual(L.scoreGuess([5, 5, 2, 3], [1, 4, 6, 5]), ['present', 'absent', 'absent', 'absent']);
  // The answer has the chord twice; both guessed copies in wrong bars are present.
  assert.deepEqual(L.scoreGuess([4, 1, 6, 1], [1, 4, 1, 6]), ['present', 'present', 'present', 'present']);
});

test('scoreGuess rejects guesses of the wrong length', () => {
  assert.throws(() => L.scoreGuess([1, 2, 3], [1, 2, 3, 4]));
});

test('randomProgression stays in the pool and never repeats a chord back to back', () => {
  for (let i = 0; i < 5000; i++) {
    const p = L.randomProgression();
    assert.equal(p.length, 4);
    p.forEach((d, j) => {
      assert.ok(Number.isInteger(d) && d >= 1 && d <= 6, `degree ${d} out of range`);
      if (j > 0) assert.notEqual(d, p[j - 1], `back-to-back repeat in ${p}`);
    });
  }
});

test('randomProgression can reach every chord in every bar', () => {
  const seen = Array.from({ length: 4 }, () => new Set());
  for (let i = 0; i < 5000; i++) L.randomProgression().forEach((d, j) => seen[j].add(d));
  seen.forEach((set) => assert.equal(set.size, 6));
});

test('randomProgression uses the supplied rng and the repeat option', () => {
  const zero = () => 0;
  assert.deepEqual(L.randomProgression({ rng: zero }), [1, 2, 1, 2]);
  assert.deepEqual(L.randomProgression({ rng: zero, allowAdjacentRepeats: true }), [1, 1, 1, 1]);
  const top = () => 0.9999;
  assert.deepEqual(L.randomProgression({ rng: top }), [6, 5, 6, 5]);
});

test('keyStates keeps the best mark each chord has earned', () => {
  const answer = [1, 5, 6, 4];
  const guesses = [[4, 2, 3, 1], [1, 4, 5, 2]].map((degrees) => ({ degrees, result: L.scoreGuess(degrees, answer) }));
  assert.deepEqual(L.keyStates(guesses), { 1: 'correct', 2: 'absent', 3: 'absent', 4: 'present', 5: 'present' });
  assert.deepEqual(L.keyStates([]), {});
});

test('voicing keeps chord tones between G3 and F#4 with the root in the bass', () => {
  const [C, Dm, Em, F, G, Am] = L.diatonicChords('C');
  assert.deepEqual(L.voiceChord(C.pcs), [55, 60, 64]);   // G3 C4 E4
  assert.deepEqual(L.voiceChord(G.pcs), [55, 59, 62]);   // G3 B3 D4
  assert.deepEqual(L.voiceChord(Am.pcs), [57, 60, 64]);  // A3 C4 E4
  for (const chord of [C, Dm, Em, F, G, Am]) {
    L.voiceChord(chord.pcs).forEach((m) => assert.ok(m >= 55 && m < 67));
    const bass = L.bassNote(chord.rootPc);
    assert.ok(bass >= 40 && bass < 52);
    assert.equal(bass % 12, chord.rootPc);
  }
  assert.equal(L.bassNote(C.rootPc), 48); // C3
  assert.equal(L.midiToFreq(69), 440);
});
