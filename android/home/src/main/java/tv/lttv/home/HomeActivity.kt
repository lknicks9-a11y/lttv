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
        Slide("Live TV", "Every channel from your playlists, with the guide", "#0E3A5C", "#4CC2FF", "home"),
        Slide("Sports", "Today's games, live scores and the channel they're on", "#0F4A2E", "#4ADE80", "sports"),
        Slide("Movies", "Your movie library, ready to play", "#5C1420", "#FF6B6B", "movies"),
        Slide("Shows", "Your shows, season by season", "#2E1A5C", "#B08CFF", "shows"),
    )

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }

    private lateinit var root: FrameLayout
    private lateinit var grid: GridLayout
    private lateinit var clock: TextView
    private lateinit var sidebar: LinearLayout

    private lateinit var hero: FrameLayout
    private lateinit var heroPhoto: ImageView
    private lateinit var heroShade: View
    private lateinit var heroBadge: ImageView
    private lateinit var heroLabel: TextView
    private lateinit var heroTitle: TextView
    private lateinit var heroSub: TextView
    private lateinit var heroButton: TextView
    private lateinit var heroDots: LinearLayout
    private lateinit var bgPhoto: ImageView
    private lateinit var bgShade: View

    private var slide = 0
    private var apps: List<App> = emptyList()
    private var lttv: String? = null
    private var focusKey: String? = null
    private var firstShow = true
    private var settingsPage: View? = null
    private var photosPage: View? = null
    private var artServer: ArtServer? = null

    private val tick = object : Runnable {
        override fun run() {
            clock.text = DateFormat.format("EEEE, MMMM d", Date()).toString() + "   " +
                DateFormat.getTimeFormat(this@HomeActivity).format(Date())
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
        root.setBackgroundColor(Color.parseColor("#09090C"))

        bgPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        bgShade = View(this).apply { setBackgroundColor(Color.parseColor("#D009090C")) }
        root.addView(bgPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(bgShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sidebar = buildSidebar()
        row.addView(sidebar, LinearLayout.LayoutParams(dp(230), ViewGroup.LayoutParams.MATCH_PARENT).apply { setMargins(dp(22), dp(22), dp(10), dp(22)) })

        val mainCol = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(34), dp(30))
            clipChildren = false; clipToPadding = false
        }
        clock = TextView(this).apply {
            setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); gravity = Gravity.END
        }
        content.addView(clock, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) })
        content.addView(buildHero(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(232)))

        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(22), 0, dp(10)) }
        head.addView(TextView(this).apply { text = "Your Apps"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f); typeface = Typeface.DEFAULT_BOLD })
        head.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        head.addView(pillButton("Reorder List") { Toast.makeText(this, "Hold Select on an app to move or remove it", Toast.LENGTH_LONG).show() })
        content.addView(head)

        grid = GridLayout(this).apply { columnCount = 4 }
        content.addView(grid)
        mainCol.addView(content)
        row.addView(mainCol, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        root.addView(row)
        setContentView(root)
        showSlide(0)
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        main.postDelayed(turn, 7_000)
        rebuildGrid()
        applyBackground()
        showSlide(slide)
        if (firstShow) { firstShow = false; hero.post { hero.requestFocus() } }
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
        main.removeCallbacks(turn)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closePhotos(); closeSettings()
        hero.requestFocus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            photosPage != null -> closePhotos()
            settingsPage != null -> closeSettings()
            else -> hero.requestFocus()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            (currentFocus?.tag as? App)?.let { showOptions(it); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    // ---- sidebar --------------------------------------------------------------------------------

    private fun buildSidebar(): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(Color.parseColor("#12141A")) }
            setPadding(dp(14), dp(18), dp(14), dp(18))
        }
        val profile = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            isFocusable = true; isClickable = true
            background = navBg(false)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            setOnClickListener { openSettings() }
            setOnFocusChangeListener { v, f -> v.background = navBg(f) }
        }
        profile.addView(ImageView(this).apply { setImageResource(R.drawable.badge) }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(10) })
        profile.addView(TextView(this).apply {
            text = profileName(); setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.DEFAULT_BOLD
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
        })
        bar.addView(profile, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(14) })

        bar.addView(navItem("Inputs", false) { openInputs() })
        bar.addView(navItem("Home", true) { scrollTopAndFocus() })
        bar.addView(navItem("Search", false) { openLttv("search") })
        bar.addView(navItem("Live TV", false) { openLttv("home") })
        bar.addView(navItem("Saved", false) { openLttv("home") })
        bar.addView(navItem("Add Apps", false) { openAppStore() })
        bar.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        bar.addView(navItem("Settings", false) { showSettings() })
        return bar
    }

    private fun navItem(label: String, selected: Boolean, onClick: () -> Unit): TextView {
        val t = TextView(this)
        t.text = label
        t.setTextColor(if (selected) Color.parseColor("#09090C") else Color.parseColor("#C3CAD4"))
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        t.typeface = if (selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        t.setPadding(dp(16), dp(12), dp(14), dp(12))
        t.isFocusable = true; t.isClickable = true
        t.background = navBg(selected)
        t.setOnClickListener { onClick() }
        t.setOnFocusChangeListener { v, f ->
            v.background = navBg(f || selected)
            (v as TextView).setTextColor(if (f || selected) Color.parseColor("#09090C") else Color.parseColor("#C3CAD4"))
            v.typeface = if (f || selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        t.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) }
        return t
    }

    private fun navBg(active: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(if (active) Color.WHITE else Color.TRANSPARENT)
    }

    private fun profileName(): String = prefs.getString("profile", null) ?: "LTTV"

    private fun scrollTopAndFocus() {
        (grid.getChildAt(0) as? ViewGroup)?.getChildAt(0)?.requestFocus() ?: hero.requestFocus()
    }

    // ---- featured banner ------------------------------------------------------------------------

    private fun buildHero(): FrameLayout {
        hero = FrameLayout(this).apply {
            isFocusable = true; isClickable = true; clipToOutline = true
            setOnClickListener { openForSlide() }
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
        heroPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        hero.addView(heroPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        heroShade = View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor("#E6000000"), Color.parseColor("#66000000"), Color.parseColor("#10000000")))
        }
        hero.addView(heroShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        heroBadge = ImageView(this).apply { setImageResource(R.drawable.badge); alpha = 0.9f; scaleType = ImageView.ScaleType.FIT_CENTER }
        hero.addView(heroBadge, FrameLayout.LayoutParams(dp(150), dp(150), Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = dp(56) })

        val text = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(38), dp(30), dp(38), dp(26)) }
        heroLabel = TextView(this).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.18f }
        heroTitle = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 42f); typeface = Typeface.create("sans-serif", Typeface.BOLD) }
        heroSub = TextView(this).apply { setTextColor(Color.parseColor("#D0D6DE")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setPadding(0, dp(4), 0, dp(14)) }
        heroButton = TextView(this).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.DEFAULT_BOLD; setPadding(dp(20), dp(9), dp(22), dp(9)) }
        text.addView(heroLabel); text.addView(heroTitle); text.addView(heroSub)
        text.addView(heroButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        hero.addView(text, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        heroDots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        hero.addView(heroDots, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(40); bottomMargin = dp(16) })
        return hero
    }

    private fun showSlide(i: Int) {
        slide = ((i % slides.size) + slides.size) % slides.size
        val s = slides[slide]
        val focused = hero.isFocused
        hero.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor(s.top), Color.parseColor("#101218"))).apply { cornerRadius = dp(16).toFloat() }
        hero.foreground = if (focused) GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setStroke(dp(3), Color.WHITE) } else null
        val photo = lttv?.let { Art.drawable(this, "$it/slide$slide") }
        heroPhoto.setImageDrawable(photo)
        heroShade.visibility = if (photo != null) View.VISIBLE else View.GONE
        heroBadge.visibility = if (photo != null) View.GONE else View.VISIBLE
        heroLabel.text = "LTTV"
        heroLabel.setTextColor(Color.parseColor(s.accent))
        heroTitle.text = s.title
        heroSub.text = s.sub
        heroButton.text = "▶  Open ${s.title}"
        heroButton.setTextColor(if (focused) Color.parseColor("#09090C") else Color.WHITE)
        heroButton.background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(if (focused) Color.WHITE else Color.parseColor("#33FFFFFF")) }
        heroDots.removeAllViews()
        for (n in slides.indices) heroDots.addView(View(this).apply {
            background = GradientDrawable().apply { cornerRadius = dp(4).toFloat(); setColor(if (n == slide) Color.WHITE else Color.parseColor("#55FFFFFF")) }
        }, LinearLayout.LayoutParams(dp(if (n == slide) 22 else 8), dp(8)).apply { marginEnd = dp(5) })
    }

    private fun openForSlide() = openLttv(slides[slide].screen)

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
        val order = prefs.getString("order", "")!!.split('\n').filter { it.isNotBlank() }
        val byPkg = found.values.associateBy { it.pkg }
        val out = LinkedHashMap<String, App>()
        lttvPkg()?.let { byPkg[it] }?.let { out[it.pkg] = it }
        for (p in order) byPkg[p]?.let { out[it.pkg] = it }
        for (a in found.values.sortedBy { it.label.lowercase() }) out.putIfAbsent(a.pkg, a)
        return out.values.toList()
    }

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

    private fun openLttv(screen: String) {
        val pkg = lttvPkg() ?: return toast("Install LTTV first")
        try {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                .setComponent(ComponentName(pkg, "tv.lttv.app.MainActivity"))
                .putExtra("screen", screen).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            packageManager.getLaunchIntentForPackage(pkg)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private fun openInputs() {
        for (a in listOf("com.amazon.tv.settings.INPUTS", Settings.ACTION_SETTINGS)) {
            try { startActivity(Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {}
        }
        toast("No input switch on this device")
    }

    private fun openAppStore() {
        for (p in listOf("com.amazon.venezia", "com.amazon.appstore")) {
            packageManager.getLeanbackLaunchIntentForPackage(p)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
            packageManager.getLaunchIntentForPackage(p)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
        }
        toast("Appstore not found")
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

        grid.addView(addAppsTile())
        for (a in apps) {
            val tileView = tile(a)
            grid.addView(tileView)
            if (a.key == had) toFocus = tileView.getChildAt(0)
        }
        focusKey = null
        toFocus?.let { v -> v.post { v.requestFocus() } }
    }

    private val tileW get() = dp(196)
    private val tileH get() = dp(110)

    private fun tile(app: App): LinearLayout {
        val box = tileBox()
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true; tag = app
            background = cardBg(false); clipToOutline = true
            setPadding(dp(2), dp(2), dp(2), dp(2))
        }
        val pm = packageManager
        val comp = ComponentName(app.pkg, app.cls)
        val photo = Art.drawable(this, app.key)
        val banner: Drawable? = photo ?: try { pm.getActivityBanner(comp) ?: pm.getApplicationBanner(app.pkg) } catch (_: Exception) { null }
        if (banner != null) {
            card.addView(ImageView(this).apply { setImageDrawable(banner); scaleType = ImageView.ScaleType.CENTER_CROP },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            card.addView(TextView(this).apply {
                text = app.label; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f); typeface = Typeface.DEFAULT_BOLD
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setPadding(dp(8), dp(16), dp(8), dp(5))
                background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(Color.parseColor("#CC000000"), Color.TRANSPARENT))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        } else {
            val icon = try { pm.getActivityIcon(comp) } catch (_: Exception) { pm.defaultActivityIcon }
            card.addView(ImageView(this).apply { setImageDrawable(icon); scaleType = ImageView.ScaleType.FIT_CENTER },
                FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))
            card.addView(TextView(this).apply {
                text = app.label; setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END; gravity = Gravity.CENTER; setPadding(dp(6), 0, dp(6), dp(8))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        }
        card.setOnClickListener { open(app) }
        card.setOnLongClickListener { showOptions(app); true }
        card.setOnFocusChangeListener { v, f ->
            v.background = cardBg(f)
            v.animate().scaleX(if (f) 1.07f else 1f).scaleY(if (f) 1.07f else 1f).setDuration(140).start()
            v.translationZ = if (f) dp(6).toFloat() else 0f
        }
        box.addView(card, FrameLayout.LayoutParams(tileW, tileH))
        return box
    }

    private fun addAppsTile(): LinearLayout {
        val box = tileBox()
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true
            background = cardBg(false)
            setOnClickListener { openAppStore() }
            setOnFocusChangeListener { v, f ->
                v.background = cardBg(f)
                v.animate().scaleX(if (f) 1.07f else 1f).scaleY(if (f) 1.07f else 1f).setDuration(140).start()
            }
        }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        col.addView(TextView(this).apply { text = "＋"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f) })
        col.addView(TextView(this).apply { text = "Add Apps"; setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); setPadding(0, dp(4), 0, 0) })
        card.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        box.addView(card, FrameLayout.LayoutParams(tileW, tileH))
        return box
    }

    private fun tileBox() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; clipChildren = false
        layoutParams = GridLayout.LayoutParams().apply { setMargins(dp(8), dp(8), dp(8), dp(8)) }
    }

    private fun cardBg(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(Color.parseColor(if (focused) "#232B36" else "#1A1F27"))
        setStroke(dp(if (focused) 3 else 1), Color.parseColor(if (focused) "#FFFFFF" else "#262E39"))
    }

    private fun pillButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(16), dp(8), dp(16), dp(8)); isFocusable = true; isClickable = true
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor("#262E39")) }
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f -> v.background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.parseColor(if (f) "#4CC2FF" else "#262E39")) } }
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
            Setting("Reset Your Apps order", "Back to the default order", "↺") { prefs.edit().remove("order").apply(); toast("Order reset"); rebuildGrid() },
            Setting("Amazon Home", "Open the original home screen", "⌂") {
                val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("com.amazon.tv.launcher").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(i) } catch (_: Exception) { toast("Not available") }
            },
            Setting("LTTV Settings", "Playlists, guide, profiles", "★") { openLttv("settings") },
        )
        val page = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F209090C")); isFillViewport = true; isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(TextView(this).apply { text = "Settings"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Typeface.create("sans-serif", Typeface.BOLD) })
        col.addView(sectionTitle("TV"))
        col.addView(settingsGrid(tv))
        col.addView(sectionTitle("Home screen"))
        col.addView(settingsGrid(home))
        page.addView(col)
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
        background = cardBg(false)
        layoutParams = GridLayout.LayoutParams().apply { width = dp(196); height = dp(124); setMargins(dp(8), dp(8), dp(8), dp(8)) }
        addView(TextView(this@HomeActivity).apply { text = s.icon; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f) })
        addView(TextView(this@HomeActivity).apply { text = s.title; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(6), 0, dp(2)) })
        addView(TextView(this@HomeActivity).apply { text = s.sub; gravity = Gravity.CENTER; maxLines = 2; setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f) })
        setOnClickListener { s.action() }
        setOnFocusChangeListener { v, f -> v.background = cardBg(f); v.animate().scaleX(if (f) 1.06f else 1f).scaleY(if (f) 1.06f else 1f).setDuration(140).start() }
    }

    private fun sectionTitle(text: String) = TextView(this).apply {
        this.text = text; setTextColor(Color.parseColor("#E6EAF0")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); typeface = Typeface.DEFAULT_BOLD; setPadding(dp(12), dp(22), 0, dp(2))
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
            runOnUiThread { rebuildGrid(); showSlide(slide); applyBackground() }
        }
        val started = server.start()
        artServer = server
        val address = if (started) server.address() else null

        val page = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#F509090C")); isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(60), dp(50), dp(60), dp(40)) }
        col.addView(TextView(this).apply { text = "Photos for your apps"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Typeface.create("sans-serif", Typeface.BOLD) })
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
            text = "Done"; setTextColor(Color.parseColor("#09090C")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); typeface = Typeface.DEFAULT_BOLD
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
        (settingsPage ?: hero).requestFocus()
    }

    override fun onDestroy() { artServer?.stop(); super.onDestroy() }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        val LTTV_PACKAGES = listOf("tv.lttv.app.debug", "tv.lttv.app")
    }
}
