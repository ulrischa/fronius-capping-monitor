import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const installer = fs.readFileSync(new URL('../scripts/install-service.sh', import.meta.url), 'utf8');

test('runs with Node.js only and has no external runtime dependencies', () => {
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.doesNotMatch(installer, /\b(?:npm|python3|make|g\+\+)\b/);
});
