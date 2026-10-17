import { CONFIG, IS_TOUCH } from '../config.js';
import { TimeState } from '../core/timeSystem.js';

const RADIUS = 58;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * Minimal cinematic HUD. DOM writes are throttled to actual changes so the
 * per-frame cost stays negligible.
 */
export class Hud {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      const x1 = 66 + Math.cos(a) * (RADIUS + 5);
      const y1 = 66 + Math.sin(a) * (RADIUS + 5);
      const x2 = 66 + Math.cos(a) * (RADIUS + 10);
      const y2 = 66 + Math.sin(a) * (RADIUS + 10);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }).join('');
    const key = IS_TOUCH ? 'TAP ◉' : 'SPACE';
    this.el.innerHTML = `
      <div class="brand">FIVE SECONDS</div>
      <div class="status"></div>
      <div class="crosshair"></div>
      <div class="countdown">
        <svg viewBox="0 0 132 132">
          <circle class="track" cx="66" cy="66" r="${RADIUS}"/>
          <g class="ticks">${ticks}</g>
          <circle class="bar" cx="66" cy="66" r="${RADIUS}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
        </svg>
        <div class="readout"><div class="num">5.00</div><div class="lbl">TIME STOPPED</div></div>
      </div>
      <div class="power">
        <div class="label">TIME STOP</div>
        <div class="state">READY</div>
        <div class="meter"><div class="fill"></div></div>
        <div class="key">${key}</div>
      </div>
      <div class="hint">PRESS <kbd>${IS_TOUCH ? '◉' : 'SPACE'}</kbd> TO STOP TIME</div>
      <div class="lockhint">CLICK TO LOOK AROUND</div>
      <div class="toast"></div>`;
    root.appendChild(this.el);

    this.statusEl = this.el.querySelector('.status');
    this.countdownEl = this.el.querySelector('.countdown');
    this.barEl = this.el.querySelector('.bar');
    this.numEl = this.el.querySelector('.num');
    this.powerEl = this.el.querySelector('.power');
    this.stateEl = this.el.querySelector('.power .state');
    this.fillEl = this.el.querySelector('.fill');
    this.hintEl = this.el.querySelector('.hint');
    this.lockEl = this.el.querySelector('.lockhint');
    this.toastEl = this.el.querySelector('.toast');

    this._lastNum = '';
    this._lastState = '';
    this._lastFill = -1;
    this._toastTimer = 0;
    this.hintShown = false;
    this.hintDone = false;
    this.userHidden = false;
  }

  show() {
    this.el.classList.add('visible');
  }

  toggle() {
    this.userHidden = !this.userHidden;
    this.el.classList.toggle('user-hidden', this.userHidden);
    return !this.userHidden;
  }

  showHint() {
    if (this.hintDone || this.hintShown) return;
    this.hintShown = true;
    this.hintEl.classList.add('on');
  }

  dismissHint() {
    this.hintDone = true;
    this.hintEl.classList.remove('on');
  }

  setLockHint(on) {
    this.lockEl.classList.toggle('on', on);
  }

  toast(text, seconds = 1.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('on'), seconds * 1000);
  }

  setStatus(text) {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  update(time) {
    const s = time.state;
    const frozenUi = s === TimeState.FREEZING || s === TimeState.FROZEN;
    this.countdownEl.classList.toggle('on', frozenUi);

    // countdown ring + decimal readout (driven by the exact real-clock value)
    const remaining = s === TimeState.FROZEN ? time.frozenRemaining : s === TimeState.FREEZING ? CONFIG.time.freezeDuration : 0;
    if (frozenUi) {
      const num = remaining.toFixed(2);
      if (num !== this._lastNum) {
        this._lastNum = num;
        this.numEl.textContent = num;
        this.barEl.setAttribute('stroke-dashoffset', String(CIRC * (1 - remaining / CONFIG.time.freezeDuration)));
        this.countdownEl.classList.toggle('final', remaining < 1);
      }
    }

    // power meter
    let state;
    let fill;
    if (s === TimeState.RUNNING && time.cooldownRemaining <= 0) {
      state = 'READY';
      fill = 1;
    } else if (s === TimeState.RUNNING) {
      state = `RECHARGING ${time.cooldownRemaining.toFixed(1)}`;
      fill = 1 - time.cooldownRemaining / CONFIG.time.cooldown;
    } else {
      state = s === TimeState.RESUMING ? 'RELEASE' : 'ACTIVE';
      fill = s === TimeState.FROZEN ? remaining / CONFIG.time.freezeDuration : s === TimeState.RESUMING ? 0 : 1;
    }
    if (state !== this._lastState) {
      this._lastState = state;
      this.stateEl.textContent = state;
      this.powerEl.classList.toggle('cooling', state.startsWith('RECHARGING') || state === 'RELEASE');
      this.powerEl.classList.toggle('active', state === 'ACTIVE');
    }
    const f = Math.round(fill * 200) / 200;
    if (f !== this._lastFill) {
      this._lastFill = f;
      this.fillEl.style.transform = `scaleX(${f})`;
    }
  }
}
