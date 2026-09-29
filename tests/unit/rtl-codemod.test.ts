import { describe, it, expect } from "vitest";
// @ts-expect-error - plain .mjs script
import { logicalClasses, transform } from "../../scripts/rtl-codemod.mjs";

describe("logicalClasses", () => {
  it("swaps margin, padding, alignment and position utilities", () => {
    expect(logicalClasses("flex ml-2 mr-4 pl-3 pr-1 text-left")).toBe("flex ms-2 me-4 ps-3 pe-1 text-start");
    expect(logicalClasses("absolute right-0 left-2 text-right")).toBe("absolute end-0 start-2 text-end");
  });
  it("keeps variants, important and negative prefixes", () => {
    expect(logicalClasses("md:ml-4 hover:!pr-2 -mr-1 sm:-left-3")).toBe("md:ms-4 hover:!pe-2 -me-1 sm:-start-3");
  });
  it("converts borders and radii", () => {
    expect(logicalClasses("border-l border-r-2 rounded-l-md rounded-tr-lg")).toBe(
      "border-s border-e-2 rounded-s-md rounded-se-lg"
    );
  });
  it("leaves the left-1/2 centring trick and unrelated strings alone", () => {
    expect(logicalClasses("absolute left-1/2 -translate-x-1/2 ml-2")).toBe("absolute left-1/2 -translate-x-1/2 ms-2");
    expect(logicalClasses("Please choose the left option")).toBe("Please choose the left option");
    expect(logicalClasses("left")).toBe("left");
  });
  it("does not touch words that merely contain the letters", () => {
    expect(logicalClasses("mrs-plan pleft-x")).toBe("mrs-plan pleft-x");
  });
});

describe("transform", () => {
  it("rewrites className strings, cn() arguments and template literals", () => {
    const src = `export const A = () => <div className={cn("ml-2 text-left", open && "pr-4", \`mr-\${n} pl-2\`)} />;`;
    const { out, changes } = transform(src);
    expect(changes).toBe(4);
    expect(out).toContain('"ms-2 text-start"');
    expect(out).toContain('"pe-4"');
    expect(out).toContain("`me-${n} ps-2`");
  });
  it("adds dir=ltr to font-mono elements only", () => {
    const { out } = transform(`const A = () => <><span className="font-mono text-xs">{n}</span><td className="font-mono text-right">{n}</td></>;`);
    expect(out).toContain('<span dir="ltr" className="font-mono text-xs">');
    expect(out).not.toContain('<td dir="ltr"');
  });
  it("is idempotent", () => {
    const once = transform(`const A = () => <div className="ml-2 font-mono" />;`).out;
    expect(transform(once).changes).toBe(0);
  });
});
