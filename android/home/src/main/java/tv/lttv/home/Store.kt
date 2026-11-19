package tv.lttv.home

import android.app.Activity
import android.app.AlertDialog
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * LTTV Store: your own apps (installed and updated straight from GitHub), popular Appstore apps
 * (opens their Appstore page to install), and installing any app from a link — like Downloader.
 */
class Store(private val a: Activity, private val onClose: () -> Unit) {

    /** tag: the release the app comes from (null = the repo's latest). */
    data class Mine(val name: String, val pkgs: List<String>, val repo: String, val asset: String, val about: String, val color: String, val tag: String? = null)
    data class Popular(val name: String, val pkg: String, val color: String)
    /** Apps whose makers publish the app file themselves: installed right here, no Appstore. */
    data class Direct(val name: String, val pkg: String, val about: String, val color: String, val github: String? = null, val listing: String? = null, val file: Regex? = null)

    private val direct = listOf(
        Direct("Kodi", "org.xbmc.kodi", "Media center for your own files and add-ons", "#17B2E7", listing = "https://mirrors.kodi.tv/releases/android/arm/", file = Regex("""kodi-[\w.\-]+-armeabi-v7a\.apk""")),
        Direct("VLC", "org.videolan.vlc", "Plays any video or music file", "#FF8800", listing = "https://download.videolan.org/pub/videolan/vlc-android/last/", file = Regex("""VLC-Android-[\d.]+-armeabi-v7a\.apk""")),
        Direct("Jellyfin", "org.jellyfin.androidtv", "Your own movie server, on the TV", "#7B4AD8", github = "jellyfin/jellyfin-androidtv"),
        Direct("Moonlight", "com.limelight", "Stream games from your PC", "#2F3542", github = "moonlight-stream/moonlight-android"),
    )

    private val mine = listOf(
        Mine("LTTV", listOf("tv.lttv.app.debug", "tv.lttv.app"), "lttv", "lttv.apk", "Live TV and sports from your playlists", "#2563EB"),
        Mine("League Pass", listOf("tv.lttv.leaguepass.debug", "tv.lttv.leaguepass"), "lttv", "lttv-leaguepass.apk", "Every NBA game, team broadcasts first", "#EA580C"),
        Mine("Blitz", listOf("tv.lttv.blitz.debug", "tv.lttv.blitz"), "lttv", "lttv-blitz.apk", "Every NFL game this week", "#16A34A"),
        Mine("LTTube", listOf("com.lttube.tv"), "lttube-firetv", "LTTube-TV.apk", "Ad-free YouTube", "#FF0033"),
        Mine("LT Music", listOf("com.lttube.music"), "lttube-firetv", "LTMusic.apk", "Ad-free YouTube Music, with lyrics", "#C026D3", tag = "music"),
        Mine("LTTV Home", listOf("tv.lttv.home"), "lttv", "lttv-home.apk", "This home screen", "#7C3AED"),
    )

    private val popular = listOf(
        Popular("Netflix", "com.netflix.ninja", "#B00710"), Popular("YouTube", "com.amazon.firetv.youtube", "#CC0000"),
        Popular("Prime Video", "com.amazon.avod", "#1A98FF"), Popular("Disney+", "com.disney.disneyplus", "#113CCF"),
        Popular("Hulu", "com.hulu.plus", "#1CE783"), Popular("HBO Max", "com.wbd.stream", "#002BE7"),
        Popular("Peacock", "com.peacocktv.peacockandroid", "#222222"), Popular("Paramount+", "com.cbs.ott", "#0064FF"),
        Popular("Apple TV", "com.apple.atve.amazon.appletv", "#333333"), Popular("YouTube TV", "com.amazon.firetv.youtube.tv", "#CC0000"),
        Popular("Sling TV", "com.sling", "#0A7AFF"), Popular("ESPN", "com.espn.gtv", "#C8102E"),
        Popular("Spotify", "com.spotify.tv.android", "#1DB954"), Popular("Twitch", "tv.twitch.android.viewer", "#9146FF"),
        Popular("Pluto TV", "tv.pluto.android", "#2A2A2A"), Popular("Tubi", "com.tubitv", "#7408FF"),
        Popular("Plex", "com.plexapp.android", "#1F1F1F"), Popular("Downloader", "com.esaba.downloader", "#E67E22"),
        Popular("VLC", "org.videolan.vlc", "#FF8800"), Popular("Fox Sports", "com.foxsports.videogo", "#003366"),
    )

    private val main = Handler(Looper.getMainLooper())
    lateinit var page: View
    private fun dp(v: Int) = Glass.dp(a, v)

