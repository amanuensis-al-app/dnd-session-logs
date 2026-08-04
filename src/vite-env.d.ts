/// <reference types="vite/client" />

/** Injected at build time from package.json's version (vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/** False for the standalone (file://, no service worker) build — vite.config.ts `define`. */
declare const __PWA_ENABLED__: boolean;
