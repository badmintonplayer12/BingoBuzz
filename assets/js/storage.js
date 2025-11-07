import {
  STORAGE_KEYS,
  QUERY_PARAM_FRESH,
  STORAGE_NAMESPACE,
} from "./constants.js";

const TRUTHY_FRESH_VALUES = new Set(["1", "true", "yes", "fresh"]);
const DEFAULT_LIBRARY_PREFS = {
  filterFavoritesOnly: false,
};

function getLocalStorage() {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage ?? null;
  } catch (error) {
    console.warn("storage: localStorage unavailable", error);
    return null;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("storage: failed to parse JSON", { value, error });
    return null;
  }
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeFavoriteIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  ids.forEach((id) => {
    if (typeof id !== "string") {
      return;
    }
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function detectFreshFlag() {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(QUERY_PARAM_FRESH);
  if (raw === null) {
    return false;
  }
  return TRUTHY_FRESH_VALUES.has(raw.toLowerCase());
}

export function createStorage({ ttl }) {
  let ttlMs = typeof ttl === "number" && ttl > 0 ? ttl : null;
  const hasFreshFlag = detectFreshFlag();

  function loadSession() {
    const store = getLocalStorage();
    if (!store) {
      return null;
    }

    const playlistRaw = store.getItem(STORAGE_KEYS.playlist);
    const indexRaw = store.getItem(STORAGE_KEYS.index);
    const createdAtRaw = store.getItem(STORAGE_KEYS.createdAt);
    const manifestEtag = store.getItem(STORAGE_KEYS.manifestEtag);

    if (!playlistRaw || indexRaw === null || createdAtRaw === null) {
      return null;
    }

    const playlistIds = parseJson(playlistRaw);
    const index = parseIntSafe(indexRaw);
    const createdAt = parseIntSafe(createdAtRaw);

    if (!Array.isArray(playlistIds) || index === null || createdAt === null) {
      clearSession();
      return null;
    }

    return {
      playlistIds,
      index,
      createdAt,
      manifestEtag: manifestEtag || null,
    };
  }

  function saveSession({ playlistIds, index, createdAt, manifestEtag }) {
    const store = getLocalStorage();
    if (!store) {
      return;
    }
    if (!Array.isArray(playlistIds) || typeof index !== "number") {
      console.warn("storage: invalid session payload", {
        playlistIds,
        index,
        createdAt,
        manifestEtag,
      });
      return;
    }
    try {
      store.setItem(STORAGE_KEYS.playlist, JSON.stringify(playlistIds));
      store.setItem(STORAGE_KEYS.index, String(index));
      store.setItem(STORAGE_KEYS.createdAt, String(createdAt ?? Date.now()));
      if (manifestEtag) {
        store.setItem(STORAGE_KEYS.manifestEtag, manifestEtag);
      } else {
        store.removeItem(STORAGE_KEYS.manifestEtag);
      }
    } catch (error) {
      console.warn("storage: saveSession failed", error);
    }
  }

  function clearSession() {
    const store = getLocalStorage();
    if (!store) {
      return;
    }
    try {
      store.removeItem(STORAGE_KEYS.playlist);
      store.removeItem(STORAGE_KEYS.index);
      store.removeItem(STORAGE_KEYS.createdAt);
      store.removeItem(STORAGE_KEYS.manifestEtag);
    } catch (error) {
      console.warn("storage: clearSession failed", error);
    }
  }

  function shouldReset({ session, manifestEtag, now = Date.now() } = {}) {
    if (hasFreshFlag) {
      return { reset: true, reason: "fresh-flag" };
    }

    if (!session) {
      return { reset: true, reason: "missing-session" };
    }

    if (manifestEtag) {
      if (!session.manifestEtag) {
        return { reset: true, reason: "manifest-unknown" };
      }
      if (session.manifestEtag !== manifestEtag) {
        return { reset: true, reason: "manifest-mismatch" };
      }
    }

    if (ttlMs && session.createdAt) {
      const age = now - session.createdAt;
      if (age >= ttlMs) {
        return { reset: true, reason: "session-expired" };
      }
    }

    return { reset: false, reason: "session-valid" };
  }

  function setTtl(newTtl) {
    if (typeof newTtl === "number" && newTtl > 0) {
      ttlMs = newTtl;
    }
  }

  function loadFavorites({ validIds } = {}) {
    const store = getLocalStorage();
    const validSet =
      validIds instanceof Set
        ? validIds
        : Array.isArray(validIds)
          ? new Set(validIds)
          : null;
    if (!store) {
      return { favorites: [], persistent: false, trimmed: false };
    }
    const raw = store.getItem(STORAGE_KEYS.favorites);
    if (!raw) {
      return { favorites: [], persistent: true, trimmed: false };
    }
    const parsed = parseJson(raw);
    const normalized = normalizeFavoriteIds(parsed);
    const hadData = Boolean(raw && raw.length);
    if (!normalized.length) {
      store.removeItem(STORAGE_KEYS.favorites);
      return { favorites: [], persistent: true, trimmed: hadData };
    }
    let filtered = normalized;
    let trimmed = false;
    if (validSet && validSet.size) {
      filtered = normalized.filter((id) => validSet.has(id));
      trimmed = filtered.length !== normalized.length;
    }
    if (trimmed) {
      saveFavorites(filtered);
    }
    return { favorites: filtered, persistent: true, trimmed };
  }

  function saveFavorites(ids) {
    const store = getLocalStorage();
    if (!store) {
      return false;
    }
    const normalized = normalizeFavoriteIds(ids);
    try {
      if (normalized.length === 0) {
        store.removeItem(STORAGE_KEYS.favorites);
      } else {
        store.setItem(STORAGE_KEYS.favorites, JSON.stringify(normalized));
      }
      return true;
    } catch (error) {
      console.warn("storage: saveFavorites failed", error);
      return false;
    }
  }

  function loadPrefs() {
    const store = getLocalStorage();
    if (!store) {
      return {
        prefs: { ...DEFAULT_LIBRARY_PREFS },
        persistent: false,
      };
    }
    const raw = store.getItem(STORAGE_KEYS.prefs);
    if (!raw) {
      return {
        prefs: { ...DEFAULT_LIBRARY_PREFS },
        persistent: true,
      };
    }
    const parsed = parseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      store.removeItem(STORAGE_KEYS.prefs);
      return {
        prefs: { ...DEFAULT_LIBRARY_PREFS },
        persistent: true,
      };
    }
    return {
      prefs: {
        ...DEFAULT_LIBRARY_PREFS,
        filterFavoritesOnly: Boolean(parsed.filterFavoritesOnly),
      },
      persistent: true,
    };
  }

  function savePrefs(prefs) {
    const store = getLocalStorage();
    if (!store) {
      return false;
    }
    const payload = {
      ...DEFAULT_LIBRARY_PREFS,
      filterFavoritesOnly: Boolean(prefs?.filterFavoritesOnly),
    };
    try {
      store.setItem(STORAGE_KEYS.prefs, JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn("storage: savePrefs failed", error);
      return false;
    }
  }

  return {
    namespace: STORAGE_NAMESPACE,
    hasFreshFlag,
    loadSession,
    saveSession,
    clearSession,
    shouldReset,
    setTtl,
    loadFavorites,
    saveFavorites,
    loadPrefs,
    savePrefs,
    get ttl() {
      return ttlMs;
    },
  };
}
