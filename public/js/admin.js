import * as pdfjsLib from '/vendor/pdfjs/legacy/build/pdf.min.mjs';
import { connectPlayback, progressInfo } from './sync.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.min.mjs';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * Small PDF helpers (page count + thumbnail rendering)
 * ------------------------------------------------------------------ */
const pdfCache = new Map(); // id -> pdfDocument promise

function loadPdf(url) {
  return pdfjsLib.getDocument(url).promise;
}

async function renderPageTo(pdf, pageNumber, canvas, maxWidth) {
  const page = await pdf.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = maxWidth / unscaled.width;
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function getCachedPdf(id) {
  if (!pdfCache.has(id)) pdfCache.set(id, loadPdf(`/api/presentations/${id}/file`));
  return pdfCache.get(id);
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */
const uploadForm = $('#uploadForm');
const fileInput = $('#file');
const fileHint = $('#fileHint');
const dropZone = $('#dropZone');
const uploadMsg = $('#uploadMsg');
const uploadBtn = $('#uploadBtn');

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileHint.textContent = f ? f.name : 'Drop a PDF here or click to browse';
  if (f && !$('#title').value.trim()) {
    $('#title').value = f.name.replace(/\.pdf$/i, '');
  }
});

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
    fileInput.dispatchEvent(new Event('change'));
  }
});

function setMsg(text, kind = '') {
  uploadMsg.textContent = text;
  uploadMsg.className = 'upload-msg' + (kind ? ' ' + kind : '');
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return setMsg('Choose a PDF first', 'error');

  const defaultSeconds = Math.max(0.5, Number($('#defaultSeconds').value) || 10);
  const name = $('#title').value.trim() || file.name.replace(/\.pdf$/i, '');

  uploadBtn.disabled = true;
  setMsg('Reading PDF…');

  // Read the page count locally so the server always has an accurate total.
  let numPages = 0;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    numPages = pdf.numPages;
  } catch (err) {
    console.warn('Could not read PDF locally, server will estimate', err);
  }

  const slideSeconds = numPages ? Array.from({ length: numPages }, () => defaultSeconds) : [];

  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', name);
  fd.append('defaultSeconds', String(defaultSeconds));
  fd.append('numPages', String(numPages));
  fd.append('slideSeconds', JSON.stringify(slideSeconds));

  setMsg('Uploading…');
  try {
    const res = await fetch('/api/presentations', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    setMsg('Uploaded ✓', 'success');
    uploadForm.reset();
    fileHint.textContent = 'Drop a PDF here or click to browse';
    await refreshLibrary();
  } catch (err) {
    setMsg(err.message, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */
const libraryEl = $('#library');
const emptyState = $('#emptyState');
const countPill = $('#countPill');
let presentations = [];

function totalDuration(p) {
  const secs = (p.slideSeconds || []).reduce((a, b) => a + Number(b || 0), 0);
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function refreshLibrary() {
  const res = await fetch('/api/presentations');
  presentations = await res.json();
  renderLibrary();
}

function renderLibrary() {
  countPill.textContent = presentations.length;
  emptyState.hidden = presentations.length > 0;
  libraryEl.innerHTML = '';

  for (const p of presentations) {
    const row = document.createElement('div');
    row.className = 'pres';
    row.dataset.id = p.id;
    row.innerHTML = `
      <canvas class="pres-thumb" data-thumb="${p.id}"></canvas>
      <div class="pres-info">
        <div class="pres-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="pres-meta">${p.numPages} slides · ${totalDuration(p)} total</div>
      </div>
      <div class="pres-actions">
        <button class="btn btn-primary" data-act="start">Start</button>
        <button class="btn btn-ghost" data-act="edit">Timings</button>
        <button class="btn btn-danger" data-act="delete" title="Delete">🗑</button>
      </div>`;
    libraryEl.appendChild(row);

    // Thumbnail (page 1)
    const canvas = row.querySelector('[data-thumb]');
    getCachedPdf(p.id)
      .then((pdf) => renderPageTo(pdf, 1, canvas, 168))
      .catch(() => {});

    row.querySelector('[data-act="start"]').addEventListener('click', () => startPresentation(p.id));
    row.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(p.id));
    row.querySelector('[data-act="delete"]').addEventListener('click', () => deletePresentation(p));
  }
  markActiveRow();
}

async function startPresentation(id) {
  await fetch('/api/control/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presentationId: id }),
  });
  // Nudge the user toward opening the display if they haven't yet.
  if (!displayOpened) flashOpenHint();
}

async function deletePresentation(p) {
  if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
  await fetch(`/api/presentations/${p.id}`, { method: 'DELETE' });
  pdfCache.delete(p.id);
  await refreshLibrary();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ------------------------------------------------------------------ *
 * Timings editor
 * ------------------------------------------------------------------ */
const backdrop = $('#editorBackdrop');
const slideGrid = $('#slideGrid');
let editingId = null;

async function openEditor(id) {
  const p = presentations.find((x) => x.id === id);
  if (!p) return;
  editingId = id;
  $('#editorTitle').textContent = `Timings — ${p.name}`;
  $('#editName').value = p.name;
  $('#applyAll').value = p.defaultSeconds;
  slideGrid.innerHTML = '';
  backdrop.hidden = false;

  const pdf = await getCachedPdf(id).catch(() => null);
  for (let i = 1; i <= p.numPages; i++) {
    const cell = document.createElement('div');
    cell.className = 'slide-cell';
    cell.innerHTML = `
      <canvas data-page="${i}"></canvas>
      <div class="slide-cell-foot">
        <label>#${i}</label>
        <input type="number" min="0.5" step="0.5" value="${p.slideSeconds[i - 1]}" data-sec="${i}" />
        <span style="color:var(--muted);font-size:.78rem">s</span>
      </div>`;
    slideGrid.appendChild(cell);
    if (pdf) renderPageTo(pdf, i, cell.querySelector('canvas'), 300).catch(() => {});
  }
}

function closeEditor() {
  backdrop.hidden = true;
  editingId = null;
}
$('#editorClose').addEventListener('click', closeEditor);
backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) closeEditor();
});

