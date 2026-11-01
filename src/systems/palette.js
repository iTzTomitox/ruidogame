import { config } from '../data/index.js';

// Acepta un nombre de la paleta o un '#rrggbb' literal.
export const hex = (name) => config.palette[name] ?? name;
export const col = (name) => parseInt(hex(name).slice(1), 16);
