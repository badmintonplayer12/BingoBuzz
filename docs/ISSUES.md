# Implementation Plan: Library, Favorites, and Playlist Regeneration

## 1. Library / Settings Panel
- Add hidden panel (hotspot, long-press, keyboard `L`) with modal behavior.
- Panel uses `role="dialog" aria-modal="true"`, handles ESC/click-outside/close button.
- Render manifest list with columns: title/id, category, preview button, favorite toggle.
- Provide filter (“vis bare favoritter”) and summary (“N favoritter av M spor”).
- Preview audio via audio-engine in preview mode; stop preview when main play button is used.

## 2. Favorites Storage & UI
- Persist favorites in `localStorage` (`bbz:v1:favorites`); add helpers `loadFavorites`/`saveFavorites`.
- Remove invalid IDs when manifest changes; show hint if storage unavailable.
- Toggle ★ updates UI optimistically and keeps aria-labels accessible.
- Store optional prefs (`bbz:v1:prefs`) for filters/sorting.

### Detailed Plan – Favorites & Prefs Persistence
1. **Storage primitives**
   - Extend `constants.js` with keys for `favorites` and `prefs`.
   - In `storage.js`, add helpers: `normalizeFavoriteIds()`, `loadFavorites({ validIds })`, `saveFavorites(ids)`, `loadPrefs()`, `savePrefs(prefs)`.
   - Helpers must gracefully handle missing/blocked `localStorage`, returning `{ persistent:false }` when writes are unavailable (e.g., private mode).
2. **Bootstrap hydration**
   - After manifest/session bootstrap, hydrate favorites + prefs:
     - Build `Set` of valid manifest IDs, drop stale favorites, emit toast “Oppdaterte favoritter …” when trimming occurs.
     - Apply stored `filterFavoritesOnly` to `libraryState` + checkbox, defaulting to false.
3. **UI integration**
   - `toggleFavorite(id)` should update `favoritesSet`, re-render list, then `persistFavorites()`; show warning toast when persistence fails (“Favoritter lagres ikke …”).
   - Filter checkbox change should call `persistLibraryPrefs()` with current flag; warn if storage unavailable.
   - Status line should continue to show steady summary, with temporary toasts for warnings.
4. **Reset & fail-safe behavior**
   - Ensure favorites are cleared only when manifest demands it; session resets should not touch `favorites`.
   - Debug helpers (`window.bingoBuzzDebug`) can expose `storage.loadFavorites()` output for QA.

## 3. Regenerate Playlist (Favorites First)
- Button “Regenerer rekkefølge” (aria-label “Regenerer spillelisten med favoritter først”), disabled when manifest empty.
- On click: fade/stop current playback; compute `order = shuffle(favorites) + shuffle(nonFavorites)`.
- Persist via existing session keys: `playlistIds=order`, `index=0`, `createdAt=Date.now()`, keep `manifestEtag`.
- Update UI state to idle (`Klar · #1 av N gjenstår`), show toast “Ny rekkefølge generert: F favoritter + U øvrige”.
- Handle edge-cases (0/all favorites, storage blocked) gracefully.
- Expose `window.bingoBuzzDebug.regenByFavorites()` for QA.

### Detailed Plan – Regenerate Playlist (Steg 3)
1. **UI wiring**
   - Enable the “Regenerer rekkefølge” button whenever manifest has >0 filer; add aria-live toast region reuse (libraryStatus).
   - Bind click handler that:
     1. Closes preview audio.
     2. If main audio plays, awaits `audioEngine.fadeOut(STOP_FADE_MS)` before proceeding.
     3. Calls a new controller method `regenerateOrder({ reason: "manual" })`.
2. **Order construction**
   - Implement helper `buildFavoritesFirstOrder({ files, favorites })` inside `playlist.js` (or a playlist utility) that:
     - Accepts full manifest list + Set of favorite IDs.
     - Produces `order = shuffle(favorites∩files) + shuffle(nonFavorites)`, reusing existing Fisher–Yates shuffle.
     - Returns metadata `{ order, favoriteCount, restCount }`.
   - Ensure determinism for tests by reusing playlist’s RNG seed if available.
3. **Playlist + storage sync**
   - Add method `playlist.applyOrder(order)` that resets cursor to 0, updates internal order/index, and exposes snapshot.
   - In `app.js`, after computing the new order:
     - Update playlist via `applyOrder`.
     - Call `persistSession({ index:0, order })` with `createdAt: Date.now()` to reset TTL freshness while keeping manifestEtag.
     - Clear `lastPlayedId`/`audioEngine` state so next press starts from first track.
4. **UI feedback**
   - After regeneration, close library panel? (spec says panel remains open but primary button shows idle). Keep panel open but set status text: `Ny rekkefølge generert: F favoritter + U øvrige (totalt N)`.
   - Update main UI: `statusLine = Klar · #1 av ${playlist.size} gjenstår`, button label “Start neste”, `showReset=false`.
   - Disable button while fade/order building runs to prevent double-click.
