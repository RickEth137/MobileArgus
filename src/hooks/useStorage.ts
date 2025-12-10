// Replacement for @plasmohq/storage/hook for web environment
import { useState, useEffect, useCallback } from 'react';

// Special symbol to indicate "loaded but no value" vs "still loading"
const EMPTY_VALUE = Symbol('EMPTY_VALUE');

export function useStorage<T>(key: string, defaultValue?: T): [T | undefined, (value: T) => void, { setRenderValue: (value: T) => void, setStoreValue: (value: T) => void, remove: () => void, isLoading: boolean }] {
  const storageKey = `geovault_${key}`;
  
  // Use null as initial state to indicate "loading"
  const [storedValue, setStoredValue] = useState<T | undefined | typeof EMPTY_VALUE>(() => {
    // Immediately try to get the value (synchronous)
    try {
      const item = localStorage.getItem(storageKey);
      if (item !== null) {
        return JSON.parse(item) as T;
      }
      // Key doesn't exist - return default or mark as empty
      return defaultValue !== undefined ? defaultValue : EMPTY_VALUE;
    } catch {
      return defaultValue !== undefined ? defaultValue : EMPTY_VALUE;
    }
  });

  // Derive loading state
  const isLoading = storedValue === undefined;

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        setStoredValue(e.newValue ? JSON.parse(e.newValue) : (defaultValue !== undefined ? defaultValue : EMPTY_VALUE));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey, defaultValue]);

  const setValue = useCallback((value: T) => {
    try {
      setStoredValue(value);
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, [storageKey]);

  const setRenderValue = useCallback((value: T) => {
    setStoredValue(value);
  }, []);

  const setStoreValue = useCallback((value: T) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, [storageKey]);

  const remove = useCallback(() => {
    setStoredValue(EMPTY_VALUE);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Convert EMPTY_VALUE to undefined for external API
  const externalValue = storedValue === EMPTY_VALUE ? undefined : storedValue;

  return [externalValue as T | undefined, setValue, { setRenderValue, setStoreValue, remove, isLoading }];
}
