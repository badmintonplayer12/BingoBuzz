import { MAX_CONSECUTIVE_SKIPS } from "./constants.js";

function toSeed(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >>> 0;
  }
  if (typeof value === "string") {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0; // Convert to 32-bit int
    }
    return hash >>> 0;
  }
  return null;
}

function createSeededRandom(seedValue) {
  const seed = toSeed(seedValue);
  if (seed === null) {
    return null;
  }
  let state = seed || 1;
  return function rng() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle(arr, seed) {
  const result = [...arr];
  const rng = createSeededRandom(seed) ?? Math.random;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createPlaylist() {
  const state = {
    trackMap: new Map(),
    order: [],
    cursor: 0,
    seed: null,
    lastId: null,
    consecutiveSkips: 0,
  };

  function hydrateTrackMap(files) {
    state.trackMap.clear();
    if (!Array.isArray(files)) {
      return;
    }
    for (const file of files) {
      if (file?.id) {
        state.trackMap.set(file.id, file);
      }
    }
  }

  function buildOrder({ order, seed } = {}) {
    const allIds = [...state.trackMap.keys()];
    if (!allIds.length) {
      state.order = [];
      return;
    }

    if (Array.isArray(order) && order.length) {
      const seen = new Set();
      const filtered = [];
      for (const id of order) {
        if (state.trackMap.has(id) && !seen.has(id)) {
          filtered.push(id);
          seen.add(id);
        }
      }
      for (const id of allIds) {
        if (!seen.has(id)) {
          filtered.push(id);
          seen.add(id);
        }
      }
      state.order = filtered;
      return;
    }

    state.order = fisherYatesShuffle(allIds, seed);
  }

  function getSnapshot() {
    return {
      order: [...state.order],
      index: state.cursor,
      total: state.order.length,
      remaining: Math.max(state.order.length - state.cursor, 0),
      seed: state.seed,
    };
  }

  function ensureInitialized() {
    return state.order.length > 0;
  }

  function next() {
    if (!ensureInitialized() || state.cursor >= state.order.length) {
      return { clip: null, done: true };
    }
    let clip = null;
    let safety = state.order.length;
    while (state.cursor < state.order.length && safety > 0) {
      const id = state.order[state.cursor];
      clip = state.trackMap.get(id) ?? null;
      state.cursor += 1;
      state.lastId = id;
      if (clip) {
        break;
      }
      safety -= 1;
    }

    if (!clip) {
      return { clip: null, done: true };
    }

    return {
      clip,
      done: state.cursor >= state.order.length,
      index: state.cursor - 1,
      total: state.order.length,
      remaining: Math.max(state.order.length - state.cursor, 0),
    };
  }

  function peek() {
    if (!ensureInitialized() || state.cursor >= state.order.length) {
      return null;
    }
    const id = state.order[state.cursor];
    return state.trackMap.get(id) ?? null;
  }

  function reset({ seed } = {}) {
    state.seed = seed ?? Date.now();
    buildOrder({ seed: state.seed });
    state.cursor = 0;
    state.lastId = null;
    state.consecutiveSkips = 0;
    return getSnapshot();
  }

  function init(files, options = {}) {
    hydrateTrackMap(files);
    state.seed = options.seed ?? state.seed ?? Date.now();
    buildOrder({ order: options.order, seed: state.seed });
    state.cursor = clamp(options.index ?? 0, 0, state.order.length);
    state.lastId = null;
    state.consecutiveSkips = 0;
    return getSnapshot();
  }

  function skipFailed(badId) {
    const targetId = badId ?? state.lastId;
    if (targetId) {
      const idx = state.order.indexOf(targetId);
      if (idx !== -1) {
        state.order.splice(idx, 1);
        if (state.cursor > idx) {
          state.cursor -= 1;
        }
      }
    }

    state.consecutiveSkips += 1;
    if (state.consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
      return {
        clip: null,
        done: true,
        exhausted: true,
        skipped: state.consecutiveSkips,
      };
    }

    if (!ensureInitialized() || state.cursor >= state.order.length) {
      return {
        clip: null,
        done: true,
        exhausted: true,
        skipped: state.consecutiveSkips,
      };
    }

    const result = next();
    return {
      ...result,
      skipped: state.consecutiveSkips,
      exhausted: !result.clip,
    };
  }

  function markSuccess() {
    state.consecutiveSkips = 0;
  }

  function isComplete() {
    return state.cursor >= state.order.length;
  }

  return {
    init,
    next,
    peek,
    reset,
    skipFailed,
    markSuccess,
    isComplete,
    snapshot: getSnapshot,
    get size() {
      return state.order.length;
    },
    get cursor() {
      return state.cursor;
    },
  };
}