    fun build(): View {
        val scroll = ScrollView(a).apply { isFillViewport = true; isClickable = true; background = Glass.sheet(a) }
        val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        val head = Glass.row(a)
        head.addView(Glass.text(a, 32f, bold = true).apply { text = "Store" }, LinearLayout.LayoutParams(0, -2, 1f))
        head.addView(Glass.button(a, "Install from a link") { linkDialog() })
        head.addView(View(a), LinearLayout.LayoutParams(dp(10), 1))
        head.addView(Glass.button(a, "Amazon Appstore") { openAppstore(null) })
        head.addView(View(a), LinearLayout.LayoutParams(dp(10), 1))
        head.addView(Glass.button(a, "⌂  Home") { onClose() })
        col.addView(head)

        col.addView(section("Your apps"))
        col.addView(grid(mine.map { m -> tile(m.name, m.about, m.color, installedPkg(m.pkgs) != null) { mineMenu(m) } }))
        col.addView(section("Install right here"))
        col.addView(grid(direct.map { d -> tile(d.name, if (installed(d.pkg)) "Installed · press to update" else d.about, d.color, false) { directAction(d) } }))
        col.addView(section("Popular apps"))
        col.addView(grid(popular.map { p -> tile(p.name, if (installed(p.pkg)) "Installed" else "Get it on the Appstore", p.color, installed(p.pkg)) { popularAction(p) } }))
        col.addView(Glass.text(a, 13f, "#8A93A3").apply {
            text = "Your apps and \"Install right here\" apps download and install inside LTTV Home, straight from their makers. Netflix, Hulu, Disney+ and other big apps are only offered by Amazon on Fire TV, so those open their install page. \"Install from a link\" works like Downloader."
            setPadding(dp(8), dp(18), 0, 0)
        })
        scroll.addView(col)
        page = scroll
        scroll.post { (col.getChildAt(2) as? GridLayout)?.getChildAt(0)?.requestFocus() }
        return scroll
    }

    private fun section(t: String) = Glass.text(a, 19f, bold = true).apply { text = t; setPadding(dp(8), dp(24), 0, dp(6)) }

    private fun grid(tiles: List<View>) = GridLayout(a).apply {
        val cols = 4
        columnCount = cols
        val sw = a.resources.displayMetrics.widthPixels
        val w = (sw - dp(112) - cols * dp(16)) / cols
        for (t in tiles) addView(t, GridLayout.LayoutParams().apply { width = w; height = dp(118); setMargins(dp(8), dp(8), dp(8), dp(8)) })
    }

