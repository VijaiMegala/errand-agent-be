import '../config.js';

if (!process.env.LANGSMITH_API_KEY?.trim()) {
  throw new Error('LANGSMITH_API_KEY is required for npm run eval; use npm run eval:offline for a local-only run');
}

// Keep the generated table and traces on disk, then publish the same run.
// run.js sets a failing exit code for failed scenarios; the upload still records them.
await import('./run.js');
await import('./upload-langsmith.js');
