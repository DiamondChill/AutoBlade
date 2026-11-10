/*
 * Four Bars: board, keypad, input and round flow.
 * Depends on window.FourBarsLogic (js/logic.js) and window.FourBarsAudio (js/audio.js).
 */
(function () {
  'use strict';

  const L = window.FourBarsLogic;
  const { ChordPlayer } = window.FourBarsAudio;

  // ---- Settings ------------------------------------------------------------
  const KEY = 'C';                  // tonic of the major key the chords come from
  const ALLOW_BACK_TO_BACK = false; // may the same chord sound in two bars in a row?
  const CHORD_SECONDS = 1.3;        // length of each chord on playback
  const STATS_KEY = 'four-bars:stats:v1';

  const { SLOTS, MAX_GUESSES } = L;
  const CHORDS = L.diatonicChords(KEY);
  const chordAt = (degree) => CHORDS[degree - 1];

  const TILE_WORDS = { correct: 'right bar', present: 'in another bar', absent: 'not in the progression' };
  const KEY_WORDS = { correct: 'found in its bar', present: 'in the progression', absent: 'not in the progression' };
  const WIN_TITLES = ['Perfect ear', 'Sharp ear', 'Nicely heard', 'Just in time'];

  const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8L13.2 8z"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>';

  const $ = (id) => document.getElementById(id);
  const ui = {
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
    tonic: $('tonic-btn'),
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

  let round = null;        // { answer, guesses: [{ degrees, result }], current, status }
  let revealing = false;   // true while a submitted row is flipping
  let revealingRow = -1;
  let hasPlayed = false;   // has this round's progression been played yet?
  let activePlay = null;   // { kind: 'answer' | 'tonic' | 'row', row }
  let flashTimer = 0;
  let stats = loadStats();
  const rows = [];         // { line, bars, tiles, playBtn }
  const keys = new Map();  // degree -> keypad button
  let answerMeasures = [];

  // ---- Building the page -----------------------------------------------------

  function buildBoard() {
    for (let r = 0; r < MAX_GUESSES; r++) {
      const line = document.createElement('div');
      line.className = 'line';
      line.setAttribute('role', 'group');
      line.setAttribute('aria-label', `Guess ${r + 1}`);

      const bars = document.createElement('div');
      bars.className = 'bars';
      const tiles = [];
      for (let s = 0; s < SLOTS; s++) {
        const measure = document.createElement('div');
        measure.className = 'measure';
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.setAttribute('role', 'img');
        tile.innerHTML = '<span class="numeral"></span><span class="name"></span>';
        measure.appendChild(tile);
        bars.appendChild(measure);
        tiles.push(tile);
      }

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'row-play';
      playBtn.setAttribute('aria-label', `Play guess ${r + 1}`);
      playBtn.innerHTML = PLAY_ICON;
      playBtn.addEventListener('click', () => toggleRow(r));

      line.append(document.createElement('span'), bars, playBtn);
      ui.board.appendChild(line);
      rows.push({ line, bars, tiles, playBtn });
    }
  }

  function buildKeypad() {
    for (const chord of CHORDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key';
      btn.innerHTML =
        `<span class="key-num">${chord.degree}</span>` +
        `<span class="key-numeral">${chord.numeral}</span>` +
        `<span class="key-name">${chord.name}</span>`;
      btn.addEventListener('click', () => enter(chord.degree));
      ui.keypad.appendChild(btn);
      keys.set(chord.degree, btn);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'key key-wide key-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', erase);

    const sub = document.createElement('button');
    sub.type = 'button';
    sub.className = 'key key-wide key-submit';
    sub.textContent = 'Submit';
    sub.addEventListener('click', submit);

    ui.keypad.append(del, sub);
  }

  // ---- Rendering -------------------------------------------------------------

  const typing = () => round.status === 'playing' && !revealing;

  function renderBoard() {
    const g = round.guesses.length;
    rows.forEach((row, r) => {
      const submitted = r < g ? round.guesses[r] : null;
      const isActive = r === g && typing();
      const degrees = submitted ? submitted.degrees : isActive ? round.current : [];
      const showMarks = submitted && r !== revealingRow;

      row.line.classList.toggle('is-active', isActive);
      row.playBtn.classList.toggle('is-visible', Boolean(submitted) && r !== revealingRow);
      row.tiles.forEach((tile, s) => {
        setTile(tile, s, degrees[s], showMarks ? submitted.result[s] : null);
        tile.classList.toggle('cursor', isActive && s === degrees.length);
      });
    });
  }

  function setTile(tile, slot, degree, state) {
    const chord = degree ? chordAt(degree) : null;
    tile.firstChild.textContent = chord ? chord.numeral : '';
    tile.lastChild.textContent = chord ? chord.name : '';
    tile.classList.toggle('filled', Boolean(chord));
    markTile(tile, slot, chord, state);
  }

  function markTile(tile, slot, chord, state) {
    if (state) tile.dataset.state = state;
    else delete tile.dataset.state;
    const what = chord ? `${chord.numeral} (${chord.name})` : 'empty';
    tile.setAttribute('aria-label', `Bar ${slot + 1}: ${what}${state ? ', ' + TILE_WORDS[state] : ''}`);
  }

  function renderKeypad() {
    const states = L.keyStates(round.guesses.filter((_, i) => i !== revealingRow));
    keys.forEach((btn, degree) => {
      const chord = chordAt(degree);
      const state = states[degree];
      if (state) btn.dataset.state = state;
      else delete btn.dataset.state;
      btn.setAttribute('aria-label', `${chord.numeral}, ${chord.name}${state ? ', ' + KEY_WORDS[state] : ''}`);
    });
    ui.keypad.hidden = round.status !== 'playing';
  }

  function renderTransport() {
    const kind = activePlay && activePlay.kind;
    const playingAnswer = kind === 'answer';
    ui.play.classList.toggle('is-playing', playingAnswer);
    ui.play.setAttribute('aria-pressed', String(playingAnswer));
    ui.playIcon.innerHTML = playingAnswer ? STOP_ICON : PLAY_ICON;
    ui.playLabel.textContent = playingAnswer ? 'Stop' : hasPlayed ? 'Play again' : 'Play progression';
    ui.play.classList.toggle('nudge', !hasPlayed && round.status === 'playing');
    ui.tonic.classList.toggle('is-playing', kind === 'tonic');
    rows.forEach((row, r) => {
      const on = kind === 'row' && activePlay.row === r;
      row.playBtn.innerHTML = on ? STOP_ICON : PLAY_ICON;
      row.playBtn.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} guess ${r + 1}`);
    });
  }

  function renderStats() {
    ui.stat.played.textContent = stats.played;
    ui.stat.winRate.textContent = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
    ui.stat.streak.textContent = stats.streak;
    ui.stat.best.textContent = stats.best;
  }

  function renderResult() {
    const finished = round.status !== 'playing';
    ui.result.hidden = !finished;
    if (!finished) return;

    const won = round.status === 'won';
    const n = round.guesses.length;
    ui.resultTitle.textContent = won ? WIN_TITLES[n - 1] : 'Out of guesses';
    ui.resultSub.textContent = won
      ? `You named it in ${n} of ${MAX_GUESSES} guesses.`
      : 'This is the progression you heard.';

    ui.answer.innerHTML = '';
    answerMeasures = round.answer.map((degree, i) => {
      const chord = chordAt(degree);
      const measure = document.createElement('div');
      measure.className = 'measure';
      const tile = document.createElement('div');
      tile.className = 'tile filled ' + (won ? '' : 'is-answer');
      tile.setAttribute('role', 'img');
      tile.innerHTML = `<span class="numeral">${chord.numeral}</span><span class="name">${chord.name}</span>`;
      if (won) tile.dataset.state = 'correct';
      tile.setAttribute('aria-label', `Bar ${i + 1}: ${chord.numeral} (${chord.name}), notes ${chord.notes.join(' ')}`);
      const notes = document.createElement('span');
      notes.className = 'notes';
      notes.textContent = chord.notes.join(' ');
      notes.setAttribute('aria-hidden', 'true');
      measure.append(tile, notes);
      ui.answer.appendChild(measure);
      return measure;
    });
  }

  function defaultStatus() {
    if (round.status !== 'playing') return 'Play it again, or move on to the next progression.';
    if (!hasPlayed) return 'Press Play to hear this round’s four chords.';
    return `Guess ${round.guesses.length + 1} of ${MAX_GUESSES}. Enter a chord for each bar.`;
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

  function enter(degree) {
    if (!typing() || round.current.length >= SLOTS) return;
    round.current.push(degree);
    renderBoard();
    animate(rows[round.guesses.length].tiles[round.current.length - 1], 'pop');
  }

  function erase() {
    if (!typing() || round.current.length === 0) return;
    round.current.pop();
    renderBoard();
  }

  function submit() {
    if (!typing()) return;
    const r = round.guesses.length;
    if (round.current.length < SLOTS) {
      animate(rows[r].bars, 'shake');
      flash(`Fill all ${SLOTS} bars before you submit.`);
      return;
    }

    const degrees = round.current.slice();
    const result = L.scoreGuess(degrees, round.answer);
    round.guesses.push({ degrees, result });
    round.current = [];
    revealing = true;
    revealingRow = r;
    renderBoard();

    reveal(r, degrees, result).then(() => {
      revealing = false;
      revealingRow = -1;
      const won = L.isSolved(result);
      if (won) round.status = 'won';
      else if (round.guesses.length >= MAX_GUESSES) round.status = 'lost';

      ui.announce.textContent = `Guess ${r + 1}: ` + degrees
        .map((d, i) => `${chordAt(d).numeral} ${TILE_WORDS[result[i]]}`)
        .join(', ') + '.';

      if (round.status !== 'playing') recordResult(won, round.guesses.length);
      renderAll();
      if (won) celebrate(r);
    });
  }

  function reveal(r, degrees, result) {
    const tiles = rows[r].tiles;
    const mark = (s) => markTile(tiles[s], s, chordAt(degrees[s]), result[s]);
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
      }, (SLOTS - 1) * STEP + FLIP + 30);
    });
  }

  function celebrate(r) {
    if (reduceMotion()) return;
    rows[r].tiles.forEach((tile, s) => {
      tile.style.animationDelay = `${s * 90}ms`;
      animate(tile, 'hop', () => { tile.style.animationDelay = ''; });
    });
  }

  function animate(el, className, done) {
    if (reduceMotion()) return;
    el.classList.remove(className);
    void el.offsetWidth; // restart the animation if it is already applied
    el.classList.add(className);
    el.addEventListener('animationend', function end(e) {
      if (e.target !== el) return; // ignore animations of child elements
      el.classList.remove(className);
      el.removeEventListener('animationend', end);
      if (done) done();
    });
  }

  // ---- Playback ----------------------------------------------------------------

  function startPlayback(kind, degrees, { row, chordSeconds = CHORD_SECONDS } = {}) {
    const token = { kind, row };
    activePlay = token;
    clearHighlights();
    renderTransport();
    player.playSequence(degrees.map(chordAt), {
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
    const first = !hasPlayed;
    hasPlayed = true;
    startPlayback('answer', round.answer);
    if (first && round.status === 'playing') setStatus();
  }

  function toggleRow(r) {
    if (r >= round.guesses.length || r === revealingRow) return;
    if (activePlay && activePlay.kind === 'row' && activePlay.row === r) return stopPlayback();
    startPlayback('row', round.guesses[r].degrees, { row: r });
  }

  function playTonic() {
    startPlayback('tonic', [1], { chordSeconds: 1.8 });
  }

  function highlight(play, i) {
    clearHighlights();
    if (play.kind === 'tonic') return;
    ui.beats[i].classList.add('on');
    if (play.kind === 'row') rows[play.row].tiles[i].classList.add('sounding');
    if (play.kind === 'answer' && !ui.result.hidden && answerMeasures[i]) {
      answerMeasures[i].firstChild.classList.add('sounding');
    }
  }

  function clearHighlights() {
    ui.beats.forEach((b) => b.classList.remove('on'));
    document.querySelectorAll('.sounding').forEach((el) => el.classList.remove('sounding'));
  }

  // ---- Rounds and stats -----------------------------------------------------------

  function newRound() {
    stopPlayback();
    const previous = round && round.answer.join();
    let answer;
    do {
      answer = L.randomProgression({ poolSize: CHORDS.length, allowAdjacentRepeats: ALLOW_BACK_TO_BACK });
    } while (answer.join() === previous);
    round = { answer, guesses: [], current: [], status: 'playing' };
    revealing = false;
    revealingRow = -1;
    hasPlayed = false;
    ui.announce.textContent = '';
    renderAll();
  }

  function nextRound() {
    if (round.status === 'playing' || revealing) return;
    newRound();
    toggleAnswer(); // the click or key press counts as the gesture that allows audio
  }

  function loadStats() {
    const base = { played: 0, won: 0, streak: 0, best: 0, dist: [0, 0, 0, 0] };
    try {
      const saved = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
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

  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* not persisted */ }
  }

  function recordResult(won, guessCount) {
    stats.played += 1;
    if (won) {
      stats.won += 1;
      stats.streak += 1;
      stats.best = Math.max(stats.best, stats.streak);
      stats.dist[guessCount - 1] += 1;
    } else {
      stats.streak = 0;
    }
    saveStats();
  }

  // Accept a round saved by a live-update snapshot only if it is well formed.
  function restoreRound(saved) {
    const isDegree = (d) => Number.isInteger(d) && d >= 1 && d <= CHORDS.length;
    if (!saved || !Array.isArray(saved.answer) || saved.answer.length !== SLOTS || !saved.answer.every(isDegree)) return null;
    const guesses = Array.isArray(saved.guesses) ? saved.guesses.slice(0, MAX_GUESSES) : [];
    if (!guesses.every((g) => g && Array.isArray(g.degrees) && g.degrees.length === SLOTS && g.degrees.every(isDegree))) return null;
    const current = Array.isArray(saved.current) ? saved.current.filter(isDegree).slice(0, SLOTS) : [];
    const scored = guesses.map((g) => ({ degrees: g.degrees.slice(), result: L.scoreGuess(g.degrees, saved.answer) }));
    const last = scored[scored.length - 1];
    const status = last && L.isSolved(last.result) ? 'won' : scored.length >= MAX_GUESSES ? 'lost' : 'playing';
    return { answer: saved.answer.slice(), guesses: scored, current, status };
  }

  // ---- Events --------------------------------------------------------------------

  function bindEvents() {
    ui.play.addEventListener('click', toggleAnswer);
    ui.tonic.addEventListener('click', playTonic);
    ui.next.addEventListener('click', nextRound);

    // Mouse clicks shouldn't leave focus on a button, or a later Enter would press it again.
    document.addEventListener('mousedown', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target instanceof Element && e.target.closest('button, summary, a, input, select, textarea');
      const k = e.key;

      if (/^[1-9]$/.test(k)) {
        const degree = Number(k);
        if (degree <= CHORDS.length) {
          e.preventDefault();
          enter(degree);
        }
      } else if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        erase();
      } else if (k === 'Enter') {
        if (onControl || e.repeat) return; // let a focused button handle its own Enter
        e.preventDefault();
        if (round.status === 'playing') submit();
        else nextRound();
      } else if (k === ' ' || k === 'Spacebar') {
        if (onControl || e.repeat) return;
        e.preventDefault();
        toggleAnswer();
      } else if (k === 't' || k === 'T') {
        e.preventDefault();
        playTonic();
      }
    });
  }

  // ---- Start ------------------------------------------------------------------------

  function start(data) {
    buildBoard();
    buildKeypad();
    bindEvents();
    const restored = restoreRound(data && data.round);
    if (restored) {
      round = restored;
      hasPlayed = true;
      renderAll();
    } else {
      newRound();
    }
  }

  // When the page runs as a claude.ai artifact, keep the round in progress across live updates.
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ round }));
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
