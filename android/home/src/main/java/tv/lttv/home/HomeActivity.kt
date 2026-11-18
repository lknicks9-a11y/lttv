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
import android.text.TextUtils
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.Date

/**
 * LTTV Home: a separate app that replaces the Fire TV home screen with a clean, ad-free one.
 * Layout (the "concept" design): a left sidebar — profile, Inputs, Home, Search, Live TV, Saved,
 * Add Apps, Settings — then a big featured banner that turns, and a "Your Apps" grid of the apps
 * installed on the TV, LTTV first. Open an app with Select; hold Select (or Menu) to reorder/remove.
 *
 * Fire OS has no setting to choose a home app, so this is set with Launcher Manager Mini
 * (Downloader code 632067) or a remote's app button.
 */
class HomeActivity : Activity() {

    private data class App(val pkg: String, val cls: String, val label: String, val leanback: Boolean) {
        val key get() = "$pkg/$cls"
    }

    private data class Slide(val title: String, val sub: String, val top: String, val accent: String, val screen: String)

    private val slides = listOf(
        Slide("Live TV", "Every channel from your playlists, with the guide", "#0E3A5C", "#4CC2FF", "guide"),
        Slide("Sports", "Today's games, live scores and the channel they're on", "#0F4A2E", "#4ADE80", "sports"),
        Slide("Movies & Shows", "Pick a streaming service and watch from your provider", "#5C1420", "#FF6B6B", "movies"),
        Slide("League Pass", "Every NBA game, team broadcasts first", "#5C2A0A", "#FF8A1F", "app:leaguepass"),
        Slide("Blitz", "Every NFL game this week", "#0A3A22", "#3DDC84", "app:blitz"),
    )

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }

    private lateinit var root: FrameLayout
    private lateinit var grid: GridLayout
    private lateinit var recRow: LinearLayout
    private lateinit var clock: TextView
    private lateinit var sidebar: LinearLayout
    private lateinit var homeItem: View
    private lateinit var bgPhoto: ImageView
    private lateinit var bgShade: View

    private var apps: List<App> = emptyList()
    private var lttv: String? = null
    private var focusKey: String? = null
    private var firstShow = true
    private var settingsPage: View? = null
    private var photosPage: View? = null
    private var artServer: ArtServer? = null
    private var contentW = 0

    private val tick = object : Runnable {
        override fun run() {
            clock.text = DateFormat.getTimeFormat(this@HomeActivity).format(Date())
            main.postDelayed(this, 15_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Fonts.init(this)
        // Like the TV home screens in the photos: a scenic background, the menu as a list on the left
        // (white bar on the one you're on), and on the right "Recommended" and an "Apps" grid.
        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#2A1F6B"))
        root.addView(ImageView(this).apply { setImageResource(R.drawable.home_scene); scaleType = ImageView.ScaleType.CENTER_CROP },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        bgPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        bgShade = View(this).apply { setBackgroundColor(Color.parseColor("#99100A2A")) }
        root.addView(bgPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(bgShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val sw = resources.displayMetrics.widthPixels
        val sh = resources.displayMetrics.heightPixels
        val side = (sw * 0.045f).toInt()

        val brand = TextView(this).apply {
            text = android.text.SpannableStringBuilder().apply {
                append("LTTV", android.text.style.ForegroundColorSpan(Color.WHITE), 0)
                append("  Home", android.text.style.ForegroundColorSpan(Color.parseColor("#CFC8F0")), 0)
            }
            typeface = Fonts.display; setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f); letterSpacing = -0.02f
        }
        root.addView(brand, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply { leftMargin = side + dp(16); topMargin = (sh * 0.06f).toInt() })
        clock = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f); typeface = Fonts.medium }
        root.addView(clock, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { rightMargin = side; topMargin = (sh * 0.065f).toInt() })

        sidebar = buildSidebar()
        // The menu scrolls, so Settings at the bottom can always be reached.
        val menuScroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = false; clipToPadding = false; setPadding(0, 0, 0, dp(24)); addView(sidebar) }
        root.addView(menuScroll, FrameLayout.LayoutParams((sw * 0.29f).toInt(), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP or Gravity.START).apply { leftMargin = side; topMargin = (sh * 0.17f).toInt() })

        val left = (sw * 0.43f).toInt()
        contentW = sw - left - side
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = true; clipToPadding = false }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(6), 0, dp(40)) }
        col.addView(sectionTitle2("Recommended"))
        recRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(6), dp(6), dp(6), dp(10)) }
        col.addView(android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; addView(recRow) })
        col.addView(sectionTitle2("Apps"))
        grid = GridLayout(this).apply { columnCount = 4; setPadding(dp(2), 0, dp(2), 0) }
        col.addView(grid)
        scroll.addView(col)
        root.addView(scroll, FrameLayout.LayoutParams(contentW + dp(12), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.TOP or Gravity.START).apply { leftMargin = left - dp(6); topMargin = (sh * 0.13f).toInt() })
        buildRecommended()
        Glass.unclip(col)
        setContentView(root)
    }

    private fun sectionTitle2(t: String) = TextView(this).apply {
        text = t; setTextColor(Color.parseColor("#F2EFFF")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); typeface = Fonts.medium
        setPadding(dp(6), dp(14), 0, dp(6))
    }

    // ---- Recommended: LTTV's parts, as big pictures ------------------------------------------------

    private data class Rec(val title: String, val art: Int, val screen: String)
    private val recs = listOf(
        Rec("Live TV", R.drawable.rec_live, "guide"),
        Rec("Sports", R.drawable.rec_sports, "sports"),
        Rec("Movies & Shows", R.drawable.rec_movies, "movies"),
        Rec("League Pass", R.drawable.rec_leaguepass, "app:leaguepass"),
        Rec("Blitz", R.drawable.rec_blitz, "app:blitz"),
    )

    private fun buildRecommended() {
        recRow.removeAllViews()
        val w = (contentW - 2 * dp(16)) / 3
        val h = w * 9 / 16
        recs.forEachIndexed { i, r ->
            val card = FrameLayout(this).apply {
                isFocusable = true; isClickable = true; clipToOutline = true
                background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.parseColor("#33000000")) }
                contentDescription = r.title
                setOnClickListener { openLttv(r.screen) }
            }
            val photo = lttvPkg()?.let { Art.drawable(this, "$it/slide$i") }
            card.addView(ImageView(this).apply { if (photo != null) setImageDrawable(photo) else setImageResource(r.art); scaleType = ImageView.ScaleType.CENTER_CROP },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            card.setOnFocusChangeListener { v, f ->
                v.foreground = if (f) GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setStroke(dp(4), Color.WHITE) } else null
                v.elevation = if (f) dp(12).toFloat() else 0f
                Glass.lift(v, f)
            }
            recRow.addView(card, LinearLayout.LayoutParams(w, h).apply { marginEnd = dp(16) })
        }
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        rebuildGrid()
        applyBackground()
        if (firstShow) { firstShow = false; homeItem.post { homeItem.requestFocus() } }
        main.postDelayed({ if (!isFinishing) Updater.autoCheck(this) }, 4_000)
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closeOverlay(); closePhotos(); closeSettings()
        homeItem.requestFocus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            overlayPage != null -> closeOverlay()
            photosPage != null -> closePhotos()
            settingsPage != null -> closeSettings()
            else -> homeItem.requestFocus()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            (currentFocus?.tag as? App)?.let { showOptions(it); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    // ---- the menu: a list on the left --------------------------------------------------------------

    private fun buildSidebar(): LinearLayout {
        val bar = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val items = listOf<Pair<String, () -> Unit>>(
            "Home" to { recRow.getChildAt(0)?.requestFocus() },
            "Live TV" to { openLttv("guide") },
            "Sports" to { openLttv("sports") },
            "Movies & Shows" to { openLttv("movies") },
            "League Pass" to { openLttv("app:leaguepass") },
            "Blitz" to { openLttv("app:blitz") },
            "Search" to { openLttv("search") },
            "Store" to { showStore() },
            "All Apps" to { showAllApps() },
            "Settings" to { showSettings() },
        )
        for ((label, action) in items) {
            val t = menuItem(label, label == "Home", action)
            if (label == "Home") homeItem = t
            bar.addView(t)
        }
        return bar
    }

    private fun menuItem(label: String, selected: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label; typeface = Fonts.medium; setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        setPadding(dp(18), dp(7), dp(18), dp(7))
        isFocusable = true; isClickable = true
        fun paint(f: Boolean) {
            background = when {
                f -> GradientDrawable().apply { cornerRadius = dp(6).toFloat(); setColor(Color.WHITE) }
                selected -> GradientDrawable().apply { cornerRadius = dp(6).toFloat(); setColor(Color.parseColor("#2EFFFFFF")) }
                else -> null
            }
            setTextColor(if (f) Color.parseColor("#1A1236") else Color.WHITE)
        }
        paint(false)
        setOnClickListener { onClick() }
        setOnFocusChangeListener { _, f -> paint(f) }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(2) }
    }

    private fun profileName(): String = prefs.getString("profile", null) ?: "LTTV"

    private fun scrollTopAndFocus() {
        homeItem.requestFocus()
    }

    // ---- apps -----------------------------------------------------------------------------------

    private fun lttvPkg(): String? = LTTV_PACKAGES.firstOrNull { p ->
        try { packageManager.getPackageInfo(p, 0); true } catch (_: Exception) { false }
    }

    private fun loadApps(): List<App> {
        val pm = packageManager
        val found = LinkedHashMap<String, App>()
        fun add(list: List<ResolveInfo>, leanback: Boolean) {
            for (r in list) {
                val ai = r.activityInfo ?: continue
                if (ai.packageName == packageName) continue
                if (found.containsKey(ai.packageName)) continue
                val label = r.loadLabel(pm).toString().trim().ifEmpty { ai.packageName }
                found[ai.packageName] = App(ai.packageName, ai.name, label, leanback)
            }
        }
        add(query(Intent.CATEGORY_LEANBACK_LAUNCHER), true)
        add(query(Intent.CATEGORY_LAUNCHER), false)
        allApps = found.values.sortedBy { it.label.lowercase() }
        val order = prefs.getString("order", "")!!.split('\n').filter { it.isNotBlank() }
        val byPkg = found.values.associateBy { it.pkg }
        val out = LinkedHashMap<String, App>()
        lttvPkg()?.let { byPkg[it] }?.let { out[it.pkg] = it }
        for (p in order) byPkg[p]?.let { out[it.pkg] = it }
        for (a in found.values.sortedBy { it.label.lowercase() }) out.putIfAbsent(a.pkg, a)
        val hidden = hiddenApps()
        return out.values.filter { it.pkg !in hidden }
    }

    private var allApps: List<App> = emptyList()

    private fun hiddenApps(): Set<String> = prefs.getString("hidden", "")!!.split('\n').filter { it.isNotBlank() }.toSet()

    private fun setHidden(pkg: String, hide: Boolean) {
        val h = hiddenApps().toMutableSet()
        if (hide) h += pkg else h -= pkg
        prefs.edit().putString("hidden", h.joinToString("\n")).apply()
    }

    /** An app's icon or banner at the TV's best resolution (avoids blurry, upscaled tiles). */
    private fun sharp(pkg: String, resId: Int): Drawable? {
        if (resId == 0) return null
        return try {
            val res = packageManager.getResourcesForApplication(pkg)
            res.getDrawableForDensity(resId, android.util.DisplayMetrics.DENSITY_XXXHIGH, null)
        } catch (_: Exception) { null }
    }

    private fun bannerOf(app: App): Drawable? = try {
        val ai = packageManager.getActivityInfo(ComponentName(app.pkg, app.cls), 0)
        sharp(app.pkg, ai.banner) ?: sharp(app.pkg, ai.applicationInfo.banner)
            ?: packageManager.getActivityBanner(ComponentName(app.pkg, app.cls)) ?: packageManager.getApplicationBanner(app.pkg)
    } catch (_: Exception) { null }

    private fun iconOf(app: App): Drawable = try {
        val ai = packageManager.getActivityInfo(ComponentName(app.pkg, app.cls), 0)
        sharp(app.pkg, ai.icon) ?: sharp(app.pkg, ai.applicationInfo.icon) ?: packageManager.getActivityIcon(ComponentName(app.pkg, app.cls))
    } catch (_: Exception) { packageManager.defaultActivityIcon }

    private fun query(category: String): List<ResolveInfo> =
        try { packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(category), 0) } catch (_: Exception) { emptyList() }

    private fun saveOrder() {
        prefs.edit().putString("order", apps.filter { it.pkg != lttv }.joinToString("\n") { it.pkg }).apply()
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
            val fb = packageManager.getLeanbackLaunchIntentForPackage(app.pkg) ?: packageManager.getLaunchIntentForPackage(app.pkg)
            if (fb != null) startActivity(fb.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) else toast("Couldn't open ${app.label}")
        }
    }

    /** The LTTV apps are separate now: Movies & Shows, League Pass and Blitz open their own app. */
    private fun openOtherApp(name: String, pkgs: List<String>, screen: String?): Boolean {
        val pkg = pkgs.firstOrNull { p -> try { packageManager.getPackageInfo(p, 0); true } catch (_: Exception) { false } } ?: return false
        // All LTTV apps share one main screen class; open it directly if the launcher lookup comes back empty.
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
            ?: Intent(Intent.ACTION_MAIN).setComponent(ComponentName(pkg, "tv.lttv.app.MainActivity"))
        if (screen != null) i.putExtra("screen", screen)
        return try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
    }

    /** Not installed yet: get it now (downloads and opens the installer), instead of only saying so. */
    private fun installLttvApp(name: String, asset: String) {
        toast("$name isn't installed yet — installing it now")
        Store(this) {}.install("https://github.com/lknicks9-a11y/lttv/releases/latest/download/$asset", name)
    }

    private fun openLttv(screen: String) {
        when (screen) {
            "movies", "shows" -> {
                if (!openOtherApp("Movies & Shows", listOf("tv.lttv.movies.debug", "tv.lttv.movies"), screen)) installLttvApp("Movies & Shows", "lttv-movies.apk")
                return
            }
            "app:leaguepass" -> {
                if (!openOtherApp("League Pass", listOf("tv.lttv.leaguepass.debug", "tv.lttv.leaguepass"), null)) installLttvApp("League Pass", "lttv-leaguepass.apk")
                return
            }
            "app:blitz" -> {
                if (!openOtherApp("Blitz", listOf("tv.lttv.blitz.debug", "tv.lttv.blitz"), null)) installLttvApp("Blitz", "lttv-blitz.apk")
                return
            }
        }
        val pkg = lttvPkg() ?: return installLttvApp("LTTV", "lttv.apk")
        try {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                .setComponent(ComponentName(pkg, "tv.lttv.app.MainActivity"))
                .putExtra("screen", screen).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            packageManager.getLaunchIntentForPackage(pkg)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private fun openSettings() {
        try { startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { toast("Settings isn't available") }
    }

    private fun showOptions(app: App) {
        val movable = app.pkg != lttv
        val idx = apps.indexOfFirst { it.pkg == app.pkg }
        val items = mutableListOf<Pair<String, () -> Unit>>()
        items += "Open" to { open(app) }
        fun move(to: Int) {
            val list = apps.toMutableList()
            val a = list.removeAt(idx); list.add(to.coerceIn(0, list.size), a)
            apps = list; focusKey = app.key; saveOrder(); rebuildGrid()
        }
        if (movable && idx > 1) items += "Move left" to { move(idx - 1) }
        if (movable && idx < apps.size - 1) items += "Move right" to { move(idx + 1) }
        if (movable && idx > 1) items += "Move to front" to { move(1) }
        if (app.pkg in hiddenApps()) items += "Show on Home" to { setHidden(app.pkg, false); toast("${app.label} is back on Home"); rebuildGrid() }
        else items += "Hide from Home" to { setHidden(app.pkg, true); toast("Hidden. Show it again from Choose apps"); rebuildGrid() }
        items += "Set a photo for this app" to { showPhotos() }
        items += "App info" to {
            try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.pkg}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        }
        AlertDialog.Builder(this, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle(app.label)
            .setItems(items.map { it.first }.toTypedArray()) { _, w -> items[w].second() }
            .show()
    }

    // ---- the app grid ---------------------------------------------------------------------------

    private fun rebuildGrid() {
        val had = focusKey ?: (currentFocus?.tag as? App)?.key
        lttv = lttvPkg()
        apps = loadApps()
        grid.removeAllViews()
        var toFocus: View? = null

        for (a in apps) {
            val tileView = tile(a)
            grid.addView(tileView)
            if (a.key == had) toFocus = tileView.getChildAt(0)
        }
        grid.addView(addAppsTile())
        buildRecommended()
        focusKey = null
        Glass.unclip(grid)
        toFocus?.let { v -> v.post { v.requestFocus() } }
    }

    // 4 tiles across the right side, like the photos
    private val tileW get() = (contentW - dp(8) - 4 * dp(TILE_GAP)) / 4
    private val tileH get() = tileW * 9 / 16

    private fun tile(app: App): LinearLayout {
        val box = tileBox()
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true; tag = app
            background = cardBg(false); clipToOutline = true
            setPadding(dp(2), dp(2), dp(2), dp(2))
        }
        val photo = Art.drawable(this, app.key)
        val banner: Drawable? = photo ?: bannerOf(app)
        if (banner != null) {
            card.addView(ImageView(this).apply { setImageDrawable(banner); scaleType = ImageView.ScaleType.CENTER_CROP },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            // icon centered with the name under it, both centered in the tile
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
            col.addView(ImageView(this).apply { setImageDrawable(iconOf(app)); scaleType = ImageView.ScaleType.FIT_CENTER },
                LinearLayout.LayoutParams(tileH * 46 / 100, tileH * 46 / 100))
            col.addView(TextView(this).apply {
                text = app.label; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END; gravity = Gravity.CENTER; setPadding(dp(8), dp(6), dp(8), 0)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            card.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        }
        card.setOnClickListener { open(app) }
        card.setOnLongClickListener { showOptions(app); true }
        val label = tileLabel(app.label)
        card.setOnFocusChangeListener { v, f ->
            v.background = cardBg(f)
            v.foreground = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setStroke(dp(if (f) 4 else 0), Color.WHITE) }
            v.elevation = if (f) dp(14).toFloat() else 0f
            Glass.lift(v, f)
        }

        box.addView(card, LinearLayout.LayoutParams(tileW, tileH))
        box.addView(label.apply { visibility = View.GONE })
        return box
    }

    private fun addAppsTile(): LinearLayout {
        val box = tileBox()
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true
            background = cardBg(false)
            setOnClickListener { showStore() }
            setOnFocusChangeListener { v, f ->
                v.background = cardBg(f)
                v.foreground = if (f) GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setStroke(dp(4), Color.WHITE) } else null
                ((v.parent as? ViewGroup)?.getChildAt(1))?.visibility = if (f) View.VISIBLE else View.INVISIBLE
                Glass.lift(v, f)
            }
        }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        col.addView(ImageView(this).apply { setImageResource(R.drawable.ic_store); setColorFilter(Color.WHITE) }, LinearLayout.LayoutParams(tileH * 34 / 100, tileH * 34 / 100).apply { gravity = Gravity.CENTER_HORIZONTAL })
        col.addView(TextView(this).apply {
            text = "Store"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Fonts.bold
            gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        card.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        box.addView(card, LinearLayout.LayoutParams(tileW, tileH))
        box.addView(tileLabel("Store"))
        return box
    }

    private fun tileLabel(t: String) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); typeface = Fonts.bold
        maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setPadding(dp(2), dp(10), 0, 0); visibility = View.INVISIBLE
    }

    private fun tileBox() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; clipChildren = false
        layoutParams = GridLayout.LayoutParams().apply { setMargins(dp(TILE_GAP / 2), dp(TILE_GAP / 2), dp(TILE_GAP / 2), dp(TILE_GAP / 2)) }
    }

    private fun cardBg(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
        if (focused) intArrayOf(Color.parseColor("#59FFFFFF"), Color.parseColor("#2EFFFFFF"))
        else intArrayOf(Color.parseColor("#26FFFFFF"), Color.parseColor("#0DFFFFFF"))).apply {
        cornerRadius = dp(8).toFloat()
    }

    private fun pillButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(16), dp(8), dp(16), dp(8)); isFocusable = true; isClickable = true
        background = Glass.surface(this@HomeActivity, 20)
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f ->
            v.background = Glass.surface(this@HomeActivity, 20, f)
            (v as TextView).setTextColor(if (f) Color.parseColor("#0B0D12") else Color.WHITE)
        }
    }

    // ---- full-screen pages (inputs, store, all apps, choose apps) --------------------------------

    private var overlayPage: View? = null

    private fun showOverlay(v: View) {
        closeOverlay()
        Glass.unclip(v)
        root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlayPage = v
    }

    /** A page's title with a Home button at the end of the same row (reached with Up, never in the way). */
    private fun headerRow(title: String, goHome: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(TextView(this@HomeActivity).apply { text = title; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Fonts.display },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(pillButton("⌂  Home") { goHome() }.apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setPadding(dp(20), dp(10), dp(20), dp(10)) })
    }

    /** (old) floating Home button. */
    private fun withHomeButton(v: View, goHome: () -> Unit): FrameLayout {
        val f = FrameLayout(this)
        f.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val home = pillButton("⌂  Home") { goHome() }.apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setPadding(dp(20), dp(10), dp(20), dp(10)) }
        f.addView(home, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(28); rightMargin = dp(48)
        })
        return f
    }

    private fun closeOverlay() {
        overlayPage?.let { root.removeView(it) }
        overlayPage = null
        rebuildGrid()
    }

    private fun pageScaffold(title: String, subtitle: String): Pair<ScrollView, LinearLayout> {
        val page = ScrollView(this).apply { background = Glass.sheet(this@HomeActivity); isFillViewport = true; isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(headerRow(title) { closeOverlay(); homeItem.post { homeItem.requestFocus() } })
        col.addView(Glass.text(this, 15f, "#B8C0CC").apply { text = subtitle; setPadding(0, dp(4), 0, dp(14)) })
        page.addView(col)
        return page to col
    }

    private fun showInputs() {
        val (page, col) = pageScaffold("Inputs", "Switch the TV to another input")
        val inputs = Inputs.list(this)
        if (inputs.isEmpty()) {
            col.addView(Glass.text(this, 17f, "#D0D6DE").apply {
                text = "This Fire TV doesn't list any TV inputs (Fire TV sticks and Cubes plug into the TV, so use your TV's remote to change input)."
                setPadding(0, dp(10), 0, dp(20))
            })
            col.addView(Glass.button(this, "Open Fire TV input settings") { if (!Inputs.openSystemInputs(this)) toast("Not available") },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        } else {
            val g = GridLayout(this).apply { columnCount = 4 }
            val w = ((resources.displayMetrics.widthPixels - dp(112) - 4 * dp(16)) / 4).coerceAtMost(dp(220))
            for (inp in inputs) {
                val t = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
                    isFocusable = true; isClickable = true
                    background = Glass.surface(this@HomeActivity, 16)
                }
                val big = Glass.text(this, 24f, bold = true).apply { text = if (inp.type == android.media.tv.TvInputInfo.TYPE_TUNER) "📡" else "⎆"; gravity = Gravity.CENTER }
                val name = Glass.text(this, 17f, bold = true).apply { text = inp.label; gravity = Gravity.CENTER; setPadding(dp(8), dp(6), dp(8), 0) }
                t.addView(big); t.addView(name)
                t.setOnClickListener { if (!Inputs.open(this, inp)) toast("This TV didn't switch to ${inp.label}") }
                t.setOnFocusChangeListener { v, f ->
                    v.background = Glass.surface(this@HomeActivity, 16, f)
                    name.setTextColor(Color.parseColor(if (f) "#0B0D12" else "#FFFFFF")); big.setTextColor(Color.parseColor(if (f) "#0B0D12" else "#FFFFFF"))
                    Glass.lift(v, f)
                }
                g.addView(t, GridLayout.LayoutParams().apply { width = w; height = dp(120); setMargins(dp(8), dp(8), dp(8), dp(8)) })
            }
            col.addView(g)
        }
        showOverlay(page)
        page.post { col.getFocusables(View.FOCUS_DOWN).firstOrNull()?.requestFocus() }
    }

    private fun showStore() {
        val store = Store(this) { closeOverlay() }
        showOverlay(store.build())
    }

    private fun showAllApps() {
        val (page, col) = pageScaffold("All Apps", "Every app on this TV. Hold Select or press ☰ for options.")
        loadApps()
        val g = GridLayout(this).apply { columnCount = 5 }
        val w = ((resources.displayMetrics.widthPixels - dp(112) - 5 * dp(16)) / 5)
        for (app in allApps) g.addView(appChip(app, w, null))
        col.addView(g)
        showOverlay(page)
        page.post { (g.getChildAt(0))?.requestFocus() }
    }

    private fun showChooseApps() {
        val (page, col) = pageScaffold("Choose apps on Home", "Select an app to show or hide it in Your Apps")
        loadApps()
        val g = GridLayout(this).apply { columnCount = 5 }
        val w = ((resources.displayMetrics.widthPixels - dp(112) - 5 * dp(16)) / 5)
        for (app in allApps) g.addView(appChip(app, w) { setHidden(app.pkg, app.pkg !in hiddenApps()) })
        col.addView(g)
        showOverlay(page)
        page.post { (g.getChildAt(0))?.requestFocus() }
    }

    /** A small app tile; [toggle] = choose-apps mode (shows ✓ / hidden). */
    private fun appChip(app: App, w: Int, toggle: (() -> Unit)?): View {
        val t = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            isFocusable = true; isClickable = true; tag = app
            setPadding(dp(8), dp(10), dp(8), dp(10))
        }
        val icon = ImageView(this).apply { setImageDrawable(iconOf(app)); scaleType = ImageView.ScaleType.FIT_CENTER }
        val name = Glass.text(this, 13f, bold = true).apply { gravity = Gravity.CENTER; maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        t.addView(icon, LinearLayout.LayoutParams(dp(56), dp(56)))
        t.addView(name, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
        fun paint(f: Boolean) {
            val hidden = app.pkg in hiddenApps()
            name.text = if (toggle != null) (if (hidden) "○  " else "✓  ") + app.label else app.label
            t.background = Glass.surface(this, 16, f)
            t.alpha = if (toggle != null && hidden && !f) 0.55f else 1f
            name.setTextColor(Color.parseColor(if (f) "#0B0D12" else "#FFFFFF"))
        }
        paint(false)
        t.setOnClickListener { if (toggle != null) { toggle(); paint(true) } else open(app) }
        t.setOnLongClickListener { if (toggle == null) showOptions(app); true }
        t.setOnFocusChangeListener { v, f -> paint(f); Glass.lift(v, f) }
        t.layoutParams = GridLayout.LayoutParams().apply { width = w; height = dp(118); setMargins(dp(8), dp(8), dp(8), dp(8)) }
        return t
    }

    // ---- background photo -----------------------------------------------------------------------

    private fun applyBackground() {
        val d = Art.drawable(this, Art.BACKGROUND)
        bgPhoto.setImageDrawable(d)
        bgShade.visibility = if (d != null) View.VISIBLE else View.GONE
    }

    // ---- settings -------------------------------------------------------------------------------

    private data class Setting(val title: String, val sub: String, val icon: String, val action: () -> Unit)

    private fun showSettings() {
        if (settingsPage != null) return
        val tv = listOf(
            Setting("Network", "Wi-Fi and internet", "📶") { system(Settings.ACTION_WIFI_SETTINGS) },
            Setting("Display & Sounds", "Resolution, screen, audio", "🖥") { system(Settings.ACTION_DISPLAY_SETTINGS, Settings.ACTION_SOUND_SETTINGS) },
            Setting("Applications", "Installed apps, storage, data", "▦") { system(Settings.ACTION_APPLICATION_SETTINGS, Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS) },
            Setting("Controllers & Bluetooth", "Remotes, controllers, headphones", "🎮") { system(Settings.ACTION_BLUETOOTH_SETTINGS) },
            Setting("Accessibility", "Captions, text size, reader", "♿") { system(Settings.ACTION_ACCESSIBILITY_SETTINGS) },
            Setting("Date & Time", "Time zone and clock", "🕒") { system(Settings.ACTION_DATE_SETTINGS) },
            Setting("My TV", "About, updates, restart", "ℹ") { system(Settings.ACTION_DEVICE_INFO_SETTINGS) },
            Setting("All TV Settings", "Everything else", "⚙") { system(Settings.ACTION_SETTINGS) },
        )
        val home = listOf(
            Setting("Photos for your apps", "Add your own pictures from your phone", "🖼") { showPhotos() },
            Setting("Choose apps on Home", "Pick which apps show in Your Apps", "☑") { closeSettings(); showChooseApps() },
            Setting("Update Center", "Check for LTTV Home updates · ${Updater.thisVersion(this)}", "⟳") { Updater.checkNow(this) },
            Setting("Store", "Your apps, Appstore apps, install from a link", "⬇") { closeSettings(); showStore() },
            Setting("TV inputs", "HDMI and antenna (on Fire TV smart TVs)", "⎆") { closeSettings(); showInputs() },
            Setting("Reset Your Apps order", "Back to the default order", "↺") { prefs.edit().remove("order").apply(); toast("Order reset"); rebuildGrid() },
            Setting("Amazon Home", "Open the original home screen", "⌂") {
                val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("com.amazon.tv.launcher").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(i) } catch (_: Exception) { toast("Not available") }
            },
            Setting("LTTV Settings", "Playlists, guide, profiles", "★") { openLttv("settings") },
        )
        val page = ScrollView(this).apply { background = Glass.sheet(this@HomeActivity); isFillViewport = true; isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(headerRow("Settings") { closeSettings(); homeItem.post { homeItem.requestFocus() } })
        col.addView(sectionTitle("TV"))
        col.addView(settingsGrid(tv))
        col.addView(sectionTitle("Home screen"))
        col.addView(settingsGrid(home))
        page.addView(col)
        Glass.unclip(page)
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        settingsPage = page
        page.post { ((col.getChildAt(2) as? GridLayout)?.getChildAt(0))?.requestFocus() }
    }

    private fun closeSettings() {
        settingsPage?.let { root.removeView(it) }; settingsPage = null
    }

    private fun settingsGrid(items: List<Setting>) = GridLayout(this).apply {
        columnCount = 4; setPadding(0, dp(8), 0, dp(8))
        for (x in items) addView(settingTile(x))
    }

    private fun settingTile(s: Setting) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
        isFocusable = true; isClickable = true
        setPadding(dp(14), dp(16), dp(14), dp(16))
        background = Glass.surface(this@HomeActivity, 16)
        layoutParams = GridLayout.LayoutParams().apply {
            width = ((resources.displayMetrics.widthPixels - dp(112) - 4 * dp(16)) / 4).coerceAtMost(dp(220)); height = dp(124); setMargins(dp(8), dp(8), dp(8), dp(8))
        }
        addView(TextView(this@HomeActivity).apply { text = s.icon; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f) })
        addView(TextView(this@HomeActivity).apply { text = s.title; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Fonts.bold; setPadding(0, dp(6), 0, dp(2)) })
        addView(TextView(this@HomeActivity).apply { text = s.sub; gravity = Gravity.CENTER; maxLines = 2; setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f) })
        setOnClickListener { s.action() }
        setOnFocusChangeListener { v, f -> v.background = Glass.surface(this@HomeActivity, 16, f); Glass.lift(v, f)
            for (i in 0 until childCount) (getChildAt(i) as? TextView)?.setTextColor(Color.parseColor(if (f) "#0B0D12" else if (i == 2) "#9AA4B2" else "#FFFFFF")) }
    }

    private fun sectionTitle(text: String) = TextView(this).apply {
        this.text = text; setTextColor(Color.parseColor("#E6EAF0")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); typeface = Fonts.bold; setPadding(dp(12), dp(22), 0, dp(2))
    }

    private fun system(vararg actions: String) {
        for (a in actions) { try { startActivity(Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {} }
        openSettings()
    }

    // ---- photos for your apps -------------------------------------------------------------------

    private fun showPhotos() {
        if (photosPage != null) return
        val pm = packageManager
        val tiles = {
            val list = mutableListOf<Triple<String, String, Drawable?>>()
            lttv?.let { p -> slides.forEachIndexed { i, s -> list += Triple("$p/slide$i", "Banner: ${s.title}", null as Drawable?) } }
            list += apps.map { a ->
                val d: Drawable? = try { pm.getActivityBanner(ComponentName(a.pkg, a.cls)) ?: pm.getApplicationBanner(a.pkg) ?: pm.getActivityIcon(ComponentName(a.pkg, a.cls)) } catch (_: Exception) { null }
                Triple(a.key, a.label, d)
            }
            list
        }
        val server = ArtServer(this, tiles) {
            runOnUiThread { rebuildGrid(); applyBackground() }
        }
        val started = server.start()
        artServer = server
        val address = if (started) server.address() else null

        val page = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#F509090C")); isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(60), dp(50), dp(60), dp(40)) }
        col.addView(TextView(this).apply { text = "Photos for your apps"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Fonts.display })
        col.addView(TextView(this).apply {
            text = if (address != null) "On your phone or computer (same Wi-Fi as this TV), open:" else "Connect this TV to Wi-Fi to add photos."
            setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); gravity = Gravity.CENTER; setPadding(0, dp(26), 0, dp(14))
        })
        if (address != null) {
            col.addView(TextView(this).apply {
                text = address.removePrefix("http://"); setTextColor(Color.parseColor("#4CC2FF")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 38f)
                typeface = Typeface.create("monospace", Typeface.BOLD); setPadding(dp(28), dp(14), dp(28), dp(14))
                background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#161B22")); setStroke(dp(1), Color.parseColor("#2A323D")) }
            })
            col.addView(TextView(this).apply {
                text = "Pick a photo for any app, or for LTTV's banners. It shows here right away. Photos stay on this TV."
                setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); gravity = Gravity.CENTER; setPadding(0, dp(22), 0, dp(26))
            })
        }
        col.addView(TextView(this).apply {
            text = "Done"; setTextColor(Color.parseColor("#09090C")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); typeface = Fonts.bold
            setPadding(dp(40), dp(10), dp(40), dp(10)); isFocusable = true; isClickable = true
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.WHITE) }
            setOnClickListener { closePhotos() }
        })
        page.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        photosPage = page
        page.post { (col.getChildAt(col.childCount - 1)).requestFocus() }
    }

    private fun closePhotos() {
        artServer?.stop(); artServer = null
        photosPage?.let { root.removeView(it) }; photosPage = null
        (settingsPage ?: homeItem).requestFocus()
    }

    override fun onDestroy() { artServer?.stop(); super.onDestroy() }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val CONTENT_LEFT = 120
        const val CONTENT_RIGHT = 40
        const val TILE_GAP = 22
        val LTTV_PACKAGES = listOf("tv.lttv.app.debug", "tv.lttv.app")
    }
}
