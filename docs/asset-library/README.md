# Toy Reskin Asset Library

A static before/after page for every asset in the game's catalog (199) plus 9 UI screens. Open `index.html` through any static file server; it loads its images from `a/` (reskin), `b/` (original build `a166d57`) and `ui/` (screens), all by relative path.

Each card has a drag-to-compare slider, with a side-by-side toggle. You can filter by category, search, and open any asset full-size with prev/next. Six streak units have no "before" because the original build had no visual for them.

## Rebuilding

1. Run a dev server for each build, for example the original on `:5174` (a `git worktree` at `a166d57`) and the reskin on `:5173`.
2. Make sure `src/catalog/catalog.js` sets `window.__cat = { items, studio, state }` right after `const state = …`. The reskin has it; add it temporarily in the original's worktree.
3. Capture both builds (needs `puppeteer-core` and `sharp`; set `CHROME` if Chrome isn't at `/usr/bin/google-chrome`):
   ```
   node scripts/capture-asset-library.mjs http://localhost:5174/ out/before
   node scripts/capture-asset-library.mjs http://localhost:5173/ out/after
   BASE=http://localhost:5174/ node scripts/capture-ui-screens.mjs out/ui-before barrio
   BASE=http://localhost:5173/ node scripts/capture-ui-screens.mjs out/ui-after barrio
   ```
4. Copy the WebP files into `a/` and `b/`. Convert the screens to 1280×720 WebP as `ui/a-<name>.webp` and `ui/b-<name>.webp`. Regenerate the `ITEMS` array in `index.html` from the two `manifest.json` files.
