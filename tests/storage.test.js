import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createStorage } from "../assets/js/storage.js";
import { STORAGE_KEYS } from "../assets/js/constants.js";

class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

function setWindowWithStorage() {
  globalThis.window = {
    localStorage: new LocalStorageMock(),
    location: { search: "" },
  };
}

describe("storage favorites & prefs", () => {
  beforeEach(() => {
    setWindowWithStorage();
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("normalizes favorites, removes invalid IDs, and persists trimmed result", () => {
    const storage = createStorage({ ttl: null });
    const manifestIds = new Set(["gong", "pling", "buzz"]);
    window.localStorage.setItem(
      STORAGE_KEYS.favorites,
      JSON.stringify(["gong", "gong", "missing", "", "buzz"]),
    );

    const { favorites, trimmed, persistent } = storage.loadFavorites({ validIds: manifestIds });

    expect(persistent).toBe(true);
    expect(trimmed).toBe(true);
    expect(favorites).toEqual(["gong", "buzz"]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.favorites))).toEqual([
      "gong",
      "buzz",
    ]);
  });

  it("saves and loads prefs", () => {
    const storage = createStorage({ ttl: null });
    const saveResult = storage.savePrefs({ filterFavoritesOnly: true, autoFadeSeconds: 15 });
    expect(saveResult).toBe(true);

    const { prefs, persistent } = storage.loadPrefs();
    expect(persistent).toBe(true);
    expect(prefs.filterFavoritesOnly).toBe(true);
    expect(prefs.autoFadeSeconds).toBe(15);
  });

  it("clamps autoFadeSeconds when saving/loading prefs", () => {
    const storage = createStorage({ ttl: null });
    storage.savePrefs({ filterFavoritesOnly: false, autoFadeSeconds: 999 });
    const { prefs } = storage.loadPrefs();
    expect(prefs.autoFadeSeconds).toBeLessThanOrEqual(120);
    expect(prefs.autoFadeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("reports persistent=false when localStorage is unavailable", () => {
    globalThis.window = { location: { search: "" } }; // no localStorage
    const storage = createStorage({ ttl: null });
    const result = storage.loadFavorites({ validIds: new Set(["a"]) });
    expect(result.persistent).toBe(false);
    expect(result.favorites).toEqual([]);
  });
});
