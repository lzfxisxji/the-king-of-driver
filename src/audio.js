/* ============================================================
   音频引擎：纯 WebAudio 程序化合成（不需要任何音频素材文件）
   - 引擎循环音（随速度变调）
   - 一次性音效（捡道具 / 用道具 / 打滑 / 撞击 / 墨水 / 闪电 / 导弹 / 护盾 / 盾挡 / 倒计时 / GO / 完赛）
   - 轻量 BGM 循环（柔和琶音 + 贝斯）
   所有声音经 master 增益路由，静音 = master.gain 置 0。
   AudioContext 必须由用户手势后创建/恢复（浏览器自动播放策略）。
   ============================================================ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engine = null;        // { o, f, g }
    this.bgmOn = false;
    this._bgmStep = 0;
    this._bgmNext = 0;
    this._bgmTimer = null;
    this.vol = 0.5;
  }

  /* 必须在用户手势里调用一次（点击/按键即手势） */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : this.vol, this.ctx.currentTime, 0.02);
    }
  }

  /* ---------------- 基础发声 ---------------- */
  blip(freq, dur = 0.12, type = 'square', vol = 0.25, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noise(dur = 0.2, vol = 0.3, filterFreq = 800, type = 'lowpass') {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /* ---------------- 引擎循环音 ---------------- */
  startEngine() {
    if (!this.ctx || this.engine) return;
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 70;
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 6;
    g.gain.value = 0.0001;
    o.connect(f).connect(g).connect(this.master);
    o.start();
    this.engine = { o, f, g };
  }

  updateEngine(norm, boosting) {
    if (!this.engine || !this.ctx) return;
    const n = Math.min(1, Math.max(0, norm));
    const freq = 60 + n * 150 + (boosting ? 60 : 0);
    const g = 0.05 + n * 0.06 + (boosting ? 0.03 : 0);
    const now = this.ctx.currentTime;
    this.engine.o.frequency.setTargetAtTime(freq, now, 0.05);
    this.engine.f.frequency.setTargetAtTime(500 + n * 900 + (boosting ? 400 : 0), now, 0.05);
    this.engine.g.gain.setTargetAtTime(g, now, 0.08);
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    this.engine = null;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      e.g.gain.setTargetAtTime(0.0001, now, 0.05);
      e.o.stop(now + 0.25);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- BGM（柔和循环） ---------------- */
  startBgm() {
    if (!this.ctx || this.bgmOn) return;
    this.bgmOn = true;
    this._bgmStep = 0;
    this._bgmNext = this.ctx.currentTime + 0.08;
    const bpm = 112;
    const stepDur = 60 / bpm / 2;            // 8 分音符
    // C3 / F3 / G3 / D3 每两拍切换（I - IV - V - V 进行）
    const bassSeq = [130.81, 174.61, 196.00, 146.83];
    const arp = [523.25, 659.25, 783.99, 659.25];
    const schedule = () => {
      if (!this.bgmOn || !this.ctx) return;
      while (this._bgmNext < this.ctx.currentTime + 0.2) {
        const s = this._bgmStep % 16;
        const t = this._bgmNext;
        if (s % 2 === 0) {
          const bf = bassSeq[((s / 2) | 0) % bassSeq.length];
          this._tone(bf, t, stepDur * 1.8, 'triangle', 0.10);
        }
        const af = arp[s % arp.length] * (s % 8 < 4 ? 1 : 0.5);
        this._tone(af, t, stepDur * 0.9, 'sine', 0.045);
        this._bgmStep++;
        this._bgmNext += stepDur;
      }
      this._bgmTimer = setTimeout(schedule, 50);
    };
    schedule();
  }

  stopBgm() {
    this.bgmOn = false;
    if (this._bgmTimer) { clearTimeout(this._bgmTimer); this._bgmTimer = null; }
  }

  _tone(freq, t0, dur, type, vol) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  /* ---------------- 事件音效映射 ---------------- */
  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'pickup':   this.blip(660, 0.10, 'square', 0.25); this.blip(990, 0.10, 'square', 0.18, 0.06); break;
      case 'potion':   this.blip(523, 0.12, 'triangle', 0.22); this.blip(784, 0.16, 'triangle', 0.18, 0.08); break;
      case 'use':      this.blip(440, 0.12, 'sawtooth', 0.20); break;
      case 'spin':     this.noise(0.30, 0.25, 500); break;
      case 'hit':      this.noise(0.25, 0.30, 300); this.blip(180, 0.20, 'square', 0.20); break;
      case 'lap':      this.blip(700, 0.10, 'triangle', 0.20); this.blip(1050, 0.12, 'triangle', 0.18, 0.08); break;
      case 'finish':   this.blip(523, 0.14, 'triangle', 0.25); this.blip(659, 0.14, 'triangle', 0.25, 0.12); this.blip(784, 0.22, 'triangle', 0.25, 0.24); break;
      case 'go':       this.blip(880, 0.35, 'square', 0.30); break;
      case 'cd3': case 'cd2': case 'cd1': {
        const f = name === 'cd3' ? 440 : name === 'cd2' ? 550 : 660;
        this.blip(f, 0.18, 'square', 0.25);
        break;
      }
      case 'wall':     this.noise(0.12, 0.18, 400); break;
      case 'bump':     this.blip(160, 0.10, 'square', 0.18); break;
      case 'boost':    this.blip(300, 0.18, 'sawtooth', 0.16); this.blip(600, 0.18, 'sawtooth', 0.12, 0.04); break;
      case 'banana':   this.blip(330, 0.12, 'square', 0.20); break;
      case 'ink':      this.blip(300, 0.20, 'sine', 0.20); this.blip(200, 0.25, 'sine', 0.15, 0.05); break;
      case 'bolt':     this.blip(1200, 0.30, 'sawtooth', 0.22); this.noise(0.20, 0.15, 1200); break;
      case 'missile':  this.blip(200, 0.30, 'sawtooth', 0.20); this.blip(900, 0.30, 'sawtooth', 0.14, 0.10); break;
      case 'shield':   this.blip(520, 0.16, 'triangle', 0.20); this.blip(780, 0.20, 'triangle', 0.18, 0.08); this.blip(1040, 0.22, 'triangle', 0.16, 0.16); break;
      case 'shieldblock': this.noise(0.20, 0.25, 900); this.blip(700, 0.12, 'square', 0.15); break;
      default: break;
    }
  }
}
