// @vitest-environment jsdom
/**
 * Retry of an on-demand dialog chunk: the fresh-URL helpers, the build step that turns a page's
 * marker into the emitted chunk path, and the hook handing every import after the first a fresh
 * token (including the loader's automatic second try and each manual Retry). The URL is never
 * taken from an error message.
 */
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DIALOG_RETRY_PARAM, freshChunkUrl, retryToken } from "../../client/src/lib/dialogChunk";
import { useOnDemandDialog } from "../../client/src/components/team/useOnDemandDialog";
import {
  dialogChunkUrls,
  findDialogImport,
  relativeChunkPath,
  replaceDialogMarkers,
} from "../../scripts/vite/dialog-chunk-urls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("freshChunkUrl", () => {
  const base = "https://app.example/assets/PermissionsMatrixDialog-AbC123.js";
  it("keeps the hashed path and changes the query for every attempt", () => {
    const one = new URL(freshChunkUrl(base, retryToken(1, 10)));
    const two = new URL(freshChunkUrl(base, retryToken(2, 10)));
    expect(one.pathname).toBe("/assets/PermissionsMatrixDialog-AbC123.js");
    expect(one.searchParams.get(DIALOG_RETRY_PARAM)).not.toBe(
      two.searchParams.get(DIALOG_RETRY_PARAM)
    );
  });
  it("resolves against the page chunk's own URL", () => {
    const page = "https://app.example/assets/TeamManagement-Zz9.js";
    const url = new URL("./PermissionsMatrixDialog-AbC123.js", page);
    expect(freshChunkUrl(url, "1-a")).toBe(`${base}?${DIALOG_RETRY_PARAM}=1-a`);
  });
});

describe("dialog-chunk-urls build step", () => {
  const page = {
    fileName: "assets/TeamManagement-!~{003}~.js",
    dynamicImports: ["assets/PermissionsMatrixDialog-!~{004}~.js", "assets/Other-!~{005}~.js"],
  };
  const code = 'a("__MUHASIB_DIALOG_CHUNK__PermissionsMatrixDialog__")';

  it("uses POSIX relative paths, also for the firm-assets folder and nested files", () => {
    expect(relativeChunkPath("assets/a.js", "assets/b-1.js")).toBe("./b-1.js");
    expect(relativeChunkPath("firm-assets/a.js", "firm-assets/b-1.js")).toBe("./b-1.js");
    expect(relativeChunkPath("assets/x/a.js", "assets/b-1.js")).toBe("../b-1.js");
  });

  it("replaces the marker with the page's own dynamic import (placeholder hash kept)", () => {
    expect(replaceDialogMarkers(code, page)).toBe('a("./PermissionsMatrixDialog-!~{004}~.js")');
  });

  it("prefers the facade module when the bundler reports it", () => {
    const chunk = { fileName: "assets/P-1.js", dynamicImports: ["assets/x-1.js", "assets/y-2.js"] };
    const meta = {
      "assets/x-1.js": { facadeModuleId: "C:\\app\\client\\src\\components\\team\\Other.tsx" },
      "assets/y-2.js": { facadeModuleId: "/app/client/src/components/team/InviteClientDialog.tsx" },
    };
    expect(findDialogImport(chunk, "InviteClientDialog", meta)).toBe("assets/y-2.js");
  });

  it("leaves chunks without a marker alone and fails the build when the target is missing", () => {
    expect(replaceDialogMarkers("nothing here", page)).toBeNull();
    expect(() =>
      replaceDialogMarkers('"__MUHASIB_DIALOG_CHUNK__InviteClientDialog__"', page)
    ).toThrow(/InviteClientDialog/);
    expect(() =>
      replaceDialogMarkers(code, {
        ...page,
        dynamicImports: [
          "assets/PermissionsMatrixDialog-1.js",
          "assets/PermissionsMatrixDialog-2.js",
        ],
      })
    ).toThrow(/2 matching chunks/);
  });

  it("is a build-only renderChunk plugin", () => {
    const plugin = dialogChunkUrls();
    expect(plugin.apply).toBe("build");
    expect(typeof plugin.renderChunk).toBe("function");
  });
});

describe("useOnDemandDialog supplies fresh tokens", () => {
  it("first import is plain; the automatic retry and every manual Retry get distinct fresh tokens", async () => {
    const seen: Array<string | null> = [];
    let request!: () => void;
    let fail = true;
    const Dummy = () => null;
    const load = async (retry: string | null) => {
      seen.push(retry);
      if (fail) throw new TypeError("Importing a module script failed.");
      return { default: Dummy };
    };
    function Probe() {
      request = useOnDemandDialog(load, "ProbeDialog").request;
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(Probe)));

    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 600));
      });
    await act(async () => request());
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeNull();
    expect(seen[1]).toEqual(expect.any(String));

    fail = false;
    await act(async () => request());
    await settle();
    expect(seen).toHaveLength(3);
    expect(new Set(seen.slice(1)).size).toBe(2);
    expect(seen[2]).toEqual(expect.any(String));
    act(() => root.unmount());
  });
});
