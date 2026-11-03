import Phaser from 'phaser';
import { config, scene as layout, actions, narrative } from '../data/index.js';
import AudioEngine from '../systems/AudioEngine.js';
import { unlockEnding } from '../systems/achievements.js';
import { CURSOR } from '../systems/cursor.js';
import { col, hex } from '../systems/palette.js';
import { normalize, wrap } from '../systems/pixelFont.js';

const { width: W, height: H } = config.meta;
const lerp = Phaser.Math.Linear;

// Escena única. El mundo (escritorios) lo ve la cámara principal, con zoom y postFX;
// la interfaz la ve una segunda cámara fija, sin efectos.
export default class DeskScene extends Phaser.Scene {
  constructor() {
    super('Desk');
  }

  create() {
    this.state = 'busy'; // busy | choose | finale | end
    this.stats = Object.fromEntries(Object.entries(config.stats).map(([k, s]) => [k, s.start]));
    this.ruidoMax = config.stats.ruido.max;
    this.care = { minEnergia: this.stats.energia, maxSueno: this.stats.sueno };
    this.helpOn = false;
    this.lampOn = true;
    this.monitorsOn = true;
    this.turns = narrative.acts.flatMap((act, ai) => act.turns.map((t, ti) => ({ ...t, act, ai, ti })));
    this.turnIndex = -1;
    this.pools = JSON.parse(JSON.stringify(layout.pools));
    this.usage = {};
    this.shakeK = 0;
    this.nextShake = 0;
    this.shakeOff = { x: 0, y: 0 };
    this.camFree = false;

    const cu = config.camera.closeUp;
    this.camCenter = { x: cu.x, y: cu.y };
    this.cameras.main.setZoom(cu.zoom).centerOn(cu.x, cu.y).setBackgroundColor(hex('negro'));
    this.uiCam = this.cameras.add(0, 0, W, H);

    this.buildWorld();
    this.buildUI();
    this.setupFX();
    this.audio = new AudioEngine(config.audio, this, this.ruidoMax);
    this.events.once('shutdown', () => this.audio.destroy());
    this.setupInput();
    this.jumpFromUrl();
    this.begin(); // se llega desde el menú: arranca directo
  }

  // Atajo para probar la narrativa: ?turno=8 arranca en el turno 8 con el escritorio y el ruido acumulados.
  jumpFromUrl() {
    const n = Number(new URLSearchParams(location.search).get('turno'));
    if (!n || n < 2) return;
    const skip = this.turns.slice(0, Math.min(n, this.turns.length) - 1);
    skip.forEach((t) => (t.deskAdd ?? []).forEach((id) => this.addDeskObject(id)));
    this.turnIndex = skip.length - 1;
    this.stats.ruido = Math.min(config.ruido.capBeforeLastTurn, Math.round((skip.length / this.turns.length) * this.ruidoMax));
  }

  // ---------- construcción ----------

  buildWorld() {
    const place = (def) => {
      const img = this.add.image(def.x, def.y, def.sprite).setOrigin(0).setDepth(def.depth ?? 0);
      if (def.alpha != null) img.setAlpha(def.alpha);
      this.uiCam.ignore(img);
      return img;
    };
    this.byId = {};
    layout.static.forEach((def) => {
      const img = place(def);
      if (def.id) this.byId[def.id] = img;
    });
    this.deskObjects = {};
    Object.entries(layout.deskObjects).forEach(([id, def]) => {
      this.deskObjects[id] = place(def).setVisible(!!def.visible);
    });
    this.special = {};
    Object.entries(layout.special).forEach(([id, def]) => {
      if (id.startsWith('_')) return;
      let obj;
      if (def.tile) {
        obj = this.add.tileSprite(def.x, def.y, def.w, def.h, def.sprite).setOrigin(0).setDepth(def.depth ?? 0);
        if (def.alpha != null) obj.setAlpha(def.alpha);
        this.uiCam.ignore(obj);
      } else obj = place(def);
      if (def.blend) obj.setBlendMode(Phaser.BlendModes[def.blend]);
      this.special[id] = obj.setVisible(false);
    });
    this.ambient = this.add
      .rectangle(0, 0, layout.world.width, layout.world.height, 0x000000, 0)
      .setOrigin(0)
      .setDepth(900);
    this.uiCam.ignore(this.ambient);
    this.buildScreens();
    this.buildClock();
    this.special.luz_lampara?.setVisible(true);
    this.buildPhoto();
  }

  // La foto del estante: con click se ven los dos retratos en grande (otro click los cierra).
  buildPhoto() {
    this.clickable(this.byId.cuadro_foto, () => this.openPhotos());
    this.clickable(this.byId.lampara, () => this.toggleLamp());
    this.clickable(this.byId.torre, () => this.toggleMonitors());
  }

  // Objeto del escritorio que se puede tocar: borde claro al pasar el mouse y acción al hacer click.
  // Se vuelven clickeables recién con la placa del primer acto (startDay); no en los finales.
  clickable(obj, onClick) {
    if (!obj) return;
    this.clickables ??= [];
    this.clickables.push(obj);
    const ring = this.add.rectangle(obj.x - 1, obj.y - 1, obj.width + 2, obj.height + 2)
      .setOrigin(0).setStrokeStyle(1, col('hueso')).setDepth(obj.depth).setVisible(false);
    this.uiCam.ignore(ring);
    obj.on('pointerover', () => ring.setVisible(true));
    obj.on('pointerout', () => ring.setVisible(false));
    obj.on('pointerdown', (p, lx, ly, ev) => {
      ev.stopPropagation();
      if (this.viewer) return this.closePhotos();
      if (!['finale', 'asleep', 'end'].includes(this.state)) onClick();
    });
  }

  // Lámpara: se apaga y se prende (cambia el foco y la luz sobre el escritorio).
  toggleLamp() {
    this.lampOn = !this.lampOn;
    this.byId.lampara.setTexture(this.lampOn ? 'lampara' : 'lampara_off');
    this.special.luz_lampara?.setVisible(this.lampOn);
    this.click();
  }

