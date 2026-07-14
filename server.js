import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// All persistent data (metadata JSON + uploaded PDFs) lives under DATA_DIR.
// In Docker this is /data (bind-mounted to ./data on the host); locally it
// defaults to ./data next to this file.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'presentations.json');
const COUNTDOWN_SECONDS = 3;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * Persistence: presentation metadata lives in a small JSON file.
 * The uploaded PDFs live on disk in data/uploads/<id>.pdf
 * ------------------------------------------------------------------ */
function loadPresentations() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let presentations = loadPresentations();

async function savePresentations() {
  await fsp.writeFile(DB_FILE, JSON.stringify(presentations, null, 2));
}

const findPresentation = (id) => presentations.find((p) => p.id === id);

/* Display preferences (e.g. whether the presentation view shows the
 * auto-advance progress bar). Persisted so they survive restarts and are
 * part of the ./data backup. */
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = { showProgress: true };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

async function saveSettings() {
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/* Best-effort page count straight from the PDF bytes. The admin page
 * normally supplies an accurate count via pdf.js; this is only a
 * fallback so an upload never ends up with zero slides. */
function countPagesFromBytes(buffer) {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

function sanitizeSlideSeconds(value, count, fallback) {
  const safeFallback = Number.isFinite(fallback) && fallback > 0 ? fallback : 10;
  const out = [];
  const arr = Array.isArray(value) ? value : [];
  for (let i = 0; i < count; i++) {
    const n = Number(arr[i]);
    out.push(Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : safeFallback);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Playback state — a single presentation plays at a time. The server
 * is the source of truth; the admin console and the display tab both
 * follow it over Server-Sent Events. Absolute timestamps are sent so
 * clients can animate the countdown / progress bar smoothly on their
 * own without the server streaming every frame.
 * ------------------------------------------------------------------ */
const playback = {
  status: 'idle', // idle | countdown | playing | paused | finished
  presentationId: null,
  currentSlide: 0, // 1-based
  totalSlides: 0,
  phaseEndsAt: null, // absolute ms timestamp the current phase ends
  phaseDurationMs: null, // full length of the current phase
  remainingMs: null, // frozen remainder while paused
};

let tickTimer = null;

function currentPresentation() {
  return playback.presentationId ? findPresentation(playback.presentationId) : null;
}

function slideDurationMs(slideNumber) {
  const p = currentPresentation();
  if (!p) return 10000;
  const secs = p.slideSeconds?.[slideNumber - 1] ?? p.defaultSeconds ?? 10;
  return Math.max(500, Math.round(secs * 1000));
}

function publicState() {
  const p = currentPresentation();
  return {
    serverNow: Date.now(),
    status: playback.status,
    presentationId: playback.presentationId,
    presentationName: p ? p.name : null,
    currentSlide: playback.currentSlide,
    totalSlides: playback.totalSlides,
    countdownTotal: COUNTDOWN_SECONDS,
    phaseEndsAt: playback.phaseEndsAt,
    phaseDurationMs: playback.phaseDurationMs,
    remainingMs: playback.remainingMs,
    showProgress: settings.showProgress,
  };
}

function ensureTicking() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, 200);
}

function stopTicking() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function tick() {
  if (playback.status !== 'countdown' && playback.status !== 'playing') {
    stopTicking();
    return;
  }
  const now = Date.now();
  if (now < playback.phaseEndsAt) return;

  if (playback.status === 'countdown') {
    // Countdown finished -> reveal slide 1 and start playing.
    beginSlide(1);
    broadcast();
    return;
  }

  // status === 'playing': the current slide's time is up.
  if (playback.currentSlide >= playback.totalSlides) {
    playback.status = 'finished';
    playback.phaseEndsAt = null;
    playback.phaseDurationMs = null;
    playback.remainingMs = null;
    stopTicking();
    broadcast();
    return;
  }
  beginSlide(playback.currentSlide + 1);
  broadcast();
}

function beginSlide(slideNumber) {
  playback.status = 'playing';
  playback.currentSlide = slideNumber;
  const dur = slideDurationMs(slideNumber);
  playback.phaseDurationMs = dur;
  playback.phaseEndsAt = Date.now() + dur;
  playback.remainingMs = null;
  ensureTicking();
}

/* --- Playback commands -------------------------------------------- */
function start(id) {
  const p = findPresentation(id);
  if (!p) return { ok: false, error: 'Presentation not found' };
  playback.presentationId = p.id;
  playback.totalSlides = p.numPages;
  playback.currentSlide = 1; // slide 1 is prepared behind the countdown overlay
  playback.status = 'countdown';
  playback.phaseDurationMs = COUNTDOWN_SECONDS * 1000;
  playback.phaseEndsAt = Date.now() + COUNTDOWN_SECONDS * 1000;
  playback.remainingMs = null;
  ensureTicking();
  broadcast();
  return { ok: true };
}

function pause() {
  if (playback.status === 'playing') {
    playback.remainingMs = Math.max(0, playback.phaseEndsAt - Date.now());
    playback.status = 'paused';
    playback.phaseEndsAt = null;
    stopTicking();
    broadcast();
  } else if (playback.status === 'countdown') {
    // Pausing during the countdown just cancels it, holding on slide 1.
    playback.status = 'paused';
    playback.currentSlide = 1;
    playback.phaseDurationMs = slideDurationMs(1);
    playback.remainingMs = playback.phaseDurationMs;
    playback.phaseEndsAt = null;
    stopTicking();
    broadcast();
  }
  return { ok: true };
}

function resume() {
  if (playback.status !== 'paused') return { ok: true };
  const remaining = playback.remainingMs ?? slideDurationMs(playback.currentSlide);
  playback.status = 'playing';
  playback.phaseEndsAt = Date.now() + remaining;
  if (!playback.phaseDurationMs) playback.phaseDurationMs = slideDurationMs(playback.currentSlide);
  playback.remainingMs = null;
  ensureTicking();
  broadcast();
  return { ok: true };
}

function stop() {
  playback.status = 'idle';
  playback.presentationId = null;
  playback.currentSlide = 0;
  playback.totalSlides = 0;
  playback.phaseEndsAt = null;
  playback.phaseDurationMs = null;
  playback.remainingMs = null;
  stopTicking();
  broadcast();
  return { ok: true };
}

function goToSlide(slideNumber) {
  if (!playback.presentationId) return { ok: false, error: 'Nothing is playing' };
  const target = Math.min(Math.max(1, slideNumber), playback.totalSlides);
  const wasPlaying = playback.status === 'playing' || playback.status === 'countdown';
  playback.currentSlide = target;
  playback.status = wasPlaying ? 'playing' : 'paused';
  playback.phaseDurationMs = slideDurationMs(target);
  if (wasPlaying) {
    playback.phaseEndsAt = Date.now() + playback.phaseDurationMs;
    playback.remainingMs = null;
    ensureTicking();
  } else {
    playback.phaseEndsAt = null;
    playback.remainingMs = playback.phaseDurationMs;
    stopTicking();
  }
  broadcast();
  return { ok: true };
}

const next = () => goToSlide(playback.currentSlide + 1);
const prev = () => goToSlide(playback.currentSlide - 1);

/* ------------------------------------------------------------------ *
 * Server-Sent Events: every connected admin/display tab gets a live
 * copy of the playback state.
 * ------------------------------------------------------------------ */
const sseClients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      /* dropped clients are cleaned up on 'close' */
    }
  }
}

