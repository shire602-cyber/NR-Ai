import { useEffect, useRef } from 'react';

export interface ShortcutBinding {
  /** A combo string: lowercase keys joined with '+'. Modifiers: mod (Ctrl/Cmd), shift, alt. */
  combo: string;
  handler: (event: KeyboardEvent) => void;
  /** Allow firing while focus is inside an input/textarea. Default: false. */
  allowInInputs?: boolean;
  /** Set to false to skip this binding without unmounting. Default: true. */
  enabled?: boolean;
  /** Prevent default and stop propagation when fired. Default: true. */
  preventDefault?: boolean;
  /** Human-readable description for the help modal. */
  description?: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  // Use code-derived key, lowercased; ignore the modifier keys themselves.
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (!['control', 'meta', 'shift', 'alt'].includes(key)) {
    parts.push(key);
  }
  return parts.join('+');
}

/** Subscribe to a list of shortcut bindings while the component is mounted. */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]) {
  // Store the latest bindings in a ref so we don't re-bind on every render.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = eventCombo(e);
      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (binding.combo.toLowerCase() !== combo) continue;
        if (!binding.allowInInputs && isEditable(e.target)) continue;
        if (binding.preventDefault !== false) {
          e.preventDefault();
          e.stopPropagation();
        }
        binding.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Render-friendly representation of a combo, e.g. "⌘K" / "Ctrl+K". */
export function formatCombo(combo: string): string {
  const parts = combo.split('+').map((p) => {
    if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (p === 'shift') return isMac ? '⇧' : 'Shift';
    if (p === 'alt') return isMac ? '⌥' : 'Alt';
    if (p === 'enter') return '⏎';
    if (p === 'escape') return 'Esc';
    if (p === 'arrowup') return '↑';
    if (p === 'arrowdown') return '↓';
    if (p === 'arrowleft') return '←';
    if (p === 'arrowright') return '→';
    if (p === ' ' || p === 'space') return 'Space';
    return p.length === 1 ? p.toUpperCase() : p;
  });
  return isMac ? parts.join('') : parts.join('+');
}
