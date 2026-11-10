/*
 * Four Bars: a small Web Audio synth that plays chord progressions.
 * Each chord is a close-voiced triad (G3 to F#4) over its root in the bass,
 * played with a soft electric-piano tone into a short generated reverb.
 * Exposes window.FourBarsAudio.ChordPlayer.
 */
(function (root) {
  'use strict';

  const L = root.FourBarsLogic;
  const AudioCtor = root.AudioContext || root.webkitAudioContext;

  function makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  class ChordPlayer {
    constructor() {
      this.ctx = null;
      this.session = null;  // gain node for the sequence now playing
      this.timers = [];
      this.finish = null;   // onEnd callback of the sequence now playing
      this.token = 0;
    }

    get supported() {
      return Boolean(AudioCtor);
    }

    init() {
      if (this.ctx || !AudioCtor) return this.ctx;
      // Lets iOS play Web Audio when the ringer switch is on silent (Safari 17+).
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }

      const ctx = new AudioCtor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      compressor.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(compressor);

      const reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(ctx, 2.4, 3.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.26;
      reverb.connect(wet);
      wet.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.reverb = reverb;
      return ctx;
    }

    async unlock() {
      const ctx = this.init();
      if (ctx && ctx.state !== 'running') {
        try { await ctx.resume(); } catch (e) { /* stays suspended */ }
      }
      return ctx;
    }

    /** Stop the current sequence (quick fade) and fire its onEnd callback. */
    stop() {
      this.token++;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      if (this.session && this.ctx) {
        const gain = this.session.gain;
        const now = this.ctx.currentTime;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0, now + 0.06);
        const node = this.session;
        setTimeout(() => node.disconnect(), 250);
      }
      this.session = null;
      this.endSequence();
    }

    endSequence() {
      const done = this.finish;
      this.finish = null;
      if (done) done();
    }

    /**
     * Play chords (objects from FourBarsLogic.diatonicChords) one after another.
     * onStep(i) fires as chord i starts; onEnd() fires when the sequence ends or is stopped.
     * Resolves false if audio is unavailable or a newer call took over.
     */
    async playSequence(chords, { chordSeconds = 1.3, onStep, onEnd } = {}) {
      this.stop();
      const token = this.token;
      const ctx = await this.unlock();
      if (!ctx || token !== this.token) return false;

      const session = ctx.createGain();
      session.connect(this.master);
      session.connect(this.reverb);
      this.session = session;
      this.finish = onEnd || null;

      const t0 = ctx.currentTime + 0.08;
      chords.forEach((chord, i) => {
        const t = t0 + i * chordSeconds;
        this.chord(session, chord, t, chordSeconds * 0.92);
        if (onStep) this.at(t, () => onStep(i));
      });
      this.at(t0 + chords.length * chordSeconds, () => {
        this.session = null;
        this.endSequence();
      });
      return true;
    }

    at(time, fn) {
      const ms = Math.max(0, (time - this.ctx.currentTime) * 1000);
      this.timers.push(setTimeout(fn, ms));
    }

    chord(dest, chord, t, duration) {
      L.voiceChord(chord.pcs).forEach((midi, i) => {
        this.note(dest, midi, t + i * 0.008, duration, 0.15);
      });
      this.note(dest, L.bassNote(chord.rootPc), t, duration, 0.2);
    }

    note(dest, midi, t, duration, velocity) {
      const ctx = this.ctx;
      const freq = L.midiToFreq(midi);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.6;
      filter.frequency.setValueAtTime(Math.min(freq * 8, 6500), t);
      filter.frequency.setTargetAtTime(Math.min(freq * 3, 2600), t, 0.3);

      const env = ctx.createGain();
      const end = t + duration;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(velocity, t + 0.012);
      env.gain.setTargetAtTime(velocity * 0.4, t + 0.012, 0.55);
      env.gain.setTargetAtTime(0.0001, end, 0.12);

      filter.connect(env);
      env.connect(dest);

      const voices = [
        { type: 'triangle', ratio: 1, detune: 0, level: 1 },
        { type: 'sine', ratio: 2, detune: 4, level: 0.18 },
        { type: 'sawtooth', ratio: 1, detune: -6, level: 0.05 },
      ];
      const stopAt = end + 0.9;
      for (const v of voices) {
        const osc = ctx.createOscillator();
        osc.type = v.type;
        osc.frequency.value = freq * v.ratio;
        osc.detune.value = v.detune;
        const level = ctx.createGain();
        level.gain.value = v.level;
        osc.connect(level);
        level.connect(filter);
        osc.start(t);
        osc.stop(stopAt);
      }
    }
  }

  root.FourBarsAudio = { ChordPlayer };
})(typeof window !== 'undefined' ? window : globalThis);
