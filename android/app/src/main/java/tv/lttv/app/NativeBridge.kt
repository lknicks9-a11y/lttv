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

    /** Download an update APK and open the system installer (progress via lttvHost.onUpdateEvent). */
    @JavascriptInterface
    fun installUpdate(url: String) = activity.updater.install(url)

    @JavascriptInterface
    fun resumeUpdate() = activity.runOnUiThread { activity.updater.resumeInstall() }

    /** json: { url, headers: {..}, key } */
    @JavascriptInterface
    fun play(json: String) {
        val o = JSONObject(json)
        val headers = mutableMapOf<String, String>()
        val h = o.optJSONObject("headers")
        if (h != null) for (k in h.keys()) headers[k] = h.optString(k)
        activity.player.play(o.getString("url"), headers)
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

    @JavascriptInterface
    fun mvMute(slot: Int, muted: Boolean) = activity.mvMute(slot, muted)

    @JavascriptInterface
    fun mvRect(slot: Int, x: Int, y: Int, w: Int, h: Int, visible: Boolean) = activity.mvRect(slot, x, y, w, h, visible)

    @JavascriptInterface
    fun startSetupServer(): String = activity.startSetupServer()

    @JavascriptInterface
    fun stopSetupServer() = activity.stopSetupServer()

    @JavascriptInterface
    fun keepScreenOn(on: Boolean) = activity.keepScreenOn(on)

    @JavascriptInterface
    fun exitApp() {
        activity.runOnUiThread { activity.finish() }
    }
}
