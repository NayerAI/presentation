import * as pdfjsLib from '/vendor/pdfjs/legacy/build/pdf.min.mjs';
import { launchConfetti } from './confetti.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.min.mjs';

let stopConfetti = null;
function clearConfetti() {
  if (stopConfetti) {
    stopConfetti();
    stopConfetti = null;
  }
}

const $ = (s) => document.getElementById(s);

// Elements
const setup = $('setup');
const stage = $('stage');
const fileInput = $('file');
const fileHint = $('fileHint');
const dropZone = $('dropZone');
const deckInfo = $('deckInfo');
const deckName = $('deckName');
const deckMeta = $('deckMeta');
const startBtn = $('startBtn');
const setupMsg = $('setupMsg');
const pacePill = $('pacePill');

const canvas = $('slideCanvas');
const countdownScreen = $('countdownScreen');
const countdownNumber = $('countdownNumber');
const ringProgress = $('ringProgress');
const doneScreen = $('doneScreen');
const doneSummary = $('doneSummary');
const stageProgress = $('stageProgress');
const stageProgressFill = $('stageProgressFill');
const hudSlide = $('hudSlide');
const hudTotal = $('hudTotal');
const hudElapsed = $('hudElapsed');
const hudTarget = $('hudTarget');
const pPlay = $('pPlay');

const RING = 2 * Math.PI * 54;
ringProgress.style.strokeDasharray = RING.toFixed(3);

// Config from the admin
let perSlideSeconds = 30;
let countdownSeconds = 3;

async function loadConfig() {
  try {
    const cfg = await (await fetch('/api/practice-config')).json();
    if (cfg.perSlideSeconds) perSlideSeconds = cfg.perSlideSeconds;
    if (cfg.countdownSeconds) countdownSeconds = cfg.countdownSeconds;
  } catch {
    /* keep defaults */
  }
  pacePill.textContent = `${perSlideSeconds}s / slide`;
  refreshDeckMeta();
}

// ---------------------------------------------------------------- PDF
let pdfDoc = null;
let renderTask = null;

fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  })
);
dropZone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) {
    fileInput.files = e.dataTransfer.files;
    loadFile(f);
  }
});

async function loadFile(file) {
  if (!file) return;
  setupMsg.textContent = '';
  fileHint.textContent = file.name;
  try {
    const buf = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    deckName.textContent = file.name.replace(/\.pdf$/i, '');
    deckInfo.hidden = false;
    startBtn.disabled = false;
    refreshDeckMeta();
  } catch (err) {
    console.error(err);
    pdfDoc = null;
    startBtn.disabled = true;
    setupMsg.textContent = 'Could not read that PDF.';
    setupMsg.className = 'upload-msg error';
  }
}

function refreshDeckMeta() {
  if (!pdfDoc) return;
  const n = pdfDoc.numPages;
  deckMeta.textContent = `${n} slides · ${fmt(n * perSlideSeconds * 1000)} target · ${perSlideSeconds}s per slide`;
}

