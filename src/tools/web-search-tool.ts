import { createTool, ToolPermission, ToolResult } from './tool.js';
import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';

const WebSearchInputSchema = z.object({
  query: z.string(),
  maxResults: z.number().positive().max(20).optional(),
  safeSearch: z.boolean().optional()
});
type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

interface WebSearchOutput extends ToolResult {
  results: Array<{ title: string; url: string; snippet: string; source: string }>;
}

export const webSearchTool = createTool<WebSearchInput, WebSearchOutput>(
  'web.search',
  'Search the web for information',
  WebSearchInputSchema,
  ['network.http'],
  async (input) => {
    try {
      const apiKey = process.env['BING_SEARCH_API_KEY'] ?? process.env['GOOGLE_SEARCH_API_KEY'];
      const cx = process.env['GOOGLE_SEARCH_CX'];

      if (apiKey && cx) {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(input.query)}&num=${input.maxResults ?? 10}&safe=${input.safeSearch ? 'active' : 'off'}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Search API error: ${response.status}`);
        const data = await response.json() as { items?: Array<{ title: string; link: string; snippet: string }> };
        return ok({
          success: true,
          results: (data.items ?? []).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet,
            source: 'google'
          })),
          output: { results: data.items ?? [] }
        });
      }

      if (process.env['BING_SEARCH_API_KEY']) {
        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(input.query)}&count=${input.maxResults ?? 10}&safeSearch=${input.safeSearch ? 'Strict' : 'Off'}`;
        const response = await fetch(url, {
          headers: { 'Ocp-Apim-Subscription-Key': process.env['BING_SEARCH_API_KEY']! }
        });
        if (!response.ok) throw new Error(`Bing API error: ${response.status}`);
        const data = await response.json() as { webPages?: { value: Array<{ name: string; url: string; snippet: string }> } };
        return ok({
          success: true,
          results: (data.webPages?.value ?? []).map((item) => ({
            title: item.name,
            url: item.url,
            snippet: item.snippet,
            source: 'bing'
          })),
          output: { results: data.webPages?.value ?? [] }
        });
      }

      return err(new ToolError('No search API configured (set BING_SEARCH_API_KEY or GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX)', 'web.search'));
    } catch (e) {
      return err(new ToolError(`Web search failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'web.search', e instanceof Error ? e : undefined));
    }
  }
);

const FetchUrlInputSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().positive().optional()
});
type FetchUrlInput = z.infer<typeof FetchUrlInputSchema>;

interface FetchUrlOutput extends ToolResult {
  content: string;
  status: number;
  headers: Record<string, string>;
}

export const fetchUrlTool = createTool<FetchUrlInput, FetchUrlOutput>(
  'web.fetch',
  'Fetch content from a URL',
  FetchUrlInputSchema,
  ['network.http'],
  async (input) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeout ?? 30000);

      const response = await fetch(input.url, {
        headers: input.headers,
        signal: controller.signal
      });

      clearTimeout(timeout);
      const content = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      return ok({ success: true, content, status: response.status, headers, output: { content, status: response.status } });
    } catch (e) {
      return err(new ToolError(`Fetch failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'web.fetch', e instanceof Error ? e : undefined));
    }
  }
);