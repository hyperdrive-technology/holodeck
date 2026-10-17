/**
 * @holodeck/provider-http: the `holodeck.http` provider (README.md; contract:
 * @holodeck/sdk docs/PACKAGING.md §6). Pure TypeScript, no React; runs in
 * browsers and Node ≥ 22 (global fetch, WebSocket, TextDecoderStream).
 */

export { createHttpProvider, HTTP_PROVIDER_ID, HTTP_SOURCE_SYNTAX, MAX_BROWSE_CHILDREN, type HttpProviderOptions } from './provider';
export {
  HTTP_CONFIG_SCHEMA,
  HTTP_DEFAULTS,
  HTTP_MODES,
  HTTP_PROVIDER_SECRETS,
  HttpConfigError,
  MIN_INTERVAL_MS,
  parseHttpConfig,
  type BackoffConfig,
  type HttpAuth,
  type HttpConnectionConfig,
  type HttpMode,
  type WriteBody,
  type WriteConfig,
} from './config';
export {
  formatPointer,
  formatSource,
  lookup,
  MAX_SOURCE_LENGTH,
  parseSelector,
  parseSource,
  SourceSyntaxError,
  type Lookup,
  type ParsedSource,
  type SelectorToken,
} from './selector';
export { backoffDelay } from './backoff';
export { HttpProviderError, type FailureKind } from './http';
export { REDACTED } from './redact';
export type { WebSocketFactory, WebSocketLike } from './channels';
export {
  createHttpProviderExtension,
  createHttpProviderPackage,
  HTTP_PACKAGE_MANIFEST,
  httpProviderPackage,
  type HttpProviderPackage,
} from './holodeck-package';
