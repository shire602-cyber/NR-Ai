/** Wait for the existing crawl text threshold so loading skeletons are not sampled as pages. */
export async function waitForRouteText(page, selector, fallbackSelector) {
  const readText = ({ selector, fallbackSelector, wait }) => {
    const text =
      document.querySelector(selector)?.innerText ||
      (fallbackSelector && document.querySelector(fallbackSelector)?.innerText) ||
      "";
    return wait && text.trim().length < 40 ? false : text;
  };
  const scope = { selector, fallbackSelector };
  const ready = await page
    .waitForFunction(readText, { ...scope, wait: true }, { timeout: 15000 })
    .catch(() => null);
  if (ready) return ready.jsonValue();
  return page.evaluate(readText, scope).catch(() => "");
}
