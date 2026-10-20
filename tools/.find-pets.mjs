/** 找候选桌宠项目（用 GitHub 搜索 API，顺便拿许可证/星标/语言） */
import { execFileSync } from 'node:child_process';

const TOKEN = (() => {
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
})();

const QUERIES = [
  'desktop pet in:name,description,readme',
  'shimeji in:name,description',
  'desktop mascot in:name,description',
  'desktop goose in:name,description',
  'electron pet in:name,description',
];

async function search(q) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(q) +
    '&sort=stars&order=desc&per_page=8';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pet-finder', Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
  });
  if (!res.ok) return { error: 'HTTP ' + res.status };
  const j = await res.json();
  return (j.items || []).map((r) => ({
    full: r.full_name,
    stars: r.stargazers_count,
    license: r.license ? r.license.spdx_id : 'NO-LICENSE',
    lang: r.language,
    desc: (r.description || '').slice(0, 90),
    archived: r.archived,
    pushed: (r.pushed_at || '').slice(0, 10),
  }));
}

const seen = new Set();
for (const q of QUERIES) {
  const rows = await search(q);
  if (rows.error) { console.log('[' + q + '] ' + rows.error); continue; }
  console.log('\n=== ' + q + ' ===');
  for (const r of rows) {
    if (seen.has(r.full)) continue;
    seen.add(r.full);
    console.log('  ' + r.full.padEnd(38) + ' ★' + String(r.stars).padStart(6) + '  ' +
      String(r.license).padEnd(12) + '  ' + String(r.lang || '-').padEnd(12) + '  ' + r.desc);
  }
}
