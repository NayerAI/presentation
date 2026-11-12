// Tiny self-contained canvas confetti — no external libraries.
// launchConfetti(container) appends a full-size canvas and rains confetti
// until the returned stop() is called.

export function launchConfetti(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0;
  let H = 0;
  function resize() {
    W = canvas.width = container.clientWidth || window.innerWidth;
    H = canvas.height = container.clientHeight || window.innerHeight;
  }
  resize();
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  const colors = ['#ff4fd8', '#4ff3ff', '#f2f65a', '#9b5cff', '#c2f286', '#f7f2fa'];
  const count = Math.max(80, Math.min(260, Math.round(W / 6)));

  const spawn = (fromTop) => ({
    x: Math.random() * W,
    y: fromTop ? -20 - Math.random() * 40 : Math.random() * -H,
    r: 4 + Math.random() * 7,
    color: colors[(Math.random() * colors.length) | 0],
    vx: (Math.random() - 0.5) * 1.4,
    vy: 2 + Math.random() * 3.5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    rect: Math.random() < 0.55,
  });
  const parts = Array.from({ length: count }, () => spawn(false));

  let running = true;
  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02;
      p.rot += p.vr;
      if (p.y > H + 24) Object.assign(p, spawn(true));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.rect) ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return function stop() {
    running = false;
    window.removeEventListener('resize', onResize);
    canvas.remove();
  };
}
