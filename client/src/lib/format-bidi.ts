/** Keep an identifier or number in reading order when it is interpolated into RTL text. */
export function isolateLtrText(value: string): string {
  return `\u2066${value}\u2069`;
}

/** Keep Arabic text in reading order when it appears in a mixed-direction string. */
export function isolateRtlText(value: string): string {
  return `\u2067${value}\u2069`;
}