  // Gabinete: apaga y prende los dos monitores de Julián (con lo que se mueve encima y el brillo de noche).
  toggleMonitors() {
    this.monitorsOn = !this.monitorsOn;
    const on = this.monitorsOn;
    this.byId.torre.setTexture(on ? 'torre' : 'torre_off');
    const screens = ['pantalla_a', 'pantalla'].flatMap((id) => [this.byId[id], ...(this.screenFx[id] ?? [])]).filter(Boolean);
    this.tweens.killTweensOf(screens.filter((o) => o.type !== 'Rectangle'));
    if (on) {
      screens.forEach((o) => o.setVisible(true).setAlpha(0));
      this.tweens.add({ targets: screens, alpha: 1, duration: 350 });
    } else screens.forEach((o) => o.setVisible(false));
    const glow = this.turns[Math.max(0, this.turnIndex)]?.act.glow ?? 0;
    this.special.brillo?.setVisible(on && glow > 0);
    this.click();
  }

  // Un "clic" seco de interruptor, al volumen elegido en el menú.
  click() {
    const c = this.audio.ctx;
    if (!c || this.audio.silenced) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.03);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.audio.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  openPhotos() {
    if (this.viewer) return;
    const S = 2, gap = 16;
    const imgs = ['retrato_a', 'retrato_b'].map((k) => this.add.image(0, 0, k).setOrigin(0).setScale(S));
    const pw = imgs[0].width * S, ph = imgs[0].height * S;
    const left = (W - (pw * 2 + gap)) / 2, top = Math.round((H - ph) / 2) - 6;
    const parts = [this.add.rectangle(0, 0, W, H, col('negro'), 0.88).setOrigin(0)];
    imgs.forEach((img, i) => {
      const x = left + i * (pw + gap);
      parts.push(
        this.add.rectangle(x - 4, top - 4, pw + 8, ph + 8, col('negro')).setOrigin(0),
        this.add.rectangle(x - 3, top - 3, pw + 6, ph + 6, col('madera_osc')).setOrigin(0),
        img.setPosition(x, top),
      );
    });
    parts.push(this.txt(W / 2, top + ph + 9, narrative.photo?.close ?? '', config.ui.textDim).setOrigin(0.5, 0));
    this.viewer = parts.map((o) => this.ui(o, 6000 + parts.indexOf(o)).setAlpha(0));
    this.tweens.add({ targets: this.viewer, alpha: 1, duration: 200 });
  }

  closePhotos() {
    const v = this.viewer;
    this.viewer = null;
    this.tweens.add({ targets: v, alpha: 0, duration: 150, onComplete: () => v.forEach((o) => o.destroy()) });
  }

  // Pantallas vivas: en las de código se sigue tipeando abajo (con cursor), en la de pistas avanza el cabezal.
  // Quedan quietas durante la llegada; arrancan con la placa del primer acto (startDay).
  buildScreens() {
    const world = (o) => (this.uiCam.ignore(o), o.setDepth(14));
    this.screenStarters = [];
    this.screenFx = {}; // lo que se anima encima de cada pantalla (para apagarla desde el gabinete)
    for (const def of layout.static) {
      const tex = layout.sprites[def.sprite];
      if (tex?.paint !== 'screen' || tex.file) continue;
      const { w, h } = tex;
      if (tex.args?.[0] === 'tracks') {
        const head = world(this.add.rectangle(def.x + 10, def.y + 3, 1, h - 3, col('blanco')).setOrigin(0));
        if (def.id) this.screenFx[def.id] = [head];
        this.screenStarters.push(() => this.tweens.add({ targets: head, x: def.x + w - 2, duration: 9000, repeat: -1 }));
      } else {
        const g = world(this.add.graphics());
        if (def.id) this.screenFx[def.id] = [g];
        this.screenStarters.push(this.typingScreen(g, def.x + 13, def.y + h - 9, w - 15));
      }
    }
  }

  // Arranca la jornada (placa del primer acto, no en la llegada): se mueven los monitores y la foto se puede abrir.
  startDay() {
    if (this.dayStarted) return;
    this.dayStarted = true;
    this.screenStarters.forEach((start) => start());
    this.clickables?.forEach((o) => o.setInteractive({ cursor: CURSOR.hover }));
  }

  // Tres renglones al pie de una pantalla de código que se van escribiendo de a poco, con pausas.
  typingScreen(g, x, y, w) {
    const colors = ['pantalla_cla', 'cyan', 'amarillo', 'rosa', 'blanco', 'verde_cla'].map(col);
    let segs = [], row = 0, cx = 1 + Phaser.Math.Between(0, 2) * 2, cursorOn = true;
    const newSeg = () => segs.push({ row, x: cx, len: 0, c: Phaser.Utils.Array.GetRandom(colors) });
    const draw = () => {
      g.clear().fillStyle(col('pantalla_osc')).fillRect(x, y, w, 8);
      segs.forEach((s) => g.fillStyle(s.c).fillRect(x + s.x, y + 1 + s.row * 2, s.len, 1));
      if (cursorOn) g.fillStyle(col('blanco')).fillRect(x + cx, y + 1 + row * 2, 1, 1);
    };
    const type = () => {
      let delay = Phaser.Math.Between(90, 260);
      const seg = segs.at(-1);
      if (!seg || seg.row !== row) newSeg();
      else if (Math.random() < 0.18 && seg.len > 1) {
        cx += 2; // espacio: arranca otra palabra
        newSeg();
      }
      segs.at(-1).len++;
      cx++;
      if (cx > w - 3 || (Math.random() < 0.06 && cx > 8)) {
        row++; // enter
        cx = 1 + Phaser.Math.Between(0, 3) * 2;
        delay += Phaser.Math.Between(300, 900);
        if (row > 2) {
          row = 0;
          segs = [];
          delay += 800;
        }
      }
      if (Math.random() < 0.05) delay += Phaser.Math.Between(1200, 2600); // se queda pensando
      draw();
      this.time.delayedCall(delay, type);
    };
    return () => {
      this.time.addEvent({ delay: 500, loop: true, callback: () => ((cursorOn = !cursorOn), draw()) });
      draw();
      this.time.delayedCall(Phaser.Math.Between(300, 1200), type);
    };
  }

