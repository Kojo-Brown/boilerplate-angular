export { createSignalStore } from './signal-store';
export type {
  SignalStore,
  SignalStoreOptions,
  StoreEvent,
  StoreEventKind,
  Transition,
} from './signal-store';

// `connectDevtools` is deliberately *not* re-exported here. It is reached through a
// dynamic `import('./devtools')` so that it lands in its own lazy chunk; pulling it into
// the barrel would put it back in whatever chunk imports `createSignalStore`, which is
// the initial one. The types are safe to export — they erase at compile time.
export type {
  DevtoolsMessage,
  DevtoolsOptions,
  ReduxDevtoolsConnection,
  ReduxDevtoolsExtension,
} from './devtools';
