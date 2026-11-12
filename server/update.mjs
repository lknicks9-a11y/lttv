// The computer version updates itself, like the Fire TV app: each time LTTV starts it asks GitHub for the latest
// build, and if that is newer than this copy it downloads it and replaces this copy's files before starting.
// Copies run from a git checkout (developers) are left alone. Nothing here ever blocks starting for long.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const API = process.env.LTTV_UPDATE_API || 'https://api.github.com/repos/lknicks9-a11y/lttv/releases/latest';
const ASSET = 'lttv-desktop.zip';

export function localBuild(root) {
  try {
    return Number(JSON.parse(readFileSync(join(root, 'build.json'), 'utf8')).build) || 0;
  } catch {
    return 0;
  }
}

/** Resolves to the new build number when this copy was replaced by a newer one, otherwise 0. */
export async function selfUpdate(root, log = console.log) {
  if (existsSync(join(root, '.git')) || process.env.LTTV_NO_UPDATE) return 0;
  const have = localBuild(root);
  let work = '';
  try {
    const res = await fetch(API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'LTTV-desktop' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return 0;
    const rel = await res.json();
    const build = Number(/build\s*(\d+)/i.exec(`${rel.name ?? ''} ${rel.body ?? ''}`)?.[1] ?? 0);
    const url = rel.assets?.find((a) => a.name === ASSET)?.browser_download_url;
    if (!url || !build || build <= have) return 0;
    log(`Updating LTTV to build ${build} (this copy is ${have || 'older'})...`);
    const zip = await fetch(url, { headers: { 'user-agent': 'LTTV-desktop' }, signal: AbortSignal.timeout(120_000) });
    if (!zip.ok) return 0;
    work = join(tmpdir(), `lttv-update-${build}-${process.pid}`);
    mkdirSync(work, { recursive: true });
    const file = join(work, ASSET);
    writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
    // Windows 10+ ships tar (which reads zip files); elsewhere unzip.
    const out = join(work, 'out');
    mkdirSync(out);
    const r = process.platform === 'win32' ? spawnSync('tar', ['-xf', file, '-C', out], { windowsHide: true }) : spawnSync('unzip', ['-oq', file, '-d', out]);
    const fresh = join(out, 'LTTV');
    if (r.status !== 0 || !existsSync(join(fresh, 'dist', 'index.html')) || !existsSync(join(fresh, 'server', 'server.mjs'))) return 0;
    // The app's pages are replaced whole (old chunk files would pile up); everything else is copied over.
    rmSync(join(root, 'dist'), { recursive: true, force: true });
    cpSync(fresh, root, { recursive: true, force: true });
    log(`LTTV is now build ${build}.`);
    return build;
  } catch {
    return 0; // offline, blocked, disk trouble: start what is here
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}
