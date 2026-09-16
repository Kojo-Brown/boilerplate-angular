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
}
