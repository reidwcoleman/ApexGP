// The system Chrome and its GPU backend for the headless tools, per platform
// (macOS: Metal; Windows: Direct3D 11; Linux: the default GL). Override with CHROME=/path/to/chrome.
import fs from 'node:fs';
const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
export const CHROME = process.env.CHROME ?? (CANDIDATES[process.platform] ?? []).find((p) => fs.existsSync(p)) ?? CANDIDATES.darwin[0];
export const ANGLE = process.platform === 'darwin' ? '--use-angle=metal' : process.platform === 'win32' ? '--use-angle=d3d11' : '--use-gl=angle';
