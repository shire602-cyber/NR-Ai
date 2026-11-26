import { useCallback, useEffect, useRef, useState } from "react";

/** How long the last stage keeps moving on screen after it lands (pop, fill and pill transitions). */
export const SETTLE_MS = 450;

export interface Sequence {
  /** Stages completed so far, 0..total. */
  step: number;
  running: boolean;
  /** The last stage has landed but its own animation or transition is still playing. */
  settling: boolean;
  done: boolean;
  start: () => void;
  reset: () => void;
}

/**
 * A timed sequence of `total` stages, one every `stepMs`. With `reduced` set, `start` jumps straight
 * to the final stage so nothing animates. While `paused` the running sequence is held: the stage
 * timer stops and, on resume, waits only for the time that was left (no restart, no skipped stage).
 *
 * The sequence reports activity (`onActivity`) while it runs and for `settleMs` after the last stage
 * lands, because that stage is still animating then: the tour keeps Pause offered until the motion
 * has really ended. The settle time is held by `paused` like a stage.
 */
export function useSequence(
  total: number,
  stepMs: number,
  reduced: boolean,
  paused = false,
  onActivity?: (active: boolean) => void,
  settleMs = SETTLE_MS
): Sequence {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(true);
  const running = playing && step < total;
  const settling = playing && step >= total && !settled;
  const left = useRef({ step: -1, ms: stepMs });
  const settleLeft = useRef(settleMs);

  // Tell the tour whether a demo is visibly moving (so Pause stays offered after a manual start).
  const active = running || settling;
  useEffect(() => {
    onActivity?.(active);
    return () => onActivity?.(false);
  }, [onActivity, active]);

  useEffect(() => {
    if (!settling) {
      settleLeft.current = settleMs;
      return;
    }
    if (paused) return;
    const startedAt = Date.now();
    const id = setTimeout(() => setSettled(true), settleLeft.current);
    return () => {
      clearTimeout(id);
      settleLeft.current = Math.max(0, settleLeft.current - (Date.now() - startedAt));
    };
  }, [settling, paused, settleMs]);

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
    setSettled(false);
    setPlaying(true);
  }, [reduced, total]);

  const reset = useCallback(() => {
    setPlaying(false);
    setSettled(true);
    setStep(0);
  }, []);

  return { step, running, settling, done: step >= total, start, reset };
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
