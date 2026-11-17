package tv.lttv.home

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.SpannableString
import android.text.Spanned
import android.text.TextUtils
import android.text.format.DateFormat
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.Date

/**
 * LTTV Home: a separate app that replaces the Fire TV home screen with a clean, ad-free one,
 * laid out like a TV home screen — a menu bar across the top, a large featured banner, then
 * rows of apps:
 *
 *  - Menu: Home, Live, Sports, Movies, Shows (open LTTV on that section), Apps, Settings, time.
 *  - Featured: LTTV's Live TV / Sports / Movies / Shows, turning every few seconds (◀ ▶ to flip).
 *  - Your Apps: LTTV, LTTV Movies, LTTV Shows, LTTV League Pass, LTTV Blitz, then your streaming apps (Hulu, Netflix, Max,
 *    Paramount+, Disney+, YouTube...) — the real apps installed on the TV.
 *  - All Apps: everything installed, A–Z.
 *
 * Hold Select (or press Menu) on an app to add, remove or move it. Fire OS has no setting to
 * choose a home app, so this is set with Launcher Manager Mini (or a remote's app button).
 */
class HomeActivity : Activity() {

    private data class App(val pkg: String, val cls: String, val label: String, val leanback: Boolean) {
        val key get() = "$pkg/$cls"
    }

    /** [cls]: the LTTV tile whose photo (if the user added one) is shown behind this slide. */
    private data class Slide(val title: String, val sub: String, val screen: String, val top: String, val accent: String, val cls: String)

