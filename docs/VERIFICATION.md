# Verification checklist

Status of every requirement as of version 1.0.0. “Verified” means exercised by an automated test in this repository (results in `test-results/`), not just implemented.

## How it was tested

| Suite | Command | Result |
|---|---|---|
| Unit/integration (node:test) | `npm test` | **92/92 passed** (+ off-device JVM test of the Fire TV live-rewind buffer: `android/jvm-tests`, 16/16) — `test-results/unit-tests.txt` |
| TypeScript type check | `npm run typecheck` | **0 errors** |
| End‑to‑end UI (headless Chromium, remote‑style keys only) | `node scripts/e2e.mjs` | **103/103 passed** — `test-results/e2e.txt`, screenshots in `test-results/screenshots/` |
| Kotlin compile check (Android sources vs. real Android API 34 + AndroidX/Media3 signature stubs) | see below | **0 errors** — `test-results/kotlin-typecheck.txt` |
| Android APK build (Gradle/AGP) | `./gradlew assembleDebug` | **Not run** — Google’s SDK/Maven servers were unreachable from the build environment. Use the GitHub Actions workflow or Android Studio. |

The end‑to‑end test serves a 5,004‑channel playlist and an 80,000‑programme gzipped XMLTV guide from a server that sends **no CORS headers** (like real providers), imports them through the wizard using only arrow/Enter/Escape/M keys, plays a real HLS stream, zaps to a broken channel, edits channels, uses the guide, search and match review, restarts the browser to check persistence, and finally runs the same UI against a simulated Fire TV host bridge.

## Feature checklist

### Import & parsing
| Requirement | Status |
|---|---|
| M3U/M3U8 from URL (through the helper, no CORS needed) | ✅ Verified (e2e) |
| Provider sign-in with server + username + password (Xtream Codes API): login check, expiry shown, wrong password explained, channels + guide loaded | ✅ Verified (unit + e2e against a mock provider); not tested against a real provider |
| Local M3U file | ✅ Verified (demo import uses the file path; unit tests) |
| XMLTV from URL, gzipped `.xml.gz` | ✅ Verified (e2e, server tests) |
| Local XMLTV file | ✅ Verified (demo guide is imported as a file) |
| Multiple playlists / guides | ✅ Implemented; storage & merge covered by unit tests |
| `#EXTM3U` header attrs (`url-tvg`), `#EXTINF`, `tvg-id/name/logo/chno`, `group-title`, `#EXTGRP`, `#EXTVLCOPT`, `#KODIPROP`, pipe headers | ✅ Verified (unit) |
| Missing attributes, malformed entries, CRLF/BOM, Unicode, URL‑encoded values, commas in quotes | ✅ Verified (unit) |
| Duplicate channels | ✅ Verified (unit) |
| Thousands of channels (20,000 parse < 3 s; 5,004 in UI) | ✅ Verified (unit + e2e) |
| HTML/JSON/wrong‑type sources rejected with clear messages; HTTP 401/403/404/DNS errors explained; retry button | ✅ Verified (unit, server tests); retry UI implemented |
| UI responsive during import (background worker) | ✅ Verified (e2e: worst frame gap ~100 ms during an 80k‑programme import) |
| Wizard: name → source → guide → validate → parse → match → summary → review → saved | ✅ Verified (e2e) |
| VOD entries skipped (optional) | ✅ Verified (e2e) |

### Organization
| Requirement | Status |
|---|---|
| Categories from `group-title`, normalized, evidence shown, never guessed from brand names | ✅ Verified (unit, e2e) |
| Only non‑empty categories shown (toggle for empty) | ✅ Implemented |
| Title cleanup preserving HD/4K/+1/region; original retained & restorable | ✅ Verified (unit, e2e) |
| No merging of similar names | ✅ Verified (unit) |
| Sorts: playlist, A–Z, number, category, favorites, recent, custom | ✅ Verified (unit) |
| Drag & drop (desktop) / Move position (remote) | ⚠️ Implemented; reorder logic unit‑tested, the drag gesture and remote move mode not driven by the e2e test |
| Custom numbers, rename, hide, favorites, custom category | ✅ Rename + favorite verified in e2e; others unit‑tested via lineup builder |
| Source playlist never modified | ✅ By design (sources are only read) |

