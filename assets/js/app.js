import { SESSION_TTL_MS, STOP_FADE_MS } from "./constants.js";
import { createAudioEngine } from "./audio-engine.js";
import { createPlaylist } from "./playlist.js";
import { createStorage } from "./storage.js";
import { loadManifest } from "./manifest.js";

/**
 * Phase 2 scaffold: DOM references plus manifest/storage bootstrap.
 * Detailed playback logic lands in later roadmap steps.
 */

const elements = {
  playNext: document.querySelector("#play-next"),
  fadeOut: document.querySelector("#fade-out"),
  statusLine: document.querySelector("#status-line"),
  resetBanner: document.querySelector(".reset-banner"),
  resetBtn: document.querySelector("#reset-session"),
};

if (!elements.playNext || !elements.fadeOut || !elements.statusLine) {
  console.warn("BingoBuzz UI elements missing; check markup.");
}

const audioEngine = createAudioEngine();
const playlist = createPlaylist();
const storage = createStorage({ ttl: SESSION_TTL_MS });
let manifestRef = null;
let sessionRef = null;
const disposables = [];

function persistSession({ index, order } = {}) {
  const snapshot = playlist.snapshot();
  const manifestEtag = manifestRef?.manifestEtag ?? null;
  const createdAt = sessionRef?.createdAt ?? Date.now();

  storage.saveSession({
    playlistIds: order ?? snapshot.order,
    index: typeof index === "number" ? index : snapshot.index,
    createdAt,
    manifestEtag,
  });

  sessionRef = {
    ...sessionRef,
    playlistIds: order ?? snapshot.order,
    index: typeof index === "number" ? index : snapshot.index,
    createdAt,
    manifestEtag,
  };
}

function resetSession() {
  audioEngine.stopImmediate();
  const snapshot = playlist.reset();
  sessionRef = {
    playlistIds: snapshot.order,
    index: snapshot.index,
    createdAt: Date.now(),
    manifestEtag: manifestRef?.manifestEtag ?? null,
  };
  storage.saveSession(sessionRef);
  updateUi({
    statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
    playDisabled: false,
    fadeDisabled: true,
    showReset: false,
  });
}

function handlePlaybackEnded({ reason } = {}) {
  if (reason === "cleanup" || reason === "error") {
    return;
  }
  if (playlist.isComplete()) {
    updateUi({
      statusText: "Alt spilt i denne økta · Start på nytt",
      playDisabled: true,
      fadeDisabled: true,
      showReset: true,
    });
  } else {
    updateUi({
      statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
      playDisabled: false,
      fadeDisabled: true,
      showReset: false,
    });
  }
}

function updateUi({ statusText, playDisabled, fadeDisabled, showReset }) {
  if (typeof playDisabled === "boolean" && elements.playNext) {
    elements.playNext.disabled = playDisabled;
    if (playDisabled) {
      elements.playNext.setAttribute("aria-busy", "true");
    } else {
      elements.playNext.removeAttribute("aria-busy");
      elements.playNext.classList.remove("is-busy");
    }
  }
  if (typeof fadeDisabled === "boolean" && elements.fadeOut) {
    elements.fadeOut.disabled = fadeDisabled;
    if (fadeDisabled) {
      elements.fadeOut.setAttribute("aria-disabled", "true");
    } else {
      elements.fadeOut.removeAttribute("aria-disabled");
    }
  }
  if (typeof statusText === "string" && elements.statusLine) {
    elements.statusLine.textContent = statusText;
  }
  if (typeof showReset === "boolean" && elements.resetBanner) {
    elements.resetBanner.hidden = !showReset;
  }
}

async function playClipResult(result) {
  if (!result || !result.clip) {
    updateUi({
      statusText: "Alt spilt i denne økta · Start på nytt",
      playDisabled: true,
      fadeDisabled: true,
      showReset: true,
    });
    return;
  }
  try {
    updateUi({
      statusText: `Spiller #${result.index + 1} av ${result.total} …`,
      playDisabled: true,
      fadeDisabled: false,
      showReset: false,
    });

    await audioEngine.play(result.clip);
    playlist.markSuccess();
    persistSession({ index: playlist.cursor });

    updateUi({
      statusText: `Spiller #${result.index + 1} av ${result.total} …`,
      playDisabled: true,
      fadeDisabled: false,
    });
  } catch (error) {
    console.error("playClipResult failed", error);

    if (error?.name === "NotAllowedError") {
      updateUi({
        statusText: "Tillat avspilling i nettleseren og prøv igjen.",
        playDisabled: false,
        fadeDisabled: true,
        showReset: false,
      });
      return;
    }

    const skipResult = playlist.skipFailed(result.clip?.id);
    if (skipResult.clip) {
      persistSession({
        index: playlist.cursor,
        order: playlist.snapshot().order,
      });
      updateUi({
        statusText: "Hoppet over en fil · prøver neste …",
        playDisabled: false,
        fadeDisabled: true,
        showReset: false,
      });
      await playClipResult(skipResult);
    } else {
      updateUi({
        statusText: "Kunne ikke spille av klippene · Start på nytt",
        playDisabled: true,
        fadeDisabled: true,
        showReset: true,
      });
    }
  }
}