async function renderSlide(pageNumber) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(window.innerWidth / base.width, window.innerHeight / base.height);
  const viewport = page.getViewport({ scale: fit * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = Math.floor(base.width * fit) + 'px';
  canvas.style.height = Math.floor(base.height * fit) + 'px';
  if (renderTask) {
    try {
      renderTask.cancel();
    } catch {
      /* ignore */
    }
  }
  renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  try {
    await renderTask.promise;
  } catch {
    /* superseded */
  }
}

// ---------------------------------------------------------- Practice loop
const P = {
  status: 'idle', // idle | countdown | playing | paused | finished
  currentSlide: 0,
  totalSlides: 0,
  perSlideMs: 30000,
  countdownMs: 3000,
  countdownRemaining: 0,
  slideElapsed: 0,
  totalElapsed: 0,
  lastCountdownShown: null,
};
let lastTs = 0;

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startPractice() {
  if (!pdfDoc) return;
  clearConfetti();
  setup.hidden = true;
  stage.hidden = false;
  doneScreen.hidden = true;

  P.status = 'countdown';
  P.totalSlides = pdfDoc.numPages;
  P.perSlideMs = perSlideSeconds * 1000;
  P.countdownMs = countdownSeconds * 1000;
  P.countdownRemaining = P.countdownMs;
  P.currentSlide = 1;
  P.slideElapsed = 0;
  P.totalElapsed = 0;
  P.lastCountdownShown = null;

  hudTotal.textContent = P.totalSlides;
  hudTarget.textContent = fmt(P.totalSlides * P.perSlideMs);
  countdownScreen.hidden = false;
  stageProgress.hidden = true;
  pPlay.textContent = 'Pause';

  renderSlide(1); // ready behind the countdown
  updateHud();
  lastTs = 0;
  requestAnimationFrame(frame);
}

function beginSlide(n) {
  P.currentSlide = n;
  P.slideElapsed = 0;
  P.status = P.status === 'paused' ? 'paused' : 'playing';
  renderSlide(n);
  updateHud();
}

function finish() {
  P.status = 'finished';
  stageProgress.hidden = true;
  const over = P.totalElapsed - P.totalSlides * P.perSlideMs;
  doneSummary.textContent = `Total time ${fmt(P.totalElapsed)} · target ${fmt(
    P.totalSlides * P.perSlideMs
  )} (${over >= 0 ? '+' : '−'}${fmt(Math.abs(over))})`;
  doneScreen.hidden = false;
  clearConfetti();
  stopConfetti = launchConfetti(doneScreen);
}

function frame(ts) {
  const dt = lastTs ? ts - lastTs : 0;
  lastTs = ts;

  if (P.status === 'countdown') {
    P.countdownRemaining -= dt;
    if (P.countdownRemaining <= 0) {
      countdownScreen.hidden = true;
      stageProgress.hidden = false;
      beginSlide(1);
    } else {
      const n = Math.min(countdownSeconds, Math.max(1, Math.ceil(P.countdownRemaining / 1000)));
      if (n !== P.lastCountdownShown) {
        P.lastCountdownShown = n;
        countdownNumber.textContent = n;
        countdownNumber.classList.remove('bump');
        void countdownNumber.offsetWidth;
        countdownNumber.classList.add('bump');
      }
      ringProgress.style.strokeDashoffset = (RING * (1 - P.countdownRemaining / P.countdownMs)).toFixed(2);
    }
  } else if (P.status === 'playing') {
    P.slideElapsed += dt;
    P.totalElapsed += dt;
    if (P.slideElapsed >= P.perSlideMs) {
      if (P.currentSlide < P.totalSlides) {
        beginSlide(P.currentSlide + 1);
      } else {
        finish();
        return;
      }
    }
    stageProgressFill.style.width = Math.min(100, (P.slideElapsed / P.perSlideMs) * 100).toFixed(2) + '%';
    updateHud();
  }

  if (P.status === 'countdown' || P.status === 'playing' || P.status === 'paused') {
    requestAnimationFrame(frame);
  }
}

function updateHud() {
  hudSlide.textContent = P.status === 'countdown' ? 0 : P.currentSlide;
  hudElapsed.textContent = fmt(P.totalElapsed);
}

// ---------------------------------------------------------- Controls
function goTo(n) {
  if (P.status !== 'playing' && P.status !== 'paused') return;
  const t = Math.min(Math.max(1, n), P.totalSlides);
  beginSlide(t);
}
function togglePlay() {
  if (P.status === 'playing' || P.status === 'countdown') {
    P.status = 'paused';
    pPlay.textContent = 'Resume';
  } else if (P.status === 'paused') {
    P.status = 'playing';
    pPlay.textContent = 'Pause';
    lastTs = 0;
    requestAnimationFrame(frame);
  } else if (P.status === 'finished') {
    startPractice();
  }
}
function exitPractice() {
  P.status = 'idle';
  clearConfetti();
  stage.hidden = true;
  setup.hidden = false;
}

startBtn.addEventListener('click', startPractice);
$('pPrev').addEventListener('click', () => goTo(P.currentSlide - 1));
$('pNext').addEventListener('click', () => (P.currentSlide < P.totalSlides ? goTo(P.currentSlide + 1) : finish()));
pPlay.addEventListener('click', togglePlay);
$('pRestart').addEventListener('click', startPractice);
$('pExit').addEventListener('click', exitPractice);
$('againBtn').addEventListener('click', startPractice);
$('doneExitBtn').addEventListener('click', exitPractice);

$('fsBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) stage.requestFullscreen?.();
  else document.exitFullscreen?.();
});

window.addEventListener('keydown', (e) => {
  if (stage.hidden) return;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') goTo(P.currentSlide + 1);
  else if (e.key === 'ArrowLeft') goTo(P.currentSlide - 1);
  else if (e.key === 'f' || e.key === 'F') $('fsBtn').click();
  else if (e.key === 'Escape' && P.status !== 'finished') exitPractice();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!stage.hidden && P.currentSlide) renderSlide(P.currentSlide);
  }, 150);
});

loadConfig();
