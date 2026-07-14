// Shared playback-sync helper used by both the admin console and the
// presentation display. The server pushes state over Server-Sent Events;
// each client animates the countdown / progress locally from the absolute
// timestamps in that state, correcting for clock skew.

export function connectPlayback(onState) {
  let offset = 0; // (server clock) - (local clock), in ms
  const source = new EventSource('/api/events');
  source.onmessage = (evt) => {
    let state;
    try {
      state = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (typeof state.serverNow === 'number') {
      offset = state.serverNow - Date.now();
    }
    onState(state, () => offset);
  };
  return source;
}

// Given a state and the server/local clock offset, work out where we are
// in the current phase: the fraction elapsed (0..1), how much time is left,
// and — during the countdown — which number to show.
export function progressInfo(state, offset = 0) {
  const serverNow = Date.now() + offset;
  const duration = state.phaseDurationMs || 0;
  let remainingMs;

  if (state.status === 'paused') {
    remainingMs = state.remainingMs ?? 0;
  } else if ((state.status === 'countdown' || state.status === 'playing') && state.phaseEndsAt) {
    remainingMs = Math.max(0, state.phaseEndsAt - serverNow);
  } else {
    remainingMs = 0;
  }

  const elapsed = duration ? Math.min(duration, Math.max(0, duration - remainingMs)) : 0;
  const fraction = duration ? elapsed / duration : 0;

  let countdownNumber = null;
  if (state.status === 'countdown') {
    countdownNumber = Math.min(
      state.countdownTotal || 3,
      Math.max(1, Math.ceil(remainingMs / 1000))
    );
  }

  return { fraction, remainingMs, countdownNumber };
}
