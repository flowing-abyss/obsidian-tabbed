import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { gridTrackList, normalizeColumnWeights } from '../columns/column-layout.js';
import type { ParsedColumnsDocument } from '../columns/column-model.js';
import { literalColumnsDocument, parseColumnsSource } from '../columns/column-parser.js';
import { formatError, logError } from '../diagnostics.js';
import { ColumnBody } from './column-body.js';
import { renderMarkdown, type RenderMarkdown } from './markdown-renderer.js';
import { RenderScope } from './render-scope.js';

let nextInstanceId = 0;

interface RenderOperation {
  readonly scope: RenderScope;
  readonly columnEl: HTMLElement;
  readonly target: HTMLElement;
  readonly markdown: string;
  readonly index: number;
  readonly kind: 'title' | 'body';
  readonly render: () => Promise<void>;
}

export class ColumnsBlock extends MarkdownRenderChild {
  private readonly app: App;
  private readonly context: MarkdownPostProcessorContext;
  private readonly renderer: RenderMarkdown;
  private readonly parsedDocument: ParsedColumnsDocument;
  private readonly rootEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly instanceId = ++nextInstanceId;
  private generation = 0;

  constructor(
    ...[
      app,
      containerEl,
      source,
      context,
      renderer = renderMarkdown,
      parser = parseColumnsSource,
    ]: [
      App,
      HTMLElement,
      string,
      MarkdownPostProcessorContext,
      RenderMarkdown?,
      typeof parseColumnsSource?,
    ]
  ) {
    super(containerEl);
    this.app = app;
    this.context = context;
    this.renderer = renderer;
    this.parsedDocument = this.parseDocument(source, parser);
    this.rootEl = containerEl.createDiv({
      cls: 'tabbed-columns',
      attr: { role: 'region', 'aria-label': 'Columns', tabindex: '0' },
    });
    this.gridEl = this.rootEl.createDiv({ cls: 'tabbed-columns__grid' });
  }

  override onload(): void {
    this.gridEl.style.gridTemplateColumns = gridTrackList(
      normalizeColumnWeights(this.parsedDocument.columns.map((column) => column.weight)),
    );
    this.parsedDocument.columns.forEach((column, index) => {
      const columnEl = this.gridEl.createDiv({ cls: 'tabbed-columns__column' });
      if (column.title.trim() !== '') {
        const title = columnEl.createDiv({
          cls: 'tabbed-columns__title',
          attr: { id: `tabbed-columns-${this.instanceId}-title-${index}` },
        });
        columnEl.setAttribute('role', 'group');
        columnEl.setAttribute('aria-labelledby', title.id);
        const scope = this.addChild(new RenderScope());
        this.renderOperation({
          scope,
          columnEl,
          target: title,
          markdown: column.title,
          index,
          kind: 'title',
          render: () =>
            this.renderer(this.app, column.title, title, this.context.sourcePath, scope),
        });
      }
      const target = columnEl.createDiv({ cls: 'tabbed-columns__content' });
      const body = this.addChild(
        new ColumnBody(this.app, target, column.content, this.context.sourcePath, this.renderer),
      );
      this.renderOperation({
        scope: body,
        columnEl,
        target,
        markdown: column.content,
        index,
        kind: 'body',
        render: () => body.render(),
      });
    });
  }

  override onunload(): void {
    this.generation += 1;
    this.rootEl.remove();
  }

  private parseDocument(source: string, parser: typeof parseColumnsSource): ParsedColumnsDocument {
    try {
      return parser(source);
    } catch (error) {
      logError('Could not parse columns block', {
        path: this.context.sourcePath,
        cause: formatError(error),
      });
      return literalColumnsDocument(source);
    }
  }

  private renderOperation(operation: RenderOperation): void {
    const generation = this.generation;
    const render = async (): Promise<void> => {
      await operation.render();
      if (generation !== this.generation) {
        this.closeScope(operation.scope);
      }
    };
    render().catch((error: unknown) => {
      const current = generation === this.generation && !operation.scope.isClosed;
      this.closeScope(operation.scope);
      if (current && generation === this.generation) {
        this.replaceFailedTarget(operation);
        logError(`Could not render column ${operation.kind}`, {
          path: this.context.sourcePath,
          index: operation.index,
          cause: formatError(error),
        });
      }
    });
  }

  private closeScope(scope: RenderScope): void {
    try {
      this.removeChild(scope);
    } catch {
      // Third-party cleanup must not interrupt fallback or replace the render diagnostic.
      // RenderScope marks itself closed before invoking registered cleanup.
    }
  }

  private replaceFailedTarget({ columnEl, target, kind, markdown, index }: RenderOperation): void {
    target.remove();
    const replacement = createDiv({
      cls: kind === 'title' ? 'tabbed-columns__title' : 'tabbed-columns__content',
    });
    if (kind === 'title') {
      replacement.id = `tabbed-columns-${this.instanceId}-title-${index}`;
      replacement.setText(markdown);
      columnEl.prepend(replacement);
    } else {
      replacement.createEl('pre', { cls: 'tabbed-columns__fallback', text: markdown });
      columnEl.append(replacement);
    }
  }
}
