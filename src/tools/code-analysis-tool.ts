import { createTool, ToolPermission, ToolResult } from './tool.js';
import { z } from 'zod';
import { ResultOrError, ok, err } from '@core/types.js';
import { ToolError } from '@core/errors.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const projectRoot = resolve(process.cwd());

function safePath(inputPath: string): string {
  const resolved = resolve(projectRoot, inputPath);
  if (!resolved.startsWith(projectRoot)) {
    throw new ToolError(`Path traversal attempt: ${inputPath}`, 'code.analysis');
  }
  return resolved;
}

const AnalyzeFileInputSchema = z.object({
  path: z.string(),
  includeImports: z.boolean().optional(),
  includeExports: z.boolean().optional(),
  includeFunctions: z.boolean().optional(),
  includeClasses: z.boolean().optional()
});
type AnalyzeFileInput = z.infer<typeof AnalyzeFileInputSchema>;

interface CodeAnalysisOutput extends ToolResult {
  analysis: {
    path: string;
    language: string;
    lines: number;
    imports: Array<{ source: string; specifiers: string[] }>;
    exports: Array<{ name: string; type: 'default' | 'named' | 'namespace' }>;
    functions: Array<{ name: string; params: string[]; async: boolean; line: number }>;
    classes: Array<{ name: string; methods: string[]; extends?: string; line: number }>;
    complexity: number;
  };
}

