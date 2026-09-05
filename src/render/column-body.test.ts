import { MarkdownRenderer } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { describe, expect, it, vi } from 'vitest';
import { ColumnBody } from './column-body.js';
import type { RenderMarkdown } from './markdown-renderer.js';
import { RenderScope } from './render-scope.js';

describe('ColumnBody', () => {
  it('renders into its owned content with itself as the lifecycle scope', async () => {
    const app = App.createConfigured__().asOriginalType__();
    const content = createDiv();
    const renderer = vi.fn<RenderMarkdown>().mockResolvedValue(undefined);
    const body = new ColumnBody(app, content, '**body**', 'Note.md', renderer);

    await body.render();

    expect(body).toBeInstanceOf(RenderScope);
    expect(body.contentEl).toBe(content);
    expect(renderer).toHaveBeenCalledExactlyOnceWith(app, '**body**', content, 'Note.md', body);
  });

  it('defaults to the public Markdown renderer', async () => {
    const app = App.createConfigured__().asOriginalType__();
    const content = createDiv();
    const renderer = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue(undefined);
    const body = new ColumnBody(app, content, 'body', 'Note.md');

    await body.render();

    expect(renderer).toHaveBeenCalledExactlyOnceWith(app, 'body', content, 'Note.md', body);
  });
});
