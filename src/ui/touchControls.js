/**
 * Mobile controls: floating virtual joystick (left), drag-look (right),
 * time-stop button, rise/sink buttons for the frozen fly-cam, and a
 * two-finger tap gesture that also stops time.
 */
export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="joy"><div class="knob"></div></div>
      <button class="tbtn stop" type="button">STOP</button>
      <button class="tbtn small up" type="button">▲</button>
      <button class="tbtn small down" type="button">▼</button>`;
    root.appendChild(this.el);
    this.joy = this.el.querySelector('.joy');
    this.knob = this.el.querySelector('.knob');
    this.stopBtn = this.el.querySelector('.stop');
    this.upBtn = this.el.querySelector('.up');
    this.downBtn = this.el.querySelector('.down');

    this.pointers = new Map();
    this.joyId = null;
    this.taps = [];
    const R = 52;

    const onDown = (e) => {
      if (e.target !== this.el) return;
      e.preventDefault();
      this.el.setPointerCapture?.(e.pointerId);
      const role = e.clientX < window.innerWidth * 0.45 && this.joyId === null ? 'joy' : 'look';
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, role, t: performance.now() };
      this.pointers.set(e.pointerId, p);
      this.taps.push({ id: e.pointerId, t: p.t, moved: false, up: 0 });
      if (this.taps.length > 4) this.taps.shift();
      if (role === 'joy') {
        this.joyId = e.pointerId;
        this.joy.style.left = `${p.x}px`;
        this.joy.style.top = `${p.y}px`;
        this.joy.classList.add('on');
      }
    };
    const onMove = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 18) {
        const tap = this.taps.find((t) => t.id === e.pointerId);
        if (tap) tap.moved = true;
      }
      if (p.role === 'joy') {
        let jx = (p.x - p.sx) / R;
        let jy = (p.y - p.sy) / R;
        const len = Math.hypot(jx, jy);
        if (len > 1) {
          jx /= len;
          jy /= len;
        }
        this.input.touchMoveX = jx;
        this.input.touchMoveY = -jy;
        this.knob.style.transform = `translate(${jx * R}px, ${jy * R}px)`;
      } else {
        this.input.touchLookDX += dx;
        this.input.touchLookDY += dy;
      }
    };
    const onUp = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.role === 'joy') {
        this.joyId = null;
        this.input.touchMoveX = 0;
        this.input.touchMoveY = 0;
        this.knob.style.transform = '';
        this.joy.classList.remove('on');
      }
      const now = performance.now();
      const tap = this.taps.find((t) => t.id === e.pointerId);
      if (tap) tap.up = now;
      // two-finger tap: two quick, stationary touches that overlapped in time
      const recent = this.taps.filter((t) => now - t.t < 450);
      if (recent.length >= 2) {
        const [a, b] = recent.slice(-2);
        if (a.up && b.up && !a.moved && !b.moved && Math.abs(a.t - b.t) < 250) {
          this.taps.length = 0;
          this.input.fire('timestop');
        }
      }
    };
    this.el.addEventListener('pointerdown', onDown);
    this.el.addEventListener('pointermove', onMove);
    this.el.addEventListener('pointerup', onUp);
    this.el.addEventListener('pointercancel', onUp);

    const hold = (btn, value) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.input.touchUp = value;
      });
      const release = () => {
        this.input.touchUp = 0;
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    };
    hold(this.upBtn, 1);
    hold(this.downBtn, -1);
    this.stopBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.input.fire('timestop');
    });
  }

  show() {
    this.el.classList.add('on');
  }

  setStopEnabled(on) {
    this.stopBtn.disabled = !on;
  }

  setFlyButtons(on) {
    this.upBtn.style.display = on ? '' : 'none';
    this.downBtn.style.display = on ? '' : 'none';
  }
}
