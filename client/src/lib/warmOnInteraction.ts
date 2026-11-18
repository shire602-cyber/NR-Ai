/**
 * Run `warm` once, when the visitor first touches the page (focus, tap or key press) or after
 * `fallbackMs`, whichever comes first. Returns a function that cancels it.
 *
 * The sign-in page used to start downloading every catalog on the window `load` event, which on
 * a slow phone is while the page's own scripts are still arriving: ~40 requests competed with the
 * first paint (4.5 s instead of 2.4 s on Slow 4G). Waiting for the first touch keeps the first
 * signed-in screen fast (typing a password takes longer than the catalogs need) and the form
 * first.
 */
export function warmOnFirstInteraction(warm: () => void, fallbackMs = 8000): () => void {
  const events = ["focusin", "pointerdown", "keydown", "touchstart"] as const;
  let done = false;
  const cancel = () => {
    done = true;
    clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, go, true);
  };
  function go() {
    if (done) return;
    cancel();
    warm();
  }
  for (const e of events) window.addEventListener(e, go, { capture: true, passive: true });
  const timer = setTimeout(go, fallbackMs);
  return cancel;
}
