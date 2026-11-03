// Logros: qué finales ya vio el jugador, guardados en el navegador (como las preferencias).
import { narrative } from '../data/index.js';

const KEY = 'ruido.finales';

function load() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return new Set();
  }
}

const seen = load();

export const endings = () => narrative.achievements.endings;

export const isUnlocked = (id) => seen.has(id);

export const unlockedCount = () => endings().filter((e) => seen.has(e.id)).length;

// Se llama al llegar a un final (ids en narrative.json → achievements.endings).
export function unlockEnding(id) {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {}
}
