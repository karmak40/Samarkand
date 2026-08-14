/**
 * Test bootstrap.
 *
 * Node 25 defines a global `localStorage` of its own, and it wins over the one jsdom
 * installs — leaving an object with no `getItem`, `setItem` or `clear` on it. Anything
 * that saves a profile would then fail for a reason that has nothing to do with the
 * code under test, so a spec-shaped in-memory Storage is put in its place.
 *
 * Only installed when the environment's storage is genuinely unusable: if a future
 * Node or jsdom hands over a real one, that is what the tests will exercise.
 */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

const existing = (globalThis as { localStorage?: Partial<Storage> }).localStorage;

if (typeof existing?.getItem !== 'function' || typeof existing?.clear !== 'function') {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
