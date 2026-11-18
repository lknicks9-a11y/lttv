package tv.lttv.home

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * LTTV Home updates itself, like LTTV: it reads build.json from the latest release and, when that build is
 * newer than this one, offers to download lttv-home.apk and open the installer (settings and hidden apps stay).
 * Checked when Home comes back on screen (at most every 20 minutes) and from Settings → Update Center.
 */
object Updater {
    private const val BASE = "https://github.com/lknicks9-a11y/lttv/releases/latest/download"
    private const val APK = "$BASE/lttv-home.apk"
    private const val EVERY_MS = 20 * 60_000L
    private val main = Handler(Looper.getMainLooper())

    data class Latest(val build: Int, val notes: List<String>)

    fun thisBuild(a: Activity): Int = try {
        @Suppress("DEPRECATION")
        a.packageManager.getPackageInfo(a.packageName, 0).versionCode
    } catch (_: Exception) { 0 }

    fun thisVersion(a: Activity): String = try {
        a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "?"
    } catch (_: Exception) { "?" }

    /** Quiet check when Home shows: only speaks up for a new build, once per build. */
    fun autoCheck(a: Activity) {
        val prefs = a.getSharedPreferences("home", Activity.MODE_PRIVATE)
        val last = prefs.getLong("updCheckedAt", 0)
        if (System.currentTimeMillis() - last < EVERY_MS) return
        prefs.edit().putLong("updCheckedAt", System.currentTimeMillis()).apply()
        fetch { latest ->
            if (latest == null || a.isFinishing) return@fetch
            if (latest.build > thisBuild(a) && prefs.getInt("updOffered", 0) != latest.build) {
                prefs.edit().putInt("updOffered", latest.build).apply()
                offer(a, latest)
            }
        }
    }

    /** Settings → Update Center: always answers. */
    fun checkNow(a: Activity) {
        Toast.makeText(a, "Checking for updates…", Toast.LENGTH_SHORT).show()
        fetch { latest ->
            if (a.isFinishing) return@fetch
            when {
                latest == null -> Toast.makeText(a, "Couldn't check for updates. Check the internet connection.", Toast.LENGTH_LONG).show()
                latest.build > thisBuild(a) -> offer(a, latest)
                else -> AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                    .setTitle("LTTV Home is up to date")
                    .setMessage("Version ${thisVersion(a)} (build ${thisBuild(a)}).")
                    .setPositiveButton("OK", null)
                    .setNeutralButton("Reinstall") { _, _ -> install(a) }
                    .show()
            }
        }
    }

    private fun offer(a: Activity, l: Latest) {
        val notes = l.notes.filter { it.isNotBlank() }.joinToString("\n") { "• $it" }
        AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle("LTTV Home update available")
            .setMessage("Build ${l.build} is ready (you have build ${thisBuild(a)}).${if (notes.isNotEmpty()) "\n\n$notes" else ""}\n\nYour apps, order and settings stay.")
            .setPositiveButton("Install") { _, _ -> install(a) }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun install(a: Activity) = Store(a) {}.install(APK, "LTTV Home update")

    private fun fetch(done: (Latest?) -> Unit) {
        Thread {
            val r = try {
                var u = URL("$BASE/build.json")
                var hops = 0
                var body: String
                while (true) {
                    val c = u.openConnection() as HttpURLConnection
                    c.instanceFollowRedirects = false
                    c.connectTimeout = 15_000; c.readTimeout = 20_000
                    c.setRequestProperty("User-Agent", "LTTV-Home")
                    c.setRequestProperty("Cache-Control", "no-cache")
                    val code = c.responseCode
                    if (code in 300..399 && hops++ < 8) { u = URL(u, c.getHeaderField("Location")); c.disconnect(); continue }
                    if (code != 200) throw Exception("HTTP $code")
                    body = c.inputStream.bufferedReader().use { it.readText() }
                    c.disconnect()
                    break
                }
                val j = JSONObject(body)
                val n = j.optJSONArray("notes")
                Latest(j.optInt("build"), (0 until (n?.length() ?: 0)).map { n!!.optString(it) })
            } catch (_: Exception) { null }
            main.post { done(r) }
        }.start()
    }
}
