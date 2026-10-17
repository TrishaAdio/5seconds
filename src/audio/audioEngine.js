import { CONFIG } from '../config.js';

/**
 * Procedural sound design — no audio files.
 *
 * Graph:
 *   [rain][traffic][drone][crackle][explosions] -> worldBus -> worldFilter (LPF) -> master
 *   [whoomp][swell][whoosh][impact]             -> fxBus ----------------------> master
 *   [heartbeat][ringing][ticks]                 -> frozenBus ------------------> master
 *   fxBus/worldBus sends                        -> convolver reverb -----------> master
 *   master -> compressor -> mute -> destination
 *
 * The world bus is what "stops": on freeze its low-pass sweeps to ~300 Hz,
 * gain drops and looped sources pitch down; on resume the filter snaps open.
 * Ticks and heartbeats are scheduled on the AudioContext clock at the
 * instant FROZEN begins, so the 5 ticks line up sample-accurately with the
 * 5.0 second freeze.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._scheduled = [];
    this._crackleTimer = 0;
  }

  /** Must be called from a user gesture (autoplay policy). */
  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(ctx.destination);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;
    this.comp.connect(this.out);
    this.master = ctx.createGain();
    this.master.gain.value = CONFIG.audio.master;
    this.master.connect(this.comp);

    this.worldFilter = ctx.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldFilter.frequency.value = CONFIG.audio.openCutoff;
    this.worldFilter.Q.value = 0.9;
    this.worldFilter.connect(this.master);
    this.worldBus = ctx.createGain();
    this.worldBus.connect(this.worldFilter);

    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    this.frozenBus = ctx.createGain();
    this.frozenBus.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.fxSend = ctx.createGain();
    this.fxSend.gain.value = 0.6;
    this.fxBus.connect(this.fxSend);
    this.fxSend.connect(this.reverb);
    this.worldSend = ctx.createGain();
    this.worldSend.gain.value = 0.12;
    this.worldFilter.connect(this.worldSend);
    this.worldSend.connect(this.reverb);

    this.white = this._noise('white', 3);
    this.pink = this._noise('pink', 5);
    this.brown = this._noise('brown', 5);

    this._startAmbience();
    this.ready = true;
    this.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(m ? 0 : 1, t, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ------------------------------------------------------------ utilities
  _noise(kind, seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      // crossfade the loop seam
      const fade = Math.min(2048, len / 4);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
      }
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _src(buffer, loop = false, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = rate;
    return s;
  }

  _gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Chains nodes and returns the first. */
  _chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[0];
  }

  /** Disconnects a one-shot graph when its source ends. */
  _autoclean(src, ...nodes) {
    src.onended = () => {
      src.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
  }

  _track(node) {
    this._scheduled.push(node);
    if (this._scheduled.length > 64) this._scheduled.splice(0, this._scheduled.length - 64);
    return node;
  }

  _cancelScheduled() {
    const t = this.ctx.currentTime;
    for (const n of this._scheduled) {
      try {
        n.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this._scheduled.length = 0;
  }

  // ------------------------------------------------------------- ambience
  _startAmbience() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.loops = [];

    // rain: pink noise, band-limited, plus a brighter close-drops layer
    const rain = this._src(this.pink, true);
    const rainHP = this._filter('highpass', 450);
    const rainLP = this._filter('lowpass', 7500);
    const rainG = this._gain(0);
    rainG.gain.setTargetAtTime(0.55, t, 1.5);
    this._chain(rain, rainHP, rainLP, rainG, this.worldBus);
    rain.start(t);
    this.loops.push(rain);

    const drops = this._src(this.white, true, 1);
    const dropsBP = this._filter('bandpass', 3400, 0.5);
    const dropsG = this._gain(0);
    dropsG.gain.setTargetAtTime(0.06, t, 2);
    this._chain(drops, dropsBP, dropsG, this.worldBus);
    drops.start(t, 0.7);
    this.loops.push(drops);

    // distant traffic hum with slow swell
    const traffic = this._src(this.brown, true);
    const trLP = this._filter('lowpass', 190);
    const trG = this._gain(0.0);
    trG.gain.setTargetAtTime(0.32, t, 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = this._gain(0.12);
    lfo.connect(lfoG);
    lfoG.connect(trG.gain);
    lfo.start(t);
    this._chain(traffic, trLP, trG, this.worldBus);
    traffic.start(t, 1.3);
    this.loops.push(traffic);

    // low city drone
    this.droneOscs = [];
    const droneLP = this._filter('lowpass', 240, 1.2);
    const droneG = this._gain(0);
    droneG.gain.setTargetAtTime(0.05, t, 3);
    droneLP.connect(droneG);
    droneG.connect(this.worldBus);
    for (const [type, f, det] of [['sawtooth', 55, 0], ['sawtooth', 55, 7], ['sine', 41.2, 0], ['triangle', 82.4, -5]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(droneLP);
      o.start(t);
      this.droneOscs.push(o);
    }

    // fire roar near the wreck (gain driven by distance in update)
    const roar = this._src(this.brown, true, 1.0);
    const roarBP = this._filter('bandpass', 420, 0.6);
    this.roarG = this._gain(0);
    this._chain(roar, roarBP, this.roarG, this.worldBus);
    roar.start(t, 2.1);
    this.loops.push(roar);
  }

  /** Per-frame: proximity-based fire roar + random crackles (world-time paced). */
  update(time, cameraPos, heroPos) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const d = cameraPos.distanceTo(heroPos);
    const prox = 1 / (1 + d * 0.18);
    this.roarG.gain.setTargetAtTime(0.5 * prox, ctx.currentTime, 0.1);

    // crackles only advance with WORLD time: they cease when time stops
    this._crackleTimer -= time.worldDelta;
    if (this._crackleTimer <= 0 && time.timeScale > 0.2) {
      this._crackleTimer = 0.04 + Math.random() * 0.18;
      this._crackle(prox);
    }
  }

  _crackle(prox) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const s = this._src(this.white, false, 0.8 + Math.random() * 0.8);
    const f = this._filter('bandpass', 1200 + Math.random() * 3500, 2.5);
    const g = this._gain(0);
    const a = (0.08 + Math.random() * 0.25) * prox;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
    this._chain(s, f, g, this.worldBus);
    s.start(t, Math.random() * 2);
    s.stop(t + 0.12);
    this._autoclean(s, f, g);
  }

  // ------------------------------------------------------------ one-shots
  explosion(distance, synced) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const att = 1 / (1 + distance * 0.05);
    const vol = (synced ? 0.7 : 1) * att;

    // body: brown noise through a closing low-pass
    const n = this._src(this.brown, false, 0.7);
    const lp = this._filter('lowpass', 1800, 0.8);
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.6 * vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
    this._chain(n, lp, g, this.worldBus);
    n.start(t, Math.random());
    n.stop(t + 3.1);
    this._autoclean(n, lp, g);

    // sub thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const og = this._gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(1.1 * vol, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    this._chain(o, og, this.worldBus);
    o.start(t);
    o.stop(t + 1.7);
    this._autoclean(o, og);

    // glass shower
    const gl = this._src(this.white, false, 1.4);
    const hp = this._filter('highpass', 5000);
    const gg = this._gain(0);
    gg.gain.setValueAtTime(0, t + 0.05);
    gg.gain.linearRampToValueAtTime(0.25 * vol, t + 0.12);
    gg.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    this._chain(gl, hp, gg, this.worldBus);
    gl.start(t + 0.05, Math.random());
    gl.stop(t + 1.9);
    this._autoclean(gl, hp, gg);
  }

  /** FREEZING begins. */
  freeze() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const A = CONFIG.audio;
    const t = ctx.currentTime;
    const dur = CONFIG.time.freezeInDuration;

    // deep "whoomp" sub drop
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.0);
    const og = this._gain(0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(1.2, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    this._chain(o, og, this.fxBus);
    o.start(t);
    o.stop(t + 1.6);
    this._autoclean(o, og);

    const thump = this._src(this.brown, false, 0.5);
    const tlp = this._filter('lowpass', 260);
    const tg = this._gain(0);
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(1.0, t + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    this._chain(thump, tlp, tg, this.fxBus);
    thump.start(t);
    thump.stop(t + 0.6);
    this._autoclean(thump, tlp, tg);

    // reverse-cymbal swell that is sucked into the freeze
    const sw = this._src(this.white, false, 1);
    const shp = this._filter('highpass', 4500);
    const sbp = this._filter('peaking', 8000, 1);
    sbp.gain.value = 6;
    const sg = this._gain(0);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.92);
    sg.gain.linearRampToValueAtTime(0.0, t + dur + 0.03);
    this._chain(sw, shp, sbp, sg, this.fxBus);
    sw.start(t, Math.random());
    sw.stop(t + dur + 0.1);
    this._autoclean(sw, shp, sbp, sg);

    // world bus: low-pass closes, volume dips, everything pitches down
    const wf = this.worldFilter.frequency;
    wf.cancelScheduledValues(t);
    wf.setValueAtTime(Math.max(wf.value, 400), t);
    wf.exponentialRampToValueAtTime(A.frozenCutoff, t + dur);
    this.worldBus.gain.cancelScheduledValues(t);
    this.worldBus.gain.setValueAtTime(this.worldBus.gain.value, t);
    this.worldBus.gain.linearRampToValueAtTime(A.frozenWorldGain, t + dur);
    for (const s of this.loops) {
      s.playbackRate.cancelScheduledValues(t);
      s.playbackRate.setValueAtTime(s.playbackRate.value, t);
      s.playbackRate.exponentialRampToValueAtTime(0.45, t + dur);
    }
    for (const d of this.droneOscs) {
      d.detune.cancelScheduledValues(t);
      d.detune.setValueAtTime(d.detune.value, t);
      d.detune.linearRampToValueAtTime(-1200, t + dur * 1.4);
    }

    // faint high ringing (tinnitus) with slow beating
    this.ring = [];
    this.ringG = this._gain(0);
    this.ringG.gain.setValueAtTime(0, t);
    this.ringG.gain.linearRampToValueAtTime(0.018, t + 1.4);
    this.ringG.connect(this.frozenBus);
    for (const f of [3520, 3526.5]) {
      const r = ctx.createOscillator();
      r.type = 'sine';
      r.frequency.value = f;
      r.connect(this.ringG);
      r.start(t);
      this.ring.push(r);
    }
  }

  /** FROZEN begins: schedule exactly five ticks and five heartbeats. */
  frozen() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const secs = Math.round(CONFIG.time.freezeDuration);
    for (let i = 0; i < secs; i++) {
      this._tick(t0 + i, i, secs);
      this._heartbeat(t0 + i + 0.18, i === secs - 1 ? 1.25 : 1);
    }
  }

  _tick(t, i, n) {
    const ctx = this.ctx;
    const pitch = 1 + (i / n) * 0.18; // tension rises with every second
    const o = this._track(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.setValueAtTime(2100 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(900 * pitch, t + 0.03);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    this._chain(o, g, this.frozenBus);
    o.start(t);
    o.stop(t + 0.09);
    this._autoclean(o, g);

    const c = this._track(this._src(this.white, false, 1));
    const bp = this._filter('bandpass', 5200 * pitch, 6);
    const cg = this._gain(0);
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.5, t + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0008, t + 0.025);
    this._chain(c, bp, cg, this.frozenBus);
    c.start(t, Math.random());
    c.stop(t + 0.04);
    this._autoclean(c, bp, cg);
  }

  _heartbeat(t, strength) {
    const ctx = this.ctx;
    for (const [offset, f, a] of [[0, 62, 0.85], [0.26, 50, 0.55]]) {
      const o = this._track(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.4, t + offset);
      o.frequency.exponentialRampToValueAtTime(f, t + offset + 0.06);
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + offset);
      g.gain.linearRampToValueAtTime(a * strength, t + offset + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.22);
      const lp = this._filter('lowpass', 160);
      this._chain(o, lp, g, this.frozenBus);
      o.start(t + offset);
      o.stop(t + offset + 0.25);
      this._autoclean(o, lp, g);
    }
  }

  /** RESUMING begins: reversed whoosh -> filter snap -> impact. */
  resume() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const A = CONFIG.audio;
    const t = ctx.currentTime;
    const dur = CONFIG.time.resumeDuration;
    const hit = t + dur;
    this._cancelScheduled();

    // reversed whoosh: rising, sweeping noise that cuts dead at the hit
    const w = this._src(this.pink, false, 1);
    const bp = this._filter('bandpass', 300, 1.2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, hit);
    const wg = this._gain(0);
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.9, hit - 0.01);
    wg.gain.linearRampToValueAtTime(0, hit + 0.015);
    this._chain(w, bp, wg, this.fxBus);
    w.start(t, Math.random());
    w.stop(hit + 0.05);
    this._autoclean(w, bp, wg);

    // ring fades
    if (this.ringG) {
      this.ringG.gain.cancelScheduledValues(t);
      this.ringG.gain.setValueAtTime(this.ringG.gain.value, t);
      this.ringG.gain.linearRampToValueAtTime(0, hit);
      const ringNodes = this.ring;
      const ringG = this.ringG;
      ringNodes.forEach((r) => r.stop(hit + 0.05));
      ringNodes[0].onended = () => {
        ringNodes.forEach((r) => r.disconnect());
        ringG.disconnect();
      };
      this.ringG = null;
    }

    // filter snaps open, world floods back
    const wf = this.worldFilter.frequency;
    wf.cancelScheduledValues(t);
    wf.setValueAtTime(Math.max(60, wf.value), t);
    wf.setValueAtTime(Math.max(60, wf.value), hit - 0.04);
    wf.exponentialRampToValueAtTime(A.openCutoff, hit + 0.08);
    this.worldBus.gain.cancelScheduledValues(t);
    this.worldBus.gain.setValueAtTime(this.worldBus.gain.value, t);
    this.worldBus.gain.setValueAtTime(this.worldBus.gain.value, hit - 0.02);
    this.worldBus.gain.linearRampToValueAtTime(1.15, hit + 0.04);
    this.worldBus.gain.setTargetAtTime(1.0, hit + 0.1, 0.4);
    for (const s of this.loops) {
      s.playbackRate.cancelScheduledValues(t);
      s.playbackRate.setValueAtTime(Math.max(0.1, s.playbackRate.value), t);
      s.playbackRate.exponentialRampToValueAtTime(1.0, hit + 0.06);
    }
    for (const d of this.droneOscs) {
      d.detune.cancelScheduledValues(t);
      d.detune.setValueAtTime(d.detune.value, t);
      d.detune.linearRampToValueAtTime(0, hit + 0.05);
    }

    // IMPACT: sub boom + crack + saturated body
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, hit);
    o.frequency.exponentialRampToValueAtTime(32, hit + 0.7);
    const og = this._gain(0);
    og.gain.setValueAtTime(0, hit);
    og.gain.linearRampToValueAtTime(1.4, hit + 0.006);
    og.gain.exponentialRampToValueAtTime(0.001, hit + 1.3);
    this._chain(o, og, this.fxBus);
    o.start(hit);
    o.stop(hit + 1.4);
    this._autoclean(o, og);

    const cr = this._src(this.white, false, 1);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._distCurve(30);
    const clp = this._filter('lowpass', 5000);
    clp.frequency.setValueAtTime(7000, hit);
    clp.frequency.exponentialRampToValueAtTime(400, hit + 0.6);
    const cg = this._gain(0);
    cg.gain.setValueAtTime(0, hit);
    cg.gain.linearRampToValueAtTime(0.6, hit + 0.003);
    cg.gain.exponentialRampToValueAtTime(0.001, hit + 0.9);
    this._chain(cr, shaper, clp, cg, this.fxBus);
    cr.start(hit, Math.random());
    cr.stop(hit + 1.0);
    this._autoclean(cr, shaper, clp, cg);
  }

  _distCurve(k) {
    if (this._curve) return this._curve;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    this._curve = curve;
    return curve;
  }

  /** Small UI blip when the power is ready again. */
  readyPing() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.07]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this._gain(0);
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.05, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + d + 0.35);
      this._chain(o, g, this.fxBus);
      o.start(t + d);
      o.stop(t + d + 0.4);
      this._autoclean(o, g);
    }
  }

  /** Hook into the time system. */
  bind(time) {
    time.on('freeze', () => this.freeze());
    time.on('frozen', () => this.frozen());
    time.on('resume', () => this.resume());
    time.on('ready', () => this.readyPing());
  }

  dispose() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}
