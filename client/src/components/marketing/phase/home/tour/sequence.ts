import { useCallback, useEffect, useRef, useState } from "react";

export interface Sequence {
  /** Stages completed so far, 0..total. */
  step: number;
  running: boolean;
  done: boolean;
  start: () => void;
  reset: () => void;
}

/**
 * A timed sequence of `total` stages, one every `stepMs`. With `reduced` set, `start` jumps straight
 * to the final stage so nothing animates.
 */
export function useSequence(total: number, stepMs: number, reduced: boolean): Sequence {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const running = playing && step < total;

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setStep((s) => s + 1), stepMs);
    return () => clearTimeout(id);
  }, [running, step, stepMs]);

  const start = useCallback(() => {
    if (reduced) {
      setPlaying(false);
      setStep(total);
      return;
    }
    setStep(0);
    setPlaying(true);
  }, [reduced, total]);

  const reset = useCallback(() => {
    setPlaying(false);
    setStep(0);
  }, []);

  return { step, running, done: step >= total, start, reset };
}

/** Start a sequence once, shortly after mount, when auto-play is allowed. */
export function useAutoStart(autoPlay: boolean, start: () => void, delayMs = 500) {
  const latest = useRef({ autoPlay, start });
  useEffect(() => {
    latest.current = { autoPlay, start };
  });
  useEffect(() => {
    if (!latest.current.autoPlay) return;
    const id = setTimeout(() => {
      // Read again at fire time: a visitor who touched the tour meanwhile cancels the demo.
      if (latest.current.autoPlay) latest.current.start();
    }, delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
}
