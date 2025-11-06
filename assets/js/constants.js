export const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const STOP_FADE_MS = 1200;
export const PREFETCH_AHEAD = 1;
export const MAX_CONSECUTIVE_SKIPS = 3;

export const STORAGE_NAMESPACE = "bbz:v1";
export const QUERY_PARAM_FRESH = "fresh";
export const STORAGE_KEYS = {
  playlist: `${STORAGE_NAMESPACE}:playlist`,
  index: `${STORAGE_NAMESPACE}:index`,
  createdAt: `${STORAGE_NAMESPACE}:createdAt`,
  manifestEtag: `${STORAGE_NAMESPACE}:manifestEtag`,
};

export const MANIFEST_URL = "assets/sounds/bingobuzz/manifest.json";
