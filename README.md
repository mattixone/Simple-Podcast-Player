# Couchcast

A simple podcast player for the couch, controlled entirely from the keyboard. It uses the same green-phosphor CRT look as Couch Commander.

- **To put it online:** see [DEPLOY.md](DEPLOY.md). It runs on Cloudflare's free plan, and you sign in with one password.
- **Without a server** (the preview link, or opening `public/index.html` directly), it runs a demo with sample podcasts and pretend playback.

## Design decisions

| Area | Decision |
|---|---|
| Setup | 50" screen about 3 m away. Keyboard and mouse, but everything works from the keyboard alone. Also works on iPhone (Add to Home Screen). |
| Look | Green-phosphor CRT: scanlines, glow, monospace type. Text grows with the screen size. Artwork is always shown in full colour. |
| Now Playing colour | The screen re-tints to the main colour of the episode's artwork. Brightness is adjusted per colour so text stays readable. Artwork with no real colour keeps the green. |
| Highlight | Whatever is selected lights up solid (buttons) or glows and grows (artwork). The mouse moves the same highlight, and the pointer hides when you're not using it. |
| Screens | **Latest** (last 14 days; played episodes stay, dimmed), **Podcasts** (one tile per show, opening its episode list), **Recent** (what you played), **Search** (find and subscribe), **Now Playing** (full screen). |
| Tiles | A `NEW` label if not started, a progress bar and "min left" if started, and `✓ PLAYED` when finished. |
| Now Playing | Big artwork, big play/pause button, one progress bar, volume, and one "Up next" line. |
| Mini player | A strip along the bottom of the library screens. Press `N` to open Now Playing. |
| Autoplay | When an episode ends, the newest episode you haven't finished starts. |
| Resume and sync | Every episode remembers where you stopped, and that follows you between devices. |
| Removing things | Unsubscribing needs a second press, so it can't happen by accident. |
| Left out on purpose | Playback speed, sleep timer, show notes, downloads. |

## Keys

| Key | Library | Now Playing |
|---|---|---|
| Arrow keys | Move the highlight | `←` back 15s, `→` forward 30s, `↑` `↓` volume |
| `Shift` + `←` / `→` | | back / forward 5s |
| `Enter` / `Space` | Select | Play / pause |
| `Esc` / `Backspace` | Back | Back to library |
| `1` `2` `3` `4` | Latest, Podcasts, Recent, Search | |
| `/` | Type a search | |
| `N` | Open Now Playing | |
| `P` | Play / pause | Play / pause |
| Media keys | Play / pause, skip | Play / pause, skip |
| `?` | Legend | Legend |

In the search box, letters type as normal. `↓` moves to the results, and `Esc` clears the box, then goes back.

## How it fits together

- **The page** (`public/`) is plain HTML, CSS and JavaScript, with no build step. It plays audio straight from each podcast's own website.
- **The server** (`worker/index.js`) is a Cloudflare Worker. Its jobs:
  - It checks your password.
  - It searches Apple's podcast directory.
  - It fetches feeds, because most block web pages from reading them directly.
  - It passes artwork through, so its colours can be read.
  - It stores your subscriptions and progress in a Durable Object.

## Files

- `public/index.html`: the page shell and the legend
- `public/css/app.css`: the CRT theme and layouts
- `public/js/theme.js`: finds the artwork's main colour and builds the Now Playing colours
- `public/js/library.js`: sign-in, search, feeds, subscriptions and progress sync
- `public/js/demo.js`: sample podcasts, generated artwork and pretend audio for demo mode
- `public/js/app.js`: screens, keyboard navigation and the player
- `worker/index.js`: the Cloudflare server
- `wrangler.jsonc`: Cloudflare settings

## Still to come

- Ad skipping. First, a "skip to next chapter" key for feeds that publish chapters. After that, ad breaks marked on the progress bar, with a single key to skip them.