  // Reloj de pared: las agujas se dibujan pixel por pixel según la hora del turno ("09:04").
  buildClock() {
    const def = layout.static.find((s) => s.sprite === 'reloj');
    if (!def || layout.sprites.reloj.file) return;
    const r = (layout.sprites.reloj.w - 1) / 2;
    this.clock = { cx: def.x + r, cy: def.y + r, g: this.add.graphics().setDepth((def.depth ?? 0) + 1) };
    this.uiCam.ignore(this.clock.g);
  }

  setClock(time) {
    if (!this.clock || !time) return;
    const [hh, mm] = time.split(':').map(Number);
    const { cx, cy, g } = this.clock;
    const hand = (turns, len) => {
      const a = turns * Math.PI * 2;
      for (let i = 0; i <= len * 2; i++) {
        const d = i / 2;
        g.fillRect(Math.round(cx + Math.sin(a) * d), Math.round(cy - Math.cos(a) * d), 1, 1);
      }
    };
    g.clear().fillStyle(col('negro'));
    hand(((hh % 12) + mm / 60) / 12, 2.4);
    hand(mm / 60, 3.6);
  }

  // Texto con la fuente bitmap pixel (ver systems/pixelFont.js).
  txt(x, y, str, color, scale = 1) {
    return this.add.bitmapText(x, y, 'pixel', normalize(str)).setTint(col(color)).setScale(scale);
  }

  ui(obj, depth) {
    this.cameras.main.ignore(obj);
    if (depth != null) obj.setDepth(depth);
    return obj;
  }

  buildUI() {
    const U = config.ui;
    this.fadeable = [];
    const keep = (o) => (this.fadeable.push(o), o);

    // Panel inferior: texto narrativo + acciones
    keep(this.ui(this.add.rectangle(0, 112, W, 68, col(U.panel)).setOrigin(0), 1000));
    keep(this.ui(this.add.rectangle(0, 112, W, 1, col(U.panelLine)).setOrigin(0), 1001));
    this.narr = keep(this.ui(this.txt(6, 116, '', U.text), 1002));
    this.contMark = this.ui(this.txt(308, 128, '▼', U.textDim), 1002).setVisible(false);
    this.tweens.add({ targets: this.contMark, alpha: 0.2, yoyo: true, repeat: -1, duration: 400 });

    // Barras de Energía y Sueño arriba, sobre la pared (config.ui.hud). Ruido no se muestra.
    const hud = U.hud;
    this.barW = hud.barW;
    this.bars = {};
    this.ghosts = {};
    this.deltas = {};
    const hudFrom = this.fadeable.length;
    const keys = ['energia', 'sueno'];
    const labels = keys.map((k, i) => keep(this.ui(this.txt(hud.x, hud.y + i * hud.rowH, config.stats[k].label, U.text), 1001)));
    const bx = hud.x + Math.max(...labels.map((l) => l.width)) + 4;
    keys.forEach((k, i) => {
      const y = hud.y + i * hud.rowH + 2;
      keep(this.ui(this.add.rectangle(bx, y, this.barW, 4, col(U.barBg)).setOrigin(0), 1001));
      this.bars[k] = keep(this.ui(this.add.rectangle(bx, y, this.barW, 4, col(config.stats[k].color)).setOrigin(0), 1002));
      this.ghosts[k] = this.ui(this.add.rectangle(bx, y, 0, 4, col('blanco')).setOrigin(0), 1003).setVisible(false);
      this.deltas[k] = this.ui(this.txt(bx + this.barW + 4, y - 2, '', U.text), 1001);
    });
    const bgW = bx + this.barW + 4 + hud.deltaW - hud.x + 6;
    keep(this.ui(this.add.rectangle(hud.x - 3, hud.y - 2, bgW, keys.length * hud.rowH + 2, col(U.hudBg), hud.bgAlpha).setOrigin(0), 1000));
    this.hudParts = this.fadeable.slice(hudFrom);
    this.tweens.add({ targets: Object.values(this.ghosts), alpha: 0.25, yoyo: true, repeat: -1, duration: 350 });

    // En el panel: pendientes + acto/hora.
    const hy = 140;
    keep(this.ui(this.add.rectangle(4, hy - 3, W - 8, 1, col(U.panelLine)).setOrigin(0), 1001));
    const pend = keep(this.ui(this.txt(6, hy, config.stats.pendientes.label, U.textDim), 1001));
    this.pendText = keep(this.ui(this.txt(6 + pend.width + 4, hy, '', U.text), 1001));
    this.deltas.pendientes = this.ui(this.txt(0, hy, '', U.text), 1001);
    this.header = keep(this.ui(this.txt(W - 6, hy, '', U.text).setOrigin(1, 0), 1001));

    this.buildButtons();

    // Overlays de transición
    this.flash = this.ui(this.add.rectangle(0, 0, W, H, col('blanco'), 0).setOrigin(0), 4000);
    this.black = this.ui(this.add.rectangle(0, 0, W, H, col('negro'), 1).setOrigin(0), 5000);
    this.card = this.ui(this.txt(W / 2, H / 2 - 6, '', U.cardText, config.font.titleScale).setOrigin(0.5), 5001)
      .setAlpha(0);
    this.cardSub = this.ui(this.txt(W / 2, H / 2 + 16, '', U.textDim).setOrigin(0.5).setCenterAlign(), 5001)
      .setAlpha(0);

    this.updateHUD();
  }

  buildButtons() {
    const U = config.ui;
    this.buttons = actions.list.map((a, i) => {
      const x = 4 + (i % 3) * 105;
      const y = 152 + Math.floor(i / 3) * 14;
      const text = `${i + 1} ${a.label}`;
      const bg = this.ui(this.add.rectangle(x, y, 102, 12, col(U.btn)).setOrigin(0), 1001);
      const label = this.ui(this.txt(x + 4, y + 2, text, a.disabled ? U.btnTextDisabled : U.btnText), 1002);
      bg.setInteractive({ cursor: CURSOR.hover });
      bg.on('pointerover', () => {
        this.hovered = i;
        if (this.state !== 'choose') return;
        bg.setFillStyle(col(U.btnHover));
        this.previewEffects(a);
      });
      bg.on('pointerout', () => {
        if (this.hovered === i) this.hovered = null;
        bg.setFillStyle(col(U.btn));
        this.clearPreview();
      });
      bg.on('pointerdown', (p, lx, ly, ev) => {
        ev.stopPropagation();
        this.choose(i);
      });
      return { a, bg, label, text };
    });
    this.setButtonsEnabled(false);
  }

