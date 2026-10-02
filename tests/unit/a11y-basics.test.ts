import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { scanSource } from "../../scripts/check-a11y-basics.mjs";

const messages = (src: string): string[] => scanSource(src).map((f: { message: string }) => f.message);

describe("a11y basics scanner", () => {
  it("flags an img without alt", () => {
    expect(messages('<img src="/a.png" className="x" />')).toEqual(["<img> without alt"]);
  });

  it("accepts an img with alt, including an empty one", () => {
    expect(messages('<img src="/a.png" alt="Logo" />')).toEqual([]);
    expect(messages('<img src={url} alt="" />')).toEqual([]);
  });

  it("is not fooled by arrow functions inside attributes", () => {
    expect(messages('<img src={a} onLoad={() => setOk(true)} />')).toEqual(["<img> without alt"]);
    expect(messages('<img src={a} onLoad={() => setOk(true)} alt="x" />')).toEqual([]);
  });

  it("flags an icon-only button", () => {
    expect(messages('<Button size="icon" onClick={go}><Trash2 className="h-4 w-4" /></Button>')).toEqual(["icon-only button without aria-label"]);
    expect(messages("<button type=\"button\"><X className=\"h-3\" /></button>")).toEqual(["icon-only button without aria-label"]);
  });

  it("accepts a button named by aria-label, title, text or an expression", () => {
    expect(messages('<Button aria-label="Delete"><Trash2 /></Button>')).toEqual([]);
    expect(messages('<Button title={tr("view")}><Eye /></Button>')).toEqual([]);
    expect(messages("<Button><Plus />Add</Button>")).toEqual([]);
    expect(messages("<Button><Plus />{tr('add')}</Button>")).toEqual([]);
  });

  it("treats a spread or a bare expression as unnamed unless there is an aria-label", () => {
    const unnamed = ["icon-only button without aria-label"];
    expect(messages('<Button {...props}><X /></Button>')).toEqual(unnamed);
    expect(messages('<Button size="icon">{icon}</Button>')).toEqual(unnamed);
    expect(messages('<Button size="icon">{open ? <X /> : <Menu />}</Button>')).toEqual(unnamed);
    expect(messages('<Button size="icon">{mode === "a" ? <X /> : <Menu />}</Button>')).toEqual(unnamed);
    expect(messages('<Button aria-label="Close" {...props}><X /></Button>')).toEqual([]);
  });

  it("still accepts expressions that produce words", () => {
    expect(messages("<Button><Plus />{action.cta}</Button>")).toEqual([]);
    expect(messages("<Button><Mail />{isLoading ? t.loading : t.send}</Button>")).toEqual([]);
    expect(messages('<Button>{busy ? (<><Loader2 className="a" />{tr("sending")}</>) : (<><Mail />{tr("send")}</>)}</Button>')).toEqual([]);
  });

  it("accepts an icon plus a screen-reader-only label", () => {
    expect(messages('<Button><X /><span className="sr-only">Close</span></Button>')).toEqual([]);
  });

  it("honours an a11y-ignore comment with a reason", () => {
    expect(messages('{/* a11y-ignore: decorative */}\n<img src="/a.png" />')).toEqual([]);
  });

  it("reports the line number", () => {
    const found = scanSource('const a = 1;\n\n<img src="/x" />');
    expect(found[0].line).toBe(3);
  });
});
