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
        Slide("Movies & Shows", "Pick a streaming service and watch from your provider", "#5C1420", "#FF6B6B", "movies"),
        Slide("League Pass", "Every NBA game, team broadcasts first", "#5C2A0A", "#FF8A1F", "app:leaguepass"),
        Slide("Blitz", "Every NFL game this week", "#0A3A22", "#3DDC84", "app:blitz"),
    )

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }

    private lateinit var root: FrameLayout
    private lateinit var grid: LinearLayout
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
            clock.text = DateFormat.getTimeFormat(this@HomeActivity).format(Date())
            val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
            val part = if (h < 12) "Good morning" else if (h < 18) "Good afternoon" else "Good evening"
            greeting.text = if (profileName() == "LTTV") part else "$part, ${profileName()}"
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
        // The Figma design (LTTV Home — Fire TV launcher): deep blue-violet backdrop with soft colour glows,
        // a slim glass icon rail on the left, greeting + clock, a big featured banner, one row of wide app
        // tiles (the focused one gets a white border and its name), and the TV's inputs as glass pills.
        root = FrameLayout(this)
        root.background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.parseColor("#0B1020"), Color.parseColor("#07080D"), Color.parseColor("#160C22")))
        val sw = resources.displayMetrics.widthPixels
        val sh = resources.displayMetrics.heightPixels
        for ((pos, c) in listOf(Triple(-sw * 0.1f, -sh * 0.25f, sw * 0.5f) to "#592B4BFF", Triple(sw * 0.62f, sh * 0.55f, sw * 0.5f) to "#478A2BE2", Triple(sw * 0.36f, -sh * 0.3f, sw * 0.38f) to "#2E00C2FF")) {
            val (x, y, d) = pos
            root.addView(View(this).apply {
                background = GradientDrawable().apply {
                    gradientType = GradientDrawable.RADIAL_GRADIENT; gradientRadius = d / 2f
                    colors = intArrayOf(Color.parseColor(c), Color.TRANSPARENT)
                }
                translationX = x; translationY = y
            }, FrameLayout.LayoutParams(d.toInt(), d.toInt()))
        }

        bgPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        bgShade = View(this).apply { setBackgroundColor(Color.parseColor("#D009090C")) }
        root.addView(bgPhoto, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(bgShade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val mainCol = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(CONTENT_LEFT), dp(24), dp(CONTENT_RIGHT), dp(30))
        }
        // greeting and clock
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        greeting = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f); typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
        top.addView(greeting, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        clock = TextView(this).apply { setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
        top.addView(clock)
        content.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })

        content.addView(buildHero(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (sh * 0.44f).toInt()))

        content.addView(sectionTitle2("Your Apps"))
        grid = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(6), dp(8), dp(6), dp(8)) }
        appsScroll = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; isSmoothScrollingEnabled = true; addView(grid) }
        content.addView(appsScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        inputsTitle = sectionTitle2("Inputs")
        content.addView(inputsTitle)
        inputsRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(6), dp(4), dp(6), dp(8)) }
        content.addView(inputsRow)

        mainCol.addView(content)
        root.addView(mainCol, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        sidebar = buildSidebar()
        root.addView(sidebar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.START or Gravity.CENTER_VERTICAL).apply { leftMargin = dp(22) })
        Glass.unclip(content)
        setContentView(root)
        showSlide(0)
    }

    private lateinit var greeting: TextView
    private lateinit var appsScroll: android.widget.HorizontalScrollView
    private lateinit var inputsTitle: TextView
    private lateinit var inputsRow: LinearLayout

    private fun sectionTitle2(t: String) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(6), dp(22), 0, dp(6))
    }

    private fun rebuildInputs() {
        inputsRow.removeAllViews()
        val list = Inputs.list(this)
        inputsTitle.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        inputsRow.visibility = inputsTitle.visibility
        for (inp in list) {
            inputsRow.addView(pillButton(inp.label) { if (!Inputs.open(this, inp)) toast("This TV didn't open ${inp.label}") }.apply {
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); typeface = Typeface.DEFAULT_BOLD; setPadding(dp(24), dp(11), dp(24), dp(11))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(14) })
        }
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        main.postDelayed(turn, 7_000)
        rebuildGrid()
        rebuildInputs()
        applyBackground()
        showSlide(slide)
        if (firstShow) { firstShow = false; hero.post { hero.requestFocus() } }
        main.postDelayed({ if (!isFinishing) Updater.autoCheck(this) }, 4_000)
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
        main.removeCallbacks(turn)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closeOverlay(); closePhotos(); closeSettings()
        hero.requestFocus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            overlayPage != null -> closeOverlay()
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
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            background = Glass.sheet(this@HomeActivity, 36)
            setPadding(dp(12), dp(20), dp(12), dp(20))
        }
        // profile: a round gradient avatar with your initial
        val avatar = TextView(this).apply {
            text = profileName().take(1).uppercase(); gravity = Gravity.CENTER; setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.parseColor("#4CC2FF"), Color.parseColor("#7A5CFF"))).apply { shape = GradientDrawable.OVAL }
            isFocusable = true; isClickable = true
            setOnClickListener { showSettings() }
            setOnFocusChangeListener { v, f -> v.foreground = if (f) GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(3), Color.WHITE) } else null; railFocus() }
        }
        bar.addView(avatar, LinearLayout.LayoutParams(dp(40), dp(40)).apply { bottomMargin = dp(18) })
        bar.addView(navItem(R.drawable.ic_search, "Search", false) { openLttv("search") })
        bar.addView(navItem(R.drawable.ic_home, "Home", true) { scrollTopAndFocus() })
        bar.addView(navItem(R.drawable.ic_live, "Live TV", false) { openLttv("home") })
        bar.addView(navItem(R.drawable.ic_inputs, "Inputs", false) { showInputs() })
        bar.addView(navItem(R.drawable.ic_apps, "All Apps", false) { showAllApps() })
        bar.addView(navItem(R.drawable.ic_store, "Store", false) { showStore() })
        bar.addView(navItem(R.drawable.ic_settings, "Settings", false) { showSettings() })
        return bar
    }

    private val railLabels = mutableListOf<TextView>()
    private var railOpen = false

    /** Labels show next to the icons while you're in the rail (it opens over the page), and hide when you leave. */
    private fun railFocus() = sidebar.post {
        val open = sidebar.hasFocus()
        railOpen = open
        for (l in railLabels) l.visibility = if (open) View.VISIBLE else View.GONE
        sidebar.background = Glass.sheet(this, 36).also { if (open) it.alpha = 255 }
        sidebar.elevation = if (open) dp(12).toFloat() else 0f
    }

    private fun navItem(icon: Int, label: String, selected: Boolean, onClick: () -> Unit): LinearLayout {
        val item = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            isFocusable = true; isClickable = true
            setPadding(dp(11), dp(11), dp(11), dp(11))
        }
        val img = ImageView(this).apply { setImageResource(icon) }
        val name = TextView(this).apply {
            text = label; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(14), 0, dp(10), 0); visibility = View.GONE
        }
        railLabels += name
        item.addView(img, LinearLayout.LayoutParams(dp(24), dp(24)))
        item.addView(name)
        fun paint(f: Boolean) {
            val light = f || (selected && !railOpen)
            item.background = if (light) GradientDrawable().apply { cornerRadius = dp(26).toFloat(); setColor(Color.WHITE) } else null
            val c = if (light) Color.parseColor("#0A0B10") else Color.parseColor("#C9D1DB")
            img.setColorFilter(c); name.setTextColor(if (f) Color.parseColor("#0A0B10") else Color.WHITE)
        }
        paint(false)
        item.setOnClickListener { onClick() }
        item.setOnFocusChangeListener { _, f -> paint(f); railFocus() }
        item.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
        return item
    }

    private fun navBg(active: Boolean): android.graphics.drawable.Drawable =
        if (active) Glass.surface(this, 14, focused = true) else GradientDrawable().apply { setColor(Color.TRANSPARENT) }

    private fun profileName(): String = prefs.getString("profile", null) ?: "LTTV"

    private fun scrollTopAndFocus() {
        hero.requestFocus()
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

        val text = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(48), dp(30), dp(48), dp(40)) }
        heroLabel = TextView(this).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.18f }
        heroTitle = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 50f); typeface = Typeface.create("sans-serif", Typeface.BOLD); letterSpacing = -0.02f }
        heroSub = TextView(this).apply { setTextColor(Color.parseColor("#E3E7EE")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f); setPadding(0, dp(6), 0, dp(20)); maxWidth = dp(520) }
        heroButton = TextView(this).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f); typeface = Typeface.DEFAULT_BOLD; setPadding(dp(26), dp(12), dp(28), dp(12)) }
        text.addView(heroLabel); text.addView(heroTitle); text.addView(heroSub)
        text.addView(heroButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        hero.addView(text, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        heroDots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        hero.addView(heroDots, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(50); bottomMargin = dp(22) })
        return hero
    }

    private fun showSlide(i: Int) {
        slide = ((i % slides.size) + slides.size) % slides.size
        val s = slides[slide]
        val focused = hero.isFocused
        hero.background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(Color.parseColor(s.top), Color.parseColor(s.top), Color.parseColor("#2A1450"))).apply { cornerRadius = dp(28).toFloat() }
        hero.foreground = GradientDrawable().apply { cornerRadius = dp(28).toFloat(); setStroke(dp(if (focused) 4 else 1), Color.parseColor(if (focused) "#FFFFFF" else "#29FFFFFF")) }
        val photo = lttv?.let { Art.drawable(this, "$it/slide$slide") }
        heroPhoto.setImageDrawable(photo)
        heroShade.visibility = if (photo != null) View.VISIBLE else View.GONE
        heroBadge.visibility = if (photo != null) View.GONE else View.VISIBLE
        heroLabel.text = "ON LTTV"
        heroLabel.setTextColor(Color.parseColor(s.accent))
        heroTitle.text = s.title
        heroSub.text = s.sub
        heroButton.text = "▶  Open ${s.title}"
        heroButton.setTextColor(if (focused) Color.parseColor("#09090C") else Color.WHITE)
        heroButton.background = if (focused) GradientDrawable().apply { cornerRadius = dp(30).toFloat(); setColor(Color.WHITE) } else Glass.surface(this, 30)
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
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg) ?: return false
        if (screen != null) i.putExtra("screen", screen)
        startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    private fun openLttv(screen: String) {
        when (screen) {
            "movies", "shows" -> {
                if (!openOtherApp("Movies & Shows", listOf("tv.lttv.movies.debug", "tv.lttv.movies"), screen)) { toast("Get Movies & Shows from the Store"); showStore() }
                return
            }
            "app:leaguepass" -> {
                if (!openOtherApp("League Pass", listOf("tv.lttv.leaguepass.debug", "tv.lttv.leaguepass"), null)) { toast("Get League Pass from the Store"); showStore() }
                return
            }
            "app:blitz" -> {
                if (!openOtherApp("Blitz", listOf("tv.lttv.blitz.debug", "tv.lttv.blitz"), null)) { toast("Get Blitz from the Store"); showStore() }
                return
            }
        }
        val pkg = lttvPkg() ?: return toast("Install LTTV first")
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
        focusKey = null
        Glass.unclip(grid)
        toFocus?.let { v -> v.post { v.requestFocus() } }
    }

    // 6 wide tiles across, like the design (the row scrolls for more)
    private val tileW get() = (resources.displayMetrics.widthPixels - dp(CONTENT_LEFT + CONTENT_RIGHT + 12) - 5 * dp(TILE_GAP)) / 6
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
            v.foreground = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setStroke(dp(if (f) 4 else 1), Color.parseColor(if (f) "#FFFFFF" else "#26FFFFFF")) }
            v.elevation = if (f) dp(14).toFloat() else 0f
            label.visibility = if (f) View.VISIBLE else View.INVISIBLE
            Glass.lift(v, f)
        }
        card.foreground = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setStroke(dp(1), Color.parseColor("#26FFFFFF")) }
        box.addView(card, LinearLayout.LayoutParams(tileW, tileH))
        box.addView(label)
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
                v.foreground = if (f) GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setStroke(dp(4), Color.WHITE) } else null
                ((v.parent as? ViewGroup)?.getChildAt(1))?.visibility = if (f) View.VISIBLE else View.INVISIBLE
                Glass.lift(v, f)
            }
        }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        col.addView(TextView(this).apply { text = "＋"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f) })
        col.addView(TextView(this).apply { text = "Store"; setTextColor(Color.parseColor("#C9D1DB")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); setPadding(0, dp(4), 0, 0) })
        card.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        box.addView(card, LinearLayout.LayoutParams(tileW, tileH))
        box.addView(tileLabel("Store"))
        return box
    }

    private fun tileLabel(t: String) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); typeface = Typeface.DEFAULT_BOLD
        maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setPadding(dp(2), dp(10), 0, 0); visibility = View.INVISIBLE
    }

    private fun tileBox() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; clipChildren = false
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(TILE_GAP) }
    }

    private fun cardBg(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
        if (focused) intArrayOf(Color.parseColor("#59FFFFFF"), Color.parseColor("#2EFFFFFF"))
        else intArrayOf(Color.parseColor("#26FFFFFF"), Color.parseColor("#0DFFFFFF"))).apply {
        cornerRadius = dp(18).toFloat()
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
        val page = withHomeButton(v) { closeOverlay(); hero.post { hero.requestFocus() } }
        Glass.unclip(v)
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlayPage = page
    }

    /** Every page has a Home button (top right) that goes straight back to the home screen. */
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
        col.addView(Glass.text(this, 32f, bold = true).apply { text = title })
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
            Setting("Reset Your Apps order", "Back to the default order", "↺") { prefs.edit().remove("order").apply(); toast("Order reset"); rebuildGrid() },
            Setting("Amazon Home", "Open the original home screen", "⌂") {
                val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("com.amazon.tv.launcher").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(i) } catch (_: Exception) { toast("Not available") }
            },
            Setting("LTTV Settings", "Playlists, guide, profiles", "★") { openLttv("settings") },
        )
        val page = ScrollView(this).apply { background = Glass.sheet(this@HomeActivity); isFillViewport = true; isClickable = true }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(TextView(this).apply { text = "Settings"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Typeface.create("sans-serif", Typeface.BOLD) })
        col.addView(sectionTitle("TV"))
        col.addView(settingsGrid(tv))
        col.addView(sectionTitle("Home screen"))
        col.addView(settingsGrid(home))
        page.addView(col)
        Glass.unclip(page)
        val withHome = withHomeButton(page) { closeSettings(); hero.post { hero.requestFocus() } }
        root.addView(withHome, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        settingsPage = withHome
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
        addView(TextView(this@HomeActivity).apply { text = s.title; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(6), 0, dp(2)) })
        addView(TextView(this@HomeActivity).apply { text = s.sub; gravity = Gravity.CENTER; maxLines = 2; setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f) })
        setOnClickListener { s.action() }
        setOnFocusChangeListener { v, f -> v.background = Glass.surface(this@HomeActivity, 16, f); Glass.lift(v, f)
            for (i in 0 until childCount) (getChildAt(i) as? TextView)?.setTextColor(Color.parseColor(if (f) "#0B0D12" else if (i == 2) "#9AA4B2" else "#FFFFFF")) }
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
        const val CONTENT_LEFT = 120
        const val CONTENT_RIGHT = 40
        const val TILE_GAP = 22
        val LTTV_PACKAGES = listOf("tv.lttv.app.debug", "tv.lttv.app")
    }
}
