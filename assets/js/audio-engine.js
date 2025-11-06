const DEFAULT_BASE_PATH = "assets/sounds/bingobuzz";
const DEFAULT_FORMATS = ["webm", "mp3"];
const AudioCtx = typeof window !== "undefined"
  ? window.AudioContext || window.webkitAudioContext
  : null;

const STATES = {
  idle: "idle",
  playing: "playing",
  fading: "fading",
  error: "error",
};

function now(context) {
  return context ? context.currentTime : 0;
}

async function fetchArrayBuffer(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`audio: ${url} responded with ${response.status}`);
  }
  return response.arrayBuffer();
}

function pickSourceUrls(clip, basePath, formats) {
  if (!clip) {
    return [];
  }
  const root = clip.src ?? clip.id;
  if (!root) {
    return [];
  }
  const prefix = clip.basePath ?? basePath;
  return formats.map((fmt) => `${prefix}/${root}.${fmt}`);
}

function createGainWithFade(context) {
  const gainNode = context.createGain();
  // Ensure we start unmuted.
  gainNode.gain.setValueAtTime(1, now(context));
  return gainNode;
}

function fadeGainToZero(context, gainNode, durationMs = 0) {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
  const start = now(context);
  const durationSeconds = safeDuration / 1000;
  gainNode.gain.cancelScheduledValues(start);
  gainNode.gain.setValueAtTime(gainNode.gain.value, start);
  gainNode.gain.linearRampToValueAtTime(0.0001, start + durationSeconds);
}

