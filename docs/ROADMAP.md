# BingoBuzz Implementation Roadmap

## 1. Project Scaffolding
- Init basic structure: `index.html`, `assets/css/style.css`, `assets/js/{app.js,audio-engine.js,playlist.js,storage.js,constants.js}`, `assets/sounds/bingobuzz/manifest.json`.
- Draft semantic markup with primary/secondary buttons and status region (`aria-live="polite"`).
- Establish shared constants (`SESSION_TTL_MS`, `STOP_FADE_MS`, `PREFETCH_AHEAD`, `MAX_CONSECUTIVE_SKIPS`).

## 2. Manifest & Storage Layer
- Define manifest schema with `formats`, `normalization`, per-file `durationHintMs`, `etag`, and top-level `manifestEtag`.
- Implement loader that fetches/validates manifest, falls back gracefully on fetch errors.
- Build `storage.js` with helpers:
  - `loadSession()`, `saveSession(sessionState)`, `clearSession()`.
  - `shouldReset({ manifestEtag, now })` factoring TTL (`SESSION_TTL_MS`), `?fresh=1`, and manifest mismatch.
  - Namespace localStorage keys `bbz:v1:{playlist,index,createdAt,manifestEtag}`.

## 3. Playlist Engine
- Implement `playlist.js` exposing:
  - `init(files, seed?)` (Fisher–Yates shuffle with optional seed).
  - `next()` returning `{ clip, done }`.
  - `peek()` without advancing cursor.
  - `reset()` to reshuffle and zero cursor.
  - `skipFailed(badId)` to advance past defective tracks (guard with `MAX_CONSECUTIVE_SKIPS`).
  - `isComplete()` for UI lockout.
- Ensure session state can serialize/restore `playlist` order and cursor index.

## 4. Audio Engine
- Use Web Audio API as primary path; lazy-initialize `AudioContext` on first trusted interaction.
- Implement `play(clipMeta)` returning a promise that resolves on start or rejects if `state !== idle`.
- Implement `fadeOut(duration = STOP_FADE_MS)` with gain ramp; no-op if already idle.
- Provide fallback `<audio>` element path when Web Audio unsupported; share contract semantics.
- Track readable `state` (`idle`, `playing`, `fading`, `error`) and emit hooks/events for UI updates.
- Prefetch next `PREFETCH_AHEAD` sources when feasible; respect `durationHintMs` to avoid heavy decode.

## 5. App Orchestration
- In `app.js`, bootstrap flow:
  - Fetch manifest, check `storage.shouldReset`, hydrate playlist/audio, restore UI state.
  - Bind button handlers: `Start neste` → guarded `playlist.next` + `audio.play`; `Fade ut` → `audio.fadeOut`.
  - Reflect state transitions in DOM (button `disabled`/`aria-disabled`, busy animations, status text).
  - Handle automatic reset when playlist complete (show “Start på nytt”), and manual reset action.
  - Integrate error handling: on playback failure call `playlist.skipFailed`, retry until `MAX_CONSECUTIVE_SKIPS`.
- Monitor TTL while page is open; on next interaction post-expiry, trigger full reset.

## 6. UI & Styling
- Craft `style.css` with CSS custom properties, layout, responsive sizing, and accessible focus rings.
- Implement busy/disabled/fade states using classes; add subtle animations with `prefers-reduced-motion` guards.
- Include iconography (optional) and ensure contrast ratios meet accessibility guidelines.

## 7. Testing & QA
- Manual acceptance checklist:
  - Shuffle invariant: full cycle plays each clip once.
  - TTL reset: manipulate `createdAt` to exceed 3h → next interaction reshuffles.
  - Busy guard: rapid clicks on “Start neste” during playback/fade cause no overlaps.
  - Format fallback: simulate failed WebM to confirm MP3 path.
  - Accessibility: keyboard activation, focus management, `aria-live` updates.
- (Future) Add lightweight unit tests for `playlist` logic and storage TTL math via simple test harness.

## 8. Future Enhancements (Backlog)
- Volume slider and fade-length options persisted via storage.
- Offline caching with Service Worker and versioned assets.
- Multi-tab coordination via `BroadcastChannel`.
- Telemetry/logging hooks for monitoring playback errors.
