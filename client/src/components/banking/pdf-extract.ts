// Browser-side text extraction for a PDF statement: the text layer through pdf.js, OCR (Tesseract) only for a page
// that has none. The text goes to the server, which parses and stages it; the server never reads the PDF itself.

export const MAX_PDF_PAGES = 10;
const MIN_TEXT_LAYER_CHARS = 50;

export interface PdfProgress {
  page: number;
  total: number;
  ocr: boolean;
}

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  pdfJsPromise ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfJsPromise;
}

async function pageToImage(page: any): Promise<Blob> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvasContext: context, viewport, canvas } as any).promise;
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/png"));
}

export async function extractPdfPages(file: File, onProgress: (p: PdfProgress) => void): Promise<{ pages: string[]; totalPages: number }> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pages: string[] = [];
  for (let n = 1; n <= count; n++) {
    onProgress({ page: n, total: count, ocr: false });
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = content.items.map((i: any) => i.str).join(" ");
    if (text.trim().length < MIN_TEXT_LAYER_CHARS) {
      onProgress({ page: n, total: count, ocr: true });
      const { default: Tesseract } = await import("tesseract.js");
      const result = await Tesseract.recognize(await pageToImage(page), "eng");
      text = result.data.text;
    }
    pages.push(text);
  }
  return { pages, totalPages: pdf.numPages };
}

/** The file as base64 (no data: prefix), for the upload body. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const isPdfFile = (file: File): boolean => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
