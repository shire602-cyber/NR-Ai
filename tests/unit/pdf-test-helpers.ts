import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

type PdfDocLike = any;

/** Collects the bytes PDFKit emits; call before doc.end(). */
export function collectPdf(doc: PdfDocLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Extracts text with poppler's pdftotext (raw reading order, logical Unicode). */
export async function pdfToText(pdf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-test-"));
  const file = path.join(dir, "doc.pdf");
  fs.writeFileSync(file, pdf);
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile("pdftotext", ["-enc", "UTF-8", file, "-"], (err, stdout) => {
        if (err) reject(err);
        else
          resolve(
            // Strip bidi embedding marks poppler adds around RTL runs.
            stdout.replace(/[‪-‮⁦-⁩]/g, "")
          );
      });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface PdfWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** Word boxes from `pdftotext -bbox` (visual positions; text is poppler's reading of glyphs). */
export async function pdfWords(pdf: Buffer): Promise<PdfWord[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-test-"));
  const file = path.join(dir, "doc.pdf");
  fs.writeFileSync(file, pdf);
  try {
    const html = await new Promise<string>((resolve, reject) => {
      execFile("pdftotext", ["-bbox", file, "-"], { maxBuffer: 20_000_000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    const words: PdfWord[] = [];
    const re =
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      words.push({
        xMin: Number(m[1]),
        yMin: Number(m[2]),
        xMax: Number(m[3]),
        yMax: Number(m[4]),
        text: m[5],
      });
    }
    return words;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * True when the rotated English watermark ("VOID", "DRAFT") is on the page. poppler extracts
 * rotated text either as one word or one glyph per word depending on the platform, so both are
 * accepted: word boxes where `pdftotext -bbox` exists (poppler), else the plain text with its
 * whitespace removed (xpdf has no -bbox).
 */
export async function hasEnglishStamp(pdf: Buffer, stamp: "VOID" | "DRAFT"): Promise<boolean> {
  try {
    const set = new Set((await pdfWords(pdf)).map((w) => w.text));
    return set.has(stamp) || stamp.split("").every((letter) => set.has(letter));
  } catch {
    return (await pdfToText(pdf)).replace(/\s+/g, "").includes(stamp);
  }
}
