import { createRoot } from "react-dom/client";
import App from "./App";
// Self-hosted fonts (Fontsource) — no external Google Fonts dependency, so the
// app never blocks on, nor leaks the user's IP to, a third-party CDN.
import "@fontsource/geist-sans/300.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa";

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker after the React app has mounted so the initial
// render isn't blocked by network registration.
if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void registerServiceWorker();
  });
}
