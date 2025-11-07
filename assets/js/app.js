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
  actionButton: document.querySelector("#action-button"),
  actionLabel: document.querySelector("#action-button .big-btn__label"),
  screen: document.querySelector(".big-btn-screen"),
  statusLine: document.querySelector("#status-line"),
  resetBanner: document.querySelector(".reset-banner"),
  resetBtn: document.querySelector("#reset-session"),
};

if (!elements.actionButton || !elements.statusLine) {
  console.warn("BingoBuzz UI elements missing; check markup.");
}

const audioEngine = createAudioEngine();
const playlist = createPlaylist();
const storage = createStorage({ ttl: SESSION_TTL_MS });
let manifestRef = null;
let sessionRef = null;
const disposables = [];
let hueOffset = Math.random() * 360;

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
  audioEngine.cancelPrepare?.();
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
    actionLabel: "Start neste",
    actionDisabled: false,
    actionBusy: false,
    buttonState: "idle",
    showReset: false,
  });
  prefetchUpcomingClip();
}

function prefetchUpcomingClip() {
  if (typeof audioEngine.prepare !== "function") {
    return;
  }
  const upcoming = playlist.peek?.();
  if (!upcoming) {
    audioEngine.cancelPrepare?.();
    return;
  }
  audioEngine
    .prepare(upcoming)
    ?.catch((error) => console.warn("Prefetch failed", error));
}

function handlePlaybackEnded({ reason } = {}) {
  if (reason === "cleanup" || reason === "error") {
    return;
  }
  elements.actionButton?.classList.remove("is-playing");
  if (playlist.isComplete()) {
    updateUi({
      statusText: "Alt spilt i denne økta · Start på nytt",
      actionLabel: "Alt spilt",
      actionDisabled: true,
      actionBusy: false,
      buttonState: "idle",
      showReset: true,
    });
    audioEngine.cancelPrepare?.();
  } else {
    updateUi({
      statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
      actionLabel: "Start neste",
      actionDisabled: false,
      actionBusy: false,
      buttonState: "idle",
      showReset: false,
    });
    prefetchUpcomingClip();
  }
}

function updateUi({
  statusText,
  actionLabel: label,
  actionDisabled,
  actionBusy,
  buttonState,
  showReset,
}) {
  if (typeof label === "string") {
    if (elements.actionLabel) {
      elements.actionLabel.textContent = label;
    }
    // Always update aria-label even if actionLabel element doesn't exist
    elements.actionButton?.setAttribute("aria-label", label);
  }
  if (typeof actionDisabled === "boolean" && elements.actionButton) {
    elements.actionButton.disabled = actionDisabled;
  }
  if (typeof actionBusy === "boolean" && elements.actionButton) {
    if (actionBusy) {
      elements.actionButton.setAttribute("aria-busy", "true");
    } else {
      elements.actionButton.removeAttribute("aria-busy");
      elements.actionButton.classList.remove("is-busy");
    }
  }

  if (typeof statusText === "string" && elements.statusLine) {
    elements.statusLine.textContent = statusText;
  }
  if (typeof showReset === "boolean" && elements.resetBanner) {
    elements.resetBanner.hidden = !showReset;
  }

  if (elements.actionButton) {
    elements.actionButton.classList.remove("is-playing", "is-fading");
    if (buttonState === "playing") {
      elements.actionButton.classList.add("is-playing");
    } else if (buttonState === "fading") {
      elements.actionButton.classList.add("is-fading");
    }
  }

  if (typeof buttonState === "string" && typeof document !== "undefined") {
    if (buttonState === "playing") {
      document.body.classList.add("-playing");
      document.body.classList.remove("-fading");
    } else if (buttonState === "fading") {
      document.body.classList.add("-fading");
      document.body.classList.remove("-playing");
    } else {
      document.body.classList.remove("-playing", "-fading");
    }
  }
}

function nextHue() {
  const goldenAngle = 137.508;
  hueOffset = (hueOffset + goldenAngle) % 360;
  return hueOffset;
}

