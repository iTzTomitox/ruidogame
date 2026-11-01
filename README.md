# RUIDO

Juego narrativo lineal en Phaser 3 + Vite. 320x180, escalado entero pixel-perfect.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # sale en dist/
```

El juego arranca en un menú (ciudad al atardecer pintada por código, painter `city`) con
**Empezar**, **Sonido** (0–100%) y **Resolución** (de 320x180 a la máxima que entra en la ventana).
Se navega con flechas/WASD y Enter, o con el mouse (click en la mitad izquierda/derecha de una
opción baja/sube el valor). Las preferencias se guardan en el navegador. Los textos del menú están
en `narrative.json → menu`.

Controles: click o teclas `1`–`6` para elegir, `Espacio`/`Enter`/click para avanzar el texto.
Para probar un turno puntual: `http://localhost:5173/?turno=8` (arranca ahí con escritorio y ruido acumulados).

## Dónde se edita cada cosa (sin tocar código)

| Archivo | Qué contiene |
|---|---|
| `src/data/narrative.json` | Actos, turnos (hora, texto, pendientes que llegan, objetos que aparecen, evento `sombra`), pantalla de inicio y final (placa + tiempos). |
| `src/data/actions.json` | Las 6 acciones: efectos sobre stats, animación, respuestas por acto, frases de "Pedir ayuda". |
| `src/data/scene.json` | Sprites (tamaño, color placeholder, archivo), posiciones del mundo, objetos acumulables, pools (tazas), sombra y brazo de Federico. |
| `src/data/config.json` | Paleta, fuente, colores de UI, stats iniciales, curva de Ruido, efectos (saturación, viñeta, shake), cámaras, tiempos y capas de audio. |

Un turno puede pisar la respuesta de una acción solo para ese momento:
`"responses": { "cafe": "Ya no queda café." }`.

## Pixel art

Todos los sprites se pintan pixel por pixel al arrancar (`src/art/painters.js`), solo con colores
de la paleta de `config.json`. Cada sprite de `scene.json` dice qué painter usa (`"paint"`) y con qué
argumentos (`"args"`, por ejemplo el color de una taza). Cambiar un color de la paleta cambia todo el arte.

Para reemplazar uno por tu propio PNG:

1. Poné el PNG en `public/sprites/` (por ejemplo `public/sprites/silla.png`).
2. En `scene.json`, en ese sprite: `"file": "sprites/silla.png"` (tiene prioridad sobre `paint`).

Iluminación por acto (`narrative.json`): `window` (tinte del vidrio), `ambient` (capa de color),
`glow` (luz de las pantallas, 0–1) y `rain` (lluvia en la ventana).

## Fuente

`src/systems/pixelFont.js` es una fuente bitmap propia (glifos de 9 filas, con tildes, ñ, ¿ y ¡) que
se genera como textura, así que se ve nítida. Para retocar una letra, editá su dibujo en `G`.
Las mayúsculas acentuadas se muestran sin tilde (no hay lugar en la grilla).

Las coordenadas son de la esquina superior izquierda en un mundo de 640x360. El plano cerrado
muestra la zona x 60–380 / y 140–252; Federico está fuera de cuadro a la derecha (x ≥ 389) y se ve
recién cuando la cámara se abre (zoom 0.5 sobre todo el mundo).
En el final, la cámara primero se cierra sobre Julián (`camera.closeIn`, zoom 2). Mientras Federico
está fuera de cuadro, se reubica según `scene.json → finaleMoves` (acerca la silla), entra el brazo
corto y recién después la cámara se abre (`camera.reveal`).
Nota: la `ventana` se tiñe por acto (`window` en cada acto); si tu arte ya trae el color, sacá esa clave.

## Audio

Las capas (teclado, reloj, gota, respiración, tubo fluorescente) se sintetizan en vivo con WebAudio.
Para usar grabaciones: poné el loop en `public/audio/` y en `config.json` → `audio.layers[].file`.
El volumen de cada capa va de `min` a `max` mientras Ruido recorre `from`→`to`.

## Ruido

Nunca baja. Cada turno suma `ruidoBase` del acto + el `ruido` de la acción (mínimo `minPerAction`).
Queda topeado en `capBeforeLastTurn` hasta el último turno, donde llega al máximo y dispara el final.
