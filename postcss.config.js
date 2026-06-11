import autoprefixer from "autoprefixer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const postcssFrom = new URL("./client/src/index.css", import.meta.url).pathname;

function withParseFrom(plugin) {
  if (!Array.isArray(plugin.plugins)) return plugin;

  return {
    ...plugin,
    plugins: plugin.plugins.map((innerPlugin) => async (...args) => {
      const originalParse = postcss.parse;
      postcss.parse = (css, options) =>
        originalParse(css, {
          ...(options ?? {}),
          from: options?.from ?? postcssFrom,
        });

      try {
        return await innerPlugin(...args);
      } finally {
        postcss.parse = originalParse;
      }
    }),
  };
}

function sourceFallback() {
  return {
    postcssPlugin: "muhasib-postcss-source-fallback",
    Once(root) {
      const source = root.source?.input?.file ? root.source : undefined;
      if (!source) return;

      root.walk((node) => {
        if (!node.source?.input?.file) node.source = source;
      });
    },
  };
}

export default {
  plugins: [
    withParseFrom(tailwindcss({ config: "./tailwind.config.ts" })),
    sourceFallback(),
    autoprefixer(),
  ],
};
