package tv.lttv.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * In-app updates: downloads the new APK (from the app's GitHub release) and opens the
 * system installer, which installs it over the current app — settings and data are kept
 * because every build is signed with the same key. Fire TV always asks the viewer to
 * press "Install" for apps from outside the Amazon store.
 */
class Updater(private val activity: MainActivity) {

    @Volatile private var busy = false

    private fun send(o: JSONObject) =
        activity.sendToPage("window.lttvHost && window.lttvHost.onUpdateEvent && window.lttvHost.onUpdateEvent(${JSONObject.quote(o.toString())})")

    fun install(url: String) {
        if (busy) return
        if (!url.startsWith("https://")) {
            send(JSONObject().put("state", "error").put("error", "Bad update address"))
            return
        }
        busy = true
        Thread {
            try {
                val base = (if (Build.VERSION.SDK_INT < 24) activity.externalCacheDir else null) ?: activity.cacheDir
                val dir = File(base, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val apk = File(dir, "lttv-update.apk")
                val c = Net.open(url, emptyMap(), 30000)
                try {
                    if (c.responseCode !in 200..299) throw IOException("The update server answered ${c.responseCode}")
                    val total = c.contentLengthLong
                    var done = 0L
                    var lastPct = -1
                    c.inputStream.use { input ->
                        apk.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                val pct = if (total > 0) (done * 100 / total).toInt() else -1
                                if (pct != lastPct && (pct < 0 || pct % 5 == 0)) {
                                    lastPct = pct
                                    send(JSONObject().put("state", "downloading").put("percent", pct))
                                }
                            }
                        }
                    }
                } finally {
                    c.disconnect()
                }
                if (Build.VERSION.SDK_INT < 24) apk.setReadable(true, false)
                activity.runOnUiThread { openInstaller(apk) }
            } catch (e: Exception) {
                send(JSONObject().put("state", "error").put("error", e.message ?: "Download failed"))
            } finally {
                busy = false
            }
        }.start()
    }

    private fun openInstaller(apk: File) {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                // First time only: the system asks to allow LTTV to install updates.
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                send(JSONObject().put("state", "permission"))
                return
            }
            val uri = if (Build.VERSION.SDK_INT >= 24) FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk) else Uri.fromFile(apk)
            val i = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            send(JSONObject().put("state", "installing"))
        } catch (e: Exception) {
            send(JSONObject().put("state", "error").put("error", e.message ?: "Couldn't open the installer"))
        }
    }

    /** After allowing installs in Settings: open the already-downloaded update. */
    fun resumeInstall() {
        val base = (if (Build.VERSION.SDK_INT < 24) activity.externalCacheDir else null) ?: activity.cacheDir
        val apk = File(File(base, "updates"), "lttv-update.apk")
        if (apk.exists()) openInstaller(apk)
    }
}
