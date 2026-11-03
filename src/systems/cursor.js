// Cursores pixel art (public/cursor*.png): flecha normal, mano inclinada sobre lo clickeable
// y mano con rayitas mientras se hace click. Cada uno tiene versión @2x para pantallas de alta densidad.
const css = (name, x, y, fallback) => {
  const set = `image-set(url("${name}.png") 1x, url("${name}@2x.png") 2x) ${x} ${y}, ${fallback}`;
  return CSS.supports('cursor', set) ? set : `url("${name}.png") ${x} ${y}, ${fallback}`;
};

// el último par de números es el punto que hace click (punta de la flecha / del dedo)
export const CURSOR = {
  normal: css('cursor', 0, 0, 'auto'),
  hover: css('cursor_hover', 2, 2, 'pointer'),
  click: css('cursor_click', 11, 6, 'pointer'),
};

// El navegador reescribe el valor al asignarlo; para comparar hay que usar su forma normalizada.
const normalized = (value) => {
  const probe = document.createElement('div');
  probe.style.cursor = value;
  return probe.style.cursor;
};

// Phaser pone CURSOR.hover al pasar por un objeto clickeable (setInteractive({ cursor: CURSOR.hover }))
// y vuelve al normal al salir; acá solo se cambia a la mano de click mientras el botón está apretado.
export function setupCursors(game) {
  const canvas = game.canvas;
  const hover = normalized(CURSOR.hover), click = normalized(CURSOR.click);
  game.input.setDefaultCursor(CURSOR.normal);
  canvas.addEventListener('pointerdown', () => {
    if (canvas.style.cursor === hover) canvas.style.cursor = CURSOR.click;
  });
  window.addEventListener('pointerup', () => {
    if (canvas.style.cursor === click) canvas.style.cursor = CURSOR.hover;
  });
}
