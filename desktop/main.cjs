// Apex GP desktop shell (Electron) for Steam.
// Serves the Vite build (../dist in dev, Resources/dist when packaged) on app://game/ — a standard,
// secure scheme so fetch, IndexedDB and localStorage behave exactly as on the website — and hooks
// up Steamworks when Steam is running (overlay + achievements); without Steam it runs as a plain window.
const { app, BrowserWindow, protocol, ipcMain, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

/** your Steam App ID (480 = Valve's Spacewar test app until yours is issued); also in steam_appid.txt */
const STEAM_APP_ID = Number(fs.existsSync(path.join(__dirname, 'steam_appid.txt')) ? fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8').trim() : 480) || 480;
const SMOKE = process.argv.includes('--smoke');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
// the game is GPU-bound: never let Chromium fall back to software, never throttle a hidden window
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let steam = null;
try {
  const sw = require('steamworks.js');
  steam = sw.init(STEAM_APP_ID);
  sw.electronEnableSteamOverlay();
} catch (e) {
  console.log('[steam] not available:', e && e.message);
}

const distDir = app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    show: !SMOKE,
    backgroundColor: '#0a0c11',
    autoHideMenuBar: true,
    title: 'Apex GP',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadURL('app://game/index.html');
  // F11 / Cmd+Ctrl+F: fullscreen (Esc stays with the game)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.meta && input.control && input.key.toLowerCase() === 'f'))) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  if (SMOKE) {
    const t0 = Date.now();
    const poll = setInterval(async () => {
      const ready = await win.webContents.executeJavaScript('window.__ready === true').catch(() => false);
      if (ready || Date.now() - t0 > 180000) {
        clearInterval(poll);
        console.log(ready ? `[smoke] ready in ${Date.now() - t0} ms` : '[smoke] timed out');
        app.exit(ready ? 0 : 1);
      }
    }, 500);
  }
}

ipcMain.on('steam:achievement', (_e, id) => {
  try {
    if (steam && !steam.achievement.isActivated(id)) steam.achievement.activate(id);
  } catch (e) {
    console.log('[steam] achievement failed', id, e && e.message);
  }
});
ipcMain.handle('steam:info', () => (steam ? { name: steam.localplayer.getName(), appId: STEAM_APP_ID } : null));

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(distDir, decodeURIComponent(pathname)));
    if (!file.startsWith(distDir)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());
