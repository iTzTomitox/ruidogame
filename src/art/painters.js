// Pixel art procedural: cada sprite de scene.json con "paint" se dibuja acá, pixel por pixel,
// usando solo colores de la paleta. Si un sprite tiene "file", se usa la imagen y esto se ignora.
import { hex } from '../systems/palette.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function mix(a, b, t) {
  const pa = parseInt(hex(a).slice(1), 16), pb = parseInt(hex(b).slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function makePainter(ctx, w, h, key) {
  const p = { w, h, rng: mulberry32(seedOf(key)) };
  p.rect = (x, y, rw, rh, c) => {
    // siempre en coordenadas enteras: nada de antialiasing
    ctx.fillStyle = hex(c);
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(rw), Math.round(rh));
  };
  p.px = (x, y, c) => x >= 0 && y >= 0 && x < w && y < h && p.rect(x | 0, y | 0, 1, 1, c);
  p.hline = (x, y, len, c) => p.rect(x, y, len, 1, c);
  p.vline = (x, y, len, c) => p.rect(x, y, 1, len, c);
  p.outline = (x, y, rw, rh, c) => {
    p.hline(x, y, rw, c);
    p.hline(x, y + rh - 1, rw, c);
    p.vline(x, y, rh, c);
    p.vline(x + rw - 1, y, rh, c);
  };
  p.clear = (x, y, rw, rh) => ctx.clearRect(x, y, rw, rh);
  p.noise = (x, y, rw, rh, c, d) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) if (p.rng() < d) p.px(i, j, c);
  };
  p.bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16;
  // degradado vertical con dither ordenado (de c1 arriba a c2 abajo)
  p.vgrad = (x, y, rw, rh, c1, c2) => {
    for (let j = 0; j < rh; j++)
      for (let i = 0; i < rw; i++) p.px(x + i, y + j, p.bayer(x + i, y + j) < j / rh ? c2 : c1);
  };
  p.ellipse = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) p.px(x, y, c);
  };
  p.mix = mix;
  p.dk = (c, t = 0.3) => mix(c, '#000000', t);
  p.lt = (c, t = 0.3) => mix(c, '#ffffff', t);
  p.pick = (arr) => arr[Math.floor(p.rng() * arr.length)];
  return p;
}

// Dibuja un mini-bitmap ('#' = color, '.' = nada) en (x, y).
const stamp = (p, x, y, rows, c) =>
  rows.forEach((r, j) => [...r].forEach((ch, i) => ch === '#' && p.px(x + i, y + j, c)));

