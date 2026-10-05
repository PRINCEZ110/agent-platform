import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryVectorStore } from '@memory/vector-store.js';
import { CodebaseIndexer } from '@memory/codebase-indexer.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(): Promise<void> {
  console.log('=== codebase search (read-only) ===\n');
  console.log('root:', projectRoot);

  const vectorStore = new InMemoryVectorStore();
  await vectorStore.initialize();

  const indexer = new CodebaseIndexer(vectorStore, {
    excludePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.git/**',
      '**/src/_excluded/**',
      '**/worktrees/**',
    ],
  });

  const stats = await indexer.index();
  if (!stats.ok) throw stats.error;
  console.log(`indexed ${stats.value.files} files -> ${stats.value.chunks} chunks`);

  const queries = [
    'message bus publish persistence',
    'permission check approval',
    'vector store search similarity',
  ];

  for (const q of queries) {
    console.log(`\nquery: "${q}"`);
    const hits = await indexer.search(q, 3);
    for (const hit of hits) {
      const rel = path.relative(projectRoot, hit.file);
      console.log(`  ${hit.score.toFixed(3)}  ${rel}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