### EPG matching & guide
| Requirement | Status |
|---|---|
| Priority tvg‑id → tvg‑name → normalized → fuzzy | ✅ Verified (unit) |
| Fuzzy shows confidence, needs approval, approve/reject, decisions persist | ✅ Verified (unit, e2e incl. restart) |
| “Sports 1” vs “Sports 2”, “+1”, East/West never cross‑matched | ✅ Verified (unit) |
| Timestamps with offsets, `Z`, `+05:45`, no offset (UTC/local/zone policy) | ✅ Verified (unit) |
| DST gaps/overlaps; grid linear across 25‑hour day | ✅ Verified (unit) |
| Programmes crossing midnight; missing stop times; overlaps; duplicates | ✅ Verified (unit) |
| “Program information unavailable” when no match | ✅ Verified (e2e) |
| Country‑prefixed names and duplicate guide entries matched automatically | ✅ Verified (unit) |
| Provider per‑channel guide (Xtream `get_short_epg`) for channels the guide file lacks; never overrides a real match | ✅ Verified (unit, e2e against a mock provider) |
| Live‑event channels (“NFL 03”, “PPV 2”) shown as the game on now, from the channel name or the guide; user renames win | ✅ Verified (unit, e2e) |
| Grid positions by actual time; current indicator & progress; horizontal/vertical navigation; jump to now; details | ✅ Verified (e2e) |
| Manual refresh, interval refresh, cache, last‑refresh time, failed refresh keeps cache, expired cleanup | ✅ Verified (unit) for cache/failed refresh/prune; schedule timer implemented |

### Playback
| Requirement | Status |
|---|---|
| Desktop HLS playback (hls.js) incl. automatic CORS fallback via helper | ✅ Verified (e2e, real stream decoded and advancing) |
| Raw MPEG‑TS on desktop via ffmpeg remux | ✅ Server output verified (fragmented MP4); browser decode of H.264 not verifiable in the test browser |
| Bundled H.264 demo streams | ⚠️ Generated & valid HLS; the test browser lacks H.264, so decode was not observed here (works in Chrome/Edge/Safari/Fire TV) |
| Fire TV native ExoPlayer playback | ❌ Not run on hardware. The JS↔host contract (play URL, video rectangle, fatal errors, keys, exit) is verified with a simulated bridge |
| Retry with back‑off, reconnect on network return, stall timeout, clear errors, no retry for unsupported formats | ✅ Verified (e2e for 404 + reconnect; unsupported‑format path with simulated host) |
| Full screen, OSD with times/progress, channel up/down, channel list, info, options, favorites‑only zapping, recents | ✅ Verified (e2e) except favorites‑only zapping (implemented) |
| Xtream format fallback (.m3u8 ⇄ .ts) and remembered working format | ✅ Verified (e2e: desktop picks HLS; simulated TV host retries a failed .m3u8 as .ts) |
| Larger IPTV buffers, decoder fallback and lenient MPEG‑TS parsing in ExoPlayer | ⚠️ Compile‑checked only; needs a real device |
| Per‑channel User‑Agent/Referer headers | ✅ Verified (server tests); passed to ExoPlayer natively |

### Remote control & TV
| Requirement | Status |
|---|---|
| Whole app usable with arrows/OK/Back/Menu only | ✅ Verified (e2e uses no mouse) |
| Focus never lost (screen changes, modals, full screen exit) | ✅ Verified (e2e) |
| 1080p layout at 960×540 CSS px @2x (Fire TV WebView) | ✅ Verified (e2e host phase) |
| Safe margins, large type, high‑contrast focus ring, theme/accent options | ✅ Implemented (see screenshots) |
| Fire TV Menu/Back/media/channel keys | ✅ Routing verified via simulated host; Android key mapping not run on hardware |
| Phone/computer LAN setup page with PIN | ❌ Implemented in Kotlin; not run (needs a device) |

### Sports & colors
| Requirement | Status |
|---|---|
| Choose favorite teams with the remote (league tabs, team grid, custom teams) | ✅ Verified (e2e for NFL/NBA; custom teams unit‑tested) |
| Live and upcoming games for those teams found in the user's guide, grouped across channels | ✅ Verified (unit, e2e) |
| No false matches on shared/everyday nicknames (“Giants”, “Heat”, “Sky Sports”) | ✅ Verified (unit) |
| Watch a live game from the team card; Live TV banner when a team is playing | ✅ Verified (e2e) |
| “Remind me” for upcoming games, persisted; prompt when it starts | ✅ Reminder persistence verified (e2e); the start‑time prompt is implemented but not time‑travel tested |
| Team channels in the lineup (e.g. “NBA: Lakers”) | ✅ Verified (unit) |
| Accent color swatches + custom hex; logo/UI recolor; persisted | ✅ Verified (e2e incl. restart) |

