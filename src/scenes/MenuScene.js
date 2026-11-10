import Phaser from 'phaser';
import { config, narrative } from '../data/index.js';
import { endings, isUnlocked, unlockedCount } from '../systems/achievements.js';
import { CURSOR } from '../systems/cursor.js';
import { col } from '../systems/palette.js';
import { normalize } from '../systems/pixelFont.js';
import { settings, maxZoom, currentZoom, applyZoom } from '../systems/settings.js';

const { width: W, height: H } = config.meta;
// Opciones de cada página del menú.
const PAGES = {
  // "Salir" solo en la versión de escritorio (.exe), que expone window.desktop (electron/preload.cjs)
  main: ['start', 'config', 'credits', ...(window.desktop ? ['quit'] : [])],
  config: ['sound', 'resolution', 'back'],
  credits: ['back'],
  achievements: ['back'],
};

// Capas del fondo animado, de atrás hacia adelante.
const D = { back: 0, backLights: 1, birds: 2, front: 4, windows: 5, train: 5.5, frontLights: 6, cars: 7, ui: 20 };
const CARS = ['menu_auto_rojo', 'menu_auto_azul', 'menu_auto_blanco', 'menu_auto_verde'];
const rnd = Phaser.Math.Between;

// Menú principal: ciudad al atardecer, título RUIDO y Empezar / Configuración (sonido y resolución) / Créditos.
export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    this.sel = 0;
    this.starting = false;
    this.cameras.main.fadeIn(500, 0, 0, 0);

    this.buildCity();
    const uiFrom = this.children.list.length;

    // Título con contorno oscuro y sombra.
    const title = normalize(narrative.start.title);
    const ts = config.font.menuTitleScale ?? 4;
    const tx = W / 2, ty = 40;
    [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 2], [0, 2], [-1, 2], [0, 3]].forEach(([dx, dy]) =>
      this.add.bitmapText(tx + dx, ty + dy, 'pixel', title).setOrigin(0.5).setScale(ts).setTint(col('ciudad_8')),
    );
    this.add.bitmapText(tx, ty, 'pixel', title).setOrigin(0.5).setScale(ts).setTint(col('blanco'));

    // Panel de opciones (se reacomoda según la página: principal, configuración o créditos).
    this.panel = this.add.rectangle(W / 2, 0, 156, 10, col('ciudad_8'), 0.82).setOrigin(0.5, 0);
    this.lineTop = this.add.rectangle(W / 2, 0, 156, 1, col('ciudad_3'));
    this.lineBottom = this.add.rectangle(W / 2, 0, 156, 1, col('ciudad_3'));
    this.highlight = this.add.rectangle(W / 2, 0, 150, 12, col('ciudad_5'));

    const slots = Math.max(...Object.values(PAGES).map((p) => p.length));
    this.items = Array.from({ length: slots }, (_, i) => {
      const text = this.add.bitmapText(W / 2, 0, 'pixel', '').setOrigin(0.5, 0);
      const zone = this.add.zone(W / 2, 0, 150, 13).setInteractive({ cursor: CURSOR.hover });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', (pointer) => {
        this.select(i);
        this.press(pointer.x < W / 2 ? -1 : 1);
      });
      return { text, zone };
    });

    // Botón del trofeo (arriba a la izquierda): abre los logros.
    const tb = { x: 6, y: 6, s: 22 };
    const border = this.add.rectangle(tb.x, tb.y, tb.s, tb.s, col('ciudad_3')).setOrigin(0);
    this.add.rectangle(tb.x + 1, tb.y + 1, tb.s - 2, tb.s - 2, col('ciudad_8'), 0.9).setOrigin(0);
    this.add.image(tb.x + 5, tb.y + 5, 'icono_trofeo').setOrigin(0);
    this.add.zone(tb.x, tb.y, tb.s, tb.s).setOrigin(0).setInteractive({ cursor: CURSOR.hover })
      .on('pointerover', () => border.setFillStyle(col('blanco')))
      .on('pointerout', () => border.setFillStyle(col('ciudad_3')))
      .on('pointerdown', () => this.go('achievements'));

    const M = narrative.menu;
    this.add.rectangle(0, 157, W, H - 157, col('ciudad_8'), 0.75).setOrigin(0);
    this.add.bitmapText(W / 2, 160, 'pixel', normalize(M.hint)).setOrigin(0.5, 0).setTint(col('ventana_rosa'));
    this.add.bitmapText(W / 2, 170, 'pixel', normalize(M.controls)).setOrigin(0.5, 0).setTint(col('gris_cla'));
    this.children.list.slice(uiFrom).forEach((o) => o.setDepth(D.ui));

    this.input.keyboard.on('keydown', (ev) => {
      const k = ev.key, n = this.ids().length;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') this.select((this.sel + n - 1) % n);
      else if (k === 'ArrowDown' || k === 's' || k === 'S') this.select((this.sel + 1) % n);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.change(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.change(1);
      else if (k === 'Enter' || k === ' ') this.press(1);
      else if ((k === 'Escape' || k === 'Backspace') && this.page !== 'main') this.go('main');
    });
    this.go('main');

    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.render, this);
      this.actx?.close();
    });
    this.render();
  }

  // ---------- ciudad viva: tren, autos, aves, ventanas y antenas ----------

  buildCity() {
    this.movers = [];
    this.add.image(0, 0, 'menu_atras').setOrigin(0).setDepth(D.back);
    const backLights = this.add.image(0, 0, 'menu_atras_luces').setOrigin(0).setDepth(D.backLights);
    this.add.image(0, 0, 'menu_frente').setOrigin(0).setDepth(D.front);
    const frontLights = this.add.image(0, 0, 'menu_frente_luces').setOrigin(0).setDepth(D.frontLights);
    // las luces de antena titilan desfasadas entre fondo y frente
    this.tweens.add({ targets: backLights, alpha: 0.1, duration: 600, hold: 1100, repeatDelay: 400, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: frontLights, alpha: 0.1, duration: 500, hold: 700, repeatDelay: 900, yoyo: true, repeat: -1, delay: 800 });

    this.buildWindows();
    this.loopSpawn(() => this.spawnCar(), 700, 2200);
    this.loopSpawn(() => this.spawnTrain(), 6000, 11000, 1500);
    this.loopSpawn(() => this.spawnBirds(), 5000, 10000, 2500);
  }

  loopSpawn(fn, min, max, first = 0) {
    const next = (delay) =>
      this.time.delayedCall(delay, () => {
        fn();
        next(rnd(min, max));
      });
    next(first);
  }

  move(obj, vx, extra = {}) {
    this.movers.push({ obj, vx, ...extra });
    return obj;
  }

  spawnCar() {
    const right = Math.random() < 0.5;
    const car = this.add.image(right ? -12 : W + 12, right ? 146 : 145, Phaser.Utils.Array.GetRandom(CARS))
      .setOrigin(0.5, 0)
      .setFlipX(!right)
      .setDepth(D.cars);
    this.move(car, (right ? 1 : -1) * rnd(28, 52));
  }

  spawnTrain() {
    const right = Math.random() < 0.5;
    const t = this.add.image(right ? -130 : W + 130, 133, 'menu_tren').setOrigin(0.5, 0).setFlipX(!right).setDepth(D.train);
    this.move(t, (right ? 1 : -1) * rnd(55, 80));
  }

  spawnBirds() {
    const right = Math.random() < 0.6;
    const n = rnd(3, 6), y0 = rnd(12, 55), speed = rnd(14, 24);
    for (let i = 0; i < n; i++) {
      // formación en V
      const off = Math.abs(i - (n >> 1)) * 6;
      const b = this.add.image(right ? -10 - off : W + 10 + off, y0 + off * 0.5 + rnd(-1, 1), 'menu_ave_1').setDepth(D.birds);
      this.move(b, (right ? 1 : -1) * speed, { bird: true, y0: b.y, phase: Math.random() * 6 });
    }
  }

  // Busca las ventanas apagadas del frente (pixeles 3x2 del color de ventana) y las prende/apaga al azar.
  buildWindows() {
    const dark = Phaser.Display.Color.IntegerToColor(col('ciudad_7'));
    const is = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const c = this.textures.getPixel(x, y, 'menu_frente');
      return c && c.alpha > 0 && c.red === dark.red && c.green === dark.green && c.blue === dark.blue;
    };
    const spots = [];
    for (let y = 112; y < 156; y++)
      for (let x = 0; x < W; x++)
        if (is(x, y) && is(x + 2, y + 1) && !is(x - 1, y) && !is(x, y - 1)) spots.push([x, y]);

    const colors = ['ventana_amarilla', 'ventana_verde', 'ventana_rosa', 'ventana_amarilla'].map(col);
    this.windows = Phaser.Utils.Array.Shuffle(spots)
      .slice(0, 40)
      .map(([x, y]) =>
        this.add.rectangle(x, y, 3, 2, Phaser.Utils.Array.GetRandom(colors)).setOrigin(0).setDepth(D.windows)
          .setVisible(Math.random() < 0.4),
      );
    if (!this.windows.length) return;
    this.time.addEvent({
      delay: 350,
      loop: true,
      callback: () => {
        const w = Phaser.Utils.Array.GetRandom(this.windows);
        w.setVisible(!w.visible);
      },
    });
  }

  update(time, delta) {
    const dt = delta / 1000;
    this.movers = this.movers.filter((m) => {
      m.obj.x += m.vx * dt;
      if (m.bird) {
        m.obj.y = m.y0 + Math.sin(time / 400 + m.phase) * 1.5;
        m.obj.setTexture(Math.floor(time / 160 + m.phase) % 2 ? 'menu_ave_1' : 'menu_ave_2');
      }
      const gone = m.vx > 0 ? m.obj.x > W + 140 : m.obj.x < -140;
      if (gone) m.obj.destroy();
      return !gone;
    });
  }

  select(i) {
    if (this.sel === i) return;
    this.sel = i;
    this.render();
  }

  ids() {
    return PAGES[this.page];
  }

  // Cambia de página y reacomoda el panel. En créditos, la lista va arriba y "Volver" abajo.
  go(page) {
    const from = this.page;
    this.page = page;
    this.sel = page === 'main' && from ? Math.max(0, PAGES.main.indexOf(from)) : 0;
    this.creditTexts?.forEach((t) => t.destroy());
    this.creditTexts = [];

    let top = 88, itemsTop = top + 4, pw = 156;
    if (page === 'credits') {
      const C = narrative.credits;
      top = 62;
      let y = top + 5;
      const add = (str, color) => {
        const t = this.add.bitmapText(0, y, 'pixel', normalize(str)).setTint(col(color)).setDepth(D.ui);
        this.creditTexts.push(t);
        return t;
      };
      const intro = C.intro && add(C.intro, 'ventana_rosa').setOrigin(0.5, 0).setX(W / 2);
      if (intro) y += 13;
      // dos columnas (rol | nombre) centradas como bloque, según el texto más largo de cada una
      const rows = C.people.map(({ role, name }) => {
        const r = [add(role, 'gris_cla'), add(name, 'blanco')];
        y += 10;
        return r;
      });
      const roleW = Math.max(...rows.map(([r]) => r.width)), nameW = Math.max(...rows.map(([, n]) => n.width));
      const split = Math.round((W - (roleW + 8 + nameW)) / 2) + roleW;
      rows.forEach(([r, n]) => (r.setOrigin(1, 0).setX(split), n.setX(split + 8)));
      pw = Math.max(pw, roleW + 8 + nameW + 20, (intro?.width ?? 0) + 20);
      itemsTop = y + 3;
    }
    if (page === 'achievements') {
      // "Finales desbloqueados  1 / 3" y la lista: los vistos con su nombre, los otros como "???"
      const A = narrative.achievements;
      top = 64;
      let y = top + 5;
      const add = (str, color) => {
        const t = this.add.bitmapText(W / 2, y, 'pixel', normalize(str)).setOrigin(0.5, 0).setTint(col(color)).setDepth(D.ui);
        this.creditTexts.push(t);
        y += 10;
        return t;
      };
      const head = add(`${A.counter}  ${unlockedCount()} / ${endings().length}`, 'amarillo');
      y += 3;
      const rows = endings().map((e) => (isUnlocked(e.id) ? add(e.name, 'blanco') : add(A.locked, 'gris_cla')));
      pw = Math.max(pw, head.width + 24, ...rows.map((r) => r.width + 24));
      itemsTop = y + 3;
    }
    const n = this.ids().length;
    const bottom = itemsTop + n * 14 + 2;
    this.panel.setY(top).setSize(pw, bottom - top);
    this.lineTop.setY(top).setSize(pw, 1);
    this.lineBottom.setY(bottom).setSize(pw, 1);
    this.items.forEach((it, i) => {
      const y = itemsTop + i * 14;
      it.y = y;
      it.text.setY(y + 2).setVisible(i < n);
      it.zone.setY(y + 6);
      if (i < n) it.zone.setInteractive();
      else it.zone.disableInteractive();
    });
    this.render();
  }

  label(id) {
    const M = narrative.menu;
    if (id === 'sound') return `${M.sound}  < ${Math.round(settings.volume * 100)}% >`;
    if (id === 'resolution') {
      const z = currentZoom(), max = maxZoom();
      const tag = z === max ? ` ${M.max}` : z === 1 ? ` ${M.min}` : '';
      return `${M.resolution}  < ${W * z}x${H * z}${tag} >`;
    }
    return M[id];
  }

  render() {
    const ids = this.ids();
    this.items.forEach((it, i) => {
      if (i >= ids.length) return;
      const on = i === this.sel;
      it.text.setText(normalize(this.label(ids[i]))).setTint(col(on ? 'blanco' : 'gris_cla'));
      if (on) this.highlight.setY(it.y + 6);
    });
  }

  // Enter / click sobre la opción elegida.
  press(dir) {
    const id = this.ids()[this.sel];
    if (id === 'start') return this.activate();
    if (id === 'config' || id === 'credits') return this.go(id);
    if (id === 'back') return this.go('main');
    if (id === 'quit') return window.desktop.quit();
    this.change(dir);
  }

  change(dir) {
    const id = this.ids()[this.sel];
    if (id === 'sound') {
      settings.volume += dir * 0.1;
      this.blip();
    } else if (id === 'resolution') {
      const max = maxZoom();
      const z = Phaser.Math.Clamp(currentZoom() + dir, 1, max);
      settings.zoom = z === max ? 'max' : z;
      applyZoom(this.game);
    } else return;
    this.render();
  }

  // Un "tic" corto para escuchar el volumen elegido.
  blip() {
    try {
      this.actx ??= new (window.AudioContext || window.webkitAudioContext)();
      const c = this.actx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.25 * settings.volume), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.1);
    } catch {}
  }

  activate() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Objective'));
  }
}
