// Local API server for `npm run dev` (vite proxies /api -> :3001).
// Serves ALL api/ handlers without needing `vercel dev`.
// Usage: npm run dev:api   (tsx watch — reloads on api/ changes; reads .env.local)
import { readFileSync } from 'node:fs';

// minimal .env / .env.local loader (no dotenv dep; .env.local wins)
for (const f of ['../.env', '../.env.local']) {
  try {
    for (const line of readFileSync(new URL(f, import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch { /* file absent */ }
}

const { createDevApiServer } = await import('./dev-api-server.js');
createDevApiServer().listen(3001, () => console.log('dev api on http://localhost:3001'));