    private val slides = listOf(
        Slide("Live TV", "Every channel from your playlists, with the guide", "home", "#0E3A5C", "#4CC2FF", "MainActivity"),
        Slide("Sports", "Today's games, live scores and the channel they're on", "sports", "#0F4A2E", "#4ADE80", "MainActivity"),
        Slide("Movies", "Your movie library, ready to play", "movies", "#5C1420", "#FF6B6B", "MoviesAlias"),
        Slide("Shows", "Your shows, season by season", "shows", "#2E1A5C", "#B08CFF", "ShowsAlias"),
        Slide("League Pass", "Every NBA game tonight, live", "leaguepass", "#5C2A0C", "#FF8A3D", "LeaguePassAlias"),
        Slide("Blitz", "Every NFL game, live, in one place", "blitz", "#4A3A08", "#FFC83D", "BlitzAlias"),
    )

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }
    private lateinit var scroll: ScrollView
    private lateinit var rows: LinearLayout
    private lateinit var clock: TextView
    private lateinit var hero: FrameLayout
    private lateinit var heroTitle: TextView
    private lateinit var heroSub: TextView
    private lateinit var heroLabel: TextView
    private lateinit var heroButton: TextView
    private lateinit var heroDots: LinearLayout
    private var allAppsTitle: View? = null
    private var firstGridTile: View? = null
    private var slide = 0
    private var apps: List<App> = emptyList()
    private var focusKey: String? = null
    private var focusRow: String? = null
    private var firstShow = true
    private lateinit var root: FrameLayout
    /** The Settings page, while it's open. */
    private var settingsPage: View? = null
    /** "Photos for your apps", while it's open, and its little web server. */
    private var photosPage: View? = null
    private var artServer: ArtServer? = null
    private lateinit var bgPhoto: ImageView
    private lateinit var bgShade: View
    private lateinit var heroPhoto: ImageView
    private lateinit var heroShade: View
    private lateinit var heroBadge: ImageView
    private var lttv: String? = null

    private val tick = object : Runnable {
        override fun run() {
            clock.text = DateFormat.getTimeFormat(this@HomeActivity).format(Date())
            main.postDelayed(this, 15_000)
        }
    }
    private val turn = object : Runnable {
        override fun run() {
            if (!hero.isFocused) showSlide(slide + 1)
            main.postDelayed(this, 7_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#08080A"))

        scroll = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false; isSmoothScrollingEnabled = true }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(18), dp(40), dp(40))
            clipChildren = false; clipToPadding = false
        }
        column.addView(topBar())
        column.addView(buildHero(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(250)).apply { topMargin = dp(16) })
        rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
        column.addView(rows)
        scroll.addView(column)
        // The user's own background photo (Settings → Photos for your apps), dimmed so the rows stay readable.
        bgPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        bgShade = View(this).apply { setBackgroundColor(Color.parseColor("#C808080A")) }
        root.addView(bgPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(bgShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        showSlide(0)
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        main.postDelayed(turn, 7_000)
        rebuild() // apps may have been installed or removed while away
        applyBackground()
        showSlide(slide)
        if (firstShow) { firstShow = false; hero.post { hero.requestFocus() } }
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
        main.removeCallbacks(turn)
    }

    /** Pressing Home again while on the home screen goes back to the top. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closePhotos()
        closeSettings()
        goTop()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Back closes Settings; on the home screen (the bottom of the stack) it returns to the top.
        if (photosPage != null) closePhotos() else if (settingsPage != null) closeSettings() else goTop()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            val tag = currentFocus?.tag as? Pair<*, *>
            val app = tag?.second as? App
            if (app != null) { showOptions(app); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun goTop() {
        scroll.smoothScrollTo(0, 0)
        hero.requestFocus()
    }

    // ---- top bar --------------------------------------------------------------------------

    private fun topBar(): LinearLayout {
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val logo = SpannableString("LTTV").apply {
            setSpan(ForegroundColorSpan(Color.parseColor("#F4F4F6")), 0, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            setSpan(ForegroundColorSpan(Color.parseColor("#4CC2FF")), 2, 4, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        bar.addView(TextView(this).apply {
            text = logo
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setPadding(dp(4), 0, dp(22), 0)
        })
        bar.addView(navItem("Home") { goTop() })
        bar.addView(navItem("Live") { openLttv("home") })
        bar.addView(navItem("Sports") { openLttv("sports") })
        bar.addView(navItem("Movies") { openLttv("movies") })
        bar.addView(navItem("Shows") { openLttv("shows") })
        bar.addView(navItem("Apps") {
            allAppsTitle?.let { t -> scroll.smoothScrollTo(0, (t.parent as View).top + t.top - dp(10)) }
            firstGridTile?.requestFocus()
        })
        bar.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        bar.addView(navItem("Settings") { showSettings() })
        clock = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setPadding(dp(18), 0, dp(4), 0)
        }
        bar.addView(clock)
        return bar
    }

    private fun navItem(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        setTextColor(Color.parseColor("#B8C0CC"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setPadding(dp(16), dp(7), dp(16), dp(7))
        isFocusable = true; isClickable = true
        background = pill(false)
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f ->
            v.background = pill(f)
            (v as TextView).setTextColor(if (f) Color.parseColor("#08080A") else Color.parseColor("#B8C0CC"))
            v.typeface = if (f) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(4) }
    }

    private fun pill(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(if (focused) Color.WHITE else Color.TRANSPARENT)
    }

    // ---- featured banner ------------------------------------------------------------------

    private fun buildHero(): FrameLayout {
        hero = FrameLayout(this).apply {
            isFocusable = true; isClickable = true
            clipToOutline = true
            setOnClickListener { openLttv(slides[slide].screen) }
            setOnKeyListener { _, code, ev ->
                if (ev.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
                when (code) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> { showSlide(slide - 1); true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { showSlide(slide + 1); true }
                    else -> false
                }
            }
            setOnFocusChangeListener { _, _ -> showSlide(slide) }
        }
        // The user's photo for this slide (if any), shaded on the left so the words stay readable.
        heroPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        hero.addView(heroPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        heroShade = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor("#E6000000"), Color.parseColor("#80000000"), Color.parseColor("#10000000")))
        }
        hero.addView(heroShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // The LTTV badge, large, on the right (when there's no photo).
        heroBadge = ImageView(this).apply {
            setImageResource(R.drawable.badge)
            alpha = 0.9f
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        hero.addView(heroBadge, FrameLayout.LayoutParams(dp(170), dp(170), Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = dp(60) })

        val text = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(40), dp(30), dp(40), dp(26)) }
        heroLabel = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.18f
        }
        heroTitle = TextView(this).apply {
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 46f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        }
        heroSub = TextView(this).apply {
            setTextColor(Color.parseColor("#D0D6DE")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setPadding(0, dp(4), 0, dp(16))
        }
        heroButton = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(20), dp(9), dp(22), dp(9))
        }
        text.addView(heroLabel); text.addView(heroTitle); text.addView(heroSub)
        text.addView(heroButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        hero.addView(text, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        heroDots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        hero.addView(heroDots, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(14) })
        return hero
    }

    private fun showSlide(i: Int) {
        slide = ((i % slides.size) + slides.size) % slides.size
        val s = slides[slide]
        val focused = hero.isFocused
        hero.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor(s.top), Color.parseColor("#101218"))).apply {
            cornerRadius = dp(18).toFloat()
        }
        // The focus ring is drawn on top, so it shows over a photo too.
        hero.foreground = if (focused) GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setStroke(dp(3), Color.WHITE) } else null
        val photo = lttv?.let { Art.drawable(this, "$it/tv.lttv.app.${s.cls}") }
        heroPhoto.setImageDrawable(photo)
        heroShade.visibility = if (photo != null) View.VISIBLE else View.GONE
        heroBadge.visibility = if (photo != null) View.GONE else View.VISIBLE
        heroLabel.text = "LTTV"
        heroLabel.setTextColor(Color.parseColor(s.accent))
        heroTitle.text = s.title
        heroSub.text = s.sub
        heroButton.text = "▶  Open ${s.title}"
        heroButton.setTextColor(if (focused) Color.parseColor("#08080A") else Color.WHITE)
        heroButton.background = GradientDrawable().apply {
            cornerRadius = dp(22).toFloat()
            setColor(if (focused) Color.WHITE else Color.parseColor("#33FFFFFF"))
        }
        heroDots.removeAllViews()
        for (n in slides.indices) {
            heroDots.addView(View(this).apply {
                background = GradientDrawable().apply { cornerRadius = dp(4).toFloat(); setColor(if (n == slide) Color.WHITE else Color.parseColor("#55FFFFFF")) }
            }, LinearLayout.LayoutParams(dp(if (n == slide) 22 else 8), dp(8)).apply { marginStart = dp(4); marginEnd = dp(4) })
        }
    }

    // ---- apps -----------------------------------------------------------------------------

    /** LTTV's own package (the GitHub build is "tv.lttv.app.debug"). */
    private fun lttvPkg(): String? = LTTV_PACKAGES.firstOrNull { p ->
        try { packageManager.getPackageInfo(p, 0); true } catch (_: Exception) { false }
    }

    private fun loadApps(): List<App> {
        val pm = packageManager
        val lttv = lttvPkg()
        val found = LinkedHashMap<String, App>()
        fun add(list: List<ResolveInfo>, leanback: Boolean) {
            for (r in list) {
                val ai = r.activityInfo ?: continue
                if (ai.packageName == packageName) continue
                // One tile per app (TV entry wins) — except LTTV, which has Live, Movies and Shows.
                val id = if (ai.packageName == lttv) "${ai.packageName}/${ai.name}" else ai.packageName
                if (found.containsKey(id)) continue
                val label = r.loadLabel(pm).toString().trim().ifEmpty { ai.packageName }
                found[id] = App(ai.packageName, ai.name, label, leanback)
            }
        }
        add(query(Intent.CATEGORY_LEANBACK_LAUNCHER), true)
        add(query(Intent.CATEGORY_LAUNCHER), false)
        return found.values.sortedBy { it.label.lowercase() }
    }

    private fun query(category: String): List<ResolveInfo> =
        try { packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(category), 0) } catch (_: Exception) { emptyList() }

    /** Saved order; the first time: LTTV, LTTV Movies, LTTV Shows, then the usual streaming apps that are installed. */
    private fun favorites(): List<App> {
        val byKey = apps.associateBy { it.key }
        val saved = prefs.getString("favs", null)
        if (saved != null) return saved.split('\n').mapNotNull { byKey[it] }.distinctBy { it.key }
        val lttv = lttvPkg()
        val picks = apps.filter { it.pkg == lttv }.toMutableList()
        for (word in DEFAULT_PICKS) {
            val hit = apps.firstOrNull { a ->
                val l = a.label.lowercase()
                a.pkg != lttv && Regex("\\b${Regex.escape(word)}\\b").containsMatchIn(l) && !l.contains("kids") && picks.none { it.pkg == a.pkg }
            }
            if (hit != null) picks += hit
        }
        return picks
    }

    private fun saveFavorites(list: List<App>) {
        prefs.edit().putString("favs", list.joinToString("\n") { it.key }).apply()
    }

    private fun open(app: App) {
        try {
            startActivity(
                Intent(Intent.ACTION_MAIN)
                    .addCategory(if (app.leanback) Intent.CATEGORY_LEANBACK_LAUNCHER else Intent.CATEGORY_LAUNCHER)
                    .setComponent(ComponentName(app.pkg, app.cls))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED),
            )
        } catch (_: Exception) {
            val fallback = packageManager.getLeanbackLaunchIntentForPackage(app.pkg) ?: packageManager.getLaunchIntentForPackage(app.pkg)
            if (fallback != null) startActivity(fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            else toast("Couldn't open ${app.label}")
        }
    }

    /** Opens LTTV on a section: home (Live TV), sports, movies or shows. */
    private fun openLttv(screen: String) {
        val pkg = lttvPkg() ?: return toast("Install LTTV first")
        try {
            startActivity(
                Intent(Intent.ACTION_MAIN)
                    .setComponent(ComponentName(pkg, "tv.lttv.app.MainActivity"))
                    .putExtra("screen", screen)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {
            packageManager.getLaunchIntentForPackage(pkg)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private fun openSettings() {
        try { startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { toast("Settings isn't available") }
    }

    private fun showOptions(app: App) {
        val favs = favorites().toMutableList()
        val idx = favs.indexOfFirst { it.key == app.key }
        val items = mutableListOf<Pair<String, () -> Unit>>()
        items += "Open" to { open(app) }
        fun change(row: String) { saveFavorites(favs); focusRow = row; focusKey = app.key; rebuild() }
        if (idx >= 0) {
            if (idx > 0) items += "Move left" to { favs.add(idx - 1, favs.removeAt(idx)); change("fav") }
            if (idx < favs.size - 1) items += "Move right" to { favs.add(idx + 1, favs.removeAt(idx)); change("fav") }
            if (idx > 0) items += "Move to front" to { favs.add(0, favs.removeAt(idx)); change("fav") }
            items += "Remove from Your Apps" to { favs.removeAt(idx); change("all") }
        } else {
            items += "Add to Your Apps" to { favs += app; change("fav") }
        }
        items += "App info" to {
            try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.pkg}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        }
        AlertDialog.Builder(this, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle(app.label)
            .setItems(items.map { it.first }.toTypedArray()) { _, which -> items[which].second() }
            .show()
    }

    // ---- photos for your apps -------------------------------------------------------------

    private fun applyBackground() {
        val d = Art.drawable(this, Art.BACKGROUND)
        bgPhoto.setImageDrawable(d)
        bgShade.visibility = if (d != null) View.VISIBLE else View.GONE
    }

    /** Shows the address to open on a phone / computer, and serves that page while it's open. */
    private fun showPhotos() {
        if (photosPage != null) return
        val pm = packageManager
        val list = apps.sortedBy { if (it.pkg == lttv) 0 else 1 }.map { a ->
            val comp = ComponentName(a.pkg, a.cls)
            val d: Drawable? = try { pm.getActivityBanner(comp) ?: pm.getApplicationBanner(a.pkg) ?: pm.getActivityIcon(comp) } catch (_: Exception) { null }
            Triple(a.key, a.label, d)
        }
        val server = ArtServer(this, { list }) {
            runOnUiThread {
                rebuild()
                showSlide(slide)
                applyBackground()
            }
        }
        val started = server.start()
        artServer = server
        val address = if (started) server.address() else null

        val page = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#F508080A")); isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(60), dp(50), dp(60), dp(40)) }
        col.addView(TextView(this).apply {
            text = "Photos for your apps"
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        })
        col.addView(TextView(this).apply {
            text = if (address != null) "On your phone or computer (on the same Wi-Fi as this TV), open:" else "Connect this TV to Wi-Fi to add photos."
            setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            setPadding(0, dp(26), 0, dp(14))
        })
        if (address != null) {
            col.addView(TextView(this).apply {
                text = address.removePrefix("http://")
                setTextColor(Color.parseColor("#4CC2FF")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
                typeface = Typeface.create("monospace", Typeface.BOLD)
                setPadding(dp(28), dp(14), dp(28), dp(14))
                background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#161B22")); setStroke(dp(1), Color.parseColor("#2A323D")) }
            })
            col.addView(TextView(this).apply {
                text = "Pick a photo for any app — LTTV, LTTV Movies, Hulu, YouTube… — or for the home screen background.\n" +
                    "It shows here right away. Your photos stay on this TV."
                setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                gravity = Gravity.CENTER
                setPadding(0, dp(22), 0, dp(26))
            })
        }
        val done = TextView(this).apply {
            text = "Done"
            setTextColor(Color.parseColor("#08080A")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(40), dp(10), dp(40), dp(10))
            isFocusable = true; isClickable = true
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.WHITE) }
            setOnClickListener { closePhotos() }
        }
        col.addView(done)
        page.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        photosPage = page
        done.post { done.requestFocus() }
    }

    private fun closePhotos() {
        artServer?.stop()
        artServer = null
        val p = photosPage ?: return
        root.removeView(p)
        photosPage = null
        val sp = settingsPage
        if (sp != null) sp.post { sp.requestFocus() } else hero.requestFocus()
    }

    override fun onDestroy() {
        artServer?.stop()
        super.onDestroy()
    }

    // ---- settings -------------------------------------------------------------------------

    private data class Setting(val title: String, val sub: String, val icon: String, val action: () -> Unit)

    /** A grid of settings like the TV's own: each opens that part of the Fire TV settings. */
    private fun showSettings() {
        if (settingsPage != null) return
        val tv = listOf(
            Setting("Network", "Wi-Fi and internet", "📶") { system(Settings.ACTION_WIFI_SETTINGS) },
            Setting("Display & Sounds", "Resolution, screen, audio", "🖥") { system(Settings.ACTION_DISPLAY_SETTINGS, Settings.ACTION_SOUND_SETTINGS) },
            Setting("Applications", "Installed apps, storage, data", "▦") { system(Settings.ACTION_APPLICATION_SETTINGS, Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS) },
            Setting("Controllers & Bluetooth", "Remotes, game controllers, headphones", "🎮") { system(Settings.ACTION_BLUETOOTH_SETTINGS) },
            Setting("Accessibility", "Captions, text size, screen reader", "♿") { system(Settings.ACTION_ACCESSIBILITY_SETTINGS) },
            Setting("Language", "Language and keyboard", "🌐") { system(Settings.ACTION_LOCALE_SETTINGS) },
            Setting("Date & Time", "Time zone and clock", "🕒") { system(Settings.ACTION_DATE_SETTINGS) },
            Setting("Storage", "Free space on this TV", "💾") { system(Settings.ACTION_INTERNAL_STORAGE_SETTINGS) },
            Setting("Privacy", "Location, data and permissions", "🔒") { system(Settings.ACTION_PRIVACY_SETTINGS, Settings.ACTION_SECURITY_SETTINGS) },
            Setting("My TV", "About, software updates, restart", "ℹ") { system(Settings.ACTION_DEVICE_INFO_SETTINGS) },
            Setting("All TV Settings", "Everything else", "⚙") { system(Settings.ACTION_SETTINGS) },
        )
        val home = listOf(
            Setting("Reset Your Apps", "Back to LTTV and your streaming apps", "↺") {
                prefs.edit().remove("favs").apply()
                toast("Your Apps reset")
                rebuild()
            },
            Setting("Amazon Home", "Open the TV's original home screen", "⌂") {
                val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("com.amazon.tv.launcher").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(i) } catch (_: Exception) { toast("The original home screen isn't available") }
            },
            Setting("Photos for your apps", "Add your own pictures from your phone", "🖼") { showPhotos() },
            Setting("LTTV Settings", "Playlists, guide, profiles", "★") { openLttv("settings") },
        )

        val page = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F208080A")); isFillViewport = true; isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(TextView(this).apply {
            text = "Settings"
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
        })
        col.addView(sectionTitle("TV"))
        col.addView(settingsGrid(tv))
        col.addView(sectionTitle("Home screen"))
        col.addView(settingsGrid(home))
        page.addView(col)
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        settingsPage = page
        page.post { (((col.getChildAt(2) as? GridLayout)?.getChildAt(0)))?.requestFocus() }
    }

    private fun closeSettings() {
        val p = settingsPage ?: return
        root.removeView(p)
        settingsPage = null
        hero.requestFocus()
    }

    private fun settingsGrid(items: List<Setting>) = GridLayout(this).apply {
        columnCount = 4
        setPadding(0, dp(8), 0, dp(8))
        for (x in items) addView(settingTile(x))
    }

    private fun settingTile(s: Setting) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        isFocusable = true; isClickable = true
        setPadding(dp(14), dp(16), dp(14), dp(16))
        background = cardBg(false)
        layoutParams = GridLayout.LayoutParams().apply { width = dp(196); height = dp(124); setMargins(dp(8), dp(8), dp(8), dp(8)) }
        addView(TextView(this@HomeActivity).apply {
            text = s.icon; gravity = Gravity.CENTER
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        })
        addView(TextView(this@HomeActivity).apply {
            text = s.title; gravity = Gravity.CENTER
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(6), 0, dp(2))
        })
        addView(TextView(this@HomeActivity).apply {
            text = s.sub; gravity = Gravity.CENTER; maxLines = 2
            setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        })
        setOnClickListener { s.action() }
        setOnFocusChangeListener { v, f ->
            v.background = cardBg(f)
            v.animate().scaleX(if (f) 1.06f else 1f).scaleY(if (f) 1.06f else 1f).setDuration(140).start()
        }
    }

    /** Opens the first of these settings pages the TV has (Fire OS doesn't have them all), else all settings. */
    private fun system(vararg actions: String) {
        for (a in actions) {
            try {
                startActivity(Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: Exception) { /* next */ }
        }
        openSettings()
    }

    // ---- rows -----------------------------------------------------------------------------

    private fun rebuild() {
        val had = currentFocus?.tag as? Pair<*, *>
        if (focusKey == null && had != null) { focusRow = had.first as? String; focusKey = (had.second as? App)?.key }
        lttv = lttvPkg()
        apps = loadApps()
        rows.removeAllViews()
        var toFocus: View? = null

        // Your Apps: one row of large tiles.
        val favs = favorites()
        rows.addView(sectionTitle("Your Apps"))
        val favRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(4), dp(6), dp(4), dp(6)); clipChildren = false }
        for (a in favs) {
            val t = tile(a, "fav", dp(208), dp(117), true)
            favRow.addView(t)
            if (focusRow == "fav" && focusKey == a.key) toFocus = t.getChildAt(0)
        }
        if (favs.isEmpty()) favRow.addView(hint("Hold Select on an app in All Apps to add it here."))
        rows.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false
            addView(favRow)
        })

        // All Apps, A–Z.
        val title = sectionTitle("All Apps")
        allAppsTitle = title
        rows.addView(title)
        val grid = GridLayout(this).apply { columnCount = 6; setPadding(dp(4), dp(6), dp(4), dp(6)) }
        firstGridTile = null
        for (a in apps) {
            val t = tile(a, "all", dp(140), dp(79), false)
            grid.addView(t)
            if (firstGridTile == null) firstGridTile = t.getChildAt(0)
            if (focusRow == "all" && focusKey == a.key) toFocus = t.getChildAt(0)
        }
        rows.addView(grid)

        focusKey = null; focusRow = null
        toFocus?.let { v -> v.post { v.requestFocus() } }
    }

    /** One app: a 16:9 card (its TV banner, or its icon on a dark card) with the name under it. */
    private fun tile(app: App, row: String, w: Int, h: Int, big: Boolean): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(dp(9), dp(8), dp(9), dp(6))
            }
            clipChildren = false
        }
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true
            tag = row to app
            background = cardBg(false)
            setPadding(dp(2), dp(2), dp(2), dp(2))
            clipToOutline = true
        }
        val pm = packageManager
        val comp = ComponentName(app.pkg, app.cls)
        // The user's own photo for this app (Settings → Photos for your apps) comes first.
        val photo = Art.drawable(this, app.key)
        val banner: Drawable? = photo ?: try { pm.getActivityBanner(comp) ?: pm.getApplicationBanner(app.pkg) } catch (_: Exception) { null }
        val img = ImageView(this)
        if (banner != null) {
            img.setImageDrawable(banner)
            img.scaleType = ImageView.ScaleType.CENTER_CROP
            card.addView(img, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            if (photo != null) {
                // A photo doesn't say which app it is: the name sits on it, bottom left.
                card.addView(TextView(this).apply {
                    text = app.label
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 13f else 10f)
                    typeface = Typeface.DEFAULT_BOLD
                    maxLines = 1; ellipsize = TextUtils.TruncateAt.END
                    setPadding(dp(8), dp(14), dp(8), dp(5))
                    background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(Color.parseColor("#D0000000"), Color.TRANSPARENT))
                }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
            }
        } else {
            img.setImageDrawable(try { pm.getActivityIcon(comp) } catch (_: Exception) { pm.defaultActivityIcon })
            img.scaleType = ImageView.ScaleType.FIT_CENTER
            val s = (h * 0.6f).toInt()
            card.addView(img, FrameLayout.LayoutParams(s, s, Gravity.CENTER))
        }
        val name = TextView(this).apply {
            text = app.label
            setTextColor(Color.TRANSPARENT) // names show on focus, like a TV home screen
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 14f else 12f)
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(2), dp(9), dp(2), 0)
            layoutParams = LinearLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        if (banner == null) name.setTextColor(Color.parseColor("#9AA4B2")) // icon-only apps always show their name
        card.setOnClickListener { open(app) }
        card.setOnLongClickListener { showOptions(app); true }
        card.setOnFocusChangeListener { v, focused ->
            v.background = cardBg(focused)
            v.animate().scaleX(if (focused) 1.1f else 1f).scaleY(if (focused) 1.1f else 1f).setDuration(150).start()
            v.translationZ = if (focused) dp(6).toFloat() else 0f
            name.setTextColor(
                when {
                    focused -> Color.WHITE
                    banner == null -> Color.parseColor("#9AA4B2")
                    else -> Color.TRANSPARENT
                },
            )
        }
        box.addView(card, LinearLayout.LayoutParams(w, h))
        box.addView(name)
        return box
    }

    private fun cardBg(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        setColor(Color.parseColor(if (focused) "#232B36" else "#161B22"))
        setStroke(dp(if (focused) 3 else 1), Color.parseColor(if (focused) "#FFFFFF" else "#232A33"))
    }

    private fun sectionTitle(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(Color.parseColor("#E6EAF0"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(12), dp(22), 0, dp(2))
    }

    private fun hint(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(Color.parseColor("#9AA4B2"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(10), dp(20), dp(10), dp(20))
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        val LTTV_PACKAGES = listOf("tv.lttv.app.debug", "tv.lttv.app")
        /** First-run apps after LTTV, in this order, when installed (matched by name). */
        val DEFAULT_PICKS = listOf(
            "hulu", "netflix", "max", "paramount", "disney", "youtube",
            "prime video", "peacock", "espn", "fox sports", "apple tv", "spotify",
        )
    }
}
