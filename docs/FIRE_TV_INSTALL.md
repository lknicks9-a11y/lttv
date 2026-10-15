# Fire TV / Android TV: build, sign and install

LTTV’s TV app is a native Android application (`android/`, Kotlin):

- a full‑screen **WebView** shows the same LTTV interface as the desktop app (bundled inside the APK — no internet needed to load the UI);
- **Media3 ExoPlayer** plays the video natively underneath the transparent interface (hardware decoding, HLS/DASH/MPEG‑TS/MP4);
- the app answers the UI’s `/api/...` requests natively (downloads without browser CORS limits, `.gz` guides, uploads);
- Fire TV remote keys (D‑pad, Select, Back, Menu, Play/Pause, ⏪/⏩, channel keys) are all handled;
- a temporary, PIN‑protected **setup web page** lets you send URLs/files from your phone or computer.

> **Which Fire TVs?** Devices running **Fire OS** (Android‑based; essentially every Fire TV released before late 2025 — Fire TV Stick 4K/4K Max, Stick 3rd gen/Lite, Cube, Fire TV smart TVs) can install it. The **Fire TV Stick 4K Select** and Amazon’s future Fire TV Sticks run **Vega OS**, which does not run Android apps, so LTTV cannot be installed on them. Android TV / Google TV devices work as well.

## 1. Build the APK

### Option A — GitHub Actions (no Android tools on your computer)

1. Push this project to a GitHub repository.
2. The workflow in `.github/workflows/build.yml` runs automatically: unit tests, an end‑to‑end UI test, the web build, and `assembleDebug`.
3. Open the run → **Artifacts** → download **lttv-debug-apk** (`app-debug.apk`).

For a signed release APK, add repository secrets `KEYSTORE_BASE64` (`base64 -w0 release.jks`), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`; the workflow then also produces **lttv-release-apk**.

### Option B — on your computer

Requirements:

| Tool | Version |
|---|---|
| JDK | 17 or newer (Android Studio’s bundled JDK is fine) |
| Android SDK | Platform 35, Build‑Tools 35 (installed automatically by Android Studio / Gradle) |
| Node.js | 20+ (only to rebuild the UI; a prebuilt copy is already in `android/app/src/main/assets/www`) |

```bash
# from the project root — only needed if you changed the UI
npm install
npm run build:android

cd android
# Tell Gradle where the SDK is if ANDROID_HOME isn't set:
echo "sdk.dir=$HOME/Android/Sdk" > local.properties     # macOS: ~/Library/Android/sdk, Windows: C:\\Users\\you\\AppData\\Local\\Android\\Sdk
./gradlew assembleDebug                                  # Windows: gradlew.bat assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android/` folder in **Android Studio** and use *Build → Build App Bundle(s)/APK(s) → Build APK(s)*.

The debug APK installs as **LTTV** with package `tv.lttv.app.debug`, so it can live next to a release build (`tv.lttv.app`).

### Release build & signing

