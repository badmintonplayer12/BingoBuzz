import { MANIFEST_URL } from "./constants.js";

const DEFAULT_FORMATS = ["webm", "mp3"];

function toNumber(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeFile(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const src = typeof entry.src === "string" ? entry.src.trim() : "";
  if (!id || !src) {
    return null;
  }
  const display =
    typeof entry.display === "string" && entry.display.trim()
      ? entry.display.trim()
      : null;
  return {
    id,
    src,
    display,
    category:
      typeof entry.category === "string" && entry.category.trim()
        ? entry.category.trim()
        : "misc",
    gain: toNumber(entry.gain, 0),
    durationHintMs: toNumber(entry.durationHintMs, null),
    etag:
      typeof entry.etag === "string" && entry.etag.trim()
        ? entry.etag.trim()
        : null,
  };
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Manifest payload is not an object.");
  }

  const version = Number.isInteger(raw.version) ? raw.version : 1;
  const ttlHours = toNumber(raw.ttlHours, 3);
  const ttlMs =
    ttlHours && ttlHours > 0 ? Math.round(ttlHours * 60 * 60 * 1000) : null;

  const formats = Array.isArray(raw.formats) && raw.formats.length
    ? raw.formats.filter((fmt) => typeof fmt === "string" && fmt.trim())
    : DEFAULT_FORMATS;

  const normalization =
    raw.normalization && typeof raw.normalization === "object"
      ? {
          targetLufs: toNumber(raw.normalization.targetLufs, -14),
          peakDbtp: toNumber(raw.normalization.peakDbtp, -1),
        }
      : { targetLufs: -14, peakDbtp: -1 };

  const manifestEtag =
    typeof raw.manifestEtag === "string" && raw.manifestEtag.trim()
      ? raw.manifestEtag.trim()
      : null;

  const seenIds = new Set();
  const files = Array.isArray(raw.files)
    ? raw.files
        .map(sanitizeFile)
        .filter((entry) => {
          if (!entry) {
            return false;
          }
          if (seenIds.has(entry.id)) {
            console.warn("manifest: duplicate id skipped", entry.id);
            return false;
          }
          seenIds.add(entry.id);
          return true;
        })
    : [];

  if (!files.length) {
    throw new Error("Manifest does not include any playable files.");
  }

  const basePath =
    typeof raw.basePath === "string" && raw.basePath.trim()
      ? raw.basePath.trim()
      : null;

  return {
    version,
    ttlHours,
    ttlMs,
    formats,
    normalization,
    manifestEtag,
    basePath,
    files,
  };
}

export async function loadManifest(url = MANIFEST_URL) {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Manifest request failed (${response.status})`);
    }
    const json = await response.json();
    const manifest = normalizeManifest(json);
    return { manifest, error: null };
  } catch (error) {
    console.error("manifest: failed to load", error);
    return { manifest: null, error };
  }
}