function fadeHtmlAudioToZero(audioEl, durationMs = 0) {
  const duration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
  if (!audioEl || duration === 0) {
    audioEl.volume = 0;
    audioEl.pause();
    return Promise.resolve();
  }
  const startVolume = audioEl.volume;
  const start = performance.now();

  return new Promise((resolve) => {
    function step(ts) {
      const elapsed = ts - start;
      const progress = Math.min(elapsed / duration, 1);
      audioEl.volume = startVolume * (1 - progress);
      if (progress >= 1) {
        audioEl.pause();
        audioEl.currentTime = 0;
        audioEl.volume = startVolume;
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  });
}

export function createAudioEngine(options = {}) {
  const supportsWebAudio = Boolean(AudioCtx);
  const state = {
    status: STATES.idle,
    context: null,
    gainNode: null,
    currentSource: null,
    currentClip: null,
    htmlAudio: null,
    abortController: null,
    basePath: options.basePath || DEFAULT_BASE_PATH,
    formats: options.formats?.length ? [...options.formats] : [...DEFAULT_FORMATS],
    lastError: null,
    listeners: {
      ended: new Set(),
    },
  };

  function emit(event, payload) {
    const set = state.listeners[event];
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`audio: listener for ${event} failed`, error);
      }
    }
  }

  function on(event, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const set = state.listeners[event];
    if (!set) {
      return () => {};
    }
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  function setStatus(nextStatus) {
    state.status = nextStatus;
  }

  function ensureContext() {
    if (!supportsWebAudio) {
      return null;
    }
    if (!state.context) {
      state.context = new AudioCtx();
    }
    return state.context;
  }

  async function decodeAndPlayWebAudio(clip, urls) {
    const context = ensureContext();
    if (!context) {
      throw new Error("Web Audio not supported.");
    }

    const controller = new AbortController();
    state.abortController = controller;
    let lastError = null;
    for (const url of urls) {
      try {
        const arrayBuffer = await fetchArrayBuffer(url, controller.signal);
        const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
        const source = context.createBufferSource();
        const gainNode = createGainWithFade(context);

        source.buffer = audioBuffer;
        source.connect(gainNode).connect(context.destination);
        if (context.state === "suspended") {
          await context.resume();
        }
        source.start();

        state.currentSource = source;
        state.gainNode = gainNode;
        state.currentClip = clip;

        source.onended = () => {
          if (state.status !== STATES.fading) {
            cleanupPlayback({ notify: true, reason: "ended" });
            setStatus(STATES.idle);
          }
        };

        return;
      } catch (error) {
        lastError = error;
        console.warn("audio: failed to use url", url, error);
      }
    }
    throw lastError ?? new Error("audio: no playable source found.");
  }

  async function playWithHtmlAudio(clip, urls) {
    const audioEl = state.htmlAudio ?? new Audio();
    state.htmlAudio = audioEl;

    let lastError = null;
    for (const url of urls) {
      try {
        audioEl.pause();
        audioEl.src = url;
        audioEl.currentTime = 0;
        audioEl.volume = 1;
        await audioEl.play();
        state.currentClip = clip;
        audioEl.onended = () => {
          if (state.status !== STATES.fading) {
            cleanupPlayback({ notify: true, reason: "ended" });
            setStatus(STATES.idle);
          }
        };
        return;
      } catch (error) {
        lastError = error;
        console.warn("audio: HTML audio failed", url, error);
      }
    }
    throw lastError ?? new Error("audio: no playable source found (HTML).");
  }

  function cleanupPlayback({ notify = false, reason = "cleanup" } = {}) {
    const clip = state.currentClip;

    if (state.currentSource) {
      try {
        state.currentSource.onended = null;
        state.currentSource.stop();
      } catch (error) {
        console.warn("audio: cleanup stop failed", error);
      }
    }
    state.currentSource = null;

    if (state.gainNode) {
      try {
        state.gainNode.disconnect();
      } catch (error) {
        console.warn("audio: cleanup disconnect failed", error);
      }
    }
    state.gainNode = null;
    state.currentClip = null;

    if (state.htmlAudio) {
      try {
        state.htmlAudio.pause();
        state.htmlAudio.currentTime = 0;
        state.htmlAudio.removeAttribute("src");
        state.htmlAudio.load();
      } catch (error) {
        console.warn("audio: cleanup html audio failed", error);
      }
    }

    if (state.abortController) {
      state.abortController.abort();
    }
    state.abortController = null;

    if (notify && clip) {
      emit("ended", { clip, reason });
    }
  }

  async function play(clip) {
    if (state.status === STATES.playing || state.status === STATES.fading) {
      throw new Error("audio: busy");
    }
    if (!clip) {
      throw new Error("audio: clip metadata missing");
    }
    const urls = pickSourceUrls(clip, state.basePath, state.formats);
    if (!urls.length) {
      throw new Error("audio: no source urls");
    }

    cleanupPlayback();
    setStatus(STATES.playing);
    state.lastError = null;
    try {
      if (supportsWebAudio) {
        await decodeAndPlayWebAudio(clip, urls);
      } else {
        await playWithHtmlAudio(clip, urls);
      }
      setStatus(STATES.playing);
    } catch (error) {
      cleanupPlayback({ notify: true, reason: "error" });
      state.lastError = error;
      setStatus(STATES.error);
      throw error;
    }
  }

  async function fadeOut(durationMs = 0) {
    if (state.status !== STATES.playing) {
      return;
    }
    setStatus(STATES.fading);

    try {
      const duration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
      if (supportsWebAudio && state.context && state.gainNode) {
        fadeGainToZero(state.context, state.gainNode, duration);
        const stopAt = now(state.context) + duration / 1000 + 0.02;
        state.currentSource?.stop(stopAt);
        await new Promise((resolve) => {
          const onEnd = () => {
            cleanupPlayback({ notify: true, reason: "faded" });
            setStatus(STATES.idle);
            resolve();
          };
          if (state.currentSource) {
            state.currentSource.onended = onEnd;
          } else {
            onEnd();
          }
        });
      } else if (state.htmlAudio) {
        await fadeHtmlAudioToZero(state.htmlAudio, duration);
        cleanupPlayback({ notify: true, reason: "faded" });
        setStatus(STATES.idle);
      } else {
        cleanupPlayback({ notify: true, reason: "faded" });
        setStatus(STATES.idle);
      }
    } catch (error) {
      cleanupPlayback({ notify: true, reason: "error" });
      state.lastError = error;
      setStatus(STATES.error);
      throw error;
    }
  }

  function stopImmediate() {
    cleanupPlayback({ notify: true, reason: "stopped" });
    setStatus(STATES.idle);
  }

  function configure({ basePath, formats } = {}) {
    if (typeof basePath === "string" && basePath.trim()) {
      state.basePath = basePath.trim();
    }
    if (Array.isArray(formats) && formats.length) {
      state.formats = formats
        .map((fmt) => fmt.trim())
        .filter(Boolean);
    }
  }

  return {
    get state() {
      return state.status;
    },
    get supportsWebAudio() {
      return supportsWebAudio;
    },
    get currentClip() {
      return state.currentClip;
    },
    get lastError() {
      return state.lastError;
    },
    on,
    configure,
    play,
    fadeOut,
    stopImmediate,
  };
}
