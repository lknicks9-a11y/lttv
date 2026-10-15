// Build the LTTV web UI (shared by desktop and Fire TV) with esbuild.
//   node scripts/build.mjs           -> production build into dist/
//   node scripts/build.mjs --watch   -> rebuild on change
//   node scripts/build.mjs --android -> also copy dist/ into the Android app's assets
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');
const android = process.argv.includes('--android');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const V = (p) => join(root, 'vendor', p);

/** Resolve bare imports to the vendored sources (no registry needed). */
const vendorPlugin = {
  name: 'vendor',
  setup(b) {
    const map = {
      preact: V('preact/src/index.js'),
      'preact/hooks': V('preact/hooks/src/index.js'),
      'hls.js': V('hls.js/src/hls.ts'),
      'url-toolkit': V('url-toolkit/url-toolkit.js'),
      eventemitter3: V('eventemitter3/index.js'),
      events: V('eventemitter3/index.js'),
      'mpegts.js': V('mpegts.js/src/mpegts.js'),
      'es6-promise': join(root, 'src/shims/es6-promise.js'),
    };
    b.onResolve({ filter: /^(preact|preact\/hooks|hls\.js|url-toolkit|eventemitter3|events|mpegts\.js|es6-promise)$/ }, (a) => ({ path: map[a.path] }));
    b.onResolve({ filter: /webworkify-webpack$/ }, () => ({ path: join(root, 'src/shims/webworkify.js') }));
    // mpegts.js's TypeScript files use `import * as X` for CommonJS modules (webpack's
    // interop); with esbuild those must be default imports or they can't be constructed.
    b.onLoad({ filter: /vendor[\\/]mpegts\.js[\\/].*\.ts$/ }, (a) => ({
      contents: readFileSync(a.path, 'utf8').replace(/import \* as (EventEmitter|work) from '([^']+)';/g, "import $1 from '$2';"),
      loader: 'ts',
    }));
    b.onResolve({ filter: /^@svta\/common-media-library\// }, (a) => {
      const sub = a.path.replace('@svta/common-media-library/', '');
      const base = V('common-media-library/src/' + sub);
      return { path: existsSync(base + '.ts') ? base + '.ts' : join(base, 'index.ts') };
    });
  },
};

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020'],
  plugins: [vendorPlugin],
  logLevel: 'info',
  legalComments: 'linked',
  define: {
    __VERSION__: JSON.stringify('1.6.13'),
    __USE_SUBTITLES__: 'true',
    __USE_ALT_AUDIO__: 'true',
    __USE_EME_DRM__: 'false',
    __USE_CMCD__: 'false',
    __USE_CONTENT_STEERING__: 'false',
    __USE_VARIABLE_SUBSTITUTION__: 'true',
    __USE_M2TS_ADVANCED_CODECS__: 'true',
    __USE_MEDIA_CAPABILITIES__: 'true',
    __USE_INTERSTITIALS__: 'false',
    __LTTV_VERSION__: JSON.stringify(pkg.version),
  },
};

if (!watch) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });

const appCtx = await esbuild.context({
  ...common,
  entryPoints: { main: join(root, 'src/main.tsx') },
  outdir: out,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  inject: [join(root, 'src/jsx-shim.ts')],
  loader: { '.svg': 'file' },
});
const workerCtx = await esbuild.context({
  ...common,
  entryPoints: { worker: join(root, 'src/app/worker.ts') },
  outdir: out,
  format: 'iife',
});

if (watch) {
  await appCtx.watch();
  await workerCtx.watch();
  console.log('Watching for changes…');
} else {
  await appCtx.rebuild();
  await workerCtx.rebuild();
  await appCtx.dispose();
  await workerCtx.dispose();
  writeFileSync(join(out, 'version.json'), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }));
  if (android) {
    const assets = join(root, 'android/app/src/main/assets/www');
    rmSync(assets, { recursive: true, force: true });
    mkdirSync(assets, { recursive: true });
    cpSync(out, assets, { recursive: true });
    console.log('Copied web UI to', assets);
  }
}
