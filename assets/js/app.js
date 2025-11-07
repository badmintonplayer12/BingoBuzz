import { SESSION_TTL_MS, STOP_FADE_MS } from "./constants.js";
import { createAudioEngine } from "./audio-engine.js";
import { createPlaylist, buildFavoritesFirstOrder } from "./playlist.js";
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
  libraryOverlay: document.querySelector("#library-overlay"),
  libraryPanel: document.querySelector(".library-panel"),
  libraryHotspot: document.querySelector(".library-hotspot"),
  libraryClose: document.querySelector("#library-close"),
  regenButton: document.querySelector("#regen-button"),
  libraryStatus: document.querySelector("#library-status"),
  libraryList: document.querySelector("#library-list"),
  favoritesToggle: document.querySelector("#favorites-toggle"),
};

if (!elements.actionButton || !elements.statusLine) {
  console.warn("BingoBuzz UI elements missing; check markup.");
}

elements.libraryPanel?.setAttribute("tabindex", "-1");

const focusableSelectors =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const LONG_PRESS_DELAY_MS = 600;

const audioEngine = createAudioEngine();
const playlist = createPlaylist();
const storage = createStorage({ ttl: SESSION_TTL_MS });
let manifestRef = null;
let sessionRef = null;
const disposables = [];
let hueOffset = Math.random() * 360;
const favoritesSet = new Set();
const libraryState = {
  isOpen: false,
  filterFavoritesOnly: false,
  previewId: null,
};
let previewAudio = null;
let longPressTimer = null;
let lastFocusedElement = null;
let libraryStatusResetTimer = null;
let favoritesPersistenceAvailable = true;
let prefsPersistenceAvailable = true;
let regenerateInFlight = false;
let hotspotSeen = false;

function humanizeClipId(id) {
  return typeof id === "string" ? id.replace(/_/g, " ") : "";
}

function clearLongPressTimer() {
  if (longPressTimer) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function persistSession({ index, order, createdAt } = {}) {
  const snapshot = playlist.snapshot();
  const manifestEtag = manifestRef?.manifestEtag ?? null;
  const createdAtValue =
    typeof createdAt === "number" ? createdAt : sessionRef?.createdAt ?? Date.now();

  storage.saveSession({
    playlistIds: order ?? snapshot.order,
    index: typeof index === "number" ? index : snapshot.index,
    createdAt: createdAtValue,
    manifestEtag,
  });

  sessionRef = {
    ...sessionRef,
    playlistIds: order ?? snapshot.order,
    index: typeof index === "number" ? index : snapshot.index,
    createdAt: createdAtValue,
    manifestEtag,
  };
}

function resetSession() {
  stopPreviewPlayback();
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
      document.body.classList.add("-playing", "-ambient");
      document.body.classList.remove("-fading");
    } else if (buttonState === "fading") {
      document.body.classList.add("-fading");
      document.body.classList.remove("-playing", "-ambient");
    } else {
      document.body.classList.remove("-playing", "-fading", "-ambient");
    }
  }
}

function openLibrary() {
  if (!elements.libraryOverlay) {
    return;
  }
  if (libraryState.isOpen) {
    return;
  }
  clearLongPressTimer();
  lastFocusedElement = document.activeElement;
  elements.libraryOverlay.hidden = false;
  libraryState.isOpen = true;
  markHotspotSeen();
  renderLibraryList();
  updateLibraryStatus();
  if (libraryStatusResetTimer) {
    clearTimeout(libraryStatusResetTimer);
    libraryStatusResetTimer = null;
  }
  const focusTarget =
    (!elements.regenButton?.disabled && elements.regenButton) ??
    elements.libraryPanel?.querySelector(focusableSelectors);
  focusTarget?.focus();
}

