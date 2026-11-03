import Phaser from 'phaser';
import { config, narrative } from '../data/index.js';
import { col } from '../systems/palette.js';
import { normalize, wrap, LINE_HEIGHT } from '../systems/pixelFont.js';

const { width: W, height: H } = config.meta;

// Pantalla de objetivo entre el menú y el escritorio. Textos en narrative.json → objective.
export default class ObjectiveScene extends Phaser.Scene {
  constructor() {
    super('Objective');
  }

  create() {
    const O = narrative.objective;
    const U = config.ui;
    this.leaving = false;
    this.cameras.main.setBackgroundColor(col('negro'));

    const text = wrap(O.text, 220);
    const textH = text.split('\n').length * LINE_HEIGHT;
    const top = Math.round(H / 2 - (24 + textH) / 2) - 8;

    const title = this.add.bitmapText(W / 2, top, 'pixel', normalize(O.title)).setOrigin(0.5, 0).setScale(2).setTint(col(U.cardText));
    this.add.rectangle(W / 2, top + 24, 40, 1, col(U.textDim));
    const body = this.add.bitmapText(W / 2, top + 32, 'pixel', text)
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setTint(col(U.text));
    const hint = this.add.bitmapText(W / 2, H - 20, 'pixel', normalize(O.hint)).setOrigin(0.5, 0).setTint(col(U.textDim));

    // aparece de a partes; el aviso para seguir titila cuando ya se puede avanzar
    [title, body, hint].forEach((o) => o.setAlpha(0));
    this.tweens.chain({
      tweens: [
        { targets: title, alpha: 1, duration: 500, delay: 300 },
        { targets: body, alpha: 1, duration: 600, delay: 200 },
        { targets: hint, alpha: 1, duration: 400, delay: 600 },
        { targets: hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 },
      ],
    });
    this.time.delayedCall(800, () => {
      this.input.on('pointerdown', () => this.leave());
      this.input.keyboard.on('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') this.leave();
      });
    });
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Desk'));
  }
}
