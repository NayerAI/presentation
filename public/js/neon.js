// RAID look: chromatic neon frames around panels and neon-tube titles.
// Same visual language as the RAID competition site (raid-web).

const SVG_NS = 'http://www.w3.org/2000/svg';
const TUBES = [['#9b5cff', 1.1], ['#4ff3ff', 1.1], ['#ff4fd8', 1.6], ['#f2f65a', 1], ['#f7f2fa', 0.8]];
const FONT = 'font-family:Archivo,"Arial Black",sans-serif;font-stretch:125%;';
let uid = 0;

function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/** Four slightly offset neon outlines inside `el` (which gets position: relative). */
export function frame(el) {
  if (el.querySelector(':scope > .fl')) return;
  el.classList.add('framed');
  for (const k of ['a', 'b', 'c', 'd']) {
    const s = document.createElement('span');
    s.className = 'fl ' + k;
    s.setAttribute('aria-hidden', 'true');
    el.prepend(s);
  }
}

/**
 * `text` drawn as five offset neon tubes, with an optional subtitle.
 * Returns an <svg>; call .animate() on it to let the tubes drift and flicker.
 */
export function neonTitle(text, subtitle = '', small = false) {
  const id = 'neon-glow-' + ++uid;
  const size = 176;
  // Archivo Black-ish at 125% stretch: about 0.86em per uppercase glyph.
  const width = Math.round(text.length * size * 0.86);
  const pad = 40;
  const cx = width / 2 + pad;
  const glow = svg('filter', { id, x: '-20%', y: '-40%', width: '140%', height: '180%' },
    svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 5, result: 'b2' }),
    svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 1.3, result: 'b1' }),
    svg('feMerge', {}, ...['b2', 'b1', 'SourceGraphic'].map((n) => svg('feMergeNode', { in: n }))));
  // Longer words get scaled down more, so thicken their tubes to keep the same look.
  // Small logos get the same 2.4x boost the RAID site uses for its nav logo.
  const thick = Math.max(1, text.length / 4) * (small ? 2.4 : 1);
  const tubes = TUBES.map(([color, w]) => svg('text', {
    x: cx, y: 166, 'text-anchor': 'middle', fill: 'none', stroke: color, 'stroke-width': (w * thick).toFixed(2),
    'stroke-linejoin': 'round', opacity: 0.95, textLength: width, lengthAdjust: 'spacingAndGlyphs',
    style: FONT + `font-weight:900;font-size:${size}px;letter-spacing:.02em`,
  }, text));
  const h = subtitle ? 250 : 200;
  const el = svg('svg', { viewBox: `0 0 ${width + 2 * pad} ${h}`, 'aria-hidden': 'true', class: 'neon-title' },
    svg('defs', {}, glow),
    svg('g', { filter: `url(#${id})`, transform: `translate(${cx} 100) skewX(-9) translate(${-cx} -100)` }, ...tubes));
  if (subtitle) {
    el.append(svg('text', {
      x: cx, y: 232, 'text-anchor': 'middle', fill: '#ff4fd8', filter: `url(#${id})`,
      style: FONT + 'font-weight:800;font-size:22px;letter-spacing:.42em',
    }, subtitle.toUpperCase()));
  }
  el.animate = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const flicker = tubes.map(() => ({ until: 0, next: performance.now() + 800 + Math.random() * 3000 }));
    const step = (now) => {
      const t = now / 1000;
      tubes.forEach((tube, i) => {
        const dir = i % 2 ? 1 : -1;
        const amp = 2.5 + Math.abs(i - 2) * 1.2;
        const f = flicker[i];
        const dx = (i - 2) * 2 + dir * amp * Math.sin(t * 0.9 + i * 0.6);
        const dy = (i - 2) + dir * 0.8 * Math.sin(t * 0.7 + i);
        if (now > f.next && now > f.until) {
          f.until = now + 60 + Math.random() * 220;
          f.next = f.until + 1500 + Math.random() * 4500;
        }
        let op = 0.9 + 0.05 * Math.sin(t * 47 + i * 3) + (Math.random() - 0.5) * 0.06;
        if (now < f.until) op = Math.random() < 0.5 ? 0.25 + Math.random() * 0.25 : 0.7;
        tube.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
        tube.setAttribute('opacity', Math.max(0, Math.min(1, op)).toFixed(2));
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  return el;
}

// Decorate the page: frames on panels, neon titles on [data-neon] placeholders.
function decorate() {
  document.querySelectorAll('.card, .modal').forEach(frame);
  document.querySelectorAll('[data-neon]').forEach((host) => {
    const art = neonTitle(host.dataset.neon, host.dataset.neonSub || '', host.hasAttribute('data-neon-small'));
    host.replaceChildren(art);
    if (host.hasAttribute('data-neon-animate')) art.animate();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate);
else decorate();
