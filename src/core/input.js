/**
 * Unified input: keyboard, mouse (+ Pointer Lock) and touch.
 * Continuous state (movement axes, look deltas) is polled each frame;
 * discrete actions (time-stop, photo, HUD...) are dispatched as events.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;

    this.keys = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.rightMouse = false;
    this.leftDrag = false;
    this.locked = false;

    // Touch-driven state, written by TouchControls.
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchLookDX = 0;
    this.touchLookDY = 0;
    this.touchUp = 0;

    this._actionHandlers = [];
    this._bindings = {
      Space: 'timestop',
      KeyP: 'photo',
      KeyH: 'hud',
      KeyM: 'mute',
      KeyX: 'drift',
    };

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat && this._bindings[e.code]) this._dispatch(this._bindings[e.code]);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => {
      this.keys.clear();
      this.rightMouse = false;
      this.leftDrag = false;
    };
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (this.locked || this.leftDrag || this.rightMouse) {
        // Guard against occasional huge spikes reported by some browsers on lock.
        const mx = Math.abs(e.movementX) > 300 ? 0 : e.movementX;
        const my = Math.abs(e.movementY) > 300 ? 0 : e.movementY;
        this.lookDX += mx;
        this.lookDY += my;
      }
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 2) this.rightMouse = true;
      if (e.button === 0) {
        if (!this.locked && this.wantsLock) this.requestLock();
        this.leftDrag = !this.locked;
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 2) this.rightMouse = false;
      if (e.button === 0) this.leftDrag = false;
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
    };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: true });
    canvas.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);

    this.wantsLock = false;
  }

  onAction(fn) {
    this._actionHandlers.push(fn);
  }

  _dispatch(action) {
    for (let i = 0; i < this._actionHandlers.length; i++) this._actionHandlers[i](action);
  }

  /** Trigger an action from UI (buttons, gestures). */
  fire(action) {
    if (this.enabled) this._dispatch(action);
  }

  requestLock() {
    this.wantsLock = true;
    if (!this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock unavailable (iframe / unsupported) — drag-look fallback works */
    }
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** Forward/back axis in [-1,1]. */
  get moveForward() {
    let v = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v -= 1;
    return Math.max(-1, Math.min(1, v + this.touchMoveY));
  }

  /** Strafe axis in [-1,1]. */
  get moveRight() {
    let v = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v -= 1;
    return Math.max(-1, Math.min(1, v + this.touchMoveX));
  }

  /** Vertical (fly) axis in [-1,1]. */
  get moveUp() {
    let v = 0;
    if (this.keys.has('KeyE')) v += 1;
    if (this.keys.has('KeyQ')) v -= 1;
    return Math.max(-1, Math.min(1, v + this.touchUp));
  }

  get modifier() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Returns and clears accumulated look deltas (mouse pixels). */
  consumeLook(out) {
    out.x = this.lookDX;
    out.y = this.lookDY;
    out.tx = this.touchLookDX;
    out.ty = this.touchLookDY;
    this.lookDX = this.lookDY = 0;
    this.touchLookDX = this.touchLookDY = 0;
    return out;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
