import { IS_TOUCH } from '../config.js';

/** Title card. The Enter click doubles as the user gesture for audio + pointer lock. */
export class StartScreen {
  constructor(root, onEnter) {
    this.el = document.createElement('div');
    this.el.className = 'start';
    const legend = IS_TOUCH
      ? `
        <div><b>LEFT THUMB</b> MOVE</div><div><b>RIGHT THUMB</b> LOOK</div>
        <div><b>◉ BUTTON</b> STOP TIME</div><div><b>TWO-FINGER TAP</b> STOP TIME</div>
        <div><b>▲ ▼</b> RISE / SINK (FROZEN)</div><div><b>ROTATE</b> LANDSCAPE IS BEST</div>`
      : `
        <div><b>W A S D</b> MOVE</div><div><b>MOUSE</b> LOOK</div>
        <div><b>SPACE</b> STOP TIME</div><div><b>Q / E</b> SINK / RISE (FROZEN)</div>
        <div><b>SHIFT</b> RUN · PRECISION (FROZEN)</div><div><b>RIGHT MOUSE</b> ORBIT THE MOMENT</div>
        <div><b>P</b> PHOTO</div><div><b>H</b> HIDE HUD</div>
        <div><b>M</b> MUTE</div><div><b>X</b> HELD-FREEZE DRIFT</div>`;
    this.el.innerHTML = `
      <div class="eyebrow">A REAL-TIME TIME-STOP EXPERIENCE</div>
      <h1>FIVE SECONDS</h1>
      <div class="tagline">The city never stops. Except for you.</div>
      <button type="button" disabled>Building city…</button>
      <div class="legend">${legend}</div>
      <div class="note">HEADPHONES RECOMMENDED</div>`;
    root.appendChild(this.el);
    this.button = this.el.querySelector('button');
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.button.disabled) return;
      onEnter();
    });
  }

  setReady() {
    this.button.disabled = false;
    this.button.textContent = IS_TOUCH ? 'Tap to Enter' : 'Click to Enter';
    this.button.focus({ preventScroll: true });
  }

  hide() {
    this.el.classList.add('hidden');
    setTimeout(() => {
      this.el.style.display = 'none';
    }, 1500);
  }
}
