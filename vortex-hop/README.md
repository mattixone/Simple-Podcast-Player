# Vortex Hop

A small browser game: hop between tiles drifting around a vortex and escape to the rim. Tiles break into Voronoi fragments where you land, and smaller fragments spin faster towards the centre.

No build step and no dependencies: just `index.html` and the files in `js/`.

## Run it locally

ES modules don't load from `file://`, so serve the folder:

```sh
npx serve vortex-hop        # or: python3 -m http.server -d vortex-hop
```

## Files

| File | What's in it |
|---|---|
| `js/config.js` | Every tunable number (speeds, sizes, jump range, rings). Start here. |
| `js/geometry.js` | Polygon helpers and the Voronoi clipping. |
| `js/world.js` | Tile motion, cracking, shattering, keeping the vortex stocked. |
| `js/main.js` | Game state, player, input, main loop. |
| `js/render.js` | Drawing: vortex, tiles, player, minimap, HUD. |

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, then pick this repo.
2. Production branch: whichever branch holds the game. Framework preset: **None**. Build command: leave empty. Build output directory: `vortex-hop`.
3. Save and deploy. Every push redeploys, and other branches get preview URLs.

## Roadmap

- [x] Spiral motion, size-based speed, jumping, Voronoi cracking and shattering
- [x] Checkpoint rings, follow camera (outward is up), minimap
- [ ] Asteroids: steady orbit, clear a gap around them, fling you off after a few seconds
- [ ] Collectables: long-jump charge, slingshot stones
- [ ] Slingshot: shatter a far tile so its fragments come to you
- [ ] Zone palettes and tuning, sound, leaderboard (Worker + D1)
