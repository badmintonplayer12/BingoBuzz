import {
  STORAGE_KEYS,
  QUERY_PARAM_FRESH,
  STORAGE_NAMESPACE,
} from "./constants.js";

const TRUTHY_FRESH_VALUES = new Set(["1", "true", "yes", "fresh"]);

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

  return {
    namespace: STORAGE_NAMESPACE,
    hasFreshFlag,
    loadSession,
    saveSession,
    clearSession,
    shouldReset,
    setTtl,
    get ttl() {
      return ttlMs;
    },
  };
}