| Requirement | Status |
|---|---|
| My TV: DIRECTV New York/NJ numbers (locals, national, RSNs, premium); best copy per slot; other cities, other countries, +1 feeds excluded | ✅ Verified (unit, e2e) |
| Sort by My TV / country / provider; My TV, Country and Provider filters | ✅ Verified (unit, e2e) |
| League tabs NBA NFL MLB NHL EPL Bundesliga Serie A Ligue 1 LaLiga MLS CBB CFB with games, scores, transparent team logos | ✅ Verified (unit with ESPN-shaped data; e2e against a mock feed). The real ESPN feed was checked by hand, not in automated tests |
| Best channels per game (event channels, guide listings, national networks, RSNs); "which broadcast?" when both teams have local TV; chosen team's RSN first | ✅ Verified (unit, e2e) |
| Live TV and guide merged; country tabs with All / My TV / sub-provider menu | ✅ Verified (unit, e2e) |
| High-quality logos matched by exact name within the channel's country | ✅ Verified (unit with the real file list; e2e with real logo files served locally). Loading from GitHub on a real device not tested here |
| Descriptions for programmes the guide leaves empty (schedule for games, TVmaze for shows/episodes, Wikipedia for movies; exact matches only) | ✅ Verified (unit, e2e against mock services). The real TVmaze/Wikipedia/ESPN services weren't reachable from the test environment |
| League picker with UEFA Champions League; league → games → streams | ✅ Verified (unit, e2e against a mock feed) |
| Country menu lists every original playlist group for the country (provider order), plus My TV; untagged channels follow their group's country | ✅ Verified (unit, e2e) |
| Connection limit: tiles beyond the provider's limit wait on standby (live score, logos, last picture); OK makes a standby tile the live one; same channel on another subscription used when that one has room | ✅ Standby/live switching verified (e2e against a 1-connection mock provider); spreading across subscriptions implemented, not covered by a test |
| Aero theme switched on for existing setups (own one-time flag); app files served without long caching | ✅ Implemented; first-run case covered by e2e screenshots |
| Update listings button; guides refreshed early when listings run out within 12 h | ✅ Implemented (button rendered in e2e); early refresh not covered by a test |
| My TV pins (chosen streams win their number; matched across providers by name/call sign) and carry-over of renames/favorites/hidden/numbers to a new provider | ✅ Verified (unit) |
| Multiview removed (at your request) | ✅ Verified (e2e: no Multiview buttons anywhere) |
| Country tabs from the provider's group codes (US, CA, UK, ES…), whole groups under one country, code shown on the tab | ✅ Verified (unit, e2e) |
| Team picker: all teams of 14 leagues from ESPN's team lists with logos; league logos always shown | ✅ Implemented; ESPN response format checked by hand; e2e covers the built-in fallback list (no internet in tests) |
| Frutiger Aero theme and glossy logo (new default; Fire TV skips blur effects) | ✅ Rendered in e2e screenshots; not checked on TV hardware |
| English-first guide text: English `lang` / Latin-script title and description chosen; English channels with Arabic/foreign guide switch to an English source; clear note when none exists | ✅ Verified (unit). Real-world EPGs with mixed languages not tested |
| Live rewind / fast forward / go to live in a browser (hls.js / mpegts.js back buffer; live edge chased only when not rewound) | ✅ Verified (e2e: rewind key and Live button move the stream position) for a recorded test stream; live-edge chasing with a real live stream not exercised |
| Live rewind on Fire TV: on-device ring buffer for MPEG-TS, ExoPlayer window seeking for HLS, remote ⏪ ⏩ keys, live bar | ⚠️ Buffer logic verified off-device (JVM test); bridge contract verified with the simulated host (seekBy/goLive, live position events); Kotlin compile-checked; not run on hardware |

### Persistence, search, settings
| Requirement | Status |
|---|---|
| Restore lineup, names, favorites, matches, guide, recents, settings after restart | ✅ Verified (unit with on‑disk store; e2e browser restart) |
| Search channels/programs, filters; unapproved matches not searched | ✅ Verified (unit, e2e) |
| Settings: time zone, clock, refresh interval, sort, theme/accent, startup screen, playback, clear cache, export/import, diagnostics without secrets | ✅ Diagnostics redaction and export/import verified; others implemented |

## Known limitations

- **APK not built here** (see above). The Kotlin code compiles against the real Android framework; AndroidX/Media3 usage was checked against hand‑written signature stubs, so a real Gradle build is the remaining check.
- **Vega OS** Fire TV devices (Fire TV Stick 4K Select and future sticks) cannot run Android apps.
- Live TV only: no recording, catch‑up or VOD playback (live rewind covers what was kept since tuning in). No DRM.
- Desktop browser codec support varies (H.264 needs Chrome/Edge/Safari; HEVC/AC‑3 often unsupported). Raw MPEG‑TS requires ffmpeg on desktop.
- Fire TV file pickers are often missing; use the LAN setup page to send files.
- XMLTV files in non‑UTF‑8 encodings are supported only when uncompressed (the encoding is read from the XML declaration).
- Program descriptions are capped at 1,200 characters and guide data at 8 days ahead to stay light on low‑memory TVs.
