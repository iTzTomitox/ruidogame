import Phaser from 'phaser';
import { config, scene } from '../data/index.js';
import { col } from '../systems/palette.js';
import { makePainter, PAINTERS } from '../art/painters.js';
import { registerPixelFont } from '../systems/pixelFont.js';

// Carga los sprites/sonidos que tengan 'file'; el resto se pinta proceduralmente
// ('paint') o, en último caso, como un rectángulo de color sólido.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    for (const [key, s] of Object.entries(scene.sprites)) if (s.file) this.load.image(key, s.file);
    for (const l of config.audio.layers) if (l.file) this.load.audio(`snd_${l.id}`, l.file);
  }

  create() {
    registerPixelFont(this);
    for (const [key, s] of Object.entries(scene.sprites)) {
      if (this.textures.exists(key)) continue;
      if (s.paint && PAINTERS[s.paint]) this.paint(key, s);
      else this.makePlaceholder(key, s);
    }
    this.scene.start('Menu');
  }

  paint(key, s) {
    const tex = this.textures.createCanvas(key, s.w, s.h);
    PAINTERS[s.paint](makePainter(tex.getContext(), s.w, s.h, key), s.args ?? []);
    tex.refresh();
  }

  makePlaceholder(key, s) {
    const g = this.add.graphics();
    const fill = col(s.color ?? 'gris');
    g.fillStyle(fill).fillRect(0, 0, s.w, s.h);
    if (s.outline !== false && s.w >= 6 && s.h >= 6) {
      const dark = Phaser.Display.Color.IntegerToColor(fill).darken(30).color;
      g.lineStyle(1, dark).strokeRect(0.5, 0.5, s.w - 1, s.h - 1);
    }
    g.generateTexture(key, s.w, s.h);
    g.destroy();
  }
}
