/**
 * PWA Storage Utilities
 * Replaces Chrome extension storage APIs with localStorage-based alternatives
 * for PWA compatibility
 */

// Simulates chrome.storage.local with localStorage
export const pwaStorage = {
  local: {
    async get(keys: string | string[]): Promise<Record<string, any>> {
      const result: Record<string, any> = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        const stored = localStorage.getItem(`pwa_local_${key}`);
        if (stored) {
          try {
            result[key] = JSON.parse(stored);
          } catch {
            result[key] = stored;
          }
        }
      }
      return result;
    },
    async set(items: Record<string, any>): Promise<void> {
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(`pwa_local_${key}`, JSON.stringify(value));
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        localStorage.removeItem(`pwa_local_${key}`);
      }
    }
  },
  sync: {
    async get(keys: string | string[]): Promise<Record<string, any>> {
      const result: Record<string, any> = {};
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        const stored = localStorage.getItem(`pwa_sync_${key}`);
        if (stored) {
          try {
            result[key] = JSON.parse(stored);
          } catch {
            result[key] = stored;
          }
        }
      }
      return result;
    },
    async set(items: Record<string, any>): Promise<void> {
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(`pwa_sync_${key}`, JSON.stringify(value));
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        localStorage.removeItem(`pwa_sync_${key}`);
      }
    }
  },
  // Password verification helper (matches chrome.runtime.sendMessage response format)
  async verifyLocalPassword(password: string): Promise<{ success: boolean }> {
    return verifyLocalPassword(password);
  }
};

// Get mnemonic/seed phrase from localStorage
export const getMnemonic = (): string | null => {
  const stored = localStorage.getItem('geovault_mnemonic');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return stored;
    }
  }
  return null;
};

// Save mnemonic/seed phrase to localStorage
export const saveMnemonic = (mnemonic: string): void => {
  localStorage.setItem('geovault_mnemonic', JSON.stringify(mnemonic));
};

// Verify password locally (check hash stored in localStorage)
// Returns { success: boolean } to match chrome.runtime.sendMessage response format
export const verifyLocalPassword = async (password: string): Promise<{ success: boolean }> => {
  const storedHash = localStorage.getItem('geovault_password_hash');
  if (!storedHash) {
    return { success: false };
  }
  
  // Hash the input password
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return { success: inputHash === storedHash };
};

// Save password hash to localStorage
export const savePasswordHash = async (password: string): Promise<void> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('geovault_password_hash', hash);
};

// Open a URL in a new tab (replaces chrome.tabs.create)
export const openInNewTab = (url: string): void => {
  window.open(url, '_blank');
};

// Check if we're running in a Chrome extension context
// Returns true if chrome.runtime and chrome.storage APIs are available
export const isExtensionContext = (): boolean => {
  return typeof chrome !== 'undefined' && 
         typeof chrome.runtime !== 'undefined' && 
         typeof chrome.runtime.id !== 'undefined' &&
         typeof chrome.storage !== 'undefined';
};

// Get asset URL - uses chrome.runtime.getURL in extension, relative path in PWA
export const getAssetUrl = (path: string): string => {
  if (isExtensionContext()) {
    return chrome.runtime.getURL(path);
  }
  // PWA: use relative path from public folder
  return `/${path}`;
};