  setButtonsEnabled(on) {
    this.buttons.forEach((b) => {
      b.bg.setAlpha(on ? 1 : 0.45);
      b.label.setAlpha(on ? 1 : 0.45);
      if (!on) b.bg.setFillStyle(col(config.ui.btn));
    });
    this.clearPreview();
    // si el mouse ya estaba sobre un botón cuando vuelven a habilitarse, mostrar su vista previa
    const h = on && this.buttons[this.hovered];
    if (h) {
      h.bg.setFillStyle(col(config.ui.btnHover));
      this.previewEffects(h.a);
    }
  }

  // Vista previa al pasar el mouse por una acción: cuánto cambia cada stat.
  // Verde si te conviene, rojo si no (config.stats[k].better: "up" o "down").
  previewEffects(a) {
    const e = a.effects ?? {};
    for (const k of ['energia', 'sueno', 'pendientes']) {
      const d = e[k];
      if (!d) continue;
      const s = config.stats[k];
      const good = (d > 0) === (s.better !== 'down');
      const c = col(good ? config.ui.deltaGood : config.ui.deltaBad);
      this.deltas[k].setText(d > 0 ? `+${d}` : `${d}`).setTint(c);
      if (k === 'pendientes') {
        this.deltas[k].setX(this.pendText.x + this.pendText.width + 4);
        continue;
      }
      const cur = this.stats[k];
      const next = Phaser.Math.Clamp(cur + d, 0, s.max);
      const w = (v) => Math.round((this.barW * v) / s.max);
      const g = this.ghosts[k];
      g.setX(this.bars[k].x + w(Math.min(cur, next)))
        .setSize(Math.max(1, Math.abs(w(next) - w(cur))), 4)
        .setFillStyle(c)
        .setVisible(next !== cur);
    }
  }

  clearPreview() {
    if (!this.ghosts) return;
    Object.values(this.ghosts).forEach((g) => g.setVisible(false));
    Object.values(this.deltas).forEach((t) => t.setText(''));
  }

  setupFX() {
    const e = config.effects;
    this.fxState = { sat: e.saturation.from, rad: e.vignette.radiusFrom, str: e.vignette.strengthFrom };
    const cam = this.cameras.main;
    if (this.renderer.type !== Phaser.WEBGL || !cam.postFX) return;
    this.colorFx = cam.postFX.addColorMatrix();
    this.vignette = cam.postFX.addVignette(e.vignette.x, e.vignette.y, this.fxState.rad, this.fxState.str);
    this.applyFX();
  }

  setupInput() {
    this.input.on('pointerdown', () => this.onAdvance());
    this.input.keyboard.on('keydown', (ev) => {
      if (/^[1-9]$/.test(ev.key)) this.choose(Number(ev.key) - 1);
      else if (ev.key === ' ' || ev.key === 'Enter') this.onAdvance();
    });
  }

  // ---------- helpers ----------

  wait(ms) {
    return new Promise((r) => this.time.delayedCall(ms, r));
  }

  tween(cfg) {
    return new Promise((r) => this.tweens.add({ ...cfg, onComplete: () => r() }));
  }

  updateHUD() {
    for (const [k, bar] of Object.entries(this.bars)) {
      bar.width = Math.round((this.barW * this.stats[k]) / config.stats[k].max);
    }
    this.pendText.setText(String(this.stats.pendientes));
  }

  type(str) {
    this.contMark.setVisible(false);
    const full = str ? wrap(str, 296) : '';
    return new Promise((res) => {
      let i = 0;
      const ev = this.time.addEvent({
        delay: config.timing.typeSpeed,
        loop: true,
        callback: () => {
          this.narr.setText(full.slice(0, ++i));
          if (i >= full.length) finish();
        },
      });
      const finish = () => {
        ev.remove();
        this.narr.setText(full);
        this.typingDone = null;
        res();
      };
      this.typingDone = finish;
      if (!full.length) finish();
    });
  }

  waitContinue() {
    this.contMark.setVisible(true);
    return new Promise((r) => (this.continueResolve = r));
  }

  onAdvance() {
    if (this.viewer) return this.closePhotos();
    if (this.state === 'end') return this.scene.start('Menu');
    if (this.typingDone) return this.typingDone();
    if (this.continueResolve) {
      const r = this.continueResolve;
      this.continueResolve = null;
      this.contMark.setVisible(false);
      r();
    }
  }

  async showCard(title, sub, ms) {
    this.card.setText(normalize(title));
    this.cardSub.setText(normalize(sub ?? ''));
    await this.tween({ targets: [this.card, this.cardSub], alpha: 1, duration: 300 });
    await this.wait(ms);
    await this.tween({ targets: [this.card, this.cardSub], alpha: 0, duration: 300 });
  }

  // ---------- Ruido: audio, saturación, viñeta, shake ----------

  setRuido(value, dur) {
    this.stats.ruido = Phaser.Math.Clamp(value, 0, this.ruidoMax);
    const k = this.stats.ruido / this.ruidoMax;
    this.audio.setRuido(this.stats.ruido);
    this.tweenFX(k, dur);
    const s0 = config.effects.shake.startAt / this.ruidoMax;
    this.shakeK = k <= s0 ? 0 : (k - s0) / (1 - s0);
  }

  tweenFX(k, dur) {
    const e = config.effects;
    this.fxTween?.stop();
    this.fxTween = this.tweens.add({
      targets: this.fxState,
      sat: lerp(e.saturation.from, e.saturation.to, k),
      rad: lerp(e.vignette.radiusFrom, e.vignette.radiusTo, k),
      str: lerp(e.vignette.strengthFrom, e.vignette.strengthTo, k),
      duration: Math.max(1, dur),
      ease: 'Sine.easeInOut',
      onUpdate: () => this.applyFX(),
    });
  }

  applyFX() {
    if (!this.colorFx) return;
    this.colorFx.saturate(this.fxState.sat);
    this.vignette.radius = this.fxState.rad;
    this.vignette.strength = this.fxState.str;
  }

