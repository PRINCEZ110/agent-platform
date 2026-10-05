import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearchTool, fetchUrlTool } from '../../src/tools/web-search-tool.js';

const fetchMock = vi.fn();
const ENV_KEYS = ['BING_SEARCH_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX'] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  clearEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
});

describe('webSearchTool', () => {
  it('returns a ToolError when no search API is configured', async () => {
    const result = await webSearchTool.execute({ query: 'anything' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe('ToolError');
      expect(result.error.message).toContain('No search API configured');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Google Custom Search API when keys and cx are set', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'g-key';
    process.env.GOOGLE_SEARCH_CX = 'cx-1';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ title: 'Result A', link: 'https://a.example', snippet: 'snippet a' }] })
    });

    const result = await webSearchTool.execute({ query: 'hello world', maxResults: 5, safeSearch: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results).toEqual([
        { title: 'Result A', url: 'https://a.example', snippet: 'snippet a', source: 'google' }
      ]);
    }
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('customsearch/v1');
    expect(url).toContain('q=hello%20world');
    expect(url).toContain('num=5');
    expect(url).toContain('safe=active');
    expect(url).toContain('key=g-key');
  });

  it('defaults to safe=off and num=10', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'g-key';
    process.env.GOOGLE_SEARCH_CX = 'cx-1';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await webSearchTool.execute({ query: 'x' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.results).toEqual([]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('num=10');
    expect(url).toContain('safe=off');
  });

  it('wraps Google API HTTP errors as ToolError results', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'g-key';
    process.env.GOOGLE_SEARCH_CX = 'cx-1';
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const result = await webSearchTool.execute({ query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Search API error: 429');
  });

  it('falls back to the Bing API when only the Bing key is set', async () => {
    process.env.BING_SEARCH_API_KEY = 'bing-key';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ webPages: { value: [{ name: 'Bing Hit', url: 'https://b.example', snippet: 'snip' }] } })
    });

    const result = await webSearchTool.execute({ query: 'azure', safeSearch: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.results).toEqual([
      { title: 'Bing Hit', url: 'https://b.example', snippet: 'snip', source: 'bing' }
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('api.bing.microsoft.com');
    expect(url).toContain('q=azure');
    expect(url).toContain('safeSearch=Strict');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('bing-key');
  });

  it('wraps Bing API HTTP errors as ToolError results', async () => {
    process.env.BING_SEARCH_API_KEY = 'bing-key';
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const result = await webSearchTool.execute({ query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Bing API error: 503');
  });

  it('wraps network failures as ToolError results', async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'g-key';
    process.env.GOOGLE_SEARCH_CX = 'cx-1';
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await webSearchTool.execute({ query: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Web search failed: network down');
  });

  it('fails validation for bad inputs', async () => {
    const empty = await webSearchTool.execute({} as never);
    expect(empty.ok).toBe(false);

    const tooMany = await webSearchTool.execute({ query: 'x', maxResults: 100 });
    expect(tooMany.ok).toBe(false);
  });
});

describe('fetchUrlTool', () => {
  it('fetches a URL and returns content, status, and headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>hi</html>',
      headers: new Headers({ 'content-type': 'text/html' })
    });

    const result = await fetchUrlTool.execute({ url: 'https://example.com' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('<html>hi</html>');
      expect(result.value.status).toBe(200);
      expect(result.value.headers['content-type']).toBe('text/html');
    }
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ headers: undefined, signal: expect.any(AbortSignal) as never }));
  });

  it('passes custom headers through', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok', headers: new Headers() });
    await fetchUrlTool.execute({ url: 'https://example.com', headers: { 'x-api-key': 'abc' } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'abc' });
  });

  it('aborts on timeout and returns a ToolError result', async () => {
    fetchMock.mockImplementation(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
        })
    );

    const pending = fetchUrlTool.execute({ url: 'https://slow.example', timeout: 100 });
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(150);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Fetch failed: aborted by timeout');
  });

  it('wraps network failures as ToolError results', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await fetchUrlTool.execute({ url: 'https://down.example' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Fetch failed: ECONNREFUSED');
  });

  it('fails validation for non-URL inputs', async () => {
    const result = await fetchUrlTool.execute({ url: 'not a url' } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Invalid input for web.fetch');
  });
});
