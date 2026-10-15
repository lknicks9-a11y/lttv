// Builds src/data/tv-logos.json: the file names (not the images) of the free
// "tv-logo/tv-logos" collection (logos made for dark backgrounds). LTTV loads the
// matching image from GitHub at run time.
//   git clone --filter=blob:none --no-checkout --depth 1 https://github.com/tv-logo/tv-logos.git
//   git -C tv-logos ls-tree -r --name-only HEAD countries > logos.txt
//   node scripts/make-logo-index.mjs logos.txt <commit sha>
import { readFileSync, writeFileSync } from 'node:fs';
const [, , list, sha] = process.argv;
const folders = {};
for (const line of readFileSync(list, 'utf8').split('\n')) {
  const m = /^countries\/([^/]+)\/(.+)\.png$/.exec(line.trim());
  if (!m) continue;
  (folders[m[1]] ??= []).push(m[2]);
}
for (const k of Object.keys(folders)) folders[k].sort();
writeFileSync(new URL('../src/data/tv-logos.json', import.meta.url), JSON.stringify({ sha, folders }));
console.log(Object.values(folders).reduce((n, a) => n + a.length, 0), 'logos in', Object.keys(folders).length, 'folders');
