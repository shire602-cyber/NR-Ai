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
 * to the final stage so nothing animates. While `paused` the running sequence is held: the stage
 * timer stops and, on resume, waits only for the time that was left (no restart, no skipped stage).
 */
export function useSequence(
  total: number,
  stepMs: number,
  reduced: boolean,
  paused = false,
  onActivity?: (active: boolean) => void
): Sequence {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const running = playing && step < total;
  const left = useRef({ step: -1, ms: stepMs });

  // Tell the tour whether a demo is visibly moving (so Pause stays offered after a manual start).
  useEffect(() => {
    onActivity?.(running);
    return () => onActivity?.(false);
  }, [onActivity, running]);

  useEffect(() => {
    if (!running) {
      left.current = { step: -1, ms: stepMs };
      return;
    }
    if (left.current.step !== step) left.current = { step, ms: stepMs };
    if (paused) return;
    const startedAt = Date.now();
    const id = setTimeout(() => setStep((s) => s + 1), left.current.ms);
    return () => {
      clearTimeout(id);
      left.current.ms = Math.max(0, left.current.ms - (Date.now() - startedAt));
    };
  }, [running, step, stepMs, paused]);

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
