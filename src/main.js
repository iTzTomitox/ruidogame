import Phaser from 'phaser';
import { config } from './data/index.js';
import { currentZoom, applyZoom } from './systems/settings.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import ObjectiveScene from './scenes/ObjectiveScene.js';
import DeskScene from './scenes/DeskScene.js';

const { width, height } = config.meta;

// Escalado pixel-perfect: siempre un múltiplo entero de la resolución base (ver Resolución en el menú).
const game = new Phaser.Game({
  type: Phaser.WEBGL, // los postFX (saturación, viñeta) necesitan WebGL
  parent: 'game',
  width,
  height,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.NONE, zoom: currentZoom() },
  scene: [BootScene, MenuScene, ObjectiveScene, DeskScene],
});
window.addEventListener('resize', () => applyZoom(game));
window.__game = game;
