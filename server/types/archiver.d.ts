// archiver 5 ships no types; only the surface the company export uses is declared.
declare module "archiver" {
  import type { Readable } from "node:stream";
  interface Archiver extends Readable {
    append(source: Buffer | string | Readable, data: { name: string; date?: Date }): this;
    finalize(): Promise<void>;
    on(event: "warning" | "error", listener: (err: Error) => void): this;
    on(event: "end" | "finish" | "close", listener: () => void): this;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    pointer(): number;
  }
  function archiver(format: "zip", options?: { zlib?: { level?: number } }): Archiver;
  export = archiver;
}
