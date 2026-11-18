package tv.lttv.app

import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * JavaScript interface exposed to the web UI as `window.LTTVNative`.
 * Methods are called on a WebView binder thread; anything touching views
 * is posted to the main thread by [MainActivity] / [PlayerController].
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun platform(): String {
        val pm = activity.packageManager
        return when {
            pm.hasSystemFeature("amazon.hardware.fire_tv") -> "Fire TV"
            pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) -> "Android TV"
            else -> "Android"
        }
    }

    @JavascriptInterface
    fun deviceInfo(): String =
        "${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE}, API ${Build.VERSION.SDK_INT})"

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    /** Build number (grows with every GitHub build) — used to tell whether an update is newer. */
    @JavascriptInterface
    fun appBuild(): Int = BuildConfig.VERSION_CODE

    /** Which LTTV app this is: lttv, movies, leaguepass or blitz. */
    @JavascriptInterface
    fun appMode(): String = BuildConfig.APP_MODE

    /** Starts another LTTV app (leaguepass, blitz, movies, lttv). False if it isn't installed. */
    @JavascriptInterface
    fun openApp(which: String): Boolean {
        val base = if (which == "lttv") "tv.lttv.app" else "tv.lttv.$which"
        val pm = activity.packageManager
        for (pkg in listOf("$base.debug", base)) {
            val i = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: continue
            return try { activity.startActivity(i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
        }
        return false
    }

    /** LTTV keeps your provider setup for the other LTTV apps (see ShareProvider). */
    @JavascriptInterface
    fun shareSetup(json: String) {
        if (BuildConfig.APP_MODE != "lttv") return
        try {
            val f = java.io.File(activity.filesDir, ShareProvider.FILE)
            val tmp = java.io.File(activity.filesDir, ShareProvider.FILE + ".tmp")
            tmp.writeText(json)
            tmp.renameTo(f)
        } catch (_: Exception) { }
    }

    /**
     * LTTV keeps a copy of League Pass' timeout photos and songs for League Pass / Blitz (sent in pieces).
     * `path` is "timeout.json" or "timeout/<name>"; the first piece replaces the file, later ones add to it.
     */
    @JavascriptInterface
    fun putSharedFile(path: String, base64: String, append: Boolean): Boolean {
        if (BuildConfig.APP_MODE != "lttv" || path.contains("..") || !path.startsWith("timeout")) return false
        return try {
            val f = java.io.File(java.io.File(activity.filesDir, ShareProvider.SHARED_DIR), path)
            f.parentFile?.mkdirs()
            java.io.FileOutputStream(f, append).use { it.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT)) }
            true
        } catch (_: Exception) { false }
    }

    /**
     * LTTV: copy League Pass' photos and songs straight from the computer into the files shared with League Pass /
     * Blitz, in the background (keeps going while you use another app). The list League Pass reads is updated after
     * every file, so whatever has arrived shows right away; files arrive whole (copied to ".part", then renamed).
     */
    @JavascriptInterface
    fun syncTimeoutFrom(base: String) {
        if (BuildConfig.APP_MODE != "lttv" || !base.startsWith("http") || timeoutSyncing) return
        timeoutSyncing = true
        Thread {
            try {
                val root = java.io.File(activity.filesDir, ShareProvider.SHARED_DIR)
                val dir = java.io.File(root, "timeout").apply { mkdirs() }
                val b = base.trimEnd('/')
                val listing = org.json.JSONObject(httpText("$b/timeout.json"))
                val names = mutableListOf<Pair<String, Boolean>>()
                listing.optJSONArray("images")?.let { a -> for (i in 0 until a.length()) names += a.getString(i) to false }
                listing.optJSONArray("audio")?.let { a -> for (i in 0 until a.length()) names += a.getString(i) to true }
                val imgs = org.json.JSONArray()
                val auds = org.json.JSONArray()
                fun writeList() {
                    val tmp = java.io.File(root, "timeout.json.tmp")
                    tmp.writeText(org.json.JSONObject().put("images", imgs).put("audio", auds).toString())
                    tmp.renameTo(java.io.File(root, "timeout.json"))
                }
                // Pictures first (small), then songs.
                for ((name, isSong) in names.sortedBy { it.second }) {
                    val f = java.io.File(dir, uriComponent(name))
                    if (!f.isFile || f.length() == 0L) {
                        try {
                            val part = java.io.File(dir, f.name + ".part")
                            httpToFile("$b/timeout/${uriComponent(name)}", part)
                            if (!isSong) shrinkPicture(part)
                            part.renameTo(f)
                        } catch (_: Exception) { continue }
                    }
                    if (isSong) auds.put(name) else imgs.put(name)
                    writeList()
                }
                // Files no longer in the folder are removed.
                val keep = names.map { uriComponent(it.first) }.toSet()
                dir.listFiles()?.forEach { if (it.name !in keep) it.delete() }
                writeList()
            } catch (_: Exception) {
                // computer off: League Pass keeps what was already shared
            } finally {
                timeoutSyncing = false
            }
        }.start()
    }

    @Volatile private var timeoutSyncing = false

    /** The same encoding as JavaScript's encodeURIComponent (file names on both sides must match). */
    private fun uriComponent(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~")

    private fun httpConn(url: String): java.net.HttpURLConnection {
        var u = java.net.URL(url)
        var hops = 0
        while (true) {
            val c = u.openConnection() as java.net.HttpURLConnection
            c.instanceFollowRedirects = false; c.connectTimeout = 8_000; c.readTimeout = 60_000
            val code = c.responseCode
            if (code in 300..399 && hops++ < 5) { u = java.net.URL(u, c.getHeaderField("Location")); c.disconnect(); continue }
            if (code != 200) { c.disconnect(); throw java.io.IOException("HTTP $code") }
            return c
        }
    }
    private fun httpText(url: String): String { val c = httpConn(url); return c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() } }
    private fun httpToFile(url: String, f: java.io.File) { val c = httpConn(url); c.inputStream.use { i -> f.outputStream().use { o -> i.copyTo(o, 64 * 1024) } }; c.disconnect() }

    /** A big photo is shrunk to TV size (a 10 MB picture would choke a Fire TV Stick). */
    private fun shrinkPicture(f: java.io.File) {
        if (f.length() < 1_500_000) return
        try {
            val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeFile(f.path, o)
            var sample = 1
            while (o.outWidth / (sample * 2) >= 1920) sample *= 2
            val bmp = android.graphics.BitmapFactory.decodeFile(f.path, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) ?: return
            val tmp = java.io.File(f.path + ".jpg")
            tmp.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 86, it) }
            bmp.recycle()
            if (tmp.length() in 1 until f.length()) tmp.renameTo(f) else tmp.delete()
        } catch (_: Throwable) { }
    }

    /** LTTV: finishes a file sent in pieces (".part" → its name), so League Pass never sees half a file. */
    @JavascriptInterface
    fun finishSharedFile(path: String): Boolean {
        if (BuildConfig.APP_MODE != "lttv" || path.contains("..") || !path.startsWith("timeout")) return false
        val root = java.io.File(activity.filesDir, ShareProvider.SHARED_DIR)
        return java.io.File(root, "$path.part").renameTo(java.io.File(root, path))
    }

    /** Which shared timeout files LTTV already kept (name -> size), so only new ones are sent. */
    @JavascriptInterface
    fun sharedFileSizes(): String {
        val dir = java.io.File(java.io.File(activity.filesDir, ShareProvider.SHARED_DIR), "timeout")
        val o = org.json.JSONObject()
        dir.listFiles()?.forEach { if (!it.name.endsWith(".part")) o.put(it.name, it.length()) }
        return o.toString()
    }

    /** The other apps: LTTV's provider setup, or "" if LTTV isn't installed / set up yet. */
    @JavascriptInterface
    fun sharedSetup(): String {
        for (pkg in listOf("tv.lttv.app.debug", "tv.lttv.app")) {
            try {
                activity.contentResolver.openInputStream(android.net.Uri.parse("content://$pkg.share/setup"))?.use {
                    return it.readBytes().toString(Charsets.UTF_8)
                }
            } catch (_: Exception) { }
        }
        return ""
    }


    /** Download an update APK and open the system installer (progress via lttvHost.onUpdateEvent). */
    @JavascriptInterface
    fun installUpdate(url: String) = activity.updater.install(url)

    /** SD movies / episodes: "sharp" (at most 1.5× their size, centered) or "full" (fill the screen). */
    @JavascriptInterface
    fun setPictureMode(mode: String) = activity.player.setPictureMode(mode)

    @JavascriptInterface
    fun resumeUpdate() = activity.runOnUiThread { activity.updater.resumeInstall() }

    /** Open the update's download page in a browser. */
    @JavascriptInterface
    fun openDownloadPage(url: String) = activity.runOnUiThread { activity.updater.openDownloadPage(url) }

    /** json: { url, headers: {..}, key } */
    @JavascriptInterface
    fun play(json: String) {
        val o = JSONObject(json)
        val headers = mutableMapOf<String, String>()
        val h = o.optJSONObject("headers")
        if (h != null) for (k in h.keys()) headers[k] = h.optString(k)
        activity.player.play(o.getString("url"), headers, o.optBoolean("vod", false), o.optLong("startMs", 0L))
        activity.keepScreenOn(true)
    }

    @JavascriptInterface
    fun stop() {
        activity.player.stop()
        activity.keepScreenOn(false)
    }

    @JavascriptInterface
    fun pause() = activity.player.pause()

    @JavascriptInterface
    fun resume() = activity.player.resume()

    @JavascriptInterface
    fun setVideoRect(x: Int, y: Int, w: Int, h: Int, visible: Boolean) = activity.setVideoRect(x, y, w, h, visible)

    /** json: { bufferSec, timeoutSec, rewindMin } — applied to the next channel that is tuned. */
    @JavascriptInterface
    fun setPlayerConfig(json: String) {
        val o = JSONObject(json)
        activity.configurePlayers(o.optInt("bufferSec", 8), o.optInt("timeoutSec", 15), o.optInt("rewindMin", 30))
    }

    /** Live rewind / fast forward by [ms] (negative = back). */
    @JavascriptInterface
    fun seekBy(ms: Int) = activity.player.seekBy(ms.toLong())

    /** Back to the live edge. */
    @JavascriptInterface
    fun goLive() = activity.player.goLive()

    /** Subtitles / closed captions on or off. */
    @JavascriptInterface
    fun setCaptions(on: Boolean) {
        activity.player.setCaptions(on)
    }

    // ---- Multiview tiles (0–3) ----

    /** json: { url, headers: {..}, key } */
    @JavascriptInterface
    fun mvPlay(slot: Int, json: String) {
        val o = JSONObject(json)
        val headers = mutableMapOf<String, String>()
        val h = o.optJSONObject("headers")
        if (h != null) for (k in h.keys()) headers[k] = h.optString(k)
        activity.mvPlay(slot, o.getString("url"), headers)
        activity.keepScreenOn(true)
    }

    @JavascriptInterface
    fun mvStop(slot: Int) = activity.mvStop(slot)

    /** Multiview "Stream info": decoder, picture, dropped frames and buffer of each game, and the TV's decoders. */
    @JavascriptInterface
    fun mvDiagnostics(): String = activity.mvDiagnostics()

    @JavascriptInterface
    fun mvMute(slot: Int, muted: Boolean) = activity.mvMute(slot, muted)

    @JavascriptInterface
    fun mvRect(slot: Int, x: Int, y: Int, w: Int, h: Int, visible: Boolean) = activity.mvRect(slot, x, y, w, h, visible)

    @JavascriptInterface
    fun startSetupServer(): String = activity.startSetupServer()

    @JavascriptInterface
    fun stopSetupServer() = activity.stopSetupServer()

    /** The account server's public address and key, for the phone sign-in page. */
    @JavascriptInterface
    fun setCloudConfig(json: String) {
        activity.cloudConfigJson = json
    }

    @JavascriptInterface
    fun keepScreenOn(on: Boolean) = activity.keepScreenOn(on)

    @JavascriptInterface
    fun exitApp() {
        activity.runOnUiThread { activity.finish() }
    }
}