export const analyzeFileTool = createTool<AnalyzeFileInput, CodeAnalysisOutput>(
  'code.analyze',
  'Analyze a source file for structure and complexity',
  AnalyzeFileInputSchema,
  ['fs.read'],
  async (input) => {
    try {
      const path = safePath(input.path);
      const content = await readFile(path, 'utf-8');
      const ext = path.split('.').pop()?.toLowerCase();

      let analysis: CodeAnalysisOutput['analysis'] = {
        path: input.path,
        language: ext ?? 'unknown',
        lines: content.split('\n').length,
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        complexity: 1
      };

      if (['ts', 'tsx', 'js', 'jsx'].includes(ext ?? '')) {
        analysis = analyzeTypeScript(content, input.path, analysis, input);
      } else if (ext === 'py') {
        analysis = analyzePython(content, input.path, analysis, input);
      }

      return ok({ success: true, analysis, output: analysis });
    } catch (e) {
      return err(new ToolError(`Code analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'code.analyze', e instanceof Error ? e : undefined));
    }
  }
);

function analyzeTypeScript(content: string, path: string, base: CodeAnalysisOutput['analysis'], options: AnalyzeFileInput): CodeAnalysisOutput['analysis'] {
  const lines = content.split('\n');
  const analysis = { ...base, lines: lines.length };

  if (options.includeImports !== false) {
    const importRegex = /^import\s+(?:(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const specifiers = match[1] ? match[1].split(',').map(s => s.trim()) : (match[2] ? [match[2]] : []);
      analysis.imports.push({ source: match[3]!, specifiers });
    }
  }

  if (options.includeExports !== false) {
    const exportRegex = /^export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+(\w+)|^export\s+\{([^}]+)\}/gm;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) {
        analysis.exports.push({ name: match[1]!, type: content.includes(`default ${match[1]}`) ? 'default' : 'named' });
      } else if (match[2]) {
        match[2]!.split(',').forEach(s => analysis.exports.push({ name: s.trim(), type: 'named' }));
      }
    }
  }

  if (options.includeFunctions !== false) {
    const funcRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/gm;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1] ?? match[3]!;
      const params = (match[2] ?? match[4] ?? '').split(',').map(p => p.trim()).filter(Boolean);
      const async = match[0].includes('async');
      const line = content.substring(0, match.index ?? 0).split('\n').length;
      analysis.functions.push({ name, params, async, line });
      analysis.complexity += 1;
    }
  }

  if (options.includeClasses !== false) {
    const classRegex = /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const methods: string[] = [];
      const classStart = match.index ?? 0;
      const classEnd = findMatchingBrace(content, classStart);
      const classContent = content.substring(classStart, classEnd);
      const methodRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)/g;
      let mMatch;
      while ((mMatch = methodRegex.exec(classContent)) !== null) {
        methods.push(mMatch[1]!);
      }
      analysis.classes.push({ name: match[1]!, methods, extends: match[2], line: content.substring(0, classStart).split('\n').length });
      analysis.complexity += methods.length;
    }
  }

  return analysis;
}

function analyzePython(content: string, path: string, base: CodeAnalysisOutput['analysis'], options: AnalyzeFileInput): CodeAnalysisOutput['analysis'] {
  const lines = content.split('\n');
  const analysis = { ...base, lines: lines.length };

  if (options.includeImports !== false) {
    const importRegex = /^(?:from\s+(\S+)\s+import\s+(.+)|import\s+(.+))/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        analysis.imports.push({ source: match[1]!, specifiers: match[2]!.split(',').map(s => s.trim()) });
      } else if (match[3]) {
        const source = match[3]!.split('.')[0] ?? match[3]!;
        analysis.imports.push({ source, specifiers: [match[3]!] });
      }
    }
  }

  if (options.includeFunctions !== false) {
    const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      const params = match[2]!.split(',').map(p => p.trim().split(':')[0] ?? p.trim()).filter(Boolean);
      const line = content.substring(0, match.index ?? 0).split('\n').length;
      analysis.functions.push({ name: match[1]!, params, async: match[0].startsWith('async'), line });
      analysis.complexity += 1;
    }
  }

  if (options.includeClasses !== false) {
    const classRegex = /^class\s+(\w+)(?:\(([^)]+)\))?/gm;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const methods: string[] = [];
      const classStart = match.index ?? 0;
      const classEnd = findMatchingBrace(content, classStart);
      const classContent = content.substring(classStart, classEnd);
      const methodRegex = /^\s+(?:async\s+)?def\s+(\w+)/gm;
      let mMatch;
      while ((mMatch = methodRegex.exec(classContent)) !== null) {
        methods.push(mMatch[1]!);
      }
      analysis.classes.push({ name: match[1]!, methods, extends: match[2], line: content.substring(0, classStart).split('\n').length });
      analysis.complexity += methods.length;
    }
  }

  return analysis;
}

function findMatchingBrace(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = start; i < content.length; i++) {
    const char = content[i];
    const prev = content[i - 1];
    if (!inString && (char === '"' || char === "'" || char === '`') && prev !== '\\') {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prev !== '\\') {
      inString = false;
    } else if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return content.length;
}

const FindReferencesInputSchema = z.object({
  symbol: z.string(),
  path: z.string().optional(),
  filePattern: z.string().optional()
});
type FindReferencesInput = z.infer<typeof FindReferencesInputSchema>;

interface FindReferencesOutput extends ToolResult {
  references: Array<{ file: string; line: number; column: number; context: string }>;
}

export const findReferencesTool = createTool<FindReferencesInput, FindReferencesOutput>(
  'code.references',
  'Find references to a symbol in the codebase',
  FindReferencesInputSchema,
  ['fs.read'],
  async (input) => {
    try {
      const { glob } = await import('glob');
      const pattern = input.filePattern ?? '**/*.{ts,tsx,js,jsx,py}';
      const files = await glob(pattern, { cwd: projectRoot, absolute: true });

      const references: FindReferencesOutput['references'] = [];
      const escapedSymbol = input.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedSymbol}\\b`, 'g');

      for (const file of files) {
        const content = await readFile(file, 'utf-8');
        let match;
        while ((match = regex.exec(content)) !== null) {
          const matchIndex = match.index ?? 0;
          const line = content.substring(0, matchIndex).split('\n').length;
          const column = matchIndex - content.lastIndexOf('\n', matchIndex - 1);
          const contextLines = content.split('\n');
          references.push({
            file: file.replace(projectRoot + '/', ''),
            line,
            column,
            context: contextLines[line - 1]?.trim() ?? ''
          });
        }
      }

      return ok({ success: true, references, output: { references } });
    } catch (e) {
      return err(new ToolError(`Find references failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'code.references', e instanceof Error ? e : undefined));
    }
  }
);