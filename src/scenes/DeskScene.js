import Phaser from 'phaser';
import { config, scene as layout, actions, narrative } from '../data/index.js';
import AudioEngine from '../systems/AudioEngine.js';
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

    // HUD dentro del panel, para no tapar la escena: stats visibles (Ruido no se muestra) + acto/hora.
    const hy = 140;
    keep(this.ui(this.add.rectangle(4, hy - 3, W - 8, 1, col(U.panelLine)).setOrigin(0), 1001));
    this.barW = 30;
    this.bars = {};
    [['energia', 6], ['sueno', 78]].forEach(([k, x]) => {
      const s = config.stats[k];
      const label = keep(this.ui(this.txt(x, hy, s.label, U.textDim), 1001));
      const bx = x + label.width + 3;
      keep(this.ui(this.add.rectangle(bx, hy + 2, this.barW, 4, col(U.barBg)).setOrigin(0), 1001));
      this.bars[k] = keep(this.ui(this.add.rectangle(bx, hy + 2, this.barW, 4, col(s.color)).setOrigin(0), 1002));
    });
    const pend = keep(this.ui(this.txt(146, hy, config.stats.pendientes.label, U.textDim), 1001));
    this.pendText = keep(this.ui(this.txt(146 + pend.width + 4, hy, '', U.text), 1001));
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
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => this.state === 'choose' && bg.setFillStyle(col(U.btnHover)));
      bg.on('pointerout', () => bg.setFillStyle(col(U.btn)));
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
    this.nextTurn();
  }

  async nextTurn() {
    const t = this.turns[++this.turnIndex];
    if (!t) return this.finale();
    const T = config.timing;
    this.state = 'busy';
    this.narr.setText('');

    // Elipsis: fundido, placa de acto/hora, y el escritorio cambia mientras está negro.
    await this.tween({ targets: this.black, alpha: 1, duration: T.fadeOut });
    if (t.ti === 0) await this.showCard(t.act.card, t.act.cardSub, T.actCard);
    this.applyAct(t);
    (t.deskAdd ?? []).forEach((id) => this.addDeskObject(id));
    this.stats.pendientes += t.pendientesAdd ?? 0;
    this.updateHUD();
    await this.showCard(t.time, null, T.timeCard);
    await this.tween({ targets: this.black, alpha: 0, duration: T.fadeIn });

    if (t.event === 'sombra') this.time.delayedCall(t.eventDelay ?? 800, () => this.crossShadow());
    await this.type(t.text);
    this.state = 'choose';
    this.setButtonsEnabled(true);
  }

  applyAct(t) {
    const act = t.act;
    this.header.setText(normalize(`${act.name} · ${t.time}`));
    if (act.window) this.byId.ventana?.setTint(col(act.window));
    this.ambient.setFillStyle(col(act.ambient?.color ?? 'negro'), act.ambient?.alpha ?? 0);
    this.special.lluvia?.setVisible(!!act.rain);
    this.special.brillo?.setVisible((act.glow ?? 0) > 0).setAlpha(act.glow ?? 0);
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
    if (!a || this.state !== 'choose') return;
    if (a.disabled) return this.refuse(i);
    this.state = 'busy';
    this.setButtonsEnabled(false);
    const t = this.turns[this.turnIndex];

    this.applyEffects(a, t);
    await this.actionVisual(a.visual);
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

  // ---------- final ----------

  async finale() {
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
    this.state = 'end';
  }
}
