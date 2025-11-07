# BingoBuzz Audio Import Guide

This guide helps automated agents (and humans) add new audio assets under `assets/sounds/bingobuzz/` safely.

## Folder layout
- Base directory: `assets/sounds/bingobuzz/`
- Licensed pack (current): `assets/sounds/bingobuzz/NonCommerseLicense/`
- Manifest: `assets/sounds/bingobuzz/manifest.json`

## Steps to add new files
1. **Copy files** into `assets/sounds/bingobuzz/NonCommerseLicense/`.
2. **Normalize filenames** by running the rename script:
   ```
   node scripts/rename-sounds.mjs
   ```
   This enforces:
   - Spaces → `_`
   - Removes unsupported characters
   - Keeps uppercase letters
   - Lowercases extensions
3. **Update `manifest.json`**:
   - Each entry needs: `id`, `src`, `display`, `category`, `gain`, `etag`.
   - `id/src` should match the normalized filename (without extension).
   - `display` is the human-friendly label (keep spaces/special chars here).
   - `category` must be one of existing groups (e.g., `voice`, `jingle`, `music`).
   - `etag` equals the original filename/version identifier for cache busting.
4. **Verify** in browser:
   - Run the app, open the library panel, check the new entries appear with correct display names.
   - Play each new clip once to ensure no decoding errors.

## Script details
- `scripts/rename-sounds.mjs` scans `NonCommerseLicense/` and renames files to safe slugs.
- Only affects files whose names change; re-run whenever new audio is added.
- After renaming, update `manifest.json` accordingly.

## Notes for AI agents
- Never commit raw files with spaces or special characters—always run the script.
- Preserve original capitalization when constructing `display`.
- Keep existing ordering in `manifest.json` unless asked otherwise.
-eigende tests (Vitest) should be run after manifest changes: `npm test`.
