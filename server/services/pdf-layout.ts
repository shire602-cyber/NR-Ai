// Layout helpers shared by the PDF generators.

interface TextMeasurer {
  fontSize(size: number): unknown;
  widthOfString(text: string): number;
}

/**
 * Largest font size between `minSize` and `baseSize` at which `text` fits in
 * `width` on one line. Unit prices keep up to six decimals, so a fixed size
 * wrapped them onto a second line that the row then clipped.
 */
export function fitFontSize(
  doc: TextMeasurer,
  text: string,
  width: number,
  baseSize: number,
  minSize = 6
): number {
  for (let size = baseSize; size > minSize; size -= 0.5) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= width) return size;
  }
  doc.fontSize(minSize);
  return minSize;
}