  update(time, delta) {
    const rain = this.special.lluvia;
    if (rain?.visible) {
      const v = (layout.special.lluvia.speed * delta) / 1000;
      rain.tilePositionY -= v;
      rain.tilePositionX += v * 0.15;
    }
    if (this.camFree) return; // la cámara la maneja un pan/zoom
    const sh = config.effects.shake;
    if (time >= this.nextShake) {
      this.nextShake = time + sh.interval;
      const a = sh.maxPx * this.shakeK;
      const on = this.shakeK > 0 && Math.random() < this.shakeK * 0.7;
      this.shakeOff = on
        ? { x: Math.round((Math.random() * 2 - 1) * a), y: Math.round((Math.random() * 2 - 1) * a) }
        : { x: 0, y: 0 };
    }
    const z = this.cameras.main.zoom;
    this.cameras.main.centerOn(this.camCenter.x + this.shakeOff.x / z, this.camCenter.y + this.shakeOff.y / z);
  }

  // ---------- flujo de turnos ----------

  begin() {
    this.state = 'busy';
    this.audio.start();
    this.setRuido(this.stats.ruido, 1);
    // con ?turno=N se saltea la llegada
    if (this.turnIndex === -1 && narrative.intro?.enabled) this.intro().then(() => this.nextTurn());
    else this.nextTurn();
  }

  // ---------- llegada: Julián entra, saluda a Federico y se sienta ----------

  async intro() {
    const I = narrative.intro;
    const T = I.timing;
    const julian = [this.byId.julian_cuerpo, this.byId.julian_cabeza];
    const ui = this.fadeable.concat(this.buttons.flatMap((b) => [b.bg, b.label]));
    ui.forEach((o) => o.setAlpha(0));
    julian.forEach((o) => o.setVisible(false));
    this.applyAct(this.turns[0]); // la luz del primer acto ya durante la llegada
    this.setClock(I.cardSub); // el reloj marca la hora de llegada

    // Julián de pie: cuerpo + la misma cabeza de siempre, en un container que camina.
    const body = this.add.image(0, 0, 'julian_pie_0').setOrigin(0);
    const head = this.add.image(6, -17, 'julian_cabeza').setOrigin(0);
    this.walker = this.add.container(I.startX, I.floorY - body.height, [body, head]).setDepth(30);
    this.walker.body_ = body;
    this.walker.head_ = head;
    this.uiCam.ignore(this.walker);

    const cu = config.camera.closeUp;
    this.camCenter.x = cu.x;
    await this.showCard(I.card, I.cardSub, T.card);
    await this.tween({ targets: this.black, alpha: 0, duration: T.fadeIn });

    await this.walkTo(I.greetX);
    await this.wait(T.beforeGreet);
    const fedHead = this.byId.federico_cabeza;
    for (const line of I.lines) {
      // Federico gira la cabeza hacia Julián mientras hablan
      if (line.who === 'federico' && fedHead && !this.fedTurned) {
        this.fedTurned = true;
        this.tween({ targets: fedHead, x: '-=2', duration: 250 });
      }
      await this.say(line);
    }
    if (this.fedTurned) this.tween({ targets: fedHead, x: '+=2', duration: 300, delay: 400 });

    await this.walkTo(I.seatX);
    // se sienta: un paso hacia la silla y aparece sentado
    await this.tween({ targets: this.walker, y: `-=${T.sitStep}`, duration: 250 });
    this.walker.destroy();
    this.walker = null;
    julian.forEach((o) => o.setVisible(true).setY(o.y - 3));
    this.tween({ targets: julian, y: '+=3', duration: 180, ease: 'Quad.easeIn' });
    if (this.byId.julian_silla) this.tween({ targets: this.byId.julian_silla, y: '+=1', yoyo: true, duration: 120, delay: 150 });
    await this.tween({ targets: this.camCenter, x: cu.x, y: cu.y, duration: 600, ease: 'Sine.easeInOut' });
    await this.wait(T.afterSit);

    await this.tween({ targets: this.black, alpha: 1, duration: config.timing.fadeOut });
    ui.forEach((o) => o.setAlpha(1));
    this.setButtonsEnabled(false);
  }

  walkTo(tx) {
    const w = this.walker;
    const I = narrative.intro;
    const dist = Math.abs(tx - w.x);
    if (!dist) return Promise.resolve();
    w.body_.setFlipX(tx < w.x);
    let step = 0;
    const anim = this.time.addEvent({
      delay: I.timing.stepMs,
      loop: true,
      callback: () => {
        step = (step % 2) + 1;
        w.body_.setTexture(`julian_pie_${step}`);
        w.head_.setY(-17 + (step === 1 ? 1 : 0));
      },
    });
    const half = config.meta.width / 2;
    return this.tween({
      targets: w,
      x: tx,
      duration: (dist / I.walkSpeed) * 1000,
      onUpdate: () => (this.camCenter.x = Phaser.Math.Clamp(Math.round(w.x + 15), config.camera.closeUp.x, layout.world.width - half)),
    }).then(() => {
      anim.remove();
      w.body_.setTexture('julian_pie_0');
      w.head_.setY(-17);
    });
  }