async function playNext() {
  if (audioEngine.state === "playing" || audioEngine.state === "fading") {
    elements.playNext?.classList.add("is-busy");
    setTimeout(() => elements.playNext?.classList.remove("is-busy"), 320);
    return;
  }

  const nextResult = playlist.next();
  await playClipResult(nextResult);
}

function bindUi() {
  disposables.push(audioEngine.on("ended", handlePlaybackEnded));

  elements.playNext?.addEventListener("click", () => {
    void playNext();
  });
  elements.fadeOut?.addEventListener("click", async () => {
    if (audioEngine.state !== "playing") {
      return;
    }
    updateUi({
      statusText: "Fader ut …",
      playDisabled: true,
      fadeDisabled: true,
      showReset: false,
    });
    try {
      await audioEngine.fadeOut(STOP_FADE_MS);
      if (playlist.isComplete()) {
        updateUi({
          statusText: "Alt spilt i denne økta · Start på nytt",
          playDisabled: true,
          fadeDisabled: true,
          showReset: true,
        });
      } else {
        updateUi({
          statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
          playDisabled: false,
          fadeDisabled: true,
          showReset: false,
        });
      }
    } catch (error) {
      console.error("Fade out failed", error);
      updateUi({
        statusText: "Fade feilet · prøv igjen",
        playDisabled: false,
        fadeDisabled: true,
      });
    }
  });
  elements.resetBtn?.addEventListener("click", () => {
    resetSession();
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    disposables.splice(0).forEach((dispose) => {
      try {
        dispose?.();
      } catch (error) {
        console.warn("cleanup listener failed", error);
      }
    });
  });
}

async function bootstrap() {
  console.info("BingoBuzz bootstrap (Phase 2)");
  bindUi();

  const { manifest, error } = await loadManifest();
  manifestRef = manifest;
  if (manifest?.ttlMs) {
    storage.setTtl(manifest.ttlMs);
  }
  const session = storage.loadSession();
  sessionRef = session;
  const resetDecision = storage.shouldReset({
    session,
    manifestEtag: manifest?.manifestEtag ?? null,
  });

  if (resetDecision.reset) {
    storage.clearSession();
    sessionRef = null;
  }

  let playlistSnapshot = null;
  const files = manifest?.files ?? [];

  if (files.length) {
    const reuseSession = Boolean(session && !resetDecision.reset);
    if (reuseSession && session) {
      playlistSnapshot = playlist.init(files, {
        order: session.playlistIds,
        index: session.index,
      });
      sessionRef = {
        playlistIds: playlistSnapshot.order,
        index: playlistSnapshot.index,
        createdAt: session.createdAt,
        manifestEtag: manifest?.manifestEtag ?? session.manifestEtag ?? null,
      };
      storage.saveSession(sessionRef);
    } else {
      playlistSnapshot = playlist.init(files);
      sessionRef = {
        playlistIds: playlistSnapshot.order,
        index: playlistSnapshot.index,
        createdAt: Date.now(),
        manifestEtag: manifest?.manifestEtag ?? null,
      };
      storage.saveSession(sessionRef);
    }
  } else {
    playlistSnapshot = playlist.init([]);
    sessionRef = null;
  }

  console.info("BingoBuzz state snapshot", {
    manifest,
    manifestError: error,
    session: resetDecision.reset ? null : session,
    resetDecision,
    audioEngine,
    playlist,
    playlistSnapshot,
  });

  audioEngine.configure({
    formats: manifest?.formats,
    basePath: manifest?.basePath ?? undefined,
  });

  if (playlist.size === 0) {
    updateUi({
      statusText: "Ingen klipp tilgjengelig · sjekk manifestet",
      playDisabled: true,
      fadeDisabled: true,
      showReset: false,
    });
  } else {
    updateUi({
      statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
      playDisabled: false,
      fadeDisabled: true,
      showReset: false,
    });
  }
}

const run = () => {
  bootstrap().catch((err) => {
    console.error("BingoBuzz bootstrap failed", err);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run, { once: true });
} else {
  run();
}
