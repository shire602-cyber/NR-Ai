import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa";

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker after the React app has mounted so the initial
// render isn't blocked by network registration.
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}