function closeLibrary() {
  if (!libraryState.isOpen || !elements.libraryOverlay) {
    return;
  }
  stopPreviewPlayback();
  elements.libraryOverlay.hidden = true;
  libraryState.isOpen = false;
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function toggleLibrary() {
  if (libraryState.isOpen) {
    closeLibrary();
  } else {
    openLibrary();
  }
}

function setLibraryStatus(message) {
  if (!elements.libraryStatus) {
    return;
  }
  if (libraryStatusResetTimer) {
    clearTimeout(libraryStatusResetTimer);
    libraryStatusResetTimer = null;
  }
  if (message) {
    elements.libraryStatus.textContent = message;
    libraryStatusResetTimer = window.setTimeout(() => {
      libraryStatusResetTimer = null;
      updateLibraryStatus();
    }, 2500);
  } else {
    updateLibraryStatus();
  }
}

function stopPreviewPlayback() {
  if (previewAudio) {
    try {
      previewAudio.pause();
    } catch (error) {
      console.warn("preview stop failed", error);
    }
  }
  previewAudio = null;
  libraryState.previewId = null;
  if (elements.libraryList) {
    elements.libraryList
      .querySelectorAll(".preview-button[aria-pressed='true']")
      .forEach((btn) => btn.setAttribute("aria-pressed", "false"));
  }
}

function buildPreviewSrc(file) {
  if (!manifestRef) {
    return null;
  }
  const base = manifestRef.basePath ?? "assets/sounds/bingobuzz";
  const formats = manifestRef.formats?.length ? manifestRef.formats : ["mp3"];
  const root = file?.src ?? file?.id;
  if (!root) {
    return null;
  }
  return `${base}/${root}.${formats[0]}`;
}

function ensureMainPlaybackIdle() {
  if (audioEngine.state === "playing" || audioEngine.state === "fading") {
    audioEngine.stopImmediate();
  }
}

async function handlePreviewClick(fileId) {
  if (!manifestRef) {
    return;
  }
  const target = manifestRef.files.find((file) => file.id === fileId);
  if (!target) {
    return;
  }
  const src = buildPreviewSrc(target);
  if (!src) {
    return;
  }
  if (libraryState.previewId === fileId && previewAudio) {
    stopPreviewPlayback();
    return;
  }
  stopPreviewPlayback();
  ensureMainPlaybackIdle();
  previewAudio = new Audio(src);
  libraryState.previewId = fileId;
  previewAudio.volume = 1;
  previewAudio.addEventListener("ended", () => stopPreviewPlayback());
  previewAudio.play().catch((error) => {
    console.warn("preview failed", error);
    stopPreviewPlayback();
  });
  if (elements.libraryList) {
    elements.libraryList
      .querySelectorAll(".preview-button")
      .forEach((btn) => {
        btn.setAttribute(
          "aria-pressed",
          btn.dataset.fileId === fileId ? "true" : "false",
        );
      });
  }
}

function toggleFavorite(fileId) {
  if (!fileId) {
    return;
  }
  if (favoritesSet.has(fileId)) {
    favoritesSet.delete(fileId);
  } else {
    favoritesSet.add(fileId);
  }
  renderLibraryList();
  persistFavorites();
}

function renderLibraryList() {
  if (!elements.libraryList || !manifestRef) {
    return;
  }
  const files = manifestRef.files ?? [];
  const sorted = files.slice(0).sort((a, b) => a.id.localeCompare(b.id));
  const filteredRows = sorted
    .filter((file) =>
      libraryState.filterFavoritesOnly ? favoritesSet.has(file.id) : true,
    )
    .sort((a, b) => {
      const favA = favoritesSet.has(a.id) ? 0 : 1;
      const favB = favoritesSet.has(b.id) ? 0 : 1;
      if (favA !== favB) {
        return favA - favB;
      }
      return a.id.localeCompare(b.id);
    });

  const fragment = document.createDocumentFragment();
  filteredRows.forEach((file) => {
    const item = document.createElement("div");
    item.className = "library-item";
    const displayName = humanizeClipId(file.id);

    const meta = document.createElement("div");
    meta.className = "library-item__meta";
    const title = document.createElement("span");
    title.className = "library-item__title";
    title.textContent = displayName || file.id;
    const category = document.createElement("span");
    category.className = "library-item__category";
    category.textContent = file.category ?? "ukjent";
    meta.append(title, category);

    const previewBtn = document.createElement("button");
    previewBtn.className = "preview-button";
    previewBtn.dataset.fileId = file.id;
    previewBtn.setAttribute("aria-pressed", libraryState.previewId === file.id ? "true" : "false");
    previewBtn.setAttribute("aria-label", `Forhåndslytt på ${displayName || file.id}`);
    previewBtn.title = `Forhåndslytt på ${displayName || file.id}`;

    const favBtn = document.createElement("button");
    favBtn.className = "favorite-button";
    favBtn.textContent = "★";
    favBtn.dataset.fileId = file.id;
    favBtn.setAttribute("aria-pressed", favoritesSet.has(file.id) ? "true" : "false");
    favBtn.setAttribute("aria-label", `Merk ${displayName || file.id} som favoritt`);

    item.append(meta, previewBtn, favBtn);
    fragment.append(item);
  });

  const hasRows = filteredRows.length > 0;
  elements.libraryList.replaceChildren(fragment);
  if (!hasRows) {
    const emptyState = document.createElement("p");
    emptyState.className = "library-empty";
    emptyState.textContent = libraryState.filterFavoritesOnly
      ? "Ingen favoritter merket enda."
      : "Ingen klipp tilgjengelig.";
    elements.libraryList.append(emptyState);
  }
  if (elements.regenButton) {
    elements.regenButton.disabled = files.length === 0;
  }
  updateLibraryStatus();
}

function persistFavorites() {
  if (typeof storage.saveFavorites !== "function") {
    return;
  }
  const success = storage.saveFavorites(Array.from(favoritesSet));
  if (!success) {
    favoritesPersistenceAvailable = false;
    setLibraryStatus("Favoritter lagres ikke (privatmodus aktiv).");
  } else {
    favoritesPersistenceAvailable = true;
  }
}

function persistLibraryPrefs() {
  if (typeof storage.savePrefs !== "function") {
    return;
  }
  const success = storage.savePrefs({
    filterFavoritesOnly: Boolean(libraryState.filterFavoritesOnly),
  });
  if (!success) {
    prefsPersistenceAvailable = false;
    setLibraryStatus("Bibliotek-innstillinger lagres ikke (privatmodus aktiv).");
  } else {
    prefsPersistenceAvailable = true;
  }
}

function updateHotspotHighlight() {
  if (elements.libraryHotspot) {
    elements.libraryHotspot.classList.toggle("needs-highlight", !hotspotSeen);
  }
}

function markHotspotSeen() {
  if (hotspotSeen) {
    return;
  }
  hotspotSeen = true;
  updateHotspotHighlight();
  storage.saveHotspotSeen?.(true);
}

function hydrateFavoritesAndPrefs() {
  const files = manifestRef?.files ?? [];
  const validIds = new Set(files.map((file) => file.id));
  if (typeof storage.loadFavorites === "function") {
    const result = storage.loadFavorites({ validIds });
    favoritesSet.clear();
    (result?.favorites ?? []).forEach((id) => favoritesSet.add(id));
    favoritesPersistenceAvailable = result?.persistent !== false;
    if (result?.persistent === false) {
      setLibraryStatus("Favoritter lagres ikke (privatmodus aktiv).");
    } else if (result?.trimmed) {
      setLibraryStatus("Oppdaterte favoritter etter manifest-endring.");
    }
  }
  if (typeof storage.loadPrefs === "function") {
    const prefsResult = storage.loadPrefs();
    prefsPersistenceAvailable = prefsResult?.persistent !== false;
    const nextFilter =
      prefsResult?.prefs?.filterFavoritesOnly ?? libraryState.filterFavoritesOnly;
    libraryState.filterFavoritesOnly = Boolean(nextFilter);
    if (elements.favoritesToggle) {
      elements.favoritesToggle.checked = libraryState.filterFavoritesOnly;
    }
    if (prefsResult?.persistent === false) {
      setLibraryStatus("Bibliotek-innstillinger lagres ikke (privatmodus aktiv).");
    }
  } else if (elements.favoritesToggle) {
    elements.favoritesToggle.checked = libraryState.filterFavoritesOnly;
  }
  hotspotSeen = storage.loadHotspotSeen?.() ?? false;
  updateHotspotHighlight();
}

function getLibraryFocusables() {
  if (!elements.libraryOverlay) {
    return [];
  }
  return Array.from(
    elements.libraryOverlay.querySelectorAll(focusableSelectors),
  ).filter(
    (node) =>
      !node.hasAttribute("hidden") &&
      !node.closest("[hidden]") &&
      !node.disabled,
  );
}

function trapLibraryFocus(event) {
  const focusables = getLibraryFocusables();
  if (!focusables.length) {
    return false;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first || document.activeElement === elements.libraryOverlay) {
      event.preventDefault();
      last.focus();
      return true;
    }
  } else if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

async function regeneratePlaylistFromFavorites({ source = "manual" } = {}) {
  if (regenerateInFlight) {
    return;
  }
  if (!manifestRef || !Array.isArray(manifestRef.files) || manifestRef.files.length === 0) {
    setLibraryStatus("Ingen klipp tilgjengelig · sjekk manifestet.");
    return;
  }
  regenerateInFlight = true;
  stopPreviewPlayback();
  if (elements.regenButton) {
    elements.regenButton.setAttribute("aria-busy", "true");
    elements.regenButton.disabled = true;
  }
  try {
    if (audioEngine.state === "playing") {
      updateUi({
        statusText: "Fader ut før regenerering …",
        actionLabel: "Fader ut …",
        actionDisabled: true,
        actionBusy: true,
        buttonState: "fading",
        showReset: false,
      });
      elements.actionButton?.style.setProperty("--fade-ms", `${STOP_FADE_MS}ms`);
      try {
        await audioEngine.fadeOut(STOP_FADE_MS);
      } catch (error) {
        console.warn("regen: fadeOut failed", error);
        audioEngine.stopImmediate();
      } finally {
        elements.actionButton?.style.removeProperty("--fade-ms");
      }
    } else if (audioEngine.state === "fading") {
      try {
        await audioEngine.fadeOut(STOP_FADE_MS);
      } catch (error) {
        console.warn("regen: concurrent fading failed", error);
        audioEngine.stopImmediate();
      }
    } else {
      audioEngine.stopImmediate();
    }

    audioEngine.cancelPrepare?.();

    const { order, favoriteCount, restCount } = buildFavoritesFirstOrder({
      files: manifestRef.files,
      favorites: favoritesSet,
      seed: Date.now(),
    });

    if (!order.length) {
      setLibraryStatus("Ingen klipp tilgjengelig · sjekk manifestet.");
      return;
    }

    const snapshot = playlist.applyOrder(order);
    const createdAt = Date.now();
    persistSession({ index: 0, order: snapshot.order, createdAt });
    prefetchUpcomingClip();

    updateUi({
      statusText: `Klar · #${playlist.cursor + 1} av ${playlist.size} gjenstår`,
      actionLabel: "Start neste",
      actionDisabled: false,
      actionBusy: false,
      buttonState: "idle",
      showReset: false,
    });

    const total = favoriteCount + restCount;
    const toast = `Ny rekkefølge generert: ${favoriteCount} favoritter + ${restCount} øvrige (totalt ${total}).`;
    setLibraryStatus(toast);
  } catch (error) {
    console.error("regenerate playlist failed", error);
    setLibraryStatus("Kunne ikke regenerere rekkefølgen.");
  } finally {
    regenerateInFlight = false;
    if (elements.regenButton) {
      elements.regenButton.removeAttribute("aria-busy");
      elements.regenButton.disabled = !(manifestRef?.files?.length);
    }
  }
}

function handleGlobalKeydown(event) {
  const key = event.key?.toLowerCase?.() ?? event.key;
  if (
    key === "l" &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.repeat
  ) {
    const tagName = (event.target?.tagName ?? "").toLowerCase();
    const isEditable =
      event.target?.isContentEditable ||
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select";
    if (!isEditable) {
      toggleLibrary();
      return true;
    }
  }
  if (key === "tab" && libraryState.isOpen) {
    return trapLibraryFocus(event);
  }
  return false;
}

function handleLongPressPointerDown(event) {
  if (libraryState.isOpen) {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  const target = event.target;
  if (
    elements.actionButton?.contains(target) ||
    elements.resetBtn?.contains(target)
  ) {
    return;
  }
  clearLongPressTimer();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = null;
    openLibrary();
  }, LONG_PRESS_DELAY_MS);
}

