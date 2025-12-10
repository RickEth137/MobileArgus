/// <reference types="@types/chrome" />

declare global {
  interface Window {
    Buffer: typeof Buffer;
    chrome: typeof chrome;
  }
}

export {};
