export const OPEN_COMMAND_PALETTE_EVENT = "muhasib:command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}