/* ------------------------------------------------------------------ *
 * HTTP app
 * ------------------------------------------------------------------ */
const app = express();
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Each uploaded file gets its own id; the id is recovered from the
  // filename in the route handler.
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 100 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist')));

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/present', (req, res) => res.sendFile(path.join(__dirname, 'public', 'present.html')));

/* --- Presentation CRUD -------------------------------------------- */
app.get('/api/presentations', (req, res) => {
  res.json(presentations);
});

app.get('/api/presentations/:id', (req, res) => {
  const p = findPresentation(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

// Upload one or many PDFs in a single request. Each file becomes its own
// presentation, titled after its file name. The admin page supplies a
// per-file page count (via pdf.js) and per-file slide durations as JSON
// arrays aligned with the file order.
app.post('/api/presentations', upload.array('files', 100), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No PDF uploaded' });

  const defaultSeconds = Math.max(0.5, Number(req.body.defaultSeconds) || 10);
  const parseArray = (raw) => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const numPagesList = parseArray(req.body.numPages);
  const slideSecondsList = parseArray(req.body.slideSeconds);

  const created = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = path.basename(file.filename, '.pdf');

    let numPages = parseInt(numPagesList[i], 10);
    if (!Number.isFinite(numPages) || numPages < 1) {
      numPages = countPagesFromBytes(await fsp.readFile(file.path)) || 1;
    }
    const slideSeconds = sanitizeSlideSeconds(slideSecondsList[i], numPages, defaultSeconds);

    const presentation = {
      id,
      name: file.originalname.replace(/\.pdf$/i, '') || 'Untitled',
      originalFilename: file.originalname,
      numPages,
      defaultSeconds,
      slideSeconds,
      createdAt: Date.now() + i,
    };
    presentations.push(presentation);
    created.push(presentation);
  }
  await savePresentations();
  res.status(201).json(created);
});

app.put('/api/presentations/:id', async (req, res) => {
  const p = findPresentation(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });

  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    p.name = req.body.name.trim();
  }
  if (req.body.defaultSeconds != null) {
    p.defaultSeconds = Math.max(0.5, Number(req.body.defaultSeconds) || p.defaultSeconds);
  }
  if (Array.isArray(req.body.slideSeconds)) {
    p.slideSeconds = sanitizeSlideSeconds(req.body.slideSeconds, p.numPages, p.defaultSeconds);
  }
  await savePresentations();

  // If this presentation is currently active, keep the live total in sync.
  if (playback.presentationId === p.id) {
    playback.totalSlides = p.numPages;
    broadcast();
  }
  res.json(p);
});

