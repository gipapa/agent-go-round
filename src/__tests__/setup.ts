import "@testing-library/jest-dom/vitest";

if (typeof globalThis.localStorage?.clear !== "function" || typeof globalThis.localStorage?.setItem !== "function") {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();

    get length() {
      return this.store.size;
    }

    clear() {
      for (const key of this.store.keys()) {
        delete (this as unknown as Record<string, string>)[key];
      }
      this.store.clear();
    }

    getItem(key: string) {
      return this.store.get(String(key)) ?? null;
    }

    key(index: number) {
      return Array.from(this.store.keys())[index] ?? null;
    }

    removeItem(key: string) {
      const normalizedKey = String(key);
      this.store.delete(normalizedKey);
      delete (this as unknown as Record<string, string>)[normalizedKey];
    }

    setItem(key: string, value: string) {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      this.store.set(normalizedKey, normalizedValue);
      Object.defineProperty(this, normalizedKey, {
        value: normalizedValue,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }

  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "Storage", {
    value: MemoryStorage,
    configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "Storage", {
      value: MemoryStorage,
      configurable: true
    });
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true
    });
  }
}
