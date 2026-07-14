import * as pdfjsLib from '/vendor/pdfjs/legacy/build/pdf.min.mjs';
import { connectPlayback, progressInfo } from './sync.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.min.mjs';

const stage = document.getElementById('stage');
const canvas = document.getElementById('slideCanvas');
const idleScreen = document.getElementById('idleScreen');
const countdownScreen = document.getElementById('countdownScreen');
const countdownNumber = document.getElementById('countdownNumber');
const ringProgress = document.getElementById('ringProgress');
const pausedBadge = document.getElementById('pausedBadge');
const stageProgress = document.getElementById('stageProgress');
const stageProgressFill = document.getElementById('stageProgressFill');
const fsBtn = document.getElementById('fsBtn');

const RING_CIRCUMFERENCE = 2 * Math.PI * 54; // r = 54 in the SVG

let currentState = { status: 'idle' };
let getOffset = () => 0;

let activePdfId = null;
let activePdf = null; // pdfDocument
let renderedKey = null; // `${id}:${slide}` currently on screen
let renderTask = null;
let lastCountdownShown = null;

/* ------------------------------------------------------------------ *
 * PDF loading + rendering
 * ------------------------------------------------------------------ */
async function ensurePdf(id) {
  if (activePdfId === id && activePdf) return activePdf;
  activePdfId = id;
  renderedKey = null;
  try {
    activePdf = await pdfjsLib.getDocument(`/api/presentations/${id}/file`).promise;
  } catch (err) {
    console.error('Failed to load presentation PDF', err);
    activePdf = null;
  }
  return activePdf;
}

async function renderSlide(pageNumber) {
  if (!activePdf) return;
  const page = await activePdf.getPage(pageNumber);
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
  const ctx = canvas.getContext('2d');
  renderTask = page.render({ canvasContext: ctx, viewport });
  try {
    await renderTask.promise;
  } catch {
    /* cancelled by a newer render */
  }
}

async function syncSlide() {
  if (!currentState.presentationId) return;
  await ensurePdf(currentState.presentationId);
  const slide = Math.max(1, currentState.currentSlide || 1);
  const key = `${currentState.presentationId}:${slide}`;
  if (key === renderedKey) return;
  renderedKey = key;
  await renderSlide(slide);
}

/* ------------------------------------------------------------------ *
 * State handling
 * ------------------------------------------------------------------ */
function applyState(state, offsetFn) {
  const prevStatus = currentState.status;
  currentState = state;
  getOffset = offsetFn;

  const isIdle = state.status === 'idle';
  idleScreen.hidden = !isIdle;
  canvas.style.visibility = isIdle ? 'hidden' : 'visible';

  const inCountdown = state.status === 'countdown';
  countdownScreen.hidden = !inCountdown;
  if (inCountdown && prevStatus !== 'countdown') lastCountdownShown = null;

  pausedBadge.hidden = state.status !== 'paused';
  const playingOrPaused = state.status === 'playing' || state.status === 'paused';
  stageProgress.hidden = !(playingOrPaused && state.showProgress !== false);

  if (isIdle) {
    activePdfId = null;
    activePdf = null;
    renderedKey = null;
    return;
  }
  syncSlide();
}

/* ------------------------------------------------------------------ *
 * Smooth animation loop (countdown number, ring, progress bar)
 * ------------------------------------------------------------------ */
function animate() {
  const state = currentState;
  if (state.status === 'countdown') {
    const { countdownNumber: n, fraction } = progressInfo(state, getOffset());
    if (n !== lastCountdownShown) {
      lastCountdownShown = n;
      countdownNumber.textContent = n;
      countdownNumber.classList.remove('bump');
      void countdownNumber.offsetWidth; // restart the animation
      countdownNumber.classList.add('bump');
    }
    ringProgress.style.strokeDashoffset = (RING_CIRCUMFERENCE * fraction).toFixed(2);
  } else if (state.status === 'playing' || state.status === 'paused') {
    const { fraction } = progressInfo(state, getOffset());
    stageProgressFill.style.width = (fraction * 100).toFixed(2) + '%';
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/* ------------------------------------------------------------------ *
 * Fullscreen + resize
 * ------------------------------------------------------------------ */
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentState.presentationId && currentState.currentSlide) {
      renderedKey = null;
      syncSlide();
    }
  }, 150);
});

// Keyboard: F for fullscreen (handy on the presentation screen).
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') fsBtn.click();
});

ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE.toFixed(3);
connectPlayback(applyState);
