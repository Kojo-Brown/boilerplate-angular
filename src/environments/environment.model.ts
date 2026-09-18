export interface Environment {
  production: boolean;
  apiUrl: string;
  googleClientId: string;

  /**
   * Where Core Web Vitals reports are POSTed, or `''` to keep them out of the network
   * entirely.
   *
   * Empty in both checked-in builds on purpose. A boilerplate has no collector to name,
   * and a default that guessed at one would send every downstream application's field
   * data somewhere its author never chose — the same call `HTTP_TELEMETRY_SINK` makes by
   * defaulting to a sink that discards. With this empty, `app.config.ts` wires the
   * console sink instead, which prints in development and is silent in production.
   *
   * The comparison against `''` is a build-time constant, so the branch not taken —
   * `createBeaconWebVitalsSink` or `consoleWebVitalsSink` — is dropped by the bundler
   * rather than shipped unused.
   */
  vitalsUrl: string;

  /**
   * Origin (and optional path prefix) of an image CDN, or `''` to serve images from this
   * application's own origin.
   *
   * Empty in both checked-in builds, for the reason `vitalsUrl` is: a boilerplate has no
   * CDN to name, and a default that guessed at one would route every downstream
   * application's images through somewhere its author never chose.
   *
   * With this empty, `provideAppImageLoader` provides *nothing* rather than a pass-through
   * loader — `NgOptimizedImage` compares the injected loader against its own no-op by
   * identity to decide whether a `srcset` is worth emitting, so a pass-through would make
   * it advertise density variants that are all the same file. `docs/images.md` has the
   * whole finding. The comparison against `''` is a build-time constant, so a build with no
   * CDN configured drops `createImageLoader` rather than shipping it unused.
   */
  imageCdnUrl: string;
}
