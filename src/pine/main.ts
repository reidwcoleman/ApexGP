import { App } from './app';
const app = new App();
(window as unknown as { __pine: App; __ready: boolean }).__pine = app;
(window as unknown as { __ready: boolean }).__ready = true;
document.getElementById('loading')?.remove();
