import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Multi-page app. Four HTML entries, one per route (CLAUDE.md §2 — no heavy
 * framework for the canvas; Phaser only loads on /play).
 */
const PAGES = {
  index: 'index.html',
  login: 'login.html',
  register: 'register.html',
  play: 'play.html',
  terms: 'terms.html',
  privacy: 'privacy.html',
} as const;

/**
 * Serve `/login` as `/login.html` in dev.
 *
 * Vite's dev server only resolves the `.html` path, but production URLs are
 * extensionless (Fastify maps them in apps/server/src/app.ts). Without this the
 * two environments disagree about what a route looks like, which is exactly the
 * kind of drift that gets discovered at deploy time.
 */
function extensionlessRoutes(): Plugin {
  // Mirrors the PAGES map in apps/server/src/app.ts. Keep the two in step.
  const routes = new Map<string, string>([
    ['/login', '/login.html'],
    ['/register', '/register.html'],
    ['/play', '/play.html'],
    ['/terms', '/terms.html'],
    ['/privacy', '/privacy.html'],
  ]);

  return {
    name: 'tillhaven:extensionless-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          const [path, query] = req.url.split('?');
          const mapped = routes.get(path ?? '');
          if (mapped) req.url = query ? `${mapped}?${query}` : mapped;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [extensionlessRoutes()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so session cookies behave as they do in production.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    // Phaser is ~1.4MB and lands in the /play chunk alone. That is the accepted
    // cost of a game engine, and it never reaches the landing or auth pages —
    // which is the point of the MPA split. Raised so the warning stays
    // meaningful for chunks we can actually do something about.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: Object.fromEntries(
        Object.entries(PAGES).map(([name, file]) => [name, resolve(__dirname, file)]),
      ),
    },
  },
});
