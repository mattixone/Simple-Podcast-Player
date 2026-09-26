# Couchcast

A simple podcast player for the couch, controlled entirely from the keyboard. It uses the same green-phosphor CRT look as Couch Commander.

This is a **clickable prototype**. It uses sample podcasts and a pretend playback clock, so it has no real audio yet. Open `index.html` in a browser to try it.

## Design decisions so far

| Area | Decision |
|---|---|
| Setup | 50" screen about 3 m away. Keyboard and mouse, but everything works from the keyboard alone. |
| Look | Green-phosphor CRT: scanlines, glow, monospace type. Text grows with the screen size. Artwork is always shown in full colour. |
| Now Playing colour | The screen re-tints to the main colour of the episode's artwork (amber, blue, pink…), fading over about a second. Brightness is adjusted per colour so text stays readable. Artwork with no real colour keeps the green. |
| Highlight | Whatever is selected lights up solid green (buttons) or glows and grows (artwork). The mouse moves the same highlight, and the pointer hides when you're not using it. |
| Screens | **Latest** (grid of the last 14 days, played episodes stay but are dimmed), **Podcasts** (one tile per show, opening a full episode list), **Recent** (what you played, newest first), **Now Playing** (full screen). |
| Tiles | A `NEW` label if not started, a progress bar and "min left" if started, and `✓ PLAYED` when finished. |
| Now Playing | Big artwork, big play/pause button, one progress bar, volume, and one "Up next" line. Nothing else. |
| Mini player | A strip along the bottom of the library screens shows what's playing. Press `N` to open it. |
| Autoplay | When an episode ends, the newest episode you haven't finished starts. |
| Resume | Every episode remembers where you stopped. |
| Left out on purpose | Playback speed, sleep timer, show notes, downloads. |

## Keys

| Key | Library | Now Playing |
|---|---|---|
| Arrow keys | Move the highlight | `←` back 15s, `→` forward 30s, `↑` `↓` volume |
| `Shift` + `←` / `→` | | back / forward 5s |
| `Enter` / `Space` | Select | Play / pause |
| `Esc` / `Backspace` | Back | Back to library |
| `1` `2` `3` | Latest, Podcasts, Recent | |
| `N` | Open Now Playing | |
| `P` | Play / pause | Play / pause |
| Media keys | Play / pause, skip | Play / pause, skip |
| `?` | Legend | Legend |

## Plan for the real version

The app is a web page that runs anywhere, including on an iPhone (Add to Home Screen). A small **cloud helper** is needed for two jobs a web page can't do on its own:

1. **Fetch feeds.** Most podcast feeds block web pages on other sites from reading them. The helper fetches them on the app's behalf.
2. **Sync progress.** It stores where you're up to, so the TV, laptop and phone all agree.

A free Cloudflare Worker (or similar) covers both, so nothing has to run on your PC. The same helper later hosts ad detection.

### Build steps

1. Real audio: swap the pretend clock for an `<audio>` element, so media keys and the phone lock screen work.
2. Subscriptions: search by name (using Apple's public podcast directory), paste a feed address, or import an OPML file. Apple Podcasts has no export button, so a small helper script or Shortcut is needed to get your list out of it.
   The cloud helper also passes artwork through, because the colour-matching can only read images the app is allowed to access.
3. Cloud helper: fetch feeds and sync progress.
4. Installable on phones, with an app icon and full screen.
5. Later: ad skipping. First, a "skip to next chapter" key for feeds that publish chapters. After that, ad breaks marked on the progress bar, with a single key to skip them.

## Files

- `index.html`: the page shell and the legend
- `css/app.css`: the CRT theme and layouts
- `js/data.js`: sample podcasts and generated placeholder artwork
- `js/app.js`: views, keyboard navigation and the prototype player
