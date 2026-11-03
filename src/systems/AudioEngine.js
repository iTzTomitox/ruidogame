// Capas de audio controladas por Ruido. Cada capa se sintetiza con WebAudio
// salvo que config.audio.layers[].file apunte a un loop (entonces usa Phaser Sound).
import { settings } from './settings.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);

const SYNTHS = {
  keyboard: {
    schedule(e, L, t, k) {
      e.click(L.gain, t, 1800 + Math.random() * 2600, 0.02 + Math.random() * 0.015, 0.5 + Math.random() * 0.5);
      if (Math.random() < 0.09 - k * 0.06) return t + 0.4 + Math.random() * 1.4; // pausa
      return t + (0.06 + Math.random() * 0.17) * (1 - k * 0.5);
    },
  },
  clock: {
    schedule(e, L, t) {
      L.tock = !L.tock;
      e.tick(L.gain, t, L.tock ? 1650 : 2100);
      return t + 1;
    },
  },
  drip: {
    schedule(e, L, t, k) {
      e.drop(L.gain, t, 0.6);
      e.drop(L.gain, t + 0.21, 0.15);
      return t + (1.8 + Math.random() * 1.2) * (1 - k * 0.45);
    },
  },
  breath: {
    init(e, L) {
      const src = e.ctx.createBufferSource();
      src.buffer = e.noise;
      src.loop = true;
      L.lp = e.ctx.createBiquadFilter();
      L.lp.type = 'lowpass';
      L.lp.frequency.value = 600;
      L.env = e.ctx.createGain();
      L.env.gain.value = 0;
      src.connect(L.lp).connect(L.env).connect(L.gain);
      src.start();
      L.nodes = [src];
    },
    schedule(e, L, t, k) {
      const s = 1 - k * 0.5;
      const inh = 1.5 * s, exh = 2.0 * s, rest = 0.6 * (1 - k), a = 0.55 + k * 0.45;
      const g = L.env.gain, f = L.lp.frequency;
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(a * 0.7, t + inh * 0.85);
      g.linearRampToValueAtTime(0.03, t + inh + 0.12);
      g.linearRampToValueAtTime(a, t + inh + 0.35);
      g.linearRampToValueAtTime(0.0001, t + inh + exh);
      f.setValueAtTime(900, t);
      f.linearRampToValueAtTime(1100, t + inh);
      f.setValueAtTime(650, t + inh + 0.12);
      f.linearRampToValueAtTime(380, t + inh + exh);
      return t + inh + exh + rest;
    },
  },
  hum: {
    init(e, L) {
      const c = e.ctx;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.connect(L.gain);
      L.nodes = [[100, 'sine', 1], [200, 'triangle', 0.35], [50, 'sawtooth', 0.15]].map(([freq, type, amp]) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = amp;
        o.connect(g).connect(lp);
        o.start();
        return o;
      });
    },
  },
};

export default class AudioEngine {
  constructor(cfg, scene, ruidoMax) {
    this.cfg = cfg;
    this.scene = scene;
    this.max = ruidoMax;
    this.ruido = 0;
    this.emphasis = 1;
    this.silenced = false;
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const c = (this.ctx = new Ctx());
    if (c.state === 'suspended') {
      const resume = () => c.resume();
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
      c.resume();
    }
    this.master = c.createGain();
    this.master.gain.value = this.cfg.masterVolume * settings.volume; // volumen elegido en el menú
    this.scene.sound.volume = settings.volume;
    this.master.connect(c.destination);

    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.layers = this.cfg.layers.map((l) => {
      const L = { ...l, gain: c.createGain(), next: c.currentTime + Math.random() * 0.5 };
      L.gain.gain.value = 0;
      L.gain.connect(this.master);
      const key = `snd_${l.id}`;
      if (l.file && this.scene.cache.audio.exists(key)) {
        L.sound = this.scene.sound.add(key, { loop: true, volume: 0 });
        L.sound.play();
      } else {
        SYNTHS[l.synth]?.init?.(this, L);
      }
      return L;
    });

    this.timer = setInterval(() => this.schedule(), 25);
    this.setRuido(this.ruido, 0.01);
  }

  level(L, r) {
    const t = clamp01((r - L.from) / Math.max(1, L.to - L.from));
    return L.min + (L.max - L.min) * smooth(t);
  }

  setRuido(r, glide = 1.2) {
    this.ruido = r;
    if (!this.ctx || this.silenced) return;
    const now = this.ctx.currentTime;
    for (const L of this.layers) {
      const v = this.level(L, r) * this.emphasis;
      if (L.sound) {
        L.sound.setVolume(v);
      } else {
        const g = L.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setTargetAtTime(v, now, Math.max(0.01, glide / 3));
      }
    }
  }

  // Con los ojos cerrados todo suena más fuerte.
  emphasize(mult, ms) {
    this.emphasis = mult;
    this.setRuido(this.ruido, 0.3);
    clearTimeout(this.emphasisTimer);
    this.emphasisTimer = setTimeout(() => {
      this.emphasis = 1;
      this.setRuido(this.ruido, 0.8);
    }, ms);
  }

  silence(sec = 0.05) {
    this.silenced = true;
    clearTimeout(this.emphasisTimer);
    if (!this.ctx) return;
    const g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.01, sec));
    this.layers.forEach((L) => {
      if (L.sound) this.scene.tweens.add({ targets: L.sound, volume: 0, duration: sec * 1000, onComplete: () => L.sound.stop() });
    });
  }

  schedule() {
    if (!this.ctx || this.silenced) return;
    const now = this.ctx.currentTime;
    const k = this.ruido / this.max;
    for (const L of this.layers) {
      const s = SYNTHS[L.synth];
      if (L.sound || !s?.schedule) continue;
      if (L.next < now) L.next = now;
      while (L.next < now + 0.12) L.next = s.schedule(this, L, L.next, k);
    }
  }

  // --- voces ---

  click(dest, t, freq, dur, amp) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 1.8, dur + 0.01);
  }

  tick(dest, t, freq) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(hp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.05);
  }

  drop(dest, t, amp) {
    const c = this.ctx;
    const f0 = 1100 + Math.random() * 500;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.07);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.18);
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.emphasisTimer);
    this.layers?.forEach((L) => L.sound?.destroy());
    this.ctx?.close();
    this.ctx = null;
  }
}
