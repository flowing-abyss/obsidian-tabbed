import type { TabbedSettings } from '../settings.js';

export type LineEnding = '\n' | '\r\n';
export type FenceMarker = '`' | '~';

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface EffectiveTabsOptions {
  readonly position: TabbedSettings['titlePosition'];
  readonly lineMode: TabbedSettings['titleLineMode'];
  readonly action: TabbedSettings['action'];
}

export interface TabsSyntaxSnapshot {
  readonly separator: string;
  readonly defaultTitle: string;
  readonly defaultContent: string;
  readonly defaultOptions: EffectiveTabsOptions;
}

export interface ExplicitTab {
  readonly kind: 'explicit';
  readonly range: SourceRange;
  readonly headerRange: SourceRange;
  readonly titleRange: SourceRange;
  readonly contentRange: SourceRange;
  readonly title: string;
  readonly content: string;
}

export interface VirtualTab {
  readonly kind: 'virtual';
  readonly reason: 'empty' | 'missing-separator';
  readonly range: SourceRange;
  readonly title: string;
  readonly content: string;
}

export type ParsedTab = ExplicitTab | VirtualTab;

export interface ParsedTabsDocument {
  readonly source: string;
  readonly syntax: TabsSyntaxSnapshot;
  readonly preambleRange: SourceRange;
  readonly preamble: string;
  readonly options: EffectiveTabsOptions;
  readonly tabs: readonly ParsedTab[];
  readonly preferredLineEnding: LineEnding;
}

export interface FenceDescriptor {
  readonly marker: FenceMarker;
  readonly length: number;
}

export interface FullTabsBlock {
  readonly source: string;
  readonly fence: FenceDescriptor;
  readonly closingFenceLength: number;
  readonly openingMarkerRange: SourceRange;
  readonly contentRange: SourceRange;
  readonly closingMarkerRange: SourceRange;
  readonly document: ParsedTabsDocument;
}

export interface TabDraft {
  readonly title: string;
  readonly content: string;
}

export type TabOperationFailure =
  | { readonly ok: false; readonly code: 'invalid-tab-index'; readonly index: number }
  | { readonly ok: false; readonly code: 'invalid-insertion-index'; readonly index: number }
  | { readonly ok: false; readonly code: 'invalid-title' };

export type TabOperationResult =
  { readonly ok: true; readonly document: ParsedTabsDocument } | TabOperationFailure;
