import { createApp } from "./app";
import { serveStatic } from "./vite";

const app = await createApp({ vercel: true });
serveStatic(app);

export default app;