    private fun tile(name: String, sub: String, color: String, have: Boolean, click: () -> Unit): View {
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            isFocusable = true; isClickable = true
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = Glass.surface(a, 16)
        }
        val badge = TextView(a).apply {
            text = name.take(1); gravity = Gravity.CENTER; setTextColor(Color.WHITE)
            textSize = 22f; typeface = Fonts.bold
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor(color)) }
        }
        box.addView(badge, LinearLayout.LayoutParams(dp(54), dp(54)))
        val txt = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, 0, 0) }
        val n = Glass.text(a, 16f, bold = true).apply { text = name; maxLines = 1 }
        val s = Glass.text(a, 12f, "#B8C0CC").apply { text = if (have) "✓ Installed" else sub; maxLines = 2 }
        txt.addView(n); txt.addView(s)
        box.addView(txt, LinearLayout.LayoutParams(0, -2, 1f))
        box.setOnClickListener { click() }
        box.setOnFocusChangeListener { v, f ->
            v.background = Glass.surface(a, 16, f)
            n.setTextColor(Color.parseColor(if (f) "#0B0D12" else "#FFFFFF"))
            s.setTextColor(Color.parseColor(if (f) "#3A4250" else "#B8C0CC"))
            Glass.lift(v, f)
        }
        return box
    }

    // ---- your apps ----------------------------------------------------------------------------
    /** Home → Search: Store apps whose name matches (title, what happens, action). */
    fun searchEntries(q: String): List<Triple<String, String, () -> Unit>> {
        val t = q.trim().lowercase()
        if (t.isEmpty()) return emptyList()
        val out = mutableListOf<Triple<String, String, () -> Unit>>()
        for (m in mine) if (m.name.lowercase().contains(t)) out += Triple(m.name, if (installedPkg(m.pkgs) != null) "Installed · Your apps" else "Install · Your apps", { mineMenu(m) })
        for (d in direct) if (d.name.lowercase().contains(t)) out += Triple(d.name, if (installed(d.pkg)) "Installed" else "Install right here", { directAction(d) })
        for (p in popular) if (p.name.lowercase().contains(t)) out += Triple(p.name, if (installed(p.pkg)) "Installed" else "Get it on the Appstore", { popularAction(p) })
        return out
    }

    private fun installed(pkg: String) = try { a.packageManager.getPackageInfo(pkg, 0); true } catch (_: Exception) { false }
    private fun installedPkg(pkgs: List<String>) = pkgs.firstOrNull { installed(it) }

    private fun mineMenu(m: Mine) {
        val pkg = installedPkg(m.pkgs)
        val url = "https://github.com/lknicks9-a11y/${m.repo}/releases/" + (if (m.tag != null) "download/${m.tag}" else "latest/download") + "/${m.asset}"
        val items = mutableListOf<Pair<String, () -> Unit>>()
        if (pkg != null) items += "Open" to { launch(pkg) }
        items += (if (pkg != null) "Update to the latest version" else "Install") to { install(url, m.name) }
        AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle(m.name)
            .setItems(items.map { it.first }.toTypedArray()) { _, w -> items[w].second() }
            .show()
    }

    private fun launch(pkg: String) {
        val i = a.packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: a.packageManager.getLaunchIntentForPackage(pkg)
        if (i != null) a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) else toast("Couldn't open it")
    }

    // ---- popular apps -------------------------------------------------------------------------
    private fun directAction(d: Direct) {
        if (installed(d.pkg)) {
            AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle(d.name)
                .setItems(arrayOf("Open", "Update to the newest version")) { _, w -> if (w == 0) launch(d.pkg) else resolveAndInstall(d) }
                .show()
        } else resolveAndInstall(d)
    }

    /** Finds the maker's newest app file (GitHub release or their download folder), best fit for this TV. */
    private fun resolveAndInstall(d: Direct) {
        Toast.makeText(a, "Finding the newest ${d.name}…", Toast.LENGTH_SHORT).show()
        Thread {
            val url = try { if (d.github != null) fromGithub(d.github) else fromListing(d.listing!!, d.file!!) } catch (_: Exception) { null }
            main.post { if (url != null) install(url, d.name) else toast("Couldn't find ${d.name}'s download right now. Try again later.") }
        }.start()
    }

    private fun fetchText(url: String, accept: String? = null): String {
        var u = URL(url); var hops = 0
        while (true) {
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false; c.connectTimeout = 15_000; c.readTimeout = 20_000
            c.setRequestProperty("User-Agent", "LTTV-Home")
            if (accept != null) c.setRequestProperty("Accept", accept)
            val code = c.responseCode
            if (code in 300..399 && hops++ < 8) { u = URL(u, c.getHeaderField("Location")); c.disconnect(); continue }
            if (code != 200) throw Exception("HTTP $code")
            return c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() }
        }
    }

    private fun abiScore(name: String): Int {
        val n = name.lowercase()
        if (n.contains("x86")) return -1
        val abis = Build.SUPPORTED_ABIS.map { it.lowercase() }
        abis.forEachIndexed { i, abi -> if (n.contains(abi.replace("-", "_")) || n.contains(abi)) return 100 - i }
        if (n.contains("universal")) return 50
        if (n.contains("arm64") || n.contains("armeabi") || n.contains("arm")) return -1 // another processor's build
        return 40
    }

    private fun fromGithub(repo: String): String? {
        val j = org.json.JSONObject(fetchText("https://api.github.com/repos/$repo/releases/latest", "application/vnd.github+json"))
        val assets = j.optJSONArray("assets") ?: return null
        val apks = (0 until assets.length()).map { assets.getJSONObject(it) }
            .filter { it.optString("name").endsWith(".apk", true) && !it.optString("name").contains("debug", true) }
        return apks.filter { abiScore(it.optString("name")) >= 0 }.maxByOrNull { abiScore(it.optString("name")) }?.optString("browser_download_url")
    }

    private fun fromListing(base: String, file: Regex): String? {
        val html = fetchText(base)
        val names = file.findAll(html).map { it.value }.toSet()
        // newest version: compare the numbers in the file names
        fun ver(n: String) = Regex("""\d+""").findAll(n).map { it.value.toInt() }.toList()
        val best = names.maxWithOrNull { x, y ->
            val a1 = ver(x); val b1 = ver(y)
            (0 until maxOf(a1.size, b1.size)).map { (a1.getOrElse(it) { 0 }).compareTo(b1.getOrElse(it) { 0 }) }.firstOrNull { it != 0 } ?: 0
        } ?: return null
        return base + best
    }

    private fun popularAction(p: Popular) {
        if (installed(p.pkg)) launch(p.pkg) else openAppstore(p.pkg)
    }

    private fun openAppstore(pkg: String?) {
        val tries = if (pkg != null) listOf(
            Intent(Intent.ACTION_VIEW, Uri.parse("amzn://apps/android?p=$pkg")),
            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.amazon.com/gp/mas/dl/android?p=$pkg")),
        ) else emptyList()
        for (i in tries) { try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) { } }
        for (p in listOf("com.amazon.venezia", "com.amazon.appstore")) {
            (a.packageManager.getLeanbackLaunchIntentForPackage(p) ?: a.packageManager.getLaunchIntentForPackage(p))?.let {
                a.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return
            }
        }
        toast("The Amazon Appstore isn't available")
    }

    // ---- install from a link ------------------------------------------------------------------
    private fun linkDialog() {
        val input = EditText(a).apply {
            setText("https://"); setSelection(text.length)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle("Install from a link")
            .setMessage("Type the address of an .apk file (or a page that downloads one).")
            .setView(input)
            .setPositiveButton("Download") { _, _ ->
                var u = input.text.toString().trim()
                if (!u.startsWith("http")) u = "https://$u"
                install(u, u.substringAfterLast('/').ifBlank { "app" })
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // ---- download + install -------------------------------------------------------------------
    fun install(url: String, name: String) {
        if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
                .setTitle("Allow LTTV Home to install apps")
                .setMessage("Fire TV needs your OK once. Turn on \"Allow from this source\" on the next screen, then come back and try again.")
                .setPositiveButton("Open settings") { _, _ ->
                    try { a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${a.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    catch (_: Exception) { toast("Settings → My Fire TV → Developer options → Install unknown apps → LTTV Home") }
                }
                .setNegativeButton("Cancel", null).show()
            return
        }
        val bar = ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; setPadding(dp(24), dp(24), dp(24), dp(24)) }
        val dlg = AlertDialog.Builder(a, AlertDialog.THEME_DEVICE_DEFAULT_DARK).setTitle("Downloading $name…").setView(bar).setCancelable(false).show()
        Thread {
            val result = try { Result.success(download(url) { p -> main.post { bar.progress = p } }) } catch (e: Exception) { Result.failure(e) }
            main.post {
                dlg.dismiss()
                result.onSuccess { openInstaller(it) }
                result.onFailure { toast("Download failed: ${it.message ?: "network error"}") }
            }
        }.start()
    }

    private fun download(url: String, progress: (Int) -> Unit): File {
        val dir = if (Build.VERSION.SDK_INT >= 24) File(a.cacheDir, "apk") else (a.getExternalFilesDir("apk") ?: File(a.cacheDir, "apk"))
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "download.apk")
        var u = URL(url)
        var conn: HttpURLConnection
        var hops = 0
        while (true) {
            conn = u.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15_000; conn.readTimeout = 60_000
            conn.setRequestProperty("User-Agent", "LTTV-Home")
            val code = conn.responseCode
            if (code in 300..399 && hops++ < 8) { u = URL(u, conn.getHeaderField("Location")); conn.disconnect(); continue }
            if (code != 200) throw Exception("HTTP $code")
            break
        }
        val total = conn.contentLengthLong
        conn.inputStream.use { inp ->
            out.outputStream().use { os ->
                val buf = ByteArray(64 * 1024)
                var got = 0L
                var last = -1
                while (true) {
                    val n = inp.read(buf); if (n <= 0) break
                    os.write(buf, 0, n); got += n
                    val pct = if (total > 0) (got * 100 / total).toInt() else 0
                    if (pct != last) { last = pct; progress(pct) }
                }
            }
        }
        conn.disconnect()
        // a quick check that it's really an app (a zip file)
        val head = out.inputStream().use { val b = ByteArray(2); it.read(b); b }
        if (head[0] != 'P'.code.toByte() || head[1] != 'K'.code.toByte()) throw Exception("that link isn't an app (.apk) file")
        out.setReadable(true, false)
        return out
    }

    private fun openInstaller(f: File) {
        try {
            val uri = if (Build.VERSION.SDK_INT >= 24) Uri.parse("content://${a.packageName}.apk/${f.name}") else Uri.fromFile(f)
            val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            a.startActivity(i)
        } catch (e: Exception) {
            toast("Couldn't open the installer: ${e.message}")
        }
    }

    private fun toast(m: String) = Toast.makeText(a, m, Toast.LENGTH_LONG).show()
}

/** Hands the downloaded .apk to Fire TV's installer (a tiny file provider, no extra libraries). */
class ApkProvider : ContentProvider() {
    override fun onCreate() = true
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val f = File(File(context!!.cacheDir, "apk"), uri.lastPathSegment ?: return null)
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun getType(uri: Uri) = "application/vnd.android.package-archive"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