function updateButtonColor() {
  const hue = nextHue();
  const sat = 80 + Math.random() * 10;
  const light = 45 + Math.random() * 10;

  document.documentElement.style.setProperty("--theme-hue", String(hue));
  document.documentElement.style.setProperty("--bg-tint-hue", String((hue + 200) % 360));
  document.documentElement.style.setProperty("--btn-color-start", `hsl(${hue}, ${sat}%, ${light + 15}%)`);
  document.documentElement.style.setProperty("--btn-color-mid", `hsl(${(hue + 20) % 360}, ${sat}%, ${light}%)`);
  document.documentElement.style.setProperty("--btn-color-end", `hsl(${(hue + 40) % 360}, ${sat}%, ${light - 10}%)`);

  document.documentElement.style.setProperty("--btn-active-glow", `hsla(${hue}, 90%, 70%, 0.9)`);
  document.documentElement.style.setProperty("--btn-idle-glow", `hsla(${hue}, 85%, 65%, 0.55)`);
  document.documentElement.style.setProperty("--btn-fade-glow", `hsla(${(hue + 30) % 360}, 85%, 75%, 0.75)`);

}

async function playClipResult(result) {
  if (!result || !result.clip) {
    elements.actionButton?.classList.remove("is-playing");
    updateUi({
      statusText: "Alt spilt i denne økta · Start på nytt",
      actionLabel: "Alt spilt",
      actionDisabled: true,
      actionBusy: false,
      buttonState: "idle",
      showReset: true,
    });
    return;
  }
  try {
    updateUi({
      statusText: `Spiller #${result.index + 1} av ${result.total} …`,
      actionLabel: "Fade ut",
      actionDisabled: false,
      actionBusy: false,
      buttonState: "playing",
      showReset: false,
    });
    elements.actionButton?.classList.add("is-playing");

    await audioEngine.play(result.clip);
    playlist.markSuccess();
    persistSession({ index: playlist.cursor });
    prefetchUpcomingClip();

    updateUi({
      statusText: `Spiller #${result.index + 1} av ${result.total} …`,
      actionLabel: "Fade ut",
      actionDisabled: false,
      actionBusy: false,
      buttonState: "playing",
    });
  } catch (error) {
    console.error("playClipResult failed", error);
    elements.actionButton?.classList.remove("is-playing");

    if (error?.name === "NotAllowedError") {
      updateUi({
        statusText: "Tillat avspilling i nettleseren og prøv igjen.",
        actionLabel: "Start neste",
        actionDisabled: false,
        actionBusy: false,
        buttonState: "idle",
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
        actionLabel: "Start neste",
        actionDisabled: false,
        actionBusy: false,
        buttonState: "idle",
        showReset: false,
      });
      await playClipResult(skipResult);
    } else {
      updateUi({
        statusText: "Kunne ikke spille av klippene · Start på nytt",
        actionLabel: "Alt spilt",
        actionDisabled: true,
        actionBusy: false,
        buttonState: "idle",
        showReset: true,
      });
    }
  }
}

async function playNext() {
  const nextResult = playlist.next();
  if (nextResult?.clip) {
    updateButtonColor();
  }
  await playClipResult(nextResult);
}

async function handleActionClick() {
  if (audioEngine.state === "playing") {
    elements.actionButton?.classList.remove("is-playing");
    updateUi({
      statusText: "Fader ut …",
      actionLabel: "Fader ut …",
      actionDisabled: true,
      actionBusy: true,
      buttonState: "fading",
      showReset: false,
    });
    elements.actionButton?.style.setProperty("--fade-ms", `${STOP_FADE_MS}ms`);
    try {
      await audioEngine.fadeOut(STOP_FADE_MS);
      elements.actionButton?.classList.add("post-bounce");
      setTimeout(() => elements.actionButton?.classList.remove("post-bounce"), 420);
      elements.actionButton?.style.removeProperty("--fade-ms");
    } catch (error) {
      console.error("Fade out failed", error);
      updateUi({
        statusText: "Fade feilet · prøv igjen",
        actionLabel: "Start neste",
        actionDisabled: false,
        actionBusy: false,
        buttonState: "idle",
      });
    } finally {
      elements.actionButton?.style.removeProperty("--fade-ms");
    }
    return;
  }

  if (audioEngine.state === "fading") {
    updateUi({ actionBusy: true, buttonState: "fading" });
    return;
  }

  if (playlist.isComplete()) {
    updateUi({
      statusText: "Alt spilt i denne økta · Start på nytt",
      actionLabel: "Alt spilt",
      actionDisabled: true,
      actionBusy: false,
      buttonState: "idle",
      showReset: true,
    });
    return;
  }

  updateUi({ actionBusy: true, buttonState: "playing" });
  await playNext();
}

