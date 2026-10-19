/**
 * The page's entry: waits for the game picker (index.html) to choose the racing game, then loads
 * it. Miami and Marble Mania are separate pages, so picking one never fetches this game's bundle.
 */
declare global {
  interface Window {
    __apexPick?: Promise<void>;
  }
}
await window.__apexPick;
await import('./main.ts');
export {};
