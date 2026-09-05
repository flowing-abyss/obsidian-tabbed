export type ColumnsLayoutMode = 'scroll' | 'stack';

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface ExplicitColumn {
  readonly kind: 'explicit';
  readonly range: SourceRange;
  readonly headerRange: SourceRange;
  readonly titleRange: SourceRange;
  readonly weightRange?: SourceRange;
  readonly contentRange: SourceRange;
  readonly title: string;
  readonly weight: number;
  readonly content: string;
}

export interface VirtualColumn {
  readonly kind: 'virtual';
  readonly range: SourceRange;
  readonly title: '';
  readonly weight: 1;
  readonly content: string;
}

export type ParsedColumn = ExplicitColumn | VirtualColumn;

export interface ParsedColumnsDocument {
  readonly source: string;
  readonly preambleRange: SourceRange;
  readonly preamble: string;
  readonly layout: ColumnsLayoutMode;
  readonly columns: readonly ParsedColumn[];
  readonly preferredLineEnding: '\n' | '\r\n';
}
