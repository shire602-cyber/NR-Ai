// Run with node tests/e2e/motion-search-width.mjs (optionally set CHROMIUM_PATH).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";

// Use the real button classes and compiled stylesheet without an authenticated server.
const app = await readFile("client/src/App.tsx", "utf8");
const classes = app.match(/data-testid="button-command-palette"[^>]+className="([^"]+)"/)?.[1];
assert.ok(classes, "desktop search button classes");
const button = `<button class="${classes}">Search</button>`;
const from = "client/src/index.css";
const config = loadConfig(resolve("tailwind.config.ts"));
const { css } = await postcss([
  tailwindcss({ ...config, content: [{ raw: button, extension: "html" }] }),
]).process(await readFile(from, "utf8"), { from });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(`<div style="display:flex">${button}</div>`);
  await page.addStyleTag({ content: css });
  const search = page.getByRole("button", { name: "Search" });
  const width = () => search.evaluate((el) => el.getBoundingClientRect().width);
  for (const [paused, reduced, expectedWidth] of [
    [false, "no-preference", 320],
    [true, "no-preference", 288],
    [false, "reduce", 288],
  ]) {
    await page.mouse.move(800, 600);
    await page.emulateMedia({ reducedMotion: reduced });
    await page.evaluate((off) => {
      if (off) document.documentElement.dataset.motion = "off";
      else delete document.documentElement.dataset.motion;
    }, paused);
    assert.equal(await width(), 288, "resting desktop width");
    await search.hover();
    await search.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished));
    });
    assert.equal(
      await width(),
      expectedWidth,
      `desktop hover width (pause=${paused}, OS=${reduced})`
    );
  }
} finally {
  await browser.close();
}
