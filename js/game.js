/*
 * Four Bars: board, keypad, input and round flow for both game modes.
 *   chords: hear four chords in a set key and name them by Roman numeral.
 *   key:    hear four chords in a random major key and name the key.
 * Depends on window.FourBarsLogic (js/logic.js) and window.FourBarsAudio (js/audio.js).
 */
(function () {
  'use strict';

  const L = window.FourBarsLogic;
  const { ChordPlayer } = window.FourBarsAudio;

  // ---- Settings ------------------------------------------------------------
  const CHORDS_MODE_KEY = 'C';      // key used by "Name the chords"
  const ALLOW_BACK_TO_BACK = false; // may the same chord sound in two bars in a row?
  const KEY_MODE_STARTS_ON_I = true; // in "Name the key", open on the I chord to set up the key
  const CHORD_SECONDS = 1.3;        // length of each chord on playback
  const STORAGE = {
    mode: 'four-bars:mode',
    stats: { chords: 'four-bars:stats:v1', key: 'four-bars:stats:key:v1' },
  };

  const { SLOTS, MAX_GUESSES, POOL_SIZE } = L;
  const MODES = ['chords', 'key'];
  const FIXED_TONIC = L.pitchClass(CHORDS_MODE_KEY);
  const REFERENCE_C = { pcs: [0], rootPc: 0 }; // C4 over C3

  const chordCache = new Map([[FIXED_TONIC, L.diatonicChords(CHORDS_MODE_KEY, POOL_SIZE)]]);
  function chordsIn(tonic) {
    if (!chordCache.has(tonic)) chordCache.set(tonic, L.diatonicChords(L.MAJOR_KEYS[tonic], POOL_SIZE));
    return chordCache.get(tonic);
  }
  const chordsOf = (tonic, degrees) => degrees.map((d) => chordsIn(tonic)[d - 1]);
  const keyName = (pc) => L.prettyName(L.MAJOR_KEYS[pc]);
  const mod12 = (n) => ((n % 12) + 12) % 12;

  const COPY = {
    chords: {
      eyebrow: `Ear training · Key of ${L.prettyName(CHORDS_MODE_KEY)} major`,
      lede: 'Four chords play. Name the progression in four guesses.',
      reference: 'Hear the <span class="rn">I</span> chord',
      referenceTitle: 'Shortcut: T',
    },
    key: {
      eyebrow: 'Ear training · Any major key',
      lede: 'Four chords play in a mystery key. Name the key in four guesses.',
      reference: 'Hear a C',
      referenceTitle: 'Plays a reference C. Shortcut: R',
    },
  };
  const TILE_WORDS = { correct: 'right bar', present: 'in another bar', absent: 'not in the progression' };
  const CHORD_KEY_WORDS = { correct: 'found in its bar', present: 'in the progression', absent: 'not in the progression' };
  const PIANO_KEY_WORDS = { correct: 'the key', present: 'in the key’s scale', absent: 'not in the key’s scale' };
  const keyTileWords = (pc, state) => ({
    correct: 'Right key',
    present: `${keyName(pc)} is in the key’s scale`,
    absent: `${keyName(pc)} isn’t in the key’s scale`,
  })[state];
  const WIN_TITLES = ['Perfect ear', 'Sharp ear', 'Nicely heard', 'Just in time'];

  // Piano layout: grid column of each key (white keys span two columns) and its colour.
  const PIANO = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13].map((col, pc) => ({
    pc,
    col,
    black: [1, 3, 6, 8, 10].includes(pc),
  }));

  const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8L13.2 8z"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>';

  const $ = (id) => document.getElementById(id);
  const ui = {
    eyebrow: $('eyebrow'),
    lede: $('lede'),
    modeButtons: Array.from(document.querySelectorAll('.mode-btn')),
    board: $('board'),
    beats: Array.from(document.querySelectorAll('.beat')),
    status: $('status'),
    announce: $('announce'),
    result: $('result'),
    resultTitle: $('result-title'),
    resultSub: $('result-sub'),
    answer: $('answer'),
    next: $('next-btn'),
    keypad: $('keypad'),
    play: $('play-btn'),
    playIcon: $('play-icon'),
    playLabel: $('play-label'),
    reference: $('ref-btn'),
    helpBodies: Array.from(document.querySelectorAll('.help-body[data-mode]')),
    stat: {
      played: $('stat-played'),
      winRate: $('stat-winrate'),
      streak: $('stat-streak'),
      best: $('stat-best'),
    },
  };

  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduceMotion = () => Boolean(motionQuery && motionQuery.matches);
  const player = new ChordPlayer();

  let mode = loadMode();
  const rounds = { chords: null, key: null };
  /*
   * round: { mode, tonic, answer, guesses, current, status, played }
   *   chords mode: guesses [{ degrees, result: [marks] }], current = degrees entered so far
   *   key mode:    guesses [{ key, result: mark }],       current = selected key or null
   */
  let round = null;
  let revealing = false;   // true while a submitted row is flipping
  let revealingRow = -1;
  let activePlay = null;   // { kind: 'answer' | 'reference' | 'row', row }
  let flashTimer = 0;
  const stats = { chords: loadStats(STORAGE.stats.chords), key: loadStats(STORAGE.stats.key) };
  let rows = [];           // { line, tiles, shakeEl, playBtn }
  let keyButtons = new Map(); // chords: degree -> button; key: pitch class -> button
  let answerTiles = [];

  // ---- Building the page -----------------------------------------------------

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function makeTile(extraClass) {
    const tile = el('div', 'tile' + (extraClass ? ' ' + extraClass : ''), '<span class="numeral"></span><span class="name"></span>');
    tile.setAttribute('role', 'img');
    return tile;
  }

  function buildBoard() {
    rows.forEach((row) => row.line.remove());
    rows = [];
    for (let r = 0; r < MAX_GUESSES; r++) {
      const line = el('div', 'line');
      line.setAttribute('role', 'group');
      line.setAttribute('aria-label', `Guess ${r + 1}`);

      let shakeEl;
      const tiles = [];
      if (mode === 'chords') {
        shakeEl = el('div', 'bars');
        for (let s = 0; s < SLOTS; s++) {
          const measure = el('div', 'measure');
          const tile = makeTile();
          measure.appendChild(tile);
          shakeEl.appendChild(measure);
          tiles.push(tile);
        }
      } else {
        shakeEl = el('div', 'key-slot');
        const tile = makeTile('key-tile');
        shakeEl.appendChild(tile);
        tiles.push(tile);
      }

      const playBtn = el('button', 'row-play', PLAY_ICON);
      playBtn.type = 'button';
      playBtn.addEventListener('click', () => toggleRow(r));

      line.append(document.createElement('span'), shakeEl, playBtn);
      ui.board.appendChild(line);
      rows.push({ line, tiles, shakeEl, playBtn });
    }
  }

  function buildKeypad() {
    ui.keypad.innerHTML = '';
    ui.keypad.className = 'keypad keypad-' + mode;
    keyButtons = new Map();

    if (mode === 'chords') {
      chordsIn(FIXED_TONIC).forEach((chord) => {
        const btn = el('button', 'key',
          `<span class="key-num">${chord.degree}</span>` +
          `<span class="key-numeral">${chord.numeral}</span>` +
          `<span class="key-name">${L.prettyName(chord.name)}</span>`);
        btn.type = 'button';
        btn.addEventListener('click', () => enterChord(chord.degree));
        ui.keypad.appendChild(btn);
        keyButtons.set(chord.degree, btn);
      });
    } else {
      PIANO.forEach(({ pc, col, black }) => {
        const btn = el('button', `key piano-key ${black ? 'black' : 'white'}`,
          `<span class="key-numeral">${keyName(pc)}</span>`);
        btn.type = 'button';
        btn.style.gridColumn = `${col} / span 2`;
        btn.style.gridRow = black ? '1' : '2';
        btn.addEventListener('click', () => selectKey(pc));
        ui.keypad.appendChild(btn);
        keyButtons.set(pc, btn);
      });
    }

    const del = el('button', 'key key-wide key-delete', 'Delete');
    del.type = 'button';
    del.addEventListener('click', erase);
    const sub = el('button', 'key key-wide key-submit', 'Submit');
    sub.type = 'button';
    sub.addEventListener('click', submit);
    ui.keypad.append(del, sub);
  }

  // ---- Rendering -------------------------------------------------------------

  const typing = () => round.status === 'playing' && !revealing;

  function renderBoard() {
    const g = round.guesses.length;
    rows.forEach((row, r) => {
      const guess = r < g ? round.guesses[r] : null;
      const isActive = r === g && typing();
      const showMarks = Boolean(guess) && r !== revealingRow;

      row.line.classList.toggle('is-active', isActive);
      row.playBtn.classList.toggle('is-visible', showMarks);

      if (round.mode === 'chords') {
        const degrees = guess ? guess.degrees : isActive ? round.current : [];
        row.tiles.forEach((tile, s) => {
          setChordTile(tile, s, degrees[s], showMarks ? guess.result[s] : null);
          tile.classList.toggle('cursor', isActive && s === degrees.length);
        });
      } else {
        const pc = guess ? guess.key : isActive ? round.current : null;
        setKeyTile(row.tiles[0], pc, showMarks ? guess.result : null);
        row.tiles[0].classList.toggle('cursor', isActive && pc === null);
      }
    });
  }

  function setChordTile(tile, slot, degree, state) {
    const chord = degree ? chordsIn(round.tonic)[degree - 1] : null;
    tile.firstChild.textContent = chord ? chord.numeral : '';
    tile.lastChild.textContent = chord ? L.prettyName(chord.name) : '';
    tile.classList.toggle('filled', Boolean(chord));
    markChordTile(tile, slot, chord, state);
  }

  function markChordTile(tile, slot, chord, state) {
    setState(tile, state);
    const what = chord ? `${chord.numeral} (${L.prettyName(chord.name)})` : 'empty';
    tile.setAttribute('aria-label', `Bar ${slot + 1}: ${what}${state ? ', ' + TILE_WORDS[state] : ''}`);
  }

  function setKeyTile(tile, pc, state) {
    const has = pc !== null && pc !== undefined;
    tile.firstChild.textContent = has ? `${keyName(pc)} major` : '';
    tile.lastChild.textContent = has && state ? keyTileWords(pc, state) : '';
    tile.classList.toggle('filled', has);
    setState(tile, state);
    tile.setAttribute('aria-label', has ? `${keyName(pc)} major${state ? ': ' + keyTileWords(pc, state) : ''}` : 'No key chosen');
  }

  function setState(node, state) {
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  }

  function renderKeypad() {
    const done = round.guesses.filter((_, i) => i !== revealingRow);
    const isKey = round.mode === 'key';
    const states = isKey ? L.bestMarks(done.map((g) => [g.key, g.result])) : L.keyStates(done);
    keyButtons.forEach((btn, item) => {
      const state = states[item];
      setState(btn, state);
      if (isKey) {
        const selected = round.current === item;
        btn.classList.toggle('selected', selected);
        btn.setAttribute('aria-pressed', String(selected));
        btn.setAttribute('aria-label', `${keyName(item)} major${state ? ', ' + PIANO_KEY_WORDS[state] : ''}`);
      } else {
        const chord = chordsIn(round.tonic)[item - 1];
        btn.setAttribute('aria-label', `${chord.numeral}, ${L.prettyName(chord.name)}${state ? ', ' + CHORD_KEY_WORDS[state] : ''}`);
      }
    });
    ui.keypad.hidden = round.status !== 'playing';
  }

  function renderTransport() {
    const kind = activePlay && activePlay.kind;
    const playingAnswer = kind === 'answer';
    ui.play.classList.toggle('is-playing', playingAnswer);
    ui.play.setAttribute('aria-pressed', String(playingAnswer));
    ui.playIcon.innerHTML = playingAnswer ? STOP_ICON : PLAY_ICON;
    ui.playLabel.textContent = playingAnswer ? 'Stop' : round.played ? 'Play again' : 'Play progression';
    ui.play.classList.toggle('nudge', !round.played && round.status === 'playing');
    ui.reference.classList.toggle('is-playing', kind === 'reference');
    rows.forEach((row, r) => {
      const on = kind === 'row' && activePlay.row === r;
      row.playBtn.innerHTML = on ? STOP_ICON : PLAY_ICON;
      row.playBtn.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} guess ${r + 1}${round.mode === 'key' ? ' in its key' : ''}`);
    });
  }

  function renderMode() {
    const copy = COPY[mode];
    ui.eyebrow.textContent = copy.eyebrow;
    ui.lede.textContent = copy.lede;
    ui.reference.innerHTML = copy.reference;
    ui.reference.title = copy.referenceTitle;
    ui.modeButtons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)));
    ui.helpBodies.forEach((body) => { body.hidden = body.dataset.mode !== mode; });
  }

  function renderStats() {
    const s = stats[round.mode];
    ui.stat.played.textContent = s.played;
    ui.stat.winRate.textContent = s.played ? Math.round((s.won / s.played) * 100) : 0;
    ui.stat.streak.textContent = s.streak;
    ui.stat.best.textContent = s.best;
  }

  function renderResult() {
    const finished = round.status !== 'playing';
    ui.result.hidden = !finished;
    answerTiles = [];
    if (!finished) return;

    const won = round.status === 'won';
    const n = round.guesses.length;
    const key = `${keyName(round.tonic)} major`;
    ui.resultTitle.textContent = won ? WIN_TITLES[n - 1] : 'Out of guesses';
    if (round.mode === 'key') {
      ui.resultSub.textContent = won ? `You named ${key} in ${n} of ${MAX_GUESSES} guesses.` : `The progression was in ${key}.`;
    } else {
      ui.resultSub.textContent = won ? `You named it in ${n} of ${MAX_GUESSES} guesses.` : 'This is the progression you heard.';
    }

    ui.answer.innerHTML = '';
    chordsOf(round.tonic, round.answer).forEach((chord, i) => {
      const measure = el('div', 'measure');
      const tile = makeTile(won ? 'filled' : 'filled is-answer');
      tile.firstChild.textContent = chord.numeral;
      tile.lastChild.textContent = L.prettyName(chord.name);
      if (won) tile.dataset.state = 'correct';
      const notes = chord.notes.map(L.prettyName).join(' ');
      tile.setAttribute('aria-label', `Bar ${i + 1}: ${chord.numeral} (${L.prettyName(chord.name)}), notes ${notes}`);
      const notesEl = el('span', 'notes');
      notesEl.textContent = notes;
      notesEl.setAttribute('aria-hidden', 'true');
      measure.append(tile, notesEl);
      ui.answer.appendChild(measure);
      answerTiles.push(tile);
    });
  }

  function defaultStatus() {
    if (round.status !== 'playing') return 'Play it again, or move on to the next progression.';
    if (!round.played) return 'Press Play to hear this round’s four chords.';
    const n = `Guess ${round.guesses.length + 1} of ${MAX_GUESSES}.`;
    return round.mode === 'key' ? `${n} Pick the key on the keyboard.` : `${n} Enter a chord for each bar.`;
  }

  function setStatus(text) {
    clearTimeout(flashTimer);
    ui.status.classList.remove('warn');
    ui.status.textContent = text || defaultStatus();
  }

  function flash(text) {
    setStatus(text);
    ui.status.classList.add('warn');
    flashTimer = setTimeout(() => setStatus(), 2600);
  }

  function renderAll() {
    renderBoard();
    renderKeypad();
    renderResult();
    renderTransport();
    renderStats();
    setStatus();
  }

  // ---- Input ------------------------------------------------------------------

  function enterChord(degree) {
    if (!typing() || round.mode !== 'chords' || round.current.length >= SLOTS) return;
    round.current.push(degree);
    renderBoard();
    animate(rows[round.guesses.length].tiles[round.current.length - 1], 'pop');
  }

  function selectKey(pc) {
    if (!typing() || round.mode !== 'key') return;
    round.current = pc;
    renderBoard();
    renderKeypad();
    animate(rows[round.guesses.length].tiles[0], 'pop');
  }

  function shiftKey(step) {
    if (!typing() || round.mode !== 'key' || round.current === null) return;
    selectKey(mod12(round.current + step));
  }

  function erase() {
    if (!typing()) return;
    if (round.mode === 'chords') {
      if (round.current.length === 0) return;
      round.current.pop();
    } else {
      if (round.current === null) return;
      round.current = null;
      renderKeypad();
    }
    renderBoard();
  }

  function submit() {
    if (!typing()) return;
    const r = round.guesses.length;
    let guess;
    if (round.mode === 'chords') {
      if (round.current.length < SLOTS) {
        animate(rows[r].shakeEl, 'shake');
        flash(`Fill all ${SLOTS} bars before you submit.`);
        return;
      }
      const degrees = round.current.slice();
      guess = { degrees, result: L.scoreGuess(degrees, round.answer) };
      round.current = [];
    } else {
      if (round.current === null) {
        animate(rows[r].shakeEl, 'shake');
        flash('Pick a key on the keyboard before you submit.');
        return;
      }
      guess = { key: round.current, result: L.scoreKeyGuess(round.current, round.tonic) };
      round.current = null;
    }

    round.guesses.push(guess);
    revealing = true;
    revealingRow = r;
    renderBoard();
    renderKeypad();

    const rnd = round;
    reveal(r, guess).then(() => {
      revealing = false;
      revealingRow = -1;
      const won = rnd.mode === 'key' ? guess.result === 'correct' : L.isSolved(guess.result);
      if (won) rnd.status = 'won';
      else if (rnd.guesses.length >= MAX_GUESSES) rnd.status = 'lost';

      ui.announce.textContent = `Guess ${r + 1}: ` + (rnd.mode === 'key'
        ? `${keyName(guess.key)} major, ${keyTileWords(guess.key, guess.result)}.`
        : guess.degrees.map((d, i) => `${chordsIn(rnd.tonic)[d - 1].numeral} ${TILE_WORDS[guess.result[i]]}`).join(', ') + '.');

      if (rnd.status !== 'playing') recordResult(rnd.mode, won, rnd.guesses.length);
      renderAll();
      if (won) celebrate(r);
    });
  }

  function reveal(r, guess) {
    const tiles = rows[r].tiles;
    const mark = (s) => {
      if (round.mode === 'key') setKeyTile(tiles[0], guess.key, guess.result);
      else markChordTile(tiles[s], s, chordsIn(round.tonic)[guess.degrees[s] - 1], guess.result[s]);
    };
    if (reduceMotion()) {
      tiles.forEach((_, s) => mark(s));
      return Promise.resolve();
    }
    const STEP = 230;   // delay between tiles
    const FLIP = 420;   // one flip; colour changes at the halfway point
    return new Promise((resolve) => {
      tiles.forEach((tile, s) => {
        tile.style.animationDelay = `${s * STEP}ms`;
        tile.classList.add('flip');
        setTimeout(() => mark(s), s * STEP + FLIP / 2);
      });
      setTimeout(() => {
        tiles.forEach((tile) => {
          tile.classList.remove('flip');
          tile.style.animationDelay = '';
        });
        resolve();
      }, (tiles.length - 1) * STEP + FLIP + 30);
    });
  }

  function celebrate(r) {
    if (reduceMotion()) return;
    rows[r].tiles.forEach((tile, s) => {
      tile.style.animationDelay = `${s * 90}ms`;
      animate(tile, 'hop', () => { tile.style.animationDelay = ''; });
    });
  }

  function animate(node, className, done) {
    if (reduceMotion()) return;
    node.classList.remove(className);
    void node.offsetWidth; // restart the animation if it is already applied
    node.classList.add(className);
    node.addEventListener('animationend', function end(e) {
      if (e.target !== node) return; // ignore animations of child elements
      node.classList.remove(className);
      node.removeEventListener('animationend', end);
      if (done) done();
    });
  }

  // ---- Playback ----------------------------------------------------------------

  function startPlayback(kind, chords, { row, chordSeconds = CHORD_SECONDS } = {}) {
    const token = { kind, row };
    activePlay = token;
    clearHighlights();
    renderTransport();
    player.playSequence(chords, {
      chordSeconds,
      onStep: (i) => { if (activePlay === token) highlight(token, i); },
      onEnd: () => { if (activePlay === token) endPlayback(); },
    }).then((ok) => {
      if (ok || activePlay !== token) return;
      endPlayback();
      if (!player.supported) flash('This browser can’t play Web Audio, so the chords can’t be heard.');
    });
  }

  function endPlayback() {
    activePlay = null;
    clearHighlights();
    renderTransport();
  }

  function stopPlayback() {
    player.stop();
    if (activePlay) endPlayback();
  }

  function toggleAnswer() {
    if (activePlay && activePlay.kind === 'answer') return stopPlayback();
    const first = !round.played;
    round.played = true;
    startPlayback('answer', chordsOf(round.tonic, round.answer));
    if (first && round.status === 'playing') setStatus();
  }

  // Chords mode: hear the guessed chords. Key mode: hear the progression in the guessed key.
  function toggleRow(r) {
    if (r >= round.guesses.length || r === revealingRow) return;
    if (activePlay && activePlay.kind === 'row' && activePlay.row === r) return stopPlayback();
    const guess = round.guesses[r];
    const chords = round.mode === 'key' ? chordsOf(guess.key, round.answer) : chordsOf(round.tonic, guess.degrees);
    startPlayback('row', chords, { row: r });
  }

  // Chords mode: the I chord of the key. Key mode: a reference C, since the I chord would give the key away.
  function playReference() {
    const chord = round.mode === 'key' ? REFERENCE_C : chordsIn(round.tonic)[0];
    startPlayback('reference', [chord], { chordSeconds: 1.8 });
  }

  function highlight(play, i) {
    clearHighlights();
    if (play.kind === 'reference') return;
    ui.beats[i].classList.add('on');
    if (play.kind === 'row') {
      const tiles = rows[play.row].tiles;
      (tiles[i] || tiles[0]).classList.add('sounding');
    }
    if (play.kind === 'answer' && answerTiles[i]) answerTiles[i].classList.add('sounding');
  }

  function clearHighlights() {
    ui.beats.forEach((b) => b.classList.remove('on'));
    document.querySelectorAll('.sounding').forEach((node) => node.classList.remove('sounding'));
  }

  // ---- Modes and rounds -------------------------------------------------------------

  function makeRound(m, previous) {
    let tonic;
    let answer;
    do {
      tonic = m === 'key' ? L.randomKey() : FIXED_TONIC;
      answer = L.randomProgression({
        poolSize: POOL_SIZE,
        allowAdjacentRepeats: ALLOW_BACK_TO_BACK,
        startOnTonic: m === 'key' && KEY_MODE_STARTS_ON_I,
      });
    } while (previous && (m === 'key' ? tonic === previous.tonic : answer.join() === previous.answer.join()));
    return { mode: m, tonic, answer, guesses: [], current: m === 'key' ? null : [], status: 'playing', played: false };
  }

  function showRound(r) {
    round = r;
    rounds[r.mode] = r;
    ui.announce.textContent = '';
    renderAll();
  }

  function nextRound() {
    if (round.status === 'playing' || revealing) return;
    stopPlayback();
    showRound(makeRound(mode, round));
    toggleAnswer(); // the click or key press counts as the gesture that allows audio
  }

  function setMode(m) {
    if (m === mode || !MODES.includes(m) || revealing) return;
    stopPlayback();
    mode = m;
    try { localStorage.setItem(STORAGE.mode, m); } catch (e) { /* not remembered */ }
    renderMode();
    buildBoard();
    buildKeypad();
    showRound(rounds[m] || makeRound(m, null));
  }

  function loadMode() {
    try {
      const saved = localStorage.getItem(STORAGE.mode);
      if (MODES.includes(saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    return 'chords';
  }

  function loadStats(storageKey) {
    const base = { played: 0, won: 0, streak: 0, best: 0, dist: [0, 0, 0, 0] };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved === 'object') {
        for (const k of ['played', 'won', 'streak', 'best']) {
          if (Number.isInteger(saved[k]) && saved[k] >= 0) base[k] = saved[k];
        }
        if (Array.isArray(saved.dist) && saved.dist.length === base.dist.length) {
          base.dist = saved.dist.map((n) => (Number.isInteger(n) && n >= 0 ? n : 0));
        }
      }
    } catch (e) { /* storage unavailable: start fresh */ }
    return base;
  }

  function recordResult(m, won, guessCount) {
    const s = stats[m];
    s.played += 1;
    if (won) {
      s.won += 1;
      s.streak += 1;
      s.best = Math.max(s.best, s.streak);
      s.dist[guessCount - 1] += 1;
    } else {
      s.streak = 0;
    }
    try { localStorage.setItem(STORAGE.stats[m], JSON.stringify(s)); } catch (e) { /* not persisted */ }
  }

  // Accept a round saved by a live-update snapshot only if it is well formed.
  function restoreRound(saved, m) {
    const isDegree = (d) => Number.isInteger(d) && d >= 1 && d <= POOL_SIZE;
    const isPc = (pc) => Number.isInteger(pc) && pc >= 0 && pc < 12;
    if (!saved || saved.mode !== m || !isPc(saved.tonic)) return null;
    if (!Array.isArray(saved.answer) || saved.answer.length !== SLOTS || !saved.answer.every(isDegree)) return null;
    const guesses = Array.isArray(saved.guesses) ? saved.guesses.slice(0, MAX_GUESSES) : [];
    let scored;
    let current;
    let solved;
    if (m === 'chords') {
      if (!guesses.every((g) => g && Array.isArray(g.degrees) && g.degrees.length === SLOTS && g.degrees.every(isDegree))) return null;
      scored = guesses.map((g) => ({ degrees: g.degrees.slice(), result: L.scoreGuess(g.degrees, saved.answer) }));
      current = Array.isArray(saved.current) ? saved.current.filter(isDegree).slice(0, SLOTS) : [];
      solved = (g) => L.isSolved(g.result);
    } else {
      if (!guesses.every((g) => g && isPc(g.key))) return null;
      scored = guesses.map((g) => ({ key: g.key, result: L.scoreKeyGuess(g.key, saved.tonic) }));
      current = isPc(saved.current) ? saved.current : null;
      solved = (g) => g.result === 'correct';
    }
    const last = scored[scored.length - 1];
    const status = last && solved(last) ? 'won' : scored.length >= MAX_GUESSES ? 'lost' : 'playing';
    return { mode: m, tonic: saved.tonic, answer: saved.answer.slice(), guesses: scored, current, status, played: true };
  }

  // ---- Events --------------------------------------------------------------------

  function bindEvents() {
    ui.play.addEventListener('click', toggleAnswer);
    ui.reference.addEventListener('click', playReference);
    ui.next.addEventListener('click', nextRound);
    ui.modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    // Mouse clicks shouldn't leave focus on a button, or a later Enter would press it again.
    document.addEventListener('mousedown', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target instanceof Element && e.target.closest('button, summary, a, input, select, textarea');
      const k = e.key;
      const keyMode = round.mode === 'key';

      if (k === 'Enter') {
        if (onControl || e.repeat) return; // let a focused button handle its own Enter
        e.preventDefault();
        if (round.status === 'playing') submit();
        else nextRound();
      } else if (k === ' ' || k === 'Spacebar') {
        if (onControl || e.repeat) return;
        e.preventDefault();
        toggleAnswer();
      } else if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        erase();
      } else if (!keyMode && /^[1-9]$/.test(k)) {
        const degree = Number(k);
        if (degree <= POOL_SIZE) {
          e.preventDefault();
          enterChord(degree);
        }
      } else if (keyMode && /^[a-g]$/i.test(k)) {
        e.preventDefault();
        selectKey(L.pitchClass(k.toUpperCase()));
      } else if (keyMode && (k === 'ArrowRight' || k === '#')) {
        e.preventDefault();
        shiftKey(1);
      } else if (keyMode && k === 'ArrowLeft') {
        e.preventDefault();
        shiftKey(-1);
      } else if (/^[tr]$/i.test(k)) {
        e.preventDefault();
        playReference();
      }
    });
  }

  // ---- Start ------------------------------------------------------------------------

  function start(data) {
    const saved = (data && data.rounds) || {};
    MODES.forEach((m) => { rounds[m] = restoreRound(saved[m], m); });
    if (data && MODES.includes(data.mode)) mode = data.mode;
    renderMode();
    buildBoard();
    buildKeypad();
    bindEvents();
    showRound(rounds[mode] || makeRound(mode, null));
  }

  // When the page runs as a claude.ai artifact, keep rounds in progress across live updates.
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ mode, rounds }));
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
