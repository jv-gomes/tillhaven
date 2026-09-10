/// <reference types="vite/client" />

/**
 * The build-time environment this client actually reads.
 *
 * `vite/client` already declares `ImportMetaEnv` with an `[key: string]: any`
 * index signature, so `import.meta.env.VITE_API_URL` would compile without this
 * file — as `any`, which CLAUDE.md §10 does not allow without a justification,
 * and which would equally happily compile `VITE_API_UR`. Declaring the variable
 * makes a typo a type error and gives the one place that reads it a real type.
 *
 * Only `VITE_*` names reach the bundle; anything else in the environment stays
 * on the build machine. That is Vite's rule and it is the reason no secret can
 * be read from here — see CLAUDE.md §8.
 */
interface ImportMetaEnv {
  /**
   * Absolute origin of the API, e.g. `https://api.tillhaven.com`.
   *
   * Unset in development, where the Vite proxy makes `/api` and `/socket.io`
   * same-origin. Read only by `src/net/origin.ts`.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
