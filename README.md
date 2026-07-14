# Auto-Advancing Presentations

A small self-hosted web app for running PDF slide decks that advance on their
own timer. You (the admin) upload PDFs, set how long each slide stays on
screen, and start/pause them from a control console. The slides themselves
play in a **separate browser tab** so you can drag that tab onto a second
screen / projector.

## Features

- **Upload PDFs** and give each deck a title.
- **Per-slide timing** — set one duration for the whole deck, or fine-tune
  every slide individually in the timings editor (with thumbnails).
- **Separate display tab** (`/present`) meant for your second screen. It shows
  only the slides — no controls — and follows the console in real time.
- **3-2-1 countdown** on the display whenever you press *Start*.
- **Live controls**: play / pause / resume, next / previous slide, restart,
  and stop, all reflected instantly on the display via Server-Sent Events.
- The server is the source of truth, so the console and the display stay in
  sync even if you reload either tab.

## Running it

```bash
npm install
npm start
```

Then open:

- **Console** (upload & control): http://localhost:3000/
- **Display** (put this on your second screen): http://localhost:3000/present

From the console, click **“Open display tab”** to pop the display out into its
own tab/window, then move it to your projector or second monitor. Press
**Start** on any deck and the display counts down 3 → 2 → 1 and begins.

Set the port with the `PORT` environment variable (defaults to `3000`).

## How it works

- `server.js` — Express server. Stores PDF metadata in `data/presentations.json`
  and the uploaded files in `data/uploads/`. Holds the single live playback
  state and drives the auto-advance timer, broadcasting every change to all
  connected tabs over `/api/events` (SSE).
- `public/` — the two pages (`index.html` console, `present.html` display),
  styles, and their scripts. PDFs are rendered in the browser with
  [pdf.js](https://mozilla.github.io/pdf.js/).

Uploaded files and the metadata file are git-ignored.