  // Un globo de texto sobre quien habla (nombre arriba, frase abajo). Click/Enter lo adelanta.
  say(line) {
    const I = narrative.intro;
    const T = I.timing;
    const U = config.ui;
    const who = narrative.speakers[line.who];
    // Julián de pie (llegada) o sentado; Federico siempre sentado
    const walking = line.who === 'julian' && this.walker;
    const anchor = walking ? this.walker.head_ : this.byId[`${line.who}_cabeza`];
    const ax = (walking ? this.walker.x : 0) + anchor.x + 9;
    const ay = (walking ? this.walker.y : 0) + anchor.y - 4;

    const name = this.txt(0, 0, who.name, who.color);
    const text = this.txt(0, 10, wrap(line.text, 150), U.text);
    const bw = Math.max(name.width, text.width) + 6;
    const bh = 10 + text.height + 4;
    const half = config.meta.width / 2;
    const left = Phaser.Math.Clamp(Math.round(ax - bw / 2), this.camCenter.x - half + 3, this.camCenter.x + half - bw - 3);
    const top = Math.round(ay - bh);
    const bg = this.add.rectangle(0, 0, bw, bh, col(U.hudBg), 0.85).setOrigin(0);
    const tail = this.add.rectangle(Phaser.Math.Clamp(Math.round(ax) - left - 1, 3, bw - 5), bh, 3, 2, col(U.hudBg), 0.85).setOrigin(0);
    name.setPosition(3, 2);
    text.setPosition(3, 12);
    const bubble = this.add.container(left, top, [bg, tail, name, text]).setDepth(950).setAlpha(0);
    this.uiCam.ignore(bubble);

    const ms = Math.max(T.lineMin, line.text.length * T.perChar);
    return this.tween({ targets: bubble, alpha: 1, duration: 150 })
      .then(() => new Promise((r) => {
        const timer = this.time.delayedCall(ms, () => done());
        const done = () => {
          timer.remove();
          this.continueResolve = null;
          r();
        };
        this.continueResolve = done;
      }))
      .then(() => this.tween({ targets: bubble, alpha: 0, duration: 150 }))
      .then(() => bubble.destroy());
  }

  async nextTurn() {
    const t = this.turns[++this.turnIndex];
    if (!t) return this.finale();
    const T = config.timing;
    this.state = 'busy';
    this.narr.setText('');

    // Elipsis: fundido, placa de acto/hora, y el escritorio cambia mientras está negro.
    await this.tween({ targets: this.black, alpha: 1, duration: T.fadeOut });
    this.startDay(); // monitores y foto se activan a partir de la placa del primer acto (no en la llegada)
    if (t.ti === 0) await this.showCard(t.act.card, t.act.cardSub, T.actCard);
    this.applyAct(t);
    (t.deskAdd ?? []).forEach((id) => this.addDeskObject(id));
    this.stats.pendientes += t.pendientesAdd ?? 0;
    this.updateHUD();
    await this.showCard(t.time, null, T.timeCard);
    await this.tween({ targets: this.black, alpha: 0, duration: T.fadeIn });

    if (t.event === 'sombra') this.time.delayedCall(t.eventDelay ?? 800, () => this.crossShadow());
    await this.type(t.text);
    if (this.checkHelp()) {
      // turno de la oportunidad: un aviso aparte para que se note
      await this.waitContinue();
      await this.type(narrative.help.unlockText);
    }
    this.state = 'choose';
    this.setButtonsEnabled(true);
  }

  // "Pedir ayuda" se habilita en un solo turno (config.rules.askForHelp.turn), y solo si Julián se cuidó
  // toda la jornada. Si en ese turno elige otra cosa, la oportunidad pasa y el botón vuelve a bloquearse.
  checkHelp() {
    const R = config.rules.askForHelp;
    const on = !!R?.enabled && this.turnIndex + 1 === R.turn && this.care.minEnergia >= R.minEnergy && this.care.maxSueno <= R.maxSleep;
    this.setHelp(on);
    return on;
  }

  // Botón "Pedir ayuda" habilitado (verde, con un borde que titila) o bloqueado.
  setHelp(on) {
    this.helpOn = on;
    const b = this.buttons.find((x) => x.a.id === 'ayuda');
    if (!b) return;
    b.label.setTint(col(on ? config.ui.helpText : config.ui.btnTextDisabled));
    this.helpRing ??= this.ui(
      this.add.rectangle(b.bg.x - 1, b.bg.y - 1, b.bg.width + 2, b.bg.height + 2).setOrigin(0).setStrokeStyle(1, col(config.ui.helpText)),
      1003,
    );
    this.tweens.killTweensOf(this.helpRing);
    this.helpRing.setVisible(on).setAlpha(1);
    if (on) this.tweens.add({ targets: this.helpRing, alpha: 0.15, duration: 450, yoyo: true, repeat: -1 });
  }

  applyAct(t) {
    const act = t.act;
    this.header.setText(normalize(`${act.name} · ${t.time}`));
    this.setClock(t.time);
    if (act.window) this.byId.ventana?.setTint(col(act.window));
    this.ambient.setFillStyle(col(act.ambient?.color ?? 'negro'), act.ambient?.alpha ?? 0);
    this.special.lluvia?.setVisible(!!act.rain);
    this.special.brillo?.setVisible((act.glow ?? 0) > 0 && this.monitorsOn).setAlpha(act.glow ?? 0);
  }

  addDeskObject(id) {
    if (id.startsWith('pool:')) return this.spawnFromPool(id.slice(5));
    this.deskObjects[id]?.setVisible(true);
  }

  spawnFromPool(name) {
    const id = this.pools[name]?.shift();
    if (id) this.deskObjects[id]?.setVisible(true);
  }

  async choose(i) {
    const a = actions.list[i];
    if (this.viewer) return this.closePhotos();
    if (!a || this.state !== 'choose') return;
    if (a.id === 'ayuda' && this.helpOn) return this.askForHelp();
    if (a.disabled) return this.refuse(i);
    if (this.helpOn) this.setHelp(false); // eligió otra cosa: la oportunidad pasa
    this.state = 'busy';
    this.setButtonsEnabled(false);
    const t = this.turns[this.turnIndex];

    this.applyEffects(a, t);
    await this.actionVisual(a.visual);
    if (config.rules.sleepAtZeroEnergy && this.stats.energia <= 0) return this.fallAsleep();
    if (a.spawnPool) this.spawnFromPool(a.spawnPool);
    await this.type(this.pickResponse(a, t));
    await this.waitContinue();

    if (this.stats.ruido >= this.ruidoMax) this.finale();
    else this.nextTurn();
  }

  applyEffects(a, t) {
    const e = a.effects ?? {};
    for (const k of ['energia', 'sueno', 'pendientes']) {
      if (e[k]) this.stats[k] = Phaser.Math.Clamp(this.stats[k] + e[k], 0, config.stats[k].max ?? Infinity);
    }
    // para el final de pedir ayuda: lo más bajo que llegó la energía y lo más alto el sueño
    this.care.minEnergia = Math.min(this.care.minEnergia, this.stats.energia);
    this.care.maxSueno = Math.max(this.care.maxSueno, this.stats.sueno);
    // Ruido sube siempre, elijas lo que elijas.
    const R = config.ruido;
    let r = this.stats.ruido + t.act.ruidoBase + Math.max(R.minPerAction, e.ruido ?? 0);
    const last = this.turnIndex === this.turns.length - 1;
    if (!last) r = Math.min(r, R.capBeforeLastTurn);
    else if (R.forceMaxOnLastTurn) r = this.ruidoMax;
    this.updateHUD();
    this.setRuido(r, config.timing.ruidoTween);
  }