export const PAINTERS = {
  // Fondo del menú: ciudad al atardecer en capas (de rosa lejano a verde azulado cercano).
  // part: 'back' (cielo + capas lejanas + vía del tren), 'front' (capas cercanas + autopista) o 'all'.
  // mode 'base' pinta todo menos las luces rojas; mode 'lights' pinta solo las luces (para titilar).
  // Usa una semilla fija para que todas las pasadas generen exactamente la misma ciudad.
  city(p, [part = 'all', mode = 'base']) {
    const rng = mulberry32(1987);
    const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const base = mode !== 'lights';
    let cur = 0; // capa que se está generando
    const FRONT_FROM = 4;
    const inPart = () => part === 'all' || (part === 'back' ? cur < FRONT_FROM : cur >= FRONT_FROM);
    const R = (x, y, w, h, c) => base && inPart() && p.rect(x, y, w, h, c);
    const light = (x, y) => !base && inPart() && p.rect(x, y, 2, 2, 'luz_roja');

    if (base && part !== 'front') {
      p.rect(0, 0, p.w, p.h, 'ciudad_cielo');
      p.vgrad(0, 40, p.w, 60, 'ciudad_cielo', 'ciudad_1');
      p.rect(0, 100, p.w, p.h - 100, 'ciudad_1');
      p.rect(226, 0, 20, 30, 'blanco');
      p.rect(248, 0, 12, 18, 'blanco');
      p.hline(226, 30, 20, 'amarillo');
    }

    const layers = [
      { c: 'ciudad_1', top: [6, 40], w: [14, 30], win: 'ciudad_cielo', winP: 0.55 },
      { c: 'ciudad_2', top: [28, 70], w: [16, 36], win: 'ciudad_1', lights: true },
      { c: 'ciudad_3', top: [55, 95], w: [18, 40], win: 'ciudad_2', lights: true },
      { c: 'ciudad_4', top: [82, 118], w: [20, 44], win: 'ciudad_3', lights: true, lit: ['luz_roja'] },
      { c: 'ciudad_6', top: [110, 135], w: [22, 50], win: 'ciudad_5', lights: true, lit: ['ventana_verde'] },
      { c: 'ciudad_8', top: [132, 156], w: [28, 60], win: 'ciudad_7', lights: true, lit: ['ventana_verde', 'ventana_amarilla'] },
    ];

    layers.forEach((L, li) => {
      cur = li;
      let x = -ri(0, 10);
      while (x < p.w) {
        const w = ri(...L.w), top = ri(...L.top);
        R(x, top, w, p.h - top, L.c);
        // baranda en la terraza y antena
        if (rng() < 0.5) for (let i = x + 1; i < x + w - 1; i += 2) R(i, top - 2, 1, 2, L.c);
        if (rng() < 0.3) {
          const ax = x + ri(3, Math.max(3, w - 4)), ah = ri(4, 10);
          R(ax, top - ah, 1, ah, L.c);
          R(ax - 2, top - ah + 2, 5, 1, L.c);
        }
        // ventanas: bandas horizontales o grilla
        const bands = rng() < 0.3;
        for (let wy = top + 4; wy < p.h - 2; wy += bands ? 3 : 5) {
          if (bands) {
            R(x + 3, wy, w - 6, 1, L.win);
            continue;
          }
          for (let wx = x + 3; wx < x + w - 4; wx += 5) {
            const r = rng();
            if (L.lit && r < 0.07) R(wx, wy, 3, 2, L.lit[ri(0, L.lit.length - 1)]);
            else if (r < (L.winP ?? 0.75)) R(wx, wy, 3, 2, L.win);
          }
        }
        if (L.lights) {
          if (rng() < 0.7) light(x + 1, top - 2);
          if (rng() < 0.5) light(x + w - 3, top - 2);
        }
        x += w + ri(0, 3);
      }

      if (li === 1) {
        // grúa
        R(268, 46, 2, 50, 'ciudad_3');
        R(250, 46, 34, 2, 'ciudad_3');
        R(280, 48, 1, 12, 'ciudad_3');
        R(278, 60, 4, 3, 'ciudad_3');
        for (let i = 0; i < 6; i++) R(264 - i, 40 + i, 1, 1, 'ciudad_3');
      }
      if (li === 2) {
        // puente con arcos
        R(120, 112, 110, 3, 'ciudad_4');
        for (let ax = 120; ax < 230; ax += 22)
          for (let i = 0; i <= 22; i += 2) {
            const h = Math.round(9 * Math.sin((Math.PI * i) / 22));
            R(ax + i, 112 - h, 1, h, 'ciudad_4');
          }
        [140, 186].forEach((px) => R(px, 115, 3, 30, 'ciudad_4'));
      }
      if (li === 3) {
        // vía elevada con postes de luz y cables
        R(0, 142, p.w, 3, 'ciudad_6');
        for (let i = 0; i < p.w; i += 3) R(i, 139, 1, 3, 'ciudad_6');
        for (let px = 30; px < p.w; px += 46) {
          R(px, 116, 1, 26, 'ciudad_6');
          R(px - 3, 118, 7, 1, 'ciudad_6');
          R(px - 2, 121, 5, 1, 'ciudad_6');
        }
        R(0, 119, p.w, 1, 'ciudad_5');
      }
    });

    // autopista en primer plano (por arriba van los autos) con baranda, pilares y faroles
    cur = FRONT_FROM;
    // vía elevada del tren, justo por encima de la autopista
    R(0, 141, p.w, 2, 'ciudad_7');
    R(0, 141, p.w, 1, 'ciudad_5');
    for (let sx = 10; sx < p.w; sx += 40) R(sx, 143, 3, 4, 'ciudad_7');
    R(0, 147, p.w, 1, 'ciudad_8');
    for (let i = 0; i < p.w; i += 4) R(i, 147, 1, 4, 'ciudad_8');
    R(0, 150, p.w, 1, 'ciudad_6');
    R(0, 151, p.w, 4, 'ciudad_8');
    for (let px = 20; px < p.w; px += 64) R(px, 155, 5, 25, 'ciudad_8');
    for (let fx = 44; fx < p.w; fx += 64) {
      R(fx, 138, 1, 10, 'ciudad_8');
      R(fx, 138, 4, 1, 'ciudad_8');
      R(fx + 3, 139, 2, 1, 'ventana_rosa');
    }
  },

  // Auto visto de costado, mirando a la derecha (se espeja para el otro sentido).
  car(p, [c]) {
    p.rect(0, 2, p.w, 2, c);
    p.rect(2, 0, p.w - 5, 2, c);
    p.rect(3, 0, 2, 1, 'ciudad_5');
    p.rect(6, 0, 2, 1, 'ciudad_5');
    p.px(p.w - 1, 2, 'ventana_amarilla');
    p.px(0, 2, 'luz_roja');
    p.px(2, 4, 'negro');
    p.px(p.w - 3, 4, 'negro');
  },

  // Tren de varios vagones con ventanas iluminadas.
  train(p) {
    const car = 30;
    for (let x = 0; x < p.w; x += car + 2) {
      const w = Math.min(car, p.w - x);
      p.rect(x, 1, w, 6, 'ciudad_6');
      p.hline(x + 1, 0, w - 2, 'ciudad_6');
      p.hline(x, 7, w, 'ciudad_8');
      for (let wx = x + 3; wx < x + w - 3; wx += 4) p.rect(wx, 2, 2, 2, 'ventana_rosa');
      p.rect(x + w, 4, 2, 1, 'ciudad_8');
    }
    p.px(p.w - 1, 3, 'ventana_amarilla');
  },

  // Ave en dos cuadros de aleteo.
  bird(p, [frame]) {
    const rows = frame === 1 ? ['#...#', '.#.#.', '..#..'] : ['.....', '##.##', '..#..'];
    stamp(p, 0, 0, rows, 'ciudad_4');
  },

  // Logo de YouTube para el botón del cortometraje (13x9): píldora roja con brillo arriba a la izquierda.
  youtube(p) {
    const body = ['..#########..', '.###########.', '#############', '#############', '#############', '#############', '#############', '.###########.', '..#########..'];
    stamp(p, 0, 0, body, 'yt_rojo');
    stamp(p, 0, 0, ['.............', '.###.........', '##...........', '#............'], 'yt_brillo');
    stamp(p, 0, 0, ['', '', '', '', '', '', '............#', '.........###.', '........###..'], 'yt_osc');
    stamp(p, 5, 2, ['#...', '##..', '###.', '##..', '#...'], 'blanco');
  },

  wall(p) {
    p.rect(0, 0, p.w, p.h, 'pizarra');
    p.vgrad(0, 0, p.w, 110, 'pizarra_osc', 'pizarra');
    p.noise(0, 0, p.w, p.h, 'pizarra_osc', 0.05);
    p.noise(0, 0, p.w, p.h, 'pizarra_cla', 0.015);
    p.rect(0, p.h - 5, p.w, 5, 'sombra');
    p.hline(0, p.h - 6, p.w, 'pizarra_cla');
  },

  // Piso de madera: tablas que corren hacia la pared y convergen en perspectiva, con juntas
  // escalonadas, veta y brillo. Detalles de 2px para que se lean también con la cámara abierta (zoom 0.5).
  floor(p) {
    const base = p.mix('madera_osc', 'madera', 0.35);
    const tones = [base, p.dk(base, 0.15), p.mix(base, 'madera', 0.35), p.mix(base, 'sombra', 0.3), p.dk(base, 0.05)];
    const cx = p.w / 2, bw = 30;
    const hash = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let y = 0; y < p.h; y++) {
      const t = y / p.h;
      const scale = 0.5 + 0.5 * t; // las tablas se angostan hacia el fondo
      for (let x = 0; x < p.w; x++) {
        const u = (x - cx) / scale / bw + 100;
        const i = Math.floor(u), f = u - i;
        // juntas de punta: cada tabla tiene su propio desfase vertical
        const jy = (y + Math.floor(hash(i) * 60)) % 46;
        let c = tones[Math.floor(hash(i + 0.5) * tones.length)];
        if (f * bw * scale < 2) c = p.dk(base, 0.55); // junta lateral
        else if (f * bw * scale < 4) c = p.lt(c, 0.1); // brillo del canto
        else if (jy < 2) c = p.dk(base, 0.5); // junta de punta
        else if (Math.floor(f * 7 + hash(i + jy * 0.01) * 0.6) % 3 === 0 && (y >> 1) % 5 !== 0) c = p.dk(c, 0.06); // veta
        p.px(x, y, c);
      }
    }
    p.vgrad(0, 0, p.w, 16, 'negro', base);
    p.rect(0, 0, p.w, 2, 'negro');
  },

  ceilingLamp(p) {
    const cx = p.w >> 1;
    p.vline(cx, 0, 6, 'sombra');
    for (let y = 6; y < 11; y++) {
      const half = 6 + (y - 6) * 3;
      p.hline(cx - half, y, half * 2, y === 6 ? 'pizarra_cla' : 'pizarra_osc');
    }
    p.hline(cx - 16, 11, 32, 'hueso');
    p.hline(cx - 10, 12, 20, 'amarillo');
  },

  shelf(p) {
    p.hline(0, 0, p.w, 'madera_cla');
    p.rect(0, 1, p.w, p.h - 2, 'madera');
    p.hline(0, p.h - 1, p.w, 'madera_osc');
  },

  frame(p, [kind]) {
    p.rect(0, 0, p.w, p.h, 'madera_osc');
    p.outline(0, 0, p.w, p.h, 'negro');
    const x0 = 2, y0 = 2, iw = p.w - 4, ih = p.h - 4;
    if (kind === 'city') {
      p.rect(x0, y0, iw, ih, 'cielo_noche');
      p.noise(x0, y0, iw, 4, 'blanco', 0.12);
      let x = x0;
      while (x < x0 + iw) {
        const bw = 3 + Math.floor(p.rng() * 4), bh = 3 + Math.floor(p.rng() * (ih - 3));
        p.rect(x, y0 + ih - bh, Math.min(bw, x0 + iw - x), bh, 'pizarra_osc');
        p.noise(x, y0 + ih - bh + 1, Math.min(bw, x0 + iw - x), bh - 1, 'amarillo', 0.15);
        x += bw;
      }
    } else if (kind === 'stripes') {
      ['rosa', 'blanco', 'pantalla_cla', 'hueso', 'rosa'].forEach((c, i) => p.rect(x0, y0 + i * 2, iw, 2, c));
    } else if (kind === 'photo') {
      // Foto de los dos (22x10): uno con flequillo y auriculares, otro con gorra; anteojos negros.
      const C = {
        '.': null, h: '#4a3326', k: '#121218', s: '#e2b493', S: '#c08a6e', m: '#9a5a50', n: '#1f2740',
        w: 'blanco', c: '#1c2236', v: '#5a6488', r: 'cyan', R: 'rosa', t: '#cdd2ea', u: '#b7a9c4',
      };
      p.rect(x0, y0, 11, ih, '#8a7f74'); // pared cálida
      p.rect(x0 + 11, y0, 11, ih, '#3a4660'); // luz fría de pantalla
      const rows = [
        '...hhhhh.....ccccccc..',
        '..hhhhhhh...ccccccccc.',
        '.khssssshk..vvvvvvvvv.',
        '.kkkkkkkkk..kuuuuuuuk.',
        '.ksssSsssk..kkrkkkRkk.',
        '..sssssSs....uuuuuuu..',
        '...ssmss......uumuu...',
        '..nnswsnn....nntttnn..',
        '.nnnnwnnnn..nnnttttnn.',
        'nnnnnwnnnnnnnnnttttnnn',
      ];
      rows.forEach((r, j) => [...r].forEach((ch, i) => C[ch] && p.px(x0 + i, y0 + j, C[ch])));
    } else {
      p.vgrad(x0, y0, iw, ih, 'pantalla', 'cielo_dia');
      p.ellipse(x0 + 5, y0 + 3, 3, 1, 'blanco');
      p.rect(x0 + iw - 7, y0 + 3, 5, ih - 3, 'gris_azul');
      p.px(x0 + iw - 5, y0 + 5, 'hueso');
      p.px(x0 + iw - 5, y0 + 8, 'hueso');
    }
  },

  // Retratos grandes de la foto del estante (se ven al hacer click en el cuadro).
  // 'a': flequillo castaño, auriculares negros con micrófono, luz cálida.
  // 'b': gorra azul, auriculares con luz, anteojos que reflejan la pantalla, luz fría.
  portrait(p, [who]) {
    const W = p.w, H = p.h, cx = W >> 1;
    const A = who === 'a';
    const P = A
      ? { bg1: '#9a8e80', bg2: '#5e554d', skin: '#e2b493', shade: '#c08a6e', dark: '#9c6a55', blazer: '#1f2740', lapel: '#2e3a5c', shirt: '#eceae2', mouth: '#9a5a50' }
      : { bg1: '#5a6a88', bg2: '#1a2030', skin: '#cdbccc', shade: '#9a90b0', dark: '#6e6890', blazer: '#141a2c', lapel: '#232c48', shirt: '#cdd2ea', mouth: '#6e5068' };
    // fondo en franjas lisas (sin trama, que en grande se ve como una reja)
    for (let i = 0; i < 4; i++) p.rect(0, Math.round((H * i) / 4), W, Math.ceil(H / 4), p.mix(P.bg1, P.bg2, i / 3));
    if (A) {
      for (let x = W - 14; x < W; x++) p.px(x, Math.round((x - (W - 14)) * 0.6), '#c2b4a2'); // esquina del techo
      p.rect(0, 0, 5, H, '#4e463f');
    } else {
      p.rect(2, 0, 9, H, '#2a3346'); // placard
      p.vline(8, 10, 12, '#6a7a96');
      p.vline(10, 10, 12, '#6a7a96');
      p.rect(9, 4, 38, 42, '#10131c'); // silla gamer
      p.ellipse(28, 10, 19, 10, '#10131c');
    }
    // saco y remera
    for (let y = 36; y < H; y++) {
      const half = Math.min(cx, 14 + (y - 36) * 2);
      p.hline(cx - half, y, half * 2, P.blazer);
    }
    for (let y = 35; y < H; y++) {
      const half = Math.min(6, 2 + (y - 35));
      p.hline(cx - half, y, half * 2, P.shirt);
      p.px(cx - half - 1, y, P.lapel);
      p.px(cx + half, y, P.lapel);
    }
    // cuello y cara
    p.rect(cx - 5, 29, 10, 8, P.shade);
    p.ellipse(cx - 0.5, 21, 9, 11, P.skin);
    p.ellipse(cx + 4, 22, 4.5, 9, P.shade);
    p.rect(cx - 1, 25, 2, 1, P.dark); // nariz
    if (A) {
      p.hline(cx - 3, 29, 6, P.mouth);
      p.hline(cx - 2, 29, 3, '#eceae2'); // sonrisa con dientes
      // pelo castaño con flequillo
      p.ellipse(cx - 0.5, 12, 11, 7, '#4a3326');
      for (let x = cx - 10; x <= cx + 9; x++) p.vline(x, 12, 2 + ((x * 7) % 3), '#4a3326');
      p.noise(cx - 9, 7, 18, 6, '#6b4a36', 0.25);
      // auriculares negros + micrófono
      for (let a = Math.PI; a <= Math.PI * 2; a += 0.02) p.px(Math.round(cx + Math.cos(a) * 13), Math.round(17 + Math.sin(a) * 12), '#16161c');
      [[cx - 15, 17], [cx + 11, 17]].forEach(([x, y]) => {
        p.rect(x, y, 5, 13, '#16161c');
        p.vline(x + 1, y + 2, 9, '#3a3a46');
      });
      p.hline(cx + 7, 31, 6, '#16161c');
      p.rect(cx + 6, 30, 2, 2, '#16161c');
      p.vline(cx + 5, 32, H - 32, '#16161c'); // cable
    } else {
      p.hline(cx - 3, 29, 6, P.mouth);
      p.px(cx - 4, 28, P.mouth);
      p.px(cx + 3, 28, P.mouth);
      // gorra
      p.ellipse(cx - 0.5, 11, 12, 8, '#1c2236');
      p.rect(cx - 12, 11, 24, 4, '#1c2236');
      p.noise(cx - 7, 6, 14, 4, '#3a4462', 0.3);
      p.rect(cx - 14, 15, 28, 3, '#1c2236');
      p.hline(cx - 14, 17, 28, '#5a6488'); // borde de la visera
      // auriculares con luz
      [[cx - 15, 17], [cx + 11, 17]].forEach(([x, y], i) => {
        p.rect(x, y, 5, 13, '#141824');
        p.vline(i ? x + 4 : x, y + 3, 7, 'cyan');
      });
    }
    // anteojos negros
    p.rect(cx - 10, 19, 20, 2, '#121218');
    p.rect(cx - 9, 20, 8, 5, '#121218');
    p.rect(cx + 1, 20, 8, 5, '#121218');
    if (A) {
      p.hline(cx - 8, 21, 3, '#3a4a7a');
      p.hline(cx + 2, 21, 3, '#3a4a7a');
    } else {
      // reflejos de la pantalla
      const refl = ['cyan', 'rosa', 'amarillo', 'verde_cla', 'pantalla_cla'];
      [cx - 8, cx + 2].forEach((lx) => {
        for (let i = 0; i < 6; i++) p.px(lx + (i % 3) * 2, 21 + Math.floor(i / 3) * 2, refl[(i + lx) % refl.length]);
      });
    }
  },

  iconFrame(p, [kind]) {
    p.rect(0, 0, p.w, p.h, 'madera_osc');
    p.outline(0, 0, p.w, p.h, 'negro');
    p.rect(2, 2, p.w - 4, p.h - 4, 'pizarra_cla');
    const icons = {
      persona: ['.##.', '.##.', '####', '.##.', '#..#'],
      grilla: ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
      taza: ['####.', '#..##', '#..#.', '####.', '.##..'],
    };
    const rows = icons[kind] ?? icons.persona;
    stamp(p, (p.w - rows[0].length) >> 1, (p.h - rows.length) >> 1, rows, 'sombra');
  },

  clock(p) {
    const c = (p.w - 1) / 2;
    p.ellipse(c, c, c, c, 'pizarra_osc');
    p.ellipse(c, c, c - 1, c - 1, 'hueso');
    // marcas de las 12, 3, 6 y 9; las agujas las dibuja DeskScene según la hora del turno
    [[c, 1], [p.w - 2, c], [c, p.h - 2], [1, c]].forEach(([x, y]) => p.px(x, y, 'gris_cla'));
  },

  tower(p) {
    p.rect(0, 0, p.w, p.h, 'noche');
    p.outline(0, 0, p.w, p.h, 'negro');
    p.vline(1, 1, p.h - 2, 'pizarra_osc');
    for (let y = 3; y < 8; y += 2) p.hline(4, y, p.w - 8, 'sombra');
    for (let y = 10; y < p.h - 4; y += 3) {
      p.px(4, y, 'cyan');
      p.px(p.w - 5, y + 1, p.rng() < 0.6 ? 'cyan' : 'pantalla');
    }
    p.rect(8, p.h - 8, p.w - 16, 3, 'sombra');
    p.px(p.w >> 1, p.h - 7, 'verde_cla');
  },

  books(p) {
    const colors = ['rojo', 'verde_osc', 'pantalla_osc', 'hueso', 'madera_cla', 'violeta', 'pizarra_cla', 'naranja'];
    let x = 0;
    while (x < p.w) {
      const bw = 2 + Math.floor(p.rng() * 3), bh = p.h - Math.floor(p.rng() * 9);
      const c = p.pick(colors), ww = Math.min(bw, p.w - x);
      p.rect(x, p.h - bh, ww, bh, c);
      p.vline(x, p.h - bh, bh, p.lt(c, 0.2));
      p.hline(x, p.h - bh, ww, p.dk(c, 0.3));
      if (bh > 12) p.hline(x, p.h - bh + 4, ww, p.dk(c, 0.4));
      x += bw;
    }
  },

  monitor(p) {
    const bh = p.h - 6, cx = p.w >> 1;
    p.rect(0, 0, p.w, bh, 'noche');
    p.outline(0, 0, p.w, bh, 'negro');
    p.hline(1, 1, p.w - 2, 'sombra');
    p.px(p.w - 4, bh - 2, 'cyan');
    p.rect(cx - 3, bh, 6, 4, 'sombra');
    p.vline(cx - 3, bh, 4, 'pizarra_osc');
    p.rect(cx - 10, bh + 4, 20, 2, 'pizarra_osc');
    p.hline(cx - 10, bh + 4, 20, 'pizarra');
  },

  // playhead 0: sin la línea blanca de reproducción (DeskScene la anima encima).
  screen(p, [kind, playhead = 1]) {
    if (kind === 'tracks') {
      p.rect(0, 0, p.w, p.h, 'pantalla');
      p.rect(0, 0, p.w, 3, 'pantalla_osc');
      for (let x = 2; x < p.w; x += 4) p.px(x, 1, 'pantalla_cla');
      p.rect(0, 3, 9, p.h - 3, 'pantalla_osc');
      for (let y = 6; y < p.h - 2; y += 2) p.hline(2, y, 2 + Math.floor(p.rng() * 4), 'pantalla_cla');
      for (let x = 11; x < p.w; x += 6) for (let y = 5; y < p.h; y += 3) p.px(x, y, 'pantalla_cla');
      const tracks = ['violeta', 'verde', 'rosa', 'cyan', 'amarillo', 'violeta'];
      tracks.forEach((c, i) => {
        const y = 5 + i * 6;
        if (y + 3 > p.h) return;
        let x = 10;
        while (x < p.w - 2) {
          const len = 4 + Math.floor(p.rng() * 14);
          if (p.rng() < 0.7) {
            p.rect(x, y, Math.min(len, p.w - x), 3, c);
            p.hline(x, y, Math.min(len, p.w - x), p.lt(c, 0.3));
          }
          x += len + 1 + Math.floor(p.rng() * 4);
        }
      });
      if (playhead) p.vline(Math.floor(p.w * 0.42), 3, p.h - 3, 'blanco');
    } else {
      p.rect(0, 0, p.w, p.h, 'pantalla_osc');
      p.rect(0, 0, p.w, 3, 'pantalla');
      p.px(1, 1, 'rojo');
      p.px(3, 1, 'amarillo');
      p.px(5, 1, 'verde');
      p.rect(0, 3, 12, p.h - 3, 'sombra');
      for (let y = 5; y < p.h - 2; y += 3) p.hline(2, y, 3 + Math.floor(p.rng() * 6), 'gris_azul');
      const cols = ['pantalla_cla', 'cyan', 'amarillo', 'rosa', 'blanco', 'verde_cla'];
      for (let y = 5; y < p.h - 1; y += 2) {
        if (p.rng() < 0.15) continue;
        let x = 14 + Math.floor(p.rng() * 4) * 2;
        const segs = 1 + Math.floor(p.rng() * 3);
        for (let s = 0; s < segs && x < p.w - 2; s++) {
          const len = 2 + Math.floor(p.rng() * 9);
          p.hline(x, y, Math.min(len, p.w - 2 - x), p.pick(cols));
          x += len + 2;
        }
      }
    }
  },

  lamp(p) {
    const cx = p.w >> 1;
    p.rect(1, p.h - 3, p.w - 2, 3, 'sombra');
    p.hline(1, p.h - 3, p.w - 2, 'pizarra_cla');
    p.vline(cx, 10, p.h - 13, 'pizarra_cla');
    for (let y = 0; y < 11; y++) {
      const half = 2 + Math.floor(y / 2);
      p.hline(cx - half, y, half * 2 + 1, y < 2 ? 'verde_osc' : 'verde');
      p.px(cx - half, y, 'verde_osc');
      p.px(cx + half, y, 'verde_cla');
    }
    p.hline(cx - 6, 11, 13, 'verde_cla');
    p.px(cx, 12, 'amarillo');
    p.px(cx + 3, p.h - 4, 'naranja');
  },

  mug(p, [c]) {
    p.rect(0, 1, 5, p.h - 1, c);
    p.vline(4, 1, p.h - 1, p.dk(c, 0.25));
    p.vline(0, 1, p.h - 1, p.lt(c, 0.25));
    p.hline(0, 0, 5, p.dk(c, 0.2));
    p.hline(1, 1, 3, 'madera_osc');
    [[5, 2], [6, 3], [6, 4], [5, 5]].forEach(([x, y]) => p.px(x, y, p.dk(c, 0.2)));
  },

  papers(p, [c1, c2]) {
    for (let y = 0; y < p.h - 1; y++) {
      const off = Math.floor(p.rng() * 3);
      p.hline(off, y, p.w - 3, y % 2 ? c2 : c1);
    }
    p.hline(1, p.h - 1, p.w - 2, 'sombra');
    p.noise(2, 0, p.w - 6, p.h - 1, 'gris_azul', 0.08);
  },

  postit(p, [c]) {
    p.rect(0, 0, p.w, p.h, c);
    p.hline(0, p.h - 1, p.w, p.dk(c, 0.3));
    p.px(1, 1, p.dk(c, 0.2));
    p.px(2, 1, p.dk(c, 0.2));
  },

  wrapper(p) {
    p.rect(0, 1, p.w, p.h - 1, 'rojo');
    p.noise(0, 0, p.w, p.h, 'amarillo', 0.25);
    p.px(0, 0, 'rojo');
    p.px(p.w - 1, 0, 'rojo');
  },

  // Saco colgado del respaldo: cae por arriba y por los costados; en el medio se ve la silla.
  jacket(p) {
    const c = 'pizarra_osc', top = 6;
    p.rect(2, 0, p.w - 4, top, c);
    p.rect(0, 2, p.w, top - 2, c);
    p.hline(3, 0, p.w - 6, 'gris_azul');
    p.rect((p.w >> 1) - 5, 0, 10, 2, 'gris_azul'); // cuello
    p.hline(2, top, p.w - 4, 'sombra');
    // costados que cuelgan; la manga izquierda un poco más larga
    p.rect(0, top, 6, p.h - top, c);
    p.vline(5, top, p.h - top, 'sombra');
    p.rect(1, p.h - 2, 5, 2, 'sombra');
    p.rect(p.w - 6, top, 6, p.h - top - 5, c);
    p.vline(p.w - 6, top, p.h - top - 5, 'sombra');
  },

  scarf(p) {
    p.rect(0, 0, p.w, p.h - 3, 'rojo');
    for (let y = 3; y < p.h - 3; y += 5) p.hline(0, y, p.w, 'hueso');
    p.vline(p.w - 1, 0, p.h - 3, p.dk('rojo', 0.3));
    for (let x = 0; x < p.w; x += 2) p.vline(x, p.h - 3, 3, 'rojo');
  },

  sweater(p) {
    p.rect(0, 0, p.w, p.h, 'pantalla_osc');
    p.hline(0, 0, p.w, p.lt('pantalla_osc', 0.2));
    for (let x = 3; x < p.w; x += 5) p.vline(x, 1, p.h - 1, p.dk('pantalla_osc', 0.3));
  },

  head(p, [hair, skin]) {
    const cx = (p.w - 1) / 2;
    p.rect(cx - 2, p.h - 4, 5, 4, p.dk(skin, 0.2));
    p.ellipse(cx, 8.5, cx - 0.5, 8.5, hair);
    p.rect(0, 9, 1, 4, skin);
    p.rect(p.w - 1, 9, 1, 4, p.dk(skin, 0.2));
    p.noise(3, 2, p.w - 6, 6, p.lt(hair, 0.25), 0.15);
    p.noise(2, 8, p.w - 4, 8, p.dk(hair, 0.35), 0.15);
    [[4, 0], [8, -1], [12, 0], [6, 1]].forEach(([x, y]) => p.px(x, y + 1, hair));
  },

  body(p, [c]) {
    for (let y = 0; y < p.h; y++) {
      const half = Math.min(p.w / 2, 9 + y * 2);
      const x0 = Math.round(p.w / 2 - half);
      p.hline(x0, y, Math.round(half * 2), c);
      p.px(x0, y, p.lt(c, 0.2));
      p.px(x0 + Math.round(half * 2) - 1, y, p.dk(c, 0.3));
    }
    p.rect(Math.round(p.w * 0.62), 3, Math.round(p.w * 0.38) - 1, p.h - 3, p.dk(c, 0.15));
    const cx = p.w >> 1;
    p.ellipse(cx, 3, 7, 4, p.dk(c, 0.25));
    p.ellipse(cx, 2, 4.5, 2.5, c);
  },

  // Silla de oficina completa: respaldo de cuero, asiento, pistón, base con ruedas y sombra en el piso.
  chair(p, [backH = 56]) {
    const bh = backH, r = 6, cx = p.w >> 1, baseY = p.h - 10;
    // sombra en el piso (dither) para que la silla apoye
    for (let y = p.h - 5; y < p.h; y++)
      for (let x = 0; x < p.w; x++)
        if (((x - cx) / (p.w / 2)) ** 2 + ((y - (p.h - 3)) / 2.5) ** 2 <= 1 && p.bayer(x, y) < 0.6) p.px(x, y, 'negro');
    // asiento (asoma por debajo del respaldo)
    p.rect(1, bh, p.w - 2, 5, 'madera_osc');
    p.hline(1, bh, p.w - 2, 'cuero');
    p.hline(2, bh + 5, p.w - 4, 'negro');
    // pistón
    p.rect(cx - 2, bh + 6, 4, baseY - bh - 6, 'negro');
    p.vline(cx - 2, bh + 6, baseY - bh - 6, 'pizarra_osc');
    p.rect(cx - 3, bh + 6, 6, 3, 'sombra');
    // base de cinco patas vista de atrás + ruedas
    p.rect(cx - 4, baseY - 2, 8, 2, 'sombra');
    p.hline(2, baseY, p.w - 4, 'negro');
    p.hline(2, baseY - 1, 4, 'sombra');
    p.hline(p.w - 6, baseY - 1, 4, 'sombra');
    p.hline(4, baseY + 1, p.w - 8, 'pizarra_osc');
    [1, cx - 2, p.w - 5].forEach((wx) => {
      p.rect(wx, baseY + 2, 4, 3, 'negro');
      p.px(wx + 1, baseY + 2, 'pizarra_osc');
    });
    // respaldo
    for (let y = 0; y < bh; y++) {
      const inset = y < r ? Math.round(r - Math.sqrt(r * r - (r - y) ** 2)) : 0;
      p.hline(inset, y, p.w - inset * 2, 'cuero');
      p.px(inset, y, 'madera_osc');
      p.px(p.w - inset - 1, y, 'negro');
    }
    for (let x = 5; x < p.w - 4; x += 5) {
      for (let y = 3; y < bh - 2; y++) {
        if (p.bayer(x, y) < 0.8) p.px(x, y, 'madera_osc');
        p.px(x - 1, y, p.rng() < 0.6 ? 'cuero_cla' : 'cuero');
      }
    }
    p.hline(4, 18, p.w - 8, 'madera_osc');
    p.hline(4, 19, p.w - 8, 'cuero_cla');
    p.noise(2, 2, p.w - 4, bh - 4, 'cuero_cla', 0.06);
    p.hline(r, 0, p.w - r * 2, 'cuero_cla');
    p.rect(2, bh - 3, p.w - 4, 3, 'madera_osc');
  },

  // Persona de pie vista de atrás, sin cabeza (la cabeza es el sprite de siempre, encima).
  // frame 0: parado; 1 y 2: pasos (una pierna levantada y el brazo contrario adelante).
  standing(p, [c, pants = 'pizarra_osc', frame = 0]) {
    const w = p.w, cx = w >> 1, skin = 'piel';
    // sombra en el piso
    for (let y = p.h - 3; y < p.h; y++)
      for (let x = 0; x < w; x++)
        if (((x - cx) / (w / 2)) ** 2 + ((y - (p.h - 2)) / 1.6) ** 2 <= 1 && p.bayer(x, y) < 0.6) p.px(x, y, 'negro');
    // cuello
    p.rect(cx - 3, 0, 6, 4, p.dk(skin, 0.2));
    // piernas
    const legTop = 48, shoeH = 4, floor = p.h - 3;
    [[7, 1], [15, 2]].forEach(([lx, f]) => {
      const up = frame === f ? 3 : 0;
      const sx = frame === f ? (f === 1 ? -1 : 1) : 0;
      const bottom = floor - up;
      p.rect(lx + sx, legTop, 8, bottom - shoeH - legTop, pants);
      p.vline(lx + sx + 7, legTop, bottom - shoeH - legTop, p.dk(pants, 0.35));
      p.rect(lx + sx - 1, bottom - shoeH, 9, shoeH, 'negro');
      p.hline(lx + sx, bottom - shoeH, 7, 'sombra');
    });
    // torso con hombros redondeados
    for (let y = 3; y < legTop; y++) {
      const inset = y < 7 ? 7 - y : 0;
      p.hline(inset, y, w - inset * 2, c);
    }
    p.rect(cx + 3, 7, w - cx - 9, legTop - 9, p.dk(c, 0.15));
    p.hline(cx - 4, 3, 8, p.dk(c, 0.3)); // cuello de la remera
    // brazos (separados del torso por una línea oscura) y manos
    [[0, 1], [w - 5, 2]].forEach(([ax, f]) => {
      const len = frame === f ? 34 : 38;
      p.rect(ax, 7, 5, len, ax ? p.dk(c, 0.2) : c);
      p.vline(ax ? ax - 1 : 5, 8, len - 2, p.dk(c, 0.4));
      p.rect(ax + 1, 7 + len, 4, 4, ax ? p.dk(skin, 0.15) : skin);
    });
    p.hline(6, legTop - 2, w - 12, 'negro'); // cinturón
  },

  arm(p, [c]) {
    p.rect(0, 0, p.w, p.h, c);
    p.hline(0, 0, p.w, p.lt(c, 0.25));
    p.hline(0, p.h - 1, p.w, p.dk(c, 0.35));
    p.rect(0, 0, 3, p.h, p.dk(c, 0.2));
    for (let x = 12; x < p.w; x += 14) p.vline(x, 1, p.h - 2, p.dk(c, 0.15));
  },

  hand(p) {
    p.rect(1, 1, p.w - 1, p.h - 2, 'piel');
    p.vline(0, 2, p.h - 3, 'piel');
    p.hline(1, p.h - 1, p.w - 2, 'piel_osc');
    p.px(1, p.h - 2, 'piel_osc');
    p.px(3, p.h - 2, 'piel_osc');
    p.px(5, p.h - 2, 'piel_osc');
    p.hline(2, 1, p.w - 3, p.lt('piel', 0.2));
  },

  windowGlass(p) {
    p.vgrad(0, 0, p.w, p.h, 'blanco', 'gris_cla');
    let x = 0;
    while (x < p.w) {
      const bw = 5 + Math.floor(p.rng() * 8), bh = 10 + Math.floor(p.rng() * 26);
      p.rect(x, p.h - bh, bw, bh, 'gris_azul');
      for (let wy = p.h - bh + 2; wy < p.h - 1; wy += 3)
        for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (p.rng() < 0.3) p.px(wx, wy, 'blanco');
      x += bw + Math.floor(p.rng() * 3);
    }
  },

  windowFrame(p) {
    const t = 3;
    p.rect(0, 0, p.w, t, 'madera_osc');
    p.rect(0, p.h - t - 2, p.w, t + 2, 'madera_osc');
    p.rect(0, 0, t, p.h, 'madera_osc');
    p.rect(p.w - t, 0, t, p.h, 'madera_osc');
    p.rect((p.w >> 1) - 1, 0, 2, p.h, 'madera_osc');
    p.rect(0, (p.h >> 1) - 1, p.w, 2, 'madera_osc');
    p.hline(0, p.h - 3, p.w, 'madera');
    p.hline(0, p.h - 1, p.w, 'negro');
    p.vline(t - 1, t, p.h - 2 * t, 'negro');
  },

  rain(p) {
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(p.rng() * p.w), y = Math.floor(p.rng() * p.h);
      for (let k = 0; k < 3; k++) p.px(x, (y + k) % p.h, k === 0 ? 'blanco' : 'gris_cla');
    }
  },

  shadow(p) {
    const cx = (p.w - 1) / 2;
    p.ellipse(cx, 6, 5, 6, 'negro');
    p.rect(cx - 2, 11, 5, 4, 'negro');
    for (let y = 14; y < p.h; y++) {
      const half = Math.min(p.w / 2, 7 + (y - 14));
      p.hline(Math.round(cx - half), y, Math.round(half * 2), 'negro');
    }
  },

  // Luz en bandas concéntricas (posterizada), se suma en modo ADD.
  glow(p) {
    const cx = p.w / 2, cy = p.h / 2;
    [['sombra', 1], ['pizarra_osc', 0.72], ['pantalla_osc', 0.45]].forEach(([c, k]) =>
      p.ellipse(cx, cy, cx * k, cy * k, c),
    );
  },

  drawers(p) {
    p.rect(0, 0, p.w, p.h, 'madera_osc');
    p.outline(0, 0, p.w, p.h, 'negro');
    for (let y = 0; y < p.h; y += 18) {
      p.hline(1, y + 1, p.w - 2, 'madera');
      p.rect((p.w >> 1) - 3, y + 7, 6, 2, 'gris_cla');
    }
  },

  deskTop(p) {
    p.rect(0, 0, p.w, p.h, 'madera');
    p.hline(0, 0, p.w, 'madera_cla');
    p.noise(0, 1, p.w, p.h - 2, 'madera_cla', 0.08);
    p.hline(0, p.h - 1, p.w, 'madera_osc');
  },

  deskFront(p) {
    p.rect(0, 0, p.w, p.h, 'madera_osc');
    p.vgrad(0, 0, p.w, 8, 'negro', 'madera_osc');
    p.noise(0, 8, p.w, p.h - 8, 'madera', 0.04);
    p.vline(0, 0, p.h, 'negro');
    p.vline(p.w - 1, 0, p.h, 'negro');
  },

  plant(p) {
    const cx = p.w / 2;
    for (let i = 0; i < 26; i++) {
      const a = p.rng() * Math.PI, r = 4 + p.rng() * (p.h - 8);
      const x = cx + Math.cos(a) * r * 0.6, y = p.h - 2 - Math.sin(a) * r;
      p.ellipse(x, y, 2 + p.rng() * 2, 1.5, p.pick(['verde_osc', 'verde', 'verde']));
      p.px(x - 1, y - 1, 'verde_cla');
    }
  },

  pot(p) {
    for (let y = 2; y < p.h; y++) {
      const inset = Math.floor((y / p.h) * 3);
      p.hline(inset, y, p.w - inset * 2, 'madera_cla');
      p.px(p.w - inset - 1, y, 'madera');
    }
    p.rect(0, 0, p.w, 3, 'madera');
    p.hline(0, 0, p.w, 'madera_cla');
  },
};
