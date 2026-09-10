/**
 * Where the API lives.
 *
 * **Until the split deployment there was no such question.** Fastify served the
 * built client and the API from one origin, so `fetch('/api/...')` and `io()`
 * both just worked, and `vite.config.ts` proxied `/api` and `/socket.io` in dev
 * specifically "so session cookies behave as they do in production".
 *
 * The client is on Netlify now and the API is on AWS, so they are different
 * origins and the client has to be told where to look.
 *
 * ------------------------------------------------------------------
 * Empty string is the correct default, and load-bearing
 * ------------------------------------------------------------------
 *
 * With `VITE_API_URL` unset this resolves to `''`, which makes every URL below
 * relative — exactly the old behaviour. That keeps `pnpm dev` working through
 * the Vite proxy with no extra configuration, keeps the test suite unaware of
 * deployment, and means a misconfigured production build fails by calling its
 * own origin (an obvious 404) rather than by silently reaching nothing.
 *
 * ------------------------------------------------------------------
 * Why the cookie still works across two origins
 * ------------------------------------------------------------------
 *
 * The session cookie is `httpOnly; sameSite=lax` (CLAUDE.md §8), and `Lax`
 * blocks **cross-site** requests, not cross-origin ones. Deploying the client
 * at `tillhaven.com` and the API at `api.tillhaven.com` keeps both on the same
 * registrable domain, so the browser considers them same-site and sends the
 * cookie on these requests unchanged.
 *
 * **This is the whole reason the apex-plus-subdomain layout was chosen.** On
 * `something.netlify.app` talking to an AWS URL the two are cross-site, the
 * cookie would need `SameSite=None`, and §8's CSRF posture would have to be
 * rebuilt with an explicit token. Keep the API on a subdomain of the site.
 */

/**
 * Absolute origin of the API, or `''` for "same origin as this page".
 *
 * Trailing slashes are trimmed so callers can always concatenate a path
 * beginning with `/` without producing a double slash — which some proxies
 * treat as a different route.
 */
export const API_ORIGIN: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Absolute URL for an API path, e.g. `apiUrl('/farm')`. */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}/api${path}`;
}

/**
 * What to hand Socket.IO.
 *
 * `undefined` rather than `''` on purpose: `io('')` is not the same as `io()`.
 * The no-argument form connects to the page's origin, which is what dev wants;
 * an empty string is a URL and Socket.IO does not treat it as "here".
 */
export function socketUrl(): string | undefined {
  return API_ORIGIN || undefined;
}
