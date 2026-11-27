/**
 * Pointer depth: tilt (`[data-tilt]`) and parallax (`[data-parallax]`).
 *
 * One delegated pointer listener for the whole document; elements opt in with an attribute and
 * index.css turns the custom properties into transforms. Loaded lazily by `useAmbientMotion`
 * only for a mouse or trackpad, and never while motion is paused or reduced.
 *
 *   data-tilt="4"      max rotation in degrees (default 4). Sets --tilt-x / --tilt-y,
 *                      --glare-x / --glare-y and `data-tilt-active` while hovered.
 *   data-parallax      sets --px / --py (-1 to 1 from the element centre) for `.parallax-layer`
 *                      children, which move by their own `--depth`.
 */
const DEFAULT_MAX_DEG = 4;

export function startPointerDepth(): () => void {
  let frame = 0;
  let x = 0;
  let y = 0;
  let tilted: HTMLElement | null = null;
  let scene: HTMLElement | null = null;

  const releaseTilt = (el: HTMLElement | null) => {
    if (!el) return;
    el.removeAttribute("data-tilt-active");
    el.style.removeProperty("--tilt-x");
    el.style.removeProperty("--tilt-y");
  };
  const releaseScene = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty("--px");
    el.style.removeProperty("--py");
  };

  const apply = () => {
    frame = 0;
    if (tilted) {
      const rect = tilted.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = (x - rect.left) / rect.width - 0.5;
        const ny = (y - rect.top) / rect.height - 0.5;
        const max = Number(tilted.dataset.tilt) || DEFAULT_MAX_DEG;
        // Wide surfaces rotate less so the far edge never travels more than a few pixels.
        const scale = Math.min(1, 420 / Math.max(rect.width, rect.height));
        tilted.style.setProperty("--tilt-x", `${(-ny * max * scale).toFixed(2)}deg`);
        tilted.style.setProperty("--tilt-y", `${(nx * max * scale).toFixed(2)}deg`);
        tilted.style.setProperty("--glare-x", `${((nx + 0.5) * 100).toFixed(1)}%`);
        tilted.style.setProperty("--glare-y", `${((ny + 0.5) * 100).toFixed(1)}%`);
        tilted.setAttribute("data-tilt-active", "");
      }
    }
    if (scene) {
      const rect = scene.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const px = ((x - rect.left) / rect.width - 0.5) * 2;
        const py = ((y - rect.top) / rect.height - 0.5) * 2;
        scene.style.setProperty("--px", Math.max(-1, Math.min(1, px)).toFixed(3));
        scene.style.setProperty("--py", Math.max(-1, Math.min(1, py)).toFixed(3));
      }
    }
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    const nextTilt = target?.closest<HTMLElement>("[data-tilt]") ?? null;
    const nextScene = target?.closest<HTMLElement>("[data-parallax]") ?? null;
    if (nextTilt !== tilted) {
      releaseTilt(tilted);
      tilted = nextTilt;
    }
    if (nextScene !== scene) {
      releaseScene(scene);
      scene = nextScene;
    }
    if (!tilted && !scene) return;
    x = event.clientX;
    y = event.clientY;
    if (!frame) frame = requestAnimationFrame(apply);
  };

  const onLeave = () => {
    releaseTilt(tilted);
    releaseScene(scene);
    tilted = null;
    scene = null;
  };

  document.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onLeave);

  return () => {
    document.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onLeave);
    if (frame) cancelAnimationFrame(frame);
    onLeave();
  };
}
