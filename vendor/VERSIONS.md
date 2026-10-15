# Vendored third-party sources

These libraries are vendored as source (unmodified; mpegts.js's webpack-only worker helper and Promise polyfill are swapped for small shims in `src/shims/` at build time) so the app can be built without network access to a package registry. Each keeps its original license file.

| Library | Version | Upstream | License |
|---|---|---|---|
| hls.js | 1.6.13 | https://github.com/video-dev/hls.js | Apache-2.0 |
| preact (+ hooks) | 10.29.8 | https://github.com/preactjs/preact | MIT |
| url-toolkit | 2.2.5 | https://github.com/tjenkinson/url-toolkit | Apache-2.0 |
| @svta/common-media-library | 0.17.1 | https://github.com/streaming-video-technology-alliance/common-media-library | Apache-2.0 |
| eventemitter3 | 4.0.7 | https://github.com/primus/eventemitter3 | MIT |
| mpegts.js | 1.8.0 | https://github.com/xqq/mpegts.js | Apache-2.0 |

Not vendored, used at run time: channel logo **file names** from [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos) (commit d32e347) are listed in `src/data/tv-logos.json` (regenerate with `scripts/make-logo-index.mjs`); the logo images themselves are loaded from GitHub when shown. Logos are trademarks of their owners.
