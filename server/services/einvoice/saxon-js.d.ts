// Minimal typing for the parts of saxon-js used by the e-invoice validator.
declare module "saxon-js" {
  interface TransformOptions {
    stylesheetInternal?: unknown;
    stylesheetFileName?: string;
    sourceText?: string;
    destination?: "serialized" | "raw" | "document";
  }
  interface TransformResult {
    principalResult: string;
  }
  const SaxonJS: {
    transform(options: TransformOptions, mode: "sync"): TransformResult;
  };
  export default SaxonJS;
}