```bash
keytool -genkeypair -v -keystore android/release.jks -alias lttv -keyalg RSA -keysize 2048 -validity 10000
cat > android/keystore.properties <<EOF
storeFile=release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=lttv
keyPassword=YOUR_KEY_PASSWORD
EOF
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

Keep the keystore safe: updates must be signed with the same key. `keystore.properties` and `*.jks` are git‑ignored.

## 2. Prepare the Fire TV

1. **Settings → My Fire TV → About** → highlight the device name (e.g. “Fire TV Stick 4K”) and press **Select about 7 times** until it says you’re a developer.
2. Back to **My Fire TV → Developer Options**:
   - turn on **ADB debugging**;
   - turn on **Apps from Unknown Sources** (newer Fire OS: *Install unknown apps*, then allow the app you’ll install from, e.g. Downloader).
3. Find the TV’s IP address: **Settings → My Fire TV → About → Network**.

## 3. Install

### Over the network with ADB (recommended)

Install [Android platform‑tools](https://developer.android.com/tools/releases/platform-tools) on your computer, then:

```bash
adb connect 192.168.1.50:5555           # your Fire TV's IP
# The first time, the TV asks "Allow USB debugging?" -> choose Always allow -> OK
adb install -r app-debug.apk
adb shell monkey -p tv.lttv.app.debug 1 # optional: launch it
```

`-r` replaces an existing install and keeps your data. To uninstall: `adb uninstall tv.lttv.app.debug`.

### Over USB

Fire TV Cube and some Fire TV smart TVs accept a USB data connection: connect, run `adb devices`, accept the prompt on the TV, then `adb install -r app-debug.apk`. (Fire TV Sticks use the micro‑USB/USB‑C port for power only on most models — use the network method.)

### Without a computer

Host the APK on a web server you control on your network and use a downloader app on the Fire TV (for example Amazon’s *Downloader* by AFTVnews) to download and open it; allow that app under *Install unknown apps*.

LTTV appears under **Your Apps & Channels** (move it to the home row with Menu ☰ → Move).

## 4. First run on the TV

1. Open LTTV → **Add playlist**, or **Sources → Phone/computer setup** to send the playlist URL, the guide URL or files from your phone (same Wi‑Fi; enter the PIN shown on the TV).
2. Optionally **Try the demo** to check playback — two test patterns are bundled in the APK; a third demo channel uses Mux’s public HLS test stream (internet required); the fourth is intentionally broken to show error handling.
3. Use the remote: D‑pad + Select everywhere, **Menu ☰** for options, **Back** to go back/exit.

To move a setup from the desktop app: Settings → **Export incl. source URLs** on the desktop, then upload that file on the TV via Phone/computer setup (type “LTTV settings export”).

## Local test build vs. Amazon Appstore

| | Sideloaded test APK (this guide) | Amazon Appstore |
|---|---|---|
| Who can install | Only devices where you enable developer options / unknown sources | Anyone, from the Appstore |
| Signing | Debug key, or your own release key | Your release key, uploaded through the Amazon Developer Console |
| Updates | Install the new APK with `adb install -r` | Automatic via the store |
| Review | None | Amazon review (content policy, Fire TV requirements, a privacy policy) |

Publishing to the Appstore needs an Amazon Developer account, store assets (icon, 1280×720/1920×1080 screenshots, banner), a privacy policy, and testing on Amazon’s device matrix. Note that apps whose purpose is accessing third‑party IPTV content receive extra scrutiny; LTTV ships no channels and only plays sources the user adds.

## Troubleshooting

| Problem | Fix |
|---|---|
| `adb connect` times out | TV and computer must be on the same network; ADB debugging on; try `adb kill-server` then connect again; some routers isolate Wi‑Fi clients. |
| “App not installed” | Uninstall an older build signed with a different key (`adb uninstall tv.lttv.app.debug`). |
| “Unauthorized APK installation detected” | Some recent Fire OS builds restrict sideloading; check Amazon’s current developer guidance for your model. |
| Channels buffer or stop | LTTV keeps a 15+ second buffer and retries a channel in the provider's other format (.ts/.m3u8) automatically. Most providers allow only one stream at a time: close LTTV (or other apps) on other devices. Use wired Ethernet or 5 GHz Wi‑Fi if possible, and raise **Settings → Playback → Buffer** if it still stutters. |
| Multiview tiles stay black | Each tile is a separate stream: your provider must allow that many connections, and many Fire TV Sticks can decode only about 2 HD streams at once. Use 2 tiles, or a Fire TV Cube / 4K Max. |
| Black screen with sound | The stream’s video codec isn’t supported by the device (LTTV shows “can’t decode” for definite cases). |
| Channels play on desktop but not on TV | Check the channel needs no browser‑only session cookies; per‑channel `User-Agent`/`Referer` headers are supported. |
| Guide shows “Program information unavailable” | Sources → Review matches, or Channel options → Find guide match. |
| Remote navigation stuck | Press Back; if it persists, Settings → Diagnostics and report what screen you were on. |
| Debugging | Debug builds enable WebView remote debugging: `chrome://inspect` on your computer while `adb` is connected. |
