# Auto-Advancing Presentations

A small self-hosted web app with two sides:

- A **student practice site** (public) where students upload their own deck and
  rehearse it against a fixed pace — the slides auto-advance so they practise
  speaking along.
- An **admin dashboard** (password-protected) for running PDF decks on a
  projector and for setting the pace students practise against.

## The three pages

| URL | Who | What |
| --- | --- | --- |
| `/` | Students (public) | Upload a PDF and practise. The deck auto-advances at the admin's pace, with a 3-2-1 countdown. The file **stays in the browser** and is never uploaded. |
| `/admin` | Admin (password) | Upload/manage decks, run them, and set the student practice pace. |
| `/present` | Second screen | Slides-only display for admin-run presentations; drag it to your projector. |

## Features

**Student practice site (`/`)**
- Students pick their own PDF (kept entirely client-side) and press *Start*.
- The deck auto-advances at the admin-set **seconds per slide**, after a
  3-2-1 countdown, so students rehearse speaking to the pace.
- A HUD shows the current slide, elapsed vs. target time, and a per-slide
  progress bar; pause/resume, next/previous, restart and fullscreen are all
  available (space / arrow keys work too).

**Admin dashboard (`/admin`, behind a password)**
- **Set the practice pace** (seconds per slide) for the student site.
- **Upload many PDFs at once** — each becomes its own presentation, titled
  after its file name.
- **Per-slide timing** — one duration for the whole deck or per-slide in the
  timings editor (with thumbnails).
- **Run decks on a second screen** via the separate display tab (`/present`),
  with a 3-2-1 countdown, live play / pause / next / previous / restart / stop,
  and a toggle for the display's progress bar — all synced over Server-Sent
  Events.

The interface uses a retro pixel-terminal look built with the bundled,
open-source (SIL OFL) fonts **VT323** and **Silkscreen** — no external
CDN, so it works fully offline.

## Running it

```bash
npm install
npm start
```

Then open:

- **Student practice**: http://localhost:3000/
- **Admin dashboard**: http://localhost:3000/admin
- **Display** (second screen): http://localhost:3000/present

Log in to `/admin` with the admin password, set the practice pace, and
(optionally) upload decks to run on a projector via **“Open display tab”**.

### Configuration (environment variables)

- `ADMIN_PASSWORD` — password for the `/admin` dashboard. **Defaults to
  `changeme`; set your own before deploying.**
- `PORT` — port to listen on (defaults to `3000`).
- `DATA_DIR` — where persistent data is stored (defaults to `./data`).

## How it works

- `server.js` — Express server. Stores PDF metadata in `data/presentations.json`,
  display preferences in `data/settings.json`, and the uploaded files in
  `data/uploads/`. Holds the single live playback state and drives the
  auto-advance timer, broadcasting every change to all connected tabs over
  `/api/events` (SSE).
- `public/` — the two pages (`index.html` console, `present.html` display),
  styles, bundled fonts, and their scripts. PDFs are rendered in the browser
  with [pdf.js](https://mozilla.github.io/pdf.js/).

Everything under `data/` (metadata, settings, uploads) is git-ignored and, in
Docker, lives under `/data` — so copying that directory is a full backup.