function updateLibraryStatus() {
  if (!elements.libraryStatus) {
    return;
  }
  const total = manifestRef?.files?.length ?? 0;
  if (total === 0) {
    elements.libraryStatus.textContent = "Ingen klipp i manifestet.";
    return;
  }
  const favCount = favoritesSet.size;
  elements.libraryStatus.textContent = `${favCount} favoritter av ${total} spor`;
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

  const bgAngle = `${Math.floor(Math.random() * 360)}deg`;
  const analogA = (hue + 30) % 360;
  const analogB = (hue + 330) % 360; // hue - 30
  const bgStart = `hsl(${analogA}, 45%, 24%)`;
  const bgMid = `hsl(${hue}, 38%, 16%)`;
  const bgEnd = `hsl(${analogB}, 35%, 8%)`;
  const radial1Color = `hsla(${analogA}, 70%, 58%, 0.3)`;
  const radial2Color = `hsla(${analogB}, 70%, 52%, 0.26)`;
  const radial1Pos = `${10 + Math.random() * 80}% ${10 + Math.random() * 80}%`;
  const radial2Pos = `${10 + Math.random() * 80}% ${10 + Math.random() * 80}%`;

  document.documentElement.style.setProperty("--bg-grad-angle", bgAngle);
  document.documentElement.style.setProperty("--bg-start", bgStart);
  document.documentElement.style.setProperty("--bg-mid", bgMid);
  document.documentElement.style.setProperty("--bg-end", bgEnd);
  document.documentElement.style.setProperty("--bg-radial-1", radial1Color);
  document.documentElement.style.setProperty("--bg-radial-2", radial2Color);
  document.documentElement.style.setProperty("--bg-radial-1-pos", radial1Pos);
  document.documentElement.style.setProperty("--bg-radial-2-pos", radial2Pos);
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
    document.body.classList.add("-ambient");
  }
  await playClipResult(nextResult);
}