  pickResponse(a, t) {
    if (t.responses?.[a.id]) return t.responses[a.id];
    const list = a.responses?.[t.act.id] ?? a.responses?.default ?? [''];
    this.usage[a.id] = (this.usage[a.id] ?? -1) + 1;
    return list[this.usage[a.id] % list.length];
  }

  refuse(i) {
    const b = this.buttons[i];
    if (b.busy) return;
    b.busy = true;
    const options = b.a.refusals ?? ['...'];
    let line;
    do line = Phaser.Utils.Array.GetRandom(options);
    while (options.length > 1 && line === this.lastRefusal);
    this.lastRefusal = line;
    b.label.setText(normalize(line));
    this.tweens.add({ targets: [b.bg, b.label], x: '+=1', yoyo: true, repeat: 2, duration: 40 });
    this.time.delayedCall(1600, () => {
      b.label.setText(normalize(b.text));
      b.busy = false;
    });
  }

  async actionVisual(kind) {
    const julian = [this.byId.julian_cuerpo, this.byId.julian_cabeza].filter(Boolean);
    switch (kind) {
      case 'type':
        this.tweens.add({ targets: this.byId.pantalla, alpha: 0.7, yoyo: true, repeat: 3, duration: 50 });
        await this.tween({ targets: julian, y: '+=1', yoyo: true, repeat: 3, duration: 70 });
        break;
      case 'sip':
        await this.tween({ targets: this.byId.julian_cabeza, y: '-=2', yoyo: true, hold: 500, duration: 200 });
        break;
      case 'blink':
        this.audio.emphasize(config.audio.eyesClosedBoost, 2000);
        await this.tween({ targets: this.black, alpha: 1, duration: 450 });
        await this.wait(1100);
        await this.tween({ targets: this.black, alpha: 0, duration: 450 });
        break;
      case 'flash':
        this.flash.setAlpha(0.85);
        await this.tween({ targets: this.flash, alpha: 0, duration: 700 });
        break;
      case 'twitch':
        await this.tween({ targets: julian, x: '+=1', yoyo: true, repeat: 2, duration: 60 });
        break;
    }
  }

  crossShadow() {
    const def = layout.special.sombra;
    const s = this.special.sombra;
    s.setPosition(def.x, def.y).setAlpha(0).setVisible(true);
    this.tweens.add({ targets: s, x: def.toX, duration: def.duration, onComplete: () => s.setVisible(false) });
    this.tweens.add({ targets: s, alpha: def.alpha, duration: 400, yoyo: true, hold: def.duration - 800 });
  }

  // ---------- derrota: sin energía ----------

  async fallAsleep() {
    unlockEnding('dormido');
    const s = narrative.asleep;
    const T = s.timing;
    this.state = 'asleep';
    this.setButtonsEnabled(false);
    this.buttons.forEach((b) => b.bg.disableInteractive());
    if (s.text) {
      await this.type(s.text);
      await this.wait(T.afterText);
    }

    // Cabeceos: la cabeza cae, los párpados pesan (la pantalla se oscurece de a poco) y el sonido se apaga.
    this.audio.silence(T.soundFade / 1000);
    const head = this.byId.julian_cabeza;
    const lids = [0.55, 0.15, 0.8, 0.35, 1];
    for (let i = 0; i < lids.length; i++) {
      const down = i % 2 === 0;
      if (head) this.tween({ targets: head, y: down ? '+=2' : '-=1', duration: T.nod, ease: 'Sine.easeInOut' });
      await this.tween({ targets: this.black, alpha: lids[i], duration: T.nod, ease: 'Sine.easeInOut' });
    }
    await this.wait(T.black);

    this.card.setScale(2).setText(normalize(s.title)).setAlpha(0);
    this.cardSub.setText(wrap(s.sub, 240)).setAlpha(0);
    await this.tween({ targets: this.card, alpha: 1, duration: T.textFade });
    await this.tween({ targets: this.cardSub, alpha: 1, duration: T.textFade });
    await this.wait(T.textHold);
    await this.tween({ targets: [this.card, this.cardSub], alpha: 0, duration: T.textFade });
    this.scene.start(s.goTo ?? 'Menu');
  }

  // ---------- final alternativo: pedir ayuda ----------