5. **Edge cases**
   - No favorites: shuffle all once.
   - All favorites: still shuffle all once.
   - Empty manifest or playlist size 0: keep button disabled, show “Ingen klipp” toast.
   - Storage blocked: `persistSession` already no-ops but log warning; still update in-memory playlist so the session behaves for this visit.
6. **Debug hook & QA**
   - Add `window.bingoBuzzDebug.regenByFavorites()` that calls the same internal routine (skipping fade) for testing.
   - QA steps: mark favorites, regen, verify localStorage playlist order begins with favorites, `createdAt` updates, TTL resets, and next press plays new first clip.

## 4. Accessibility & QA
- Ensure panel focus management and aria-live updates for status/toasts.
- Validate that favorites persist across reloads and regen honors the priority.
- Confirm TTL resets after manual regen and that preview playback stays isolated.

# Implementation Plan: BingoBuzz PWA

## 1. Web App Manifest & Icons
- Create `/app.webmanifest` with full metadata (`name`, `short_name`, `start_url`, `scope`, `display`, `background_color`, `theme_color`).
- Reference existing icons or add 192×192 and 512×512 PNGs under `assets/icons/`.
- Update `index.html` `<head>` with:
  - `<link rel="manifest" href="/app.webmanifest">`
  - `<meta name="theme-color" content="#0a0818">`
  - Optional iOS tags (`apple-touch-icon`, `apple-mobile-web-app-capable`, status-bar style).

## 2. Service Worker
- Add `/sw.js` that:
  - Precaches the app shell (HTML, CSS, JS modules).
  - Uses cache-first for shell assets.
  - Uses stale-while-revalidate for audio under `/assets/sounds/` (cache on first play, no upfront bulk caching).
  - Cleans up old caches on `activate` (bump cache name on releases).
- Register the worker once in `assets/js/app.js` after bootstrap (`navigator.serviceWorker.register("/sw.js")` guarded by feature detection).

## 3. Offline Behavior & Testing
- Ensure fetch failures (e.g., manifest load) have graceful fallbacks when offline.
- Document how to clear caches and bump cache keys when deploying new shell versions.
- Update docs with a PWA section (requirements, testing with Lighthouse/Add to Home Screen).
- Manual QA checklist:
  - Install prompt visible on Chrome (desktop/mobile).
  - App loads offline with cached shell + any previously fetched audio.
  - Service worker updates after cache version bump.
# Detailed Plan: Bibliotekspanel (Steg 1)

## 1. Triggere & Åpning/Lukking
- **Hotspot**: Transparent knapp (64×64 px) øverst til høyre (`position:absolute`, `aria-label="Åpne bibliotek"`). 
- **Langt trykk**: Lytt på `touchstart/mousedown` og mål >600 ms før åpning; avbryt ved `touchend/mouseup`.
- **Tastatur**: Global `keydown` på `L` som toggler panelet (debounce når fokus i input).
- **Lukking**: ESC, klikk på overlay (utenfor panel), egen “Lukk”-knapp.

## 2. Modalstruktur & Fokus
- Overlay (`#library-overlay`) med `role="dialog"` og `aria-modal="true"`, `hidden` som toggles.
- Panel (`#library-panel`) kan være drawer eller kort; ved åpning:
  - lagre `lastFocusedElement`.
  - `hidden = false`, sett `focus()` på første element (f.eks. “Regenerer rekkefølge”).
  - Felle Tab/Shift+Tab slik at fokus ikke hopper ut (enkel focus trap).
- Ved lukking: `hidden = true`, returner fokus til `lastFocusedElement`.

## 3. Panelinnhold
- **Heading** + `aria-live="polite"` statusområde.
- **Regenerer-knapp** øverst (disabled hvis manifest tomt).
- **Filter**: checkbox/switch “Vis bare favoritter” (lagres via prefs).
- **Liste**:
  - Layout (liste eller tabell) med rader: tittel/id, kategori, previewknapp, ★-toggle.
  - Favoritter sorteres først (★), resten etter id; støtt filteret.
- **Forhåndslytt**:
  - Preview-knapp spiller/spanner via audio-engine i separat modus.
  - Stopp preview hvis hovedknappen startes eller annet preview aktiveres.

## 4. Tilstand & Data
- `libraryState = { isOpen, filterFavoritesOnly, previewClipId }`.
- Manifest + favorites brukes til å bygge radene; oppdater favoritt-knapp optimistisk.
- Implementér helper-funksjoner i `storage.js` for `loadFavorites/saveFavorites` (selv om lagring kommer i steg 2).

## 5. Tilgjengelighet
- Panel `aria-labelledby` → heading id.
- Status-meldinger (toast) sendes via `aria-live="polite"`.
- Alle knapper har `aria-label` (“Spill <id>”, “Merk som favoritt <id>”).
- Preferer semantiske elementer (`button`, `ul/li` eller `table`).

## 6. Sanitetssjekker før videre steg
- Åpne/lukke fungerer via alle triggere; fokus returneres korrekt.
- Preview fungerer uten å påvirke hovedknappen.
- Favoritt-knapper kan toggles (selv om lagring ikke er ferdig).
- Regenerer-knapp vises, men handling implementeres i neste steg.
- Ingen bibliotek-elementer synlige når panelet er lukket.
