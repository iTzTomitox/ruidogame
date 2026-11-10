// Le avisa al juego que corre como app de escritorio (para mostrar "Salir" en el menú).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  quit: () => window.close(),
});
