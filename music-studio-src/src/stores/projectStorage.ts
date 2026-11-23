/**
 * Debounced localStorage adapter with explicit failure reporting.
 *
 * The project stays in memory when a write fails (quota, private mode, blocked
 * storage); callers can show the error and offer a JSON export. A later
 * successful write clears the error.
 */
export interface StorageLike {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

export interface DebouncedStorageOptions {
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
}

export interface DebouncedStorage extends StorageLike {
  flush: () => void;
}

export function createDebouncedStorage(
  storage: StorageLike,
  { debounceMs = 500, onError, onSuccess }: DebouncedStorageOptions = {},
): DebouncedStorage {
  const pending = new Map<
    string,
    { value: string; timer: ReturnType<typeof setTimeout> }
  >();

  const reportError = (error: unknown) => {
    try {
      onError?.(error);
    } catch {
      /* reporting must never break saving */
    }
  };
  const reportSuccess = () => {
    try {
      onSuccess?.();
    } catch {
      /* reporting must never break saving */
    }
  };

  const flush = () => {
    for (const [name, { value, timer }] of pending) {
      clearTimeout(timer);
      try {
        storage.setItem(name, value);
        reportSuccess();
      } catch (error) {
        reportError(error);
      }
      pending.delete(name);
    }
  };

  return {
    getItem: (name) => {
      try {
        return storage.getItem(name);
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    setItem: (name, value) => {
      const existing = pending.get(name);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        const entry = pending.get(name);
        if (!entry) return;
        try {
          storage.setItem(name, entry.value);
          reportSuccess();
        } catch (error) {
          reportError(error);
        } finally {
          pending.delete(name);
        }
      }, debounceMs);
      pending.set(name, { value, timer });
    },
    removeItem: (name) => {
      const existing = pending.get(name);
      if (existing) clearTimeout(existing.timer);
      pending.delete(name);
      try {
        storage.removeItem(name);
        reportSuccess();
      } catch (error) {
        reportError(error);
      }
    },
    flush,
  };
}
