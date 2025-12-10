import { Buffer } from "buffer"

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer
}

if (typeof global !== "undefined") {
  global.Buffer = global.Buffer || Buffer
}

// Mock chrome APIs for web environment
// NOTE: Browser extensions may inject window.chrome, so we check for storage specifically
if (typeof window !== 'undefined') {
  const existingChrome = (window as any).chrome || {};
  
  // Create storage mock if it doesn't exist or is incomplete
  const storageMock = {
    local: {
      get: (keys: string | string[], callback?: (result: any) => void) => {
        const result: any = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(key => {
          const value = localStorage.getItem(`geovault_${key}`);
          if (value) {
            try {
              result[key] = JSON.parse(value);
            } catch {
              result[key] = value;
            }
          }
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: (items: any, callback?: () => void) => {
        Object.keys(items).forEach(key => {
          localStorage.setItem(`geovault_${key}`, JSON.stringify(items[key]));
        });
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys: string | string[], callback?: () => void) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(key => {
          localStorage.removeItem(`geovault_${key}`);
        });
        if (callback) callback();
        return Promise.resolve();
      }
    },
    sync: {
      get: (keys: string | string[], callback?: (result: any) => void) => {
        return storageMock.local.get(keys, callback);
      },
      set: (items: any, callback?: () => void) => {
        return storageMock.local.set(items, callback);
      }
    }
  };

  // Runtime message handler - simulates background script responses
  const runtimeMock = {
    sendMessage: (message: any) => {
      // Return mock responses based on message type
      const type = message?.type;
      switch (type) {
        case 'CHECK_WALLET_STATUS':
          const wallets = localStorage.getItem('geovault_wallets');
          return Promise.resolve({ 
            success: true, 
            isOnboarded: !!wallets,
            isUnlocked: !!localStorage.getItem('geovault_wallet_unlocked')
          });
        case 'VERIFY_PASSWORD':
          // For web, we'll handle password verification locally
          return Promise.resolve({ success: true });
        case 'GET_MNEMONIC_FOR_DERIVATION':
          const mnemonic = localStorage.getItem('geovault_mnemonic');
          return Promise.resolve({ success: !!mnemonic, mnemonic });
        case 'SAVE_WALLET':
        case 'CREATE_WALLET':
        case 'IMPORT_WALLET':
          return Promise.resolve({ success: true });
        case 'VERIFY_SERVER_PASSWORD':
          return Promise.resolve({ success: true, verified: true });
        default:
          // Return a generic success response
          return Promise.resolve({ success: true });
      }
    },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    getURL: (path: string) => {
      if (path.startsWith('assets/')) {
        return '/' + path;
      }
      return path;
    },
    lastError: null
  };

  const tabsMock = {
    query: () => Promise.resolve([]),
    sendMessage: () => Promise.resolve(),
    create: () => Promise.resolve()
  };

  const windowsMock = {
    create: () => Promise.resolve({ id: 1 }),
    remove: () => Promise.resolve(),
    update: () => Promise.resolve()
  };

  // Override chrome with our mocks for web
  (window as any).chrome = {
    ...existingChrome,
    storage: storageMock,
    runtime: runtimeMock,
    tabs: tabsMock,
    windows: windowsMock
  };
}

export {};