function bindUi() {
  disposables.push(audioEngine.on("ended", handlePlaybackEnded));

  elements.actionButton?.addEventListener("click", () => {
    void handleActionClick();
  });
  elements.resetBtn?.addEventListener("click", () => {
    resetSession();
  });

  // Use document-level click handler to catch clicks outside the button
  // This ensures we catch clicks even when they bubble up from child elements
  document.addEventListener("click", (event) => {
    if (!event || !elements.actionButton || !elements.screen) {
      return;
    }

    const target = event.target;

    if (elements.actionButton === target || elements.actionButton.contains(target)) {
      return;
    }

    if (elements.resetBtn && (elements.resetBtn === target || elements.resetBtn.contains(target))) {
      return;
    }

    if (elements.screen === target || elements.screen.contains(target)) {
      toggleFullscreen({ userInitiated: true });
    }
  });
}

function toggleFullscreen({ userInitiated = false } = {}) {
  if (typeof document === "undefined") {
    return;
  }
  if (!document.fullscreenEnabled) {
    return;
  }
  if (document.fullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    return;
  }
  if (!userInitiated) {
    return;
  }
  const target = document.documentElement;
  if (target.requestFullscreen) {
    target.requestFullscreen().catch(() => {});
  }
}

if (typeof window !== "undefined") {
  window.bingoBuzzDebug = {
    playlist,
    audioEngine,
    storage,
    getState() {
      return {
        audioState: audioEngine.state,
        manifest: manifestRef,
        playlist: playlist.snapshot(),
        session: sessionRef,
      };
    },
    resetPlaylist() {
      resetSession();
      return playlist.snapshot();
    },
  };

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
      actionLabel: "Ingen klipp",
      actionDisabled: true,
      actionBusy: false,
      buttonState: "idle",
      showReset: false,
    });
  } else {
    updateUi({
      statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
      actionLabel: "Start neste",
      actionDisabled: false,
      actionBusy: false,
      buttonState: "idle",
      showReset: false,
    });
  }

  prefetchUpcomingClip();
}

const run = () => {
  bootstrap().catch((err) => {
    console.error("BingoBuzz bootstrap failed", err);
  });
};

// Expose debugging helpers for QA/testing (as referenced in ROADMAP.md)
if (typeof window !== "undefined") {
  window.bingoBuzzDebug = {
    get playlist() {
      return playlist;
    },
    get audioEngine() {
      return audioEngine;
    },
    get storage() {
      return storage;
    },
    get manifest() {
      return manifestRef;
    },
    get session() {
      return sessionRef;
    },
    // Helper to reset playlist manually (useful for testing)
    resetPlaylist() {
      resetSession();
      console.log("Playlist reset. Snapshot:", playlist.snapshot());
    },
    // Helper to check current state
    getState() {
      return {
        playlist: playlist.snapshot(),
        audioEngine: {
          state: audioEngine.state,
          currentClip: audioEngine.currentClip,
          supportsWebAudio: audioEngine.supportsWebAudio,
        },
        storage: {
          session: storage.loadSession(),
          hasFreshFlag: storage.hasFreshFlag,
          ttl: storage.ttl,
        },
        manifest: manifestRef,
      };
    },
  };
  console.info(
    "BingoBuzz debug helpers available via window.bingoBuzzDebug",
    "\nTry: bingoBuzzDebug.getState()",
    "\nOr: bingoBuzzDebug.playlist.snapshot()",
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run, { once: true });
} else {
  run();
}
