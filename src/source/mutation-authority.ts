import type { SourceLocator } from './source-locator.js';

export interface SourceMutationAuthority {
  readonly locator: SourceLocator;
  isActive(): boolean;
}