app.delete('/api/presentations/:id', async (req, res) => {
  const idx = presentations.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  if (playback.presentationId === req.params.id) stop();

  const [removed] = presentations.splice(idx, 1);
  await savePresentations();
  fs.promises
    .unlink(path.join(UPLOAD_DIR, `${removed.id}.pdf`))
    .catch(() => {});
  res.json({ ok: true });
});

app.get('/api/presentations/:id/file', (req, res) => {
  const p = findPresentation(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const file = path.join(UPLOAD_DIR, `${p.id}.pdf`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(p.originalFilename)}"`);
  res.sendFile(file);
});

/* --- Display settings --------------------------------------------- */
app.put('/api/settings', async (req, res) => {
  if (typeof req.body.showProgress === 'boolean') {
    settings.showProgress = req.body.showProgress;
  }
  await saveSettings();
  broadcast();
  res.json(settings);
});

/* --- Playback control --------------------------------------------- */
app.get('/api/state', (req, res) => res.json(publicState()));

app.post('/api/control/:action', (req, res) => {
  const { action } = req.params;
  let result;
  switch (action) {
    case 'start':
      result = start(req.body.presentationId);
      break;
    case 'pause':
      result = pause();
      break;
    case 'resume':
      result = resume();
      break;
    case 'stop':
      result = stop();
      break;
    case 'next':
      result = next();
      break;
    case 'prev':
      result = prev();
      break;
    case 'goto':
      result = goToSlide(parseInt(req.body.slide, 10));
      break;
    case 'restart':
      result = start(playback.presentationId || req.body.presentationId);
      break;
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, state: publicState() });
});

/* --- SSE ----------------------------------------------------------- */
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Multer / generic error handler
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
  next();
});

app.listen(PORT, () => {
  console.log(`Auto-advancing presentations running at http://localhost:${PORT}`);
  console.log(`  Admin console:      http://localhost:${PORT}/`);
  console.log(`  Presentation view:  http://localhost:${PORT}/present`);
});