async function handleActionClick() {
  stopPreviewPlayback();
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
  elements.libraryHotspot?.addEventListener("click", () => {
    openLibrary();
  });
  elements.libraryClose?.addEventListener("click", () => {
    closeLibrary();
  });
  elements.libraryOverlay?.addEventListener("click", (event) => {
    if (event.target === elements.libraryOverlay) {
      closeLibrary();
    }
  });
  elements.regenButton?.addEventListener("click", () => {
    void regeneratePlaylistFromFavorites({ source: "manual" });
  });
  elements.favoritesToggle?.addEventListener("change", (event) => {
    libraryState.filterFavoritesOnly = Boolean(event.target?.checked);
    renderLibraryList();
    setLibraryStatus(
      libraryState.filterFavoritesOnly
        ? "Viser bare favoritter"
        : "Viser alle spor",
    );
    persistLibraryPrefs();
  });
  elements.libraryList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const previewBtn = target.closest(".preview-button");
    if (previewBtn && previewBtn instanceof HTMLButtonElement) {
      const fileId = previewBtn.dataset.fileId;
      if (fileId) {
        void handlePreviewClick(fileId);
      }
      return;
    }
    const favBtn = target.closest(".favorite-button");
    if (favBtn && favBtn instanceof HTMLButtonElement) {
      const fileId = favBtn.dataset.fileId;
      if (fileId) {
        toggleFavorite(fileId);
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (handleGlobalKeydown(event)) {
      event.preventDefault();
    }
  });
  if (elements.screen) {
    elements.screen.addEventListener("pointerdown", handleLongPressPointerDown);
    ["pointerup", "pointerleave", "pointercancel", "pointerout"].forEach(
      (type) => {
        elements.screen?.addEventListener(type, clearLongPressTimer);
      },
    );
  }

  document.addEventListener("click", handleFullscreenToggle);
}

function handleFullscreenToggle(event) {
  if (!event || !elements.screen || !elements.actionButton) {
    return;
  }
  const target = event.target;
  const libraryOpen = Boolean(elements.libraryOverlay && !elements.libraryOverlay.hidden);

  if (
    elements.actionButton === target ||
    elements.actionButton.contains(target) ||
    (elements.resetBtn && (elements.resetBtn === target || elements.resetBtn.contains(target))) ||
    libraryOpen
  ) {
    return;
  }

  if (elements.screen.contains(target)) {
    toggleFullscreen();
  }
}

function toggleFullscreen() {
  if (typeof document === "undefined" || !document.fullscreenEnabled) {
    return;
  }

  if (document.fullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
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
    regenByFavorites(options) {
      return regeneratePlaylistFromFavorites({
        source: "debug",
        ...options,
      });
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

  hydrateFavoritesAndPrefs();

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
  renderLibraryList();
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
