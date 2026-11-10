// Versión de escritorio (.exe): abre el juego ya compilado (dist/) en una ventana propia.
// F11 alterna pantalla completa. Los links (el cortometraje en YouTube) se abren en el navegador.
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');

// el audio arranca sin esperar un click (en el navegador lo bloquea la política de autoplay)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, // 320x180 por 4: pixel art exacto
    height: 720,
    useContentSize: true,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    title: 'RUIDO',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