$('#applyAllBtn').addEventListener('click', () => {
  const v = Number($('#applyAll').value);
  if (!Number.isFinite(v) || v <= 0) return;
  slideGrid.querySelectorAll('[data-sec]').forEach((inp) => (inp.value = v));
});

$('#editorSave').addEventListener('click', async () => {
  if (!editingId) return;
  const slideSeconds = [...slideGrid.querySelectorAll('[data-sec]')].map((inp) => Number(inp.value) || 0);
  const name = $('#editName').value.trim();
  await fetch(`/api/presentations/${editingId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slideSeconds }),
  });
  closeEditor();
  await refreshLibrary();
});

/* ------------------------------------------------------------------ *
 * Live control bar (driven by SSE)
 * ------------------------------------------------------------------ */
const controlBar = $('#controlBar');
const statusDot = $('#statusDot');
const nowTitle = $('#nowTitle');
const nowStatus = $('#nowStatus');
const slideNum = $('#slideNum');
const slideTotal = $('#slideTotal');
const progressFill = $('#progressFill');
const btnPlayPause = $('#btnPlayPause');

let currentState = { status: 'idle' };
let getOffset = () => 0;

const control = (action, body) =>
  fetch(`/api/control/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

$('#btnPrev').addEventListener('click', () => control('prev'));
$('#btnNext').addEventListener('click', () => control('next'));
$('#btnStop').addEventListener('click', () => control('stop'));
$('#btnRestart').addEventListener('click', () => control('restart'));
btnPlayPause.addEventListener('click', () => {
  if (currentState.status === 'playing' || currentState.status === 'countdown') control('pause');
  else if (currentState.status === 'paused') control('resume');
  else if (currentState.status === 'finished') control('restart');
});

const STATUS_LABEL = {
  idle: 'Idle',
  countdown: 'Starting…',
  playing: 'Playing',
  paused: 'Paused',
  finished: 'Finished',
};

function applyState(state, offsetFn) {
  currentState = state;
  getOffset = offsetFn;

  const active = state.status !== 'idle';
  controlBar.hidden = !active;
  if (!active) {
    markActiveRow();
    return;
  }

  nowTitle.textContent = state.presentationName || '—';
  nowStatus.textContent = STATUS_LABEL[state.status] || state.status;
  statusDot.className = 'status-dot ' + state.status;
  slideNum.textContent = state.status === 'countdown' ? 0 : state.currentSlide;
  slideTotal.textContent = state.totalSlides;

  btnPlayPause.textContent =
    state.status === 'playing' || state.status === 'countdown'
      ? 'Pause'
      : state.status === 'finished'
      ? 'Restart'
      : 'Resume';

  markActiveRow();
}

function markActiveRow() {
  document.querySelectorAll('.pres').forEach((row) => {
    row.classList.toggle('active', row.dataset.id === currentState.presentationId && currentState.status !== 'idle');
  });
}

function animate() {
  if (currentState.status === 'countdown') {
    const { countdownNumber } = progressInfo(currentState, getOffset());
    nowStatus.textContent = `Starting in ${countdownNumber}…`;
    progressFill.style.width = '0%';
  } else if (currentState.status === 'playing' || currentState.status === 'paused') {
    const { fraction } = progressInfo(currentState, getOffset());
    progressFill.style.width = (fraction * 100).toFixed(1) + '%';
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

connectPlayback(applyState);

/* ------------------------------------------------------------------ *
 * Open display tab
 * ------------------------------------------------------------------ */
let displayWindow = null;
let displayOpened = false;
$('#openDisplay').addEventListener('click', () => {
  displayWindow = window.open('/present', 'presentationDisplay');
  displayOpened = true;
});

function flashOpenHint() {
  const btn = $('#openDisplay');
  btn.classList.add('btn-primary');
  btn.classList.remove('btn-ghost');
  setTimeout(() => {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-ghost');
  }, 2500);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
refreshLibrary();
