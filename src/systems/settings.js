// Preferencias del jugador (volumen y resolución), guardadas en el navegador.
import { config } from '../data/index.js';

const KEY = 'ruido.settings';
const DEFAULTS = { volume: 0.8, zoom: 'max' };
const { width: W, height: H } = config.meta;

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export const settings = {
  get volume() {
    return state.volume;
  },
  set volume(v) {
    state.volume = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    save();
  },
  // 'max' = el mayor múltiplo entero que entra en la ventana (se recalcula al redimensionar)
  get zoom() {
    return state.zoom;
  },
  set zoom(z) {
    state.zoom = z;
    save();
  },
};

export const maxZoom = () =>
  Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));

export const currentZoom = () => (state.zoom === 'max' ? maxZoom() : Math.min(state.zoom, maxZoom()));

export const applyZoom = (game) => game.scale.setZoom(currentZoom());
