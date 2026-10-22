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
    /** Waiting for "Install unknown apps" to be switched on; the install continues when LTTV comes back. */
    @Volatile private var waitingForPermission = false
    @Volatile private var lastUrl: String? = null

    private fun send(o: JSONObject) =
        activity.sendToPage("window.lttvHost && window.lttvHost.onUpdateEvent && window.lttvHost.onUpdateEvent(${JSONObject.quote(o.toString())})")

    fun install(url: String) {
        if (busy) return
        if (!url.startsWith("https://")) {
            send(JSONObject().put("state", "error").put("error", "Bad update address"))
            return
        }
        busy = true
        lastUrl = url
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

    /**
     * Open the install screen for the downloaded update — every time: the system installer
     * (ACTION_VIEW, then ACTION_INSTALL_PACKAGE), and if neither can open, the download page in a browser.
     */
    private fun openInstaller(apk: File) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            // First time only: allow LTTV to install updates. The install continues by itself on return.
            waitingForPermission = true
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                try {
                    activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (ignored: Exception) {
                }
            }
            send(JSONObject().put("state", "permission"))
            return
        }
        waitingForPermission = false
        val uri = if (Build.VERSION.SDK_INT >= 24) FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk) else Uri.fromFile(apk)
        val attempts = listOf(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive"),
            @Suppress("DEPRECATION") Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri).putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true),
        )
        for (i in attempts) {
            try {
                activity.startActivity(i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                send(JSONObject().put("state", "installing"))
                return
            } catch (ignored: Exception) {
            }
        }
        if (openDownloadPage(lastUrl)) send(JSONObject().put("state", "browser"))
        else send(JSONObject().put("state", "error").put("error", "Couldn't open the installer"))
    }

    /** The update's download address in a browser (fallback, or the "Open download page" button). */
    fun openDownloadPage(url: String?): Boolean {
        val u = url?.takeIf { it.startsWith("https://") } ?: return false
        return try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun downloadedApk(): File {
        val base = (if (Build.VERSION.SDK_INT < 24) activity.externalCacheDir else null) ?: activity.cacheDir
        return File(File(base, "updates"), "lttv-update.apk")
    }

    /** Open the already-downloaded update again (e.g. the installer was closed). */
    fun resumeInstall() {
        val apk = downloadedApk()
        if (apk.exists()) openInstaller(apk)
        else send(JSONObject().put("state", "error").put("error", "The update isn't downloaded yet"))
    }

    /** LTTV came back to the screen: if installs were just allowed, open the installer now. */
    fun onAppResumed() {
        if (!waitingForPermission) return
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            send(JSONObject().put("state", "permission-needed"))
            return
        }
        val apk = downloadedApk()
        if (apk.exists()) openInstaller(apk)
    }
}
