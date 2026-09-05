import { Component, type MarkdownPostProcessorContext } from 'obsidian';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { parseColumnsSource } from '../columns/column-parser.js';
import { ColumnBody } from './column-body.js';
import { ColumnsBlock } from './columns-block.js';
import type { RenderMarkdown } from './markdown-renderer.js';
import { RenderScope } from './render-scope.js';

function context(): MarkdownPostProcessorContext {
  return {
    sourcePath: 'Note.md',
    docId: 'doc',
    frontmatter: null,
    addChild: vi.fn(),
    getSectionInfo: vi.fn(() => null),
  };
}

function createBlock(
  source: string,
  renderer: RenderMarkdown,
  parser: typeof parseColumnsSource = parseColumnsSource,
) {
  const app = App.createConfigured__().asOriginalType__();
  const container = document.body.createDiv();
  const block = new ColumnsBlock(app, container, source, context(), renderer, parser);
  block.load();
  return { app, block, container };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

function element(parent: ParentNode, selector: string): HTMLElement {
  const result = parent.querySelector<HTMLElement>(selector);
  if (result === null) throw new Error(`Missing test element: ${selector}`);
  return result;
}

describe('ColumnsBlock visible rendering', () => {
  it('renders ordered column Markdown and unique dedicated scopes without chrome', async () => {
    const renderer = vi.fn<RenderMarkdown>(async (_app, markdown, target) => {
      if (markdown === '**Right**') target.createEl('strong', { text: 'Right' });
      else if (markdown.trim() === '*left body*')
        target.createEl('em', { text: markdown.trim().slice(1, -1) });
      else target.setText(markdown);
      await Promise.resolve();
    });
    const { app, container, block } = createBlock(
      'column:\nweight: 3\n*left body*\ncolumn: **Right**\nweight: 1\nright body',
      renderer,
    );
    await settle();

    const root = element(container, '.tabbed-columns');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('Columns');
    expect(root.tabIndex).toBe(0);
    const grid = element(root, ':scope > .tabbed-columns__grid');
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(var(--tabbed-column-min-width), 1.5fr) minmax(var(--tabbed-column-min-width), 0.5fr)',
    );
    const columns = grid.querySelectorAll(':scope > .tabbed-columns__column');
    expect(columns).toHaveLength(2);
    const left = element(grid, ':scope > :nth-child(1)');
    const right = element(grid, ':scope > :nth-child(2)');
    expect(element(left, '.tabbed-columns__content em').textContent).toBe('left body');
    expect(left.hasAttribute('role')).toBe(false);
    expect(left.hasAttribute('aria-labelledby')).toBe(false);
    const title = element(right, '.tabbed-columns__title');
    expect(element(title, 'strong').textContent).toBe('Right');
    expect(right.getAttribute('role')).toBe('group');
    expect(right.getAttribute('aria-labelledby')).toBe(title.id);
    expect(container.querySelectorAll('.tabbed-columns__title')).toHaveLength(1);
    expect(
      container.querySelector('button, [role="tab"], [role="tablist"], .tabbed__action'),
    ).toBeNull();
    expect(renderer).toHaveBeenCalledTimes(3);
    expect(new Set(renderer.mock.calls.map((call) => call[4])).size).toBe(3);
    expect(new Set(renderer.mock.calls.map((call) => call[2])).size).toBe(3);
    for (const [renderApp, markdown, target, path, scope] of renderer.mock.calls) {
      expect(renderApp).toBe(app);
      expect(path).toBe('Note.md');
      expect(scope).toBeInstanceOf(RenderScope);
      if (markdown === '**Right**') expect(target).toBe(title);
      else {
        expect(scope).toBeInstanceOf(ColumnBody);
        expect((scope as ColumnBody).contentEl).toBe(target);
      }
    }
    expect(renderer.mock.calls.map((call) => call[1])).toEqual([
      '*left body*\n',
      '**Right**',
      'right body',
    ]);
    block.unload();
  });

  it.each(['column:', 'column:   '])('omits every title node for %j', async (header) => {
    const { container, block } = createBlock(
      `${header}\nbody`,
      vi.fn<RenderMarkdown>().mockResolvedValue(undefined),
    );
    await settle();
    expect(container.querySelector('.tabbed-columns__title')).toBeNull();
    expect(container.querySelector('[role="group"], [aria-labelledby]')).toBeNull();
    block.unload();
  });

  it('uses distinct accessible title ids across adjacent blocks', async () => {
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const first = createBlock('column: Same\nbody', renderer);
    const second = createBlock('column: Same\nbody', renderer);
    await settle();
    const ids = [first, second].map(
      ({ container }) => container.querySelector('.tabbed-columns__title')?.id,
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    first.block.unload();
    second.block.unload();
  });
});

class CleanupChild extends Component {
  readonly cleanup = vi.fn();

  override onload(): void {
    this.register(this.cleanup);
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ColumnsBlock failure isolation', () => {
  it('recovers parser exceptions with the complete literal source and one diagnostic', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notice = vi.spyOn(Notice.prototype, 'constructor__');
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const source = 'column: Named\n<script>literal</script>';
    const { block, container, app } = createBlock(source, renderer, () => {
      throw new Error('parser failed');
    });
    await settle();

    expect(renderer).toHaveBeenCalledExactlyOnceWith(
      app,
      source,
      expect.any(HTMLElement),
      'Note.md',
      expect.any(ColumnBody),
    );
    expect(container.querySelectorAll('.tabbed-columns__column')).toHaveLength(1);
    expect(container.querySelector('.tabbed-columns__title')).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not parse columns block', {
      path: 'Note.md',
      cause: 'parser failed',
    });
    expect(notice).not.toHaveBeenCalled();
    block.unload();
  });

  it.each(['title', 'body'] as const)(
    'replaces only a failed %s target and closes current and late resources',
    async (kind) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const operation = deferred();
      const original = '<img src=x> *source*';
      const currentCleanup = vi.fn();
      const currentChild = new CleanupChild();
      let failedTarget!: HTMLElement;
      let failedScope!: RenderScope;
      const renderer = vi.fn<RenderMarkdown>(async (...[, markdown, target, , component]) => {
        if (markdown === original) {
          failedTarget = target;
          failedScope = component as RenderScope;
          target.createDiv({ text: 'partial DOM' });
          component.register(currentCleanup);
          component.addChild(currentChild);
          await operation.promise;
        } else target.setText(markdown);
      });
      const source =
        kind === 'title'
          ? `column: ${original}\nfirst body\ncolumn: Good\ngood body`
          : `column: Good\ngood body\ncolumn: Failed\n${original}`;
      const { block, container } = createBlock(source, renderer);
      const sibling = element(
        container,
        `.tabbed-columns__column:nth-child(${kind === 'title' ? 2 : 1})`,
      );
      const siblingHtml = sibling.innerHTML;

      operation.reject(new Error(`${kind} failed`));
      await settle();
      await settle();

      const column = element(
        container,
        `.tabbed-columns__column:nth-child(${kind === 'title' ? 1 : 2})`,
      );
      const replacement = element(
        column,
        kind === 'title' ? '.tabbed-columns__title' : '.tabbed-columns__content',
      );
      expect(replacement).not.toBe(failedTarget);
      expect(failedTarget.isConnected).toBe(false);
      expect(replacement.textContent).toBe(original);
      expect(replacement.querySelector('img')).toBeNull();
      expect(replacement.querySelector('.tabbed-columns__fallback')?.textContent).toBe(
        kind === 'body' ? original : undefined,
      );
      if (kind === 'title') expect(column.getAttribute('aria-labelledby')).toBe(replacement.id);
      expect(currentCleanup).toHaveBeenCalledOnce();
      expect(currentChild.cleanup).toHaveBeenCalledOnce();
      expect(failedScope.isClosed).toBe(true);
      const fallbackHtml = replacement.outerHTML;
      failedTarget.setText('Late mutation');
      const lateCleanup = vi.fn();
      const lateChild = new CleanupChild();
      failedScope.register(lateCleanup);
      failedScope.addChild(lateChild);
      expect(lateCleanup).toHaveBeenCalledOnce();
      expect(lateChild.cleanup).toHaveBeenCalledOnce();
      expect(replacement.outerHTML).toBe(fallbackHtml);
      expect(sibling.innerHTML).toBe(siblingHtml);
      expect(log).toHaveBeenCalledExactlyOnceWith(`[tabbed] Could not render column ${kind}`, {
        path: 'Note.md',
        index: kind === 'title' ? 0 : 1,
        cause: `${kind} failed`,
      });
      expect(notice).not.toHaveBeenCalled();
      block.unload();
      expect(container.childElementCount).toBe(0);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'silently closes every stale scope after unload and late %s',
    async (completion) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const notice = vi.spyOn(Notice.prototype, 'constructor__');
      const operation = deferred();
      const renderer = vi.fn<RenderMarkdown>(() => operation.promise);
      const { block, container } = createBlock(
        'column: Title\nbody\ncolumn:\nsecond body',
        renderer,
      );
      expect(renderer).toHaveBeenCalledTimes(3);
      block.unload();
      expect(container.childElementCount).toBe(0);

      for (const [, , target, , component] of renderer.mock.calls) {
        const scope = component as RenderScope;
        expect(scope.isClosed).toBe(true);
        const cleanup = vi.fn();
        const child = new CleanupChild();
        scope.register(cleanup);
        scope.addChild(child);
        target.setText('Late result');
        expect(cleanup).toHaveBeenCalledOnce();
        expect(child.cleanup).toHaveBeenCalledOnce();
      }
      if (completion === 'resolve') operation.resolve();
      else operation.reject(new Error('stale error'));
      await settle();
      await settle();

      expect(container.childElementCount).toBe(0);
      expect(log).not.toHaveBeenCalled();
      expect(notice).not.toHaveBeenCalled();
    },
  );

  it('owns synchronous renderer throws without preventing sibling rendering', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderer = vi.fn<RenderMarkdown>((_app, markdown, target) => {
      if (markdown === 'Bad') throw new Error('sync failure');
      target.setText(markdown);
      return Promise.resolve();
    });
    const { block, container } = createBlock('column: Bad\nfirst\ncolumn:\nsecond', renderer);
    await settle();
    expect(container.querySelectorAll('.tabbed-columns__content')).toHaveLength(2);
    expect(container.textContent).toContain('second');
    expect(log).toHaveBeenCalledExactlyOnceWith('[tabbed] Could not render column title', {
      path: 'Note.md',
      index: 0,
      cause: 'sync failure',
    });
    block.unload();
  });
});