  async askForHelp() {
    unlockEnding('ayuda');
    const P = narrative.help;
    const T = P.timing;
    this.state = 'finale';
    this.setButtonsEnabled(false);
    this.buttons.forEach((b) => b.bg.disableInteractive());
    this.helpRing?.setVisible(false);
    this.narr.setText('');

    // Julián gira hacia Federico; la cámara se corre para que entren los dos.
    const julian = ['julian_cuerpo', 'julian_cabeza', 'julian_silla'].map((id) => this.byId[id]).filter(Boolean);
    this.tween({ targets: julian, x: '+=3', duration: 400, ease: 'Sine.easeOut' });
    this.tween({ targets: this.hudParts, alpha: 0, duration: 400 }); // acá importan los pendientes, no las barras
    await this.tween({ targets: this.camCenter, x: P.cameraX, duration: T.pan, ease: 'Sine.easeInOut' });

    // Él lo decide: el Ruido se corta y la oscuridad se abre; recién entonces habla (así el globo se lee).
    this.audio.silence(T.silenceFade / 1000);
    this.shakeK = 0;
    this.tweenFX(0, T.fxRelease);
    await this.wait(T.fxRelease + T.silenceAfter);
    const [first, ...rest] = P.lines;
    await this.say(first);

    // Federico gira y acerca la silla.
    this.tween({ targets: this.byId.federico_cabeza, x: '-=2', duration: 250 });
    for (const line of rest) await this.say(line);
    const moves = Object.entries(layout.finaleMoves ?? {}).filter(([id]) => !id.startsWith('_'));
    await this.tween({ targets: moves.map(([id]) => this.byId[id]), duration: T.roll, ease: 'Sine.easeInOut', x: (target) => moves.find(([id]) => this.byId[id] === target)[1].x });

    // Las tareas, entre los dos, bajan a 0.
    if (P.text) await this.type(P.text);
    await new Promise((res) => {
      const ev = this.time.addEvent({
        delay: T.taskTick,
        loop: true,
        callback: () => {
          this.stats.pendientes = Math.max(0, this.stats.pendientes - 1);
          this.updateHUD();
          if (!this.stats.pendientes) {
            ev.remove();
            res();
          }
        },
      });
    });
    await this.wait(T.hold);

    // Negro y placa.
    await this.tween({ targets: this.black, alpha: 1, duration: T.fadeOut });
    this.card.setScale(config.font.placaScale).setText(normalize(P.placa)).setAlpha(0);
    await this.tween({ targets: this.card, alpha: 1, duration: T.placaFade });
    await this.wait(T.placaHold);
    const f = narrative.finale;
    this.cardSub.setText(normalize(f.restart)).setAlpha(0);
    this.tween({ targets: this.cardSub, alpha: 0.6, duration: 800 });
    if (f.film?.url) this.tween({ targets: this.filmButton(f.film), alpha: 1, duration: 800, delay: 600 });
    this.state = 'end';
  }

  // ---------- final ----------

  async finale() {
    unlockEnding('federico');
    const f = narrative.finale;
    const T = f.timing;
    this.state = 'finale';
    this.setButtonsEnabled(false);
    this.buttons.forEach((b) => b.bg.disableInteractive());
    this.setRuido(this.ruidoMax, 400);
    this.narr.setText('');
    if (f.lockedText) await this.type(f.lockedText);

    // El encuadre se cierra todavía más sobre Julián; fuera de cuadro, Federico acerca la silla.
    const ci = config.camera.closeIn;
    if (ci) {
      this.cameras.main.zoomTo(ci.zoom, ci.duration, 'Sine.easeInOut');
      await this.tween({ targets: this.camCenter, x: ci.x, y: ci.y, duration: ci.duration, ease: 'Sine.easeInOut' });
    }
    for (const [id, pos] of Object.entries(layout.finaleMoves ?? {})) {
      if (!id.startsWith('_')) this.byId[id]?.setPosition(pos.x, pos.y);
    }
    await this.wait(T.beforeHand);

    // Una mano en el hombro.
    const dx = layout.special.brazo.enterOffset ?? 80;
    const hand = ['brazo', 'mano'].map((id) => {
      const def = layout.special[id];
      return this.special[id].setPosition(def.x + dx, def.y).setVisible(true);
    });
    await this.tween({ targets: hand, x: `-=${dx}`, duration: T.handIn, ease: 'Sine.easeOut' });

    // Silencio total.
    this.audio.silence(T.silenceFade / 1000);
    this.shakeK = 0;
    this.tweenFX(0, T.fxRelease);
    await this.wait(T.holdSilence);

    // La cámara se abre: Federico, en el escritorio de al lado.
    const uiTargets = this.fadeable.concat(this.buttons.flatMap((b) => [b.bg, b.label]));
    await this.tween({ targets: uiTargets, alpha: 0, duration: T.uiFade });
    const rv = config.camera.reveal;
    const cam = this.cameras.main;
    this.camFree = true;
    cam.pan(rv.x, rv.y, rv.duration, 'Sine.easeInOut');
    cam.zoomTo(rv.zoom, rv.duration, 'Sine.easeInOut');
    await this.wait(rv.duration + T.holdReveal);

    // Corte a negro y placa.
    this.black.setAlpha(1);
    await this.wait(T.blackBeforePlaca);
    this.card.setScale(config.font.placaScale).setText(normalize(f.placa)).setAlpha(0);
    await this.tween({ targets: this.card, alpha: 1, duration: T.placaFade });
    await this.wait(T.placaHold);
    this.cardSub.setText(normalize(f.restart)).setAlpha(0);
    this.tween({ targets: this.cardSub, alpha: 0.6, duration: 800 });
    if (f.film?.url) this.tween({ targets: this.filmButton(f.film), alpha: 1, duration: 800, delay: 600 });
    this.state = 'end';
  }

  // Botón de la pantalla final que abre el cortometraje en otra pestaña.
  filmButton(film) {
    const U = config.ui;
    // Todo en coordenadas enteras (si no, el borde se ve doble). Las mayúsculas ocupan las filas 0–6
    // de la fuente, así que el texto arranca 4 px abajo del borde para quedar centrado en los 15 px.
    const top = H / 2 + 28, h = 15, pad = 8, gap = 5;
    const label = this.ui(this.txt(0, top + 4, film.label, U.btnText), 5003);
    const icon = this.ui(this.add.image(0, top + 3, 'icono_youtube').setOrigin(0), 5003);
    const textW = label.width - 1; // sin el espacio que queda después de la última letra
    const content = icon.width + gap + textW;
    const bw = content + 2 * pad + ((W - content) % 2); // ancho de igual paridad que la pantalla: centro exacto
    const left = (W - bw) / 2;
    icon.setX((W - content) >> 1);
    label.setX(icon.x + icon.width + gap);
    const bg = this.ui(this.add.rectangle(left, top, bw, h, col(U.btn)).setOrigin(0), 5002);
    const border = this.ui(this.add.rectangle(left - 1, top - 1, bw + 2, h + 2, col(U.panelLine)).setOrigin(0), 5001);
    bg.setInteractive({ cursor: CURSOR.hover });
    bg.on('pointerover', () => bg.setFillStyle(col(U.btnHover)));
    bg.on('pointerout', () => bg.setFillStyle(col(U.btn)));
    bg.on('pointerdown', (p, lx, ly, ev) => ev.stopPropagation()); // que no vuelva al menú
    bg.on('pointerup', () => window.open(film.url, '_blank', 'noopener'));
    return [border.setAlpha(0), bg.setAlpha(0), icon.setAlpha(0), label.setAlpha(0)];
  }
}
