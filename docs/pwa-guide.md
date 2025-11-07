# BingoBuzz PWA Guide

## Install/Update Workflow
1. Ensure the icons in `assets/icons/` (192×192 & 512×512) match the latest branding.
2. Update `/app.webmanifest` if name/theme/colors change.
3. When modifying shell assets (HTML/CSS/JS), bump cache labels in `sw.js` (e.g. `bbz-shell-v3`, `bbz-audio-v3`).
4. Rebuild/serve the app, then reload twice to ensure the new service worker activates.

## Service Worker Testing
- `npm run dev` (or your static server) → open `http://localhost:PORT` → DevTools > Application > Service Workers.
- Confirm `sw.js` is “activated and is running”.
- Toggle “Offline” and reload: UI + any previously played audio should remain available.
- Clear caches by running `navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()))` in DevTools when debugging.

## Lighthouse Audit
Run a PWA audit after functional changes:
```bash
npx lighthouse http://localhost:PORT --preset=pwa --output html --output-path ./lighthouse-pwa.html
```
Check that:
- “Installable” and “PWA Optimized” sections pass.
- No blocking issues under Diagnostics.

## Manifest & App Icons
- Keep `app.webmanifest` at project root.
- Link it in `index.html` along with `<meta name="theme-color">` and iOS meta tags.
- Update `assets/icons/` when branding changes and keep PNGs optimized.

## Audio Caching Notes
- `sw.js` caches the app shell eagerly, but audio files only after the first successful fetch (“stale-while-revalidate”).
- Large sound packs should not be precached; let users stream them and rely on SW cache for replays.

## Release Checklist
- [ ] Increment cache names in `sw.js` after shell changes.
- [ ] Run `npm test`.
- [ ] Run Lighthouse PWA audit (`npx lighthouse ...`).
- [ ] Verify install prompt/Add to Home Screen.
- [ ] Commit regenerated `app.webmanifest`/icons if changed.
