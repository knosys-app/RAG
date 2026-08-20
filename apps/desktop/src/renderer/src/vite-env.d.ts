/// <reference types="vite/client" />

import type { KnosysDesktopApi } from "@knosys-rag/contracts";

declare global {
  interface Window {
    readonly knosys: KnosysDesktopApi;
  }
}

export {};
