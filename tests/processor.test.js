import { describe, it, expect } from 'vitest';
import { extractLinks } from '../src/core/processer.js';

describe('extractLinks', () => {
  it('should extract links from the same domain', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/page1">Page 1</a>
          <a href="/page2">Page 2</a>
          <a href="https://another-domain.com">External</a>
          <a href="https://example.com/page1#section">Page 1 with hash</a>
        </body>
      </html>
    `;
    const baseUrl = 'https://example.com';
    const links = extractLinks(html, baseUrl);
    expect(links).toEqual([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });

  it('should ignore media and script file links', () => {
    const html = `
      <html>
        <body>
          <a href="https://example.com/image.jpg">Image</a>
          <a href="https://example.com/script.js">Script</a>
          <a href="https://example.com/document.pdf">PDF</a>
          <a href="https://example.com/page">A valid page</a>
        </body>
      </html>
    `;
    const baseUrl = 'https://example.com';
    const links = extractLinks(html, baseUrl);
    expect(links).toEqual(['https://example.com/page']);
  });

  it('should handle invalid URLs gracefully', () => {
    const html = `<a href="javascript:void(0)">Invalid</a>`;
    const baseUrl = 'https://example.com';
    const links = extractLinks(html, baseUrl);
    expect(links).toEqual([]);
  });
});