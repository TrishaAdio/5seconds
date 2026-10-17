/** ?debug overlay: FPS, draw calls, triangles, time state and quality. */
export class DebugPanel {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'debug';
    root.appendChild(this.el);
    this._acc = 0;
    this._frames = 0;
    this.fps = 0;
  }

  update(rawDelta, data) {
    this._acc += rawDelta;
    this._frames++;
    if (this._acc < 0.25) return;
    this.fps = this._frames / this._acc;
    this._acc = 0;
    this._frames = 0;
    const t = data.time;
    this.el.textContent =
      `FPS        ${this.fps.toFixed(1)}\n` +
      `draw calls ${data.calls}\n` +
      `triangles  ${data.triangles.toLocaleString()}\n` +
      `state      ${t.state}\n` +
      `timeScale  ${t.timeScale.toFixed(4)}\n` +
      `worldTime  ${t.worldTime.toFixed(3)}\n` +
      `frozen     ${t.frozenRemaining.toFixed(3)} left · last ${t.lastFrozenDuration.toFixed(3)}s\n` +
      `cooldown   ${t.cooldownRemaining.toFixed(2)}\n` +
      `heroT      ${data.heroT.toFixed(3)}\n` +
      `quality    ${data.quality} (${data.pixelRatio.toFixed(2)}x, ${data.resolution})\n` +
      `drift      ${t.microDrift ? 'on' : 'off'}`;
  }
}
