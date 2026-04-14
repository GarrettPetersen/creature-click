import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = path.join(root, 'public');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'index.html'), path.join(out, 'index.html'));
await cp(path.join(root, 'cull.html'), path.join(out, 'cull.html'));
await cp(path.join(root, 'css'), path.join(out, 'css'), { recursive: true });
await cp(path.join(root, 'js'), path.join(out, 'js'), { recursive: true });
await cp(path.join(root, 'data'), path.join(out, 'data'), { recursive: true });
if (existsSync(path.join(root, 'sounds'))) {
  await cp(path.join(root, 'sounds'), path.join(out, 'sounds'), { recursive: true });
}
