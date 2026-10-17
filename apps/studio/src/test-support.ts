import type { DocumentChannel } from './documents/changes';

/** A document channel that drops everything (component tests do not need cross-tab notices). */
export const NO_CHANNEL: DocumentChannel = { post: () => undefined, subscribe: () => () => undefined };
