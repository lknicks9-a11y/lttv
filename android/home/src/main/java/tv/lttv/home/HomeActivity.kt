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
 * Laid out like a PS5's home: a row of app tiles at the top (LTTV's apps first, then the installed ones, the Store
 * and All Apps); the app you're on fills the screen with its picture, with its name and Open on the left.
 * Open an app with Select; hold Select (or Menu, or "…") for its options.
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
        Slide("League Pass", "Every NBA game, team broadcasts first", "#5C2A0A", "#FF8A1F", "app:leaguepass"),
        Slide("Blitz", "Every NFL game this week", "#0A3A22", "#3DDC84", "app:blitz"),
    )

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }

    private lateinit var root: FrameLayout
    private lateinit var clock: TextView
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
        // Laid out like a PlayStation 5 home: a row of square app tiles along the top (the one you're on grows and
        // shows its name), the whole screen behind it is that app's picture, and its name, line and Open button
        // sit on the left under the row. Search, Sports, Weather and Settings are icons at the top right.
        root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        val sw = resources.displayMetrics.widthPixels
        val sh = resources.displayMetrics.heightPixels
        screenW = sw; screenH = sh
        val full = { FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        bgPhoto = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        bgShade = View(this).apply { setBackgroundColor(Color.parseColor("#B3000000")) }
        root.addView(bgPhoto, full()); root.addView(bgShade, full())

        // The big picture (two layers, so a new one fades in over the old).
        heroBack = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        heroFront = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
        root.addView(heroBack, full()); root.addView(heroFront, full())
        // An installed app's own icon, big and on the right (LTTV's apps have it drawn into their picture).
        heroIcon = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER; alpha = 0f }
        root.addView(heroIcon, FrameLayout.LayoutParams((sh * 0.46f).toInt(), (sh * 0.46f).toInt(), Gravity.TOP or Gravity.START).apply {
            leftMargin = (sw * 0.70f - sh * 0.23f).toInt(); topMargin = (sh * 0.20f).toInt() })
        // Shade: dark on the left (behind the words), at the bottom and along the top (behind the row).
        root.addView(View(this).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.parseColor("#D908080A"), Color.parseColor("#7308080A"), Color.parseColor("#0008080A"))) },
            FrameLayout.LayoutParams((sw * 0.66f).toInt(), ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply { background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP,
            intArrayOf(Color.parseColor("#E608080A"), Color.parseColor("#0008080A"))) },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (sh * 0.36f).toInt(), Gravity.BOTTOM))
        root.addView(View(this).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.parseColor("#B308080A"), Color.parseColor("#0008080A"))) },
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (sh * 0.30f).toInt(), Gravity.TOP))

        val home = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
        val side = (sw * 0.05f).toInt()

        // ---- top bar: tabs on the left; search, sports, weather, settings, profile and the clock on the right
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val appsTab = tab("Apps", true) { selectedTile()?.requestFocus() }
        val liveTab = tab("Live TV", false) { openLttv("guide") }
        bar.addView(appsTab); bar.addView(liveTab, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(18) })
        bar.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        topItems += appsTab; topItems += liveTab
        for ((label, icon, act) in listOf(
            Triple("Search", R.drawable.ic_search) { showSearch() },
            Triple("Sports", R.drawable.ic_sports) { showScores() },
            Triple("Weather", R.drawable.ic_weather) { showWeather() },
            Triple("Settings", R.drawable.ic_settings) { showSettings() },
        )) {
            val b = iconButton(label, icon) { act() }
            topItems += b
            bar.addView(b, LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginStart = dp(10) })
        }
        val initial = profileName().trim().firstOrNull()?.uppercaseChar()?.toString() ?: "L"
        bar.addView(TextView(this).apply {
            text = initial; gravity = Gravity.CENTER; setTextColor(Color.WHITE); typeface = Fonts.bold; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#1B2330")); setStroke(dp(2), Color.parseColor("#D9FFFFFF")) }
            contentDescription = "Profile: ${profileName()}"
        }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginStart = dp(16) })
        clock = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f); typeface = Fonts.regular; gravity = Gravity.END }
        bar.addView(clock, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(22) })
        home.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48), Gravity.TOP).apply {
            leftMargin = side; rightMargin = side; topMargin = (sh * 0.035f).toInt() })
        homeItem = appsTab

        // ---- the row of app tiles
        // Sizes from the PS5: small tiles about 9.7% of the screen's height, the one you're on 16%, tight gaps.
        tileSmall = (sh * 0.097f).toInt(); tileBig = (sh * 0.16f).toInt(); tileGap = (sh * 0.009f).toInt()
        slotX = (sw * 0.095f).toInt()
        row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP; clipChildren = false
            // Room on the right so even the last app can slide into the slot.
            setPadding(slotX, dp(4), sw, dp(12))
        }
        rowScroll = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; clipChildren = false; addView(row) }
        val rowTop = (sh * 0.13f).toInt()
        home.addView(rowScroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP).apply {
            topMargin = rowTop })
        // The app's name, small, tucked under the next tiles beside the one you're on (as on the PS5).
        tileName = TextView(this).apply { setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_PX, sh * 0.026f); typeface = Fonts.medium; maxLines = 1 }
        home.addView(tileName, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            leftMargin = slotX + tileBig + (sh * 0.02f).toInt(); topMargin = rowTop + dp(4) + tileSmall + (sh * 0.03f).toInt() })

        // ---- the selected app: name, its line, Open and "…"
        val info = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        heroTitle = TextView(this).apply { setTextColor(Color.WHITE); typeface = Fonts.display; letterSpacing = -0.035f; maxLines = 2; ellipsize = TextUtils.TruncateAt.END; includeFontPadding = false
            setShadowLayer(dp(14).toFloat(), 0f, dp(2).toFloat(), Color.parseColor("#66000000")) }
        heroSub = TextView(this).apply { setTextColor(Color.parseColor("#F0FFFFFF")); setTextSize(TypedValue.COMPLEX_UNIT_PX, sh * 0.025f); typeface = Fonts.medium; setPadding(0, (sh * 0.016f).toInt(), 0, 0) }
        info.addView(heroTitle); info.addView(heroSub)
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, (sh * 0.065f).toInt(), 0, 0) }
        openBtn = TextView(this).apply {
            text = "Open"; gravity = Gravity.CENTER; typeface = Fonts.bold; setTextSize(TypedValue.COMPLEX_UNIT_PX, sh * 0.025f)
            isFocusable = true; isClickable = true
            setOnClickListener { selected?.let { launch(it) } }
        }
        moreBtn = TextView(this).apply {
            text = "•••"; gravity = Gravity.CENTER; setTextSize(TypedValue.COMPLEX_UNIT_PX, sh * 0.02f); typeface = Fonts.bold
            isFocusable = true; isClickable = true; contentDescription = "More options"
            setOnClickListener { selected?.let { options(it) } }
        }
        val bh = (sh * 0.067f).toInt()
        buttons.addView(openBtn, LinearLayout.LayoutParams((sw * 0.175f).toInt(), bh))
        buttons.addView(moreBtn, LinearLayout.LayoutParams(bh, bh).apply { marginStart = (sh * 0.016f).toInt() })
        info.addView(buttons)
        // Anchored from the bottom, like the PS5: the buttons always sit at the same height, the name grows upward.
        home.addView(info, FrameLayout.LayoutParams((sw * 0.44f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = (sw * 0.105f).toInt(); bottomMargin = (sh * 0.14f).toInt() })
        infoBlock = info
        paintButtons()
        for (b in listOf(openBtn, moreBtn)) b.setOnFocusChangeListener { _, _ -> paintButtons() }
        wireKeys()

        // Little info chips at the bottom right (like the PS5's), in the app's colour.
        chipRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        home.addView(chipRow, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            rightMargin = (sw * 0.078f).toInt(); bottomMargin = (sh * 0.15f).toInt(); gravity = Gravity.BOTTOM or Gravity.END })

        root.addView(home, full())
        homeLayers += home
        setContentView(root)
    }

    private var screenW = 0
    private var screenH = 0
    private var tileSmall = 0
    private var tileBig = 0
    private var tileGap = 0
    private var slotX = 0
    private lateinit var tileName: TextView
    private lateinit var infoBlock: View
    private lateinit var heroBack: ImageView
    private lateinit var heroFront: ImageView
    private lateinit var heroIcon: ImageView
    private lateinit var heroTitle: TextView
    private lateinit var heroSub: TextView
    private lateinit var openBtn: TextView
    private lateinit var moreBtn: TextView
    private lateinit var row: LinearLayout
    private lateinit var rowScroll: android.widget.HorizontalScrollView
    private val topItems = mutableListOf<View>()
    private lateinit var chipRow: LinearLayout

    private fun paintChips(e: Entry) {
        chipRow.removeAllViews()
        for (c in e.chips) chipRow.addView(TextView(this).apply {
            text = c; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Fonts.bold
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(14), 0, dp(16), 0); compoundDrawablePadding = dp(8)
            background = GradientDrawable().apply { cornerRadius = dp(9).toFloat(); setColor(Color.parseColor("#B808080A")) }
            setCompoundDrawablesWithIntrinsicBounds(GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(e.accent); setSize(dp(8), dp(8)) }, null, null, null)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)).apply { marginStart = dp(11) })
    }

    private fun tab(label: String, current: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label; setTextSize(TypedValue.COMPLEX_UNIT_PX, resources.displayMetrics.heightPixels * 0.03f); typeface = if (current) Fonts.bold else Fonts.regular
        setTextColor(if (current) Color.WHITE else Color.parseColor("#9EFFFFFF"))
        isFocusable = true; isClickable = true; setPadding(dp(14), dp(6), dp(14), dp(6))
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f ->
            v.background = if (f) GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(Color.WHITE) } else null
            (v as TextView).setTextColor(if (f) Color.parseColor("#0B0B0E") else if (current) Color.WHITE else Color.parseColor("#9EFFFFFF"))
        }
    }

    private fun iconButton(label: String, icon: Int, onClick: () -> Unit) = FrameLayout(this).apply {
        isFocusable = true; isClickable = true; contentDescription = label
        val img = ImageView(this@HomeActivity).apply { setImageResource(icon); setColorFilter(Color.WHITE) }
        addView(img, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f ->
            v.background = if (f) GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) } else null
            img.setColorFilter(if (f) Color.parseColor("#0B0B0E") else Color.WHITE)
        }
    }

    private fun paintButtons() {
        val accent = selected?.accent ?: Color.WHITE
        val of = openBtn.isFocused
        openBtn.background = GradientDrawable().apply {
            cornerRadius = screenH * 0.034f; setColor(if (of) Color.WHITE else Color.parseColor("#33FFFFFF"))
            if (of) setStroke(dp(3), accent)
        }
        openBtn.setTextColor(if (of) Color.parseColor("#0B0B0E") else Color.WHITE)
        val mf = moreBtn.isFocused
        moreBtn.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (mf) Color.WHITE else Color.parseColor("#2EFFFFFF")) }
        moreBtn.setTextColor(if (mf) Color.parseColor("#0B0B0E") else Color.WHITE)
    }

    /** Remote moves like the PS5's: Down from the row to Open, Up from the buttons back to the app, Up from the row to the top bar. */
    private fun wireKeys() {
        val toTile = View.OnKeyListener { _, code, ev ->
            if (code == KeyEvent.KEYCODE_DPAD_UP) { if (ev.action == KeyEvent.ACTION_DOWN) selectedTile()?.requestFocus(); true }
            else code == KeyEvent.KEYCODE_DPAD_DOWN
        }
        openBtn.setOnKeyListener(toTile); moreBtn.setOnKeyListener(toTile)
        for (t in topItems) t.setOnKeyListener { _, code, ev ->
            if (code == KeyEvent.KEYCODE_DPAD_DOWN) { if (ev.action == KeyEvent.ACTION_DOWN) selectedTile()?.requestFocus(); true }
            else code == KeyEvent.KEYCODE_DPAD_UP
        }
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        // Only rebuild when the installed apps changed (rebuilding on every return made the screen flash).
        val sig = appsSignature()
        if (sig != lastAppsSig) { lastAppsSig = sig; rebuildGrid() }
        applyBackground()
        if (firstShow) { firstShow = false; focusHome() }
        main.postDelayed({ if (!isFinishing) Updater.autoCheck(this) }, 4_000)
    }

    private var lastAppsSig = ""
    private fun appsSignature(): String = try {
        loadApps().joinToString("|") { it.key } + "#" + prefs.getString("hidden", "") + "#" + prefs.getString("order", "")
    } catch (_: Exception) { "" }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        closeOverlay(); closePhotos(); closeSettings()
        focusHome()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            overlayPage != null -> closeOverlay()
            photosPage != null -> closePhotos()
            settingsPage != null -> closeSettings()
            else -> focusHome()
        }
    }

    private var backHeld = false

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // Back: a press stays in LTTV Home (closes a page, back to the top); hold it to go to Fire TV's own home.
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.repeatCount == 0) { backHeld = false; event.startTracking() }
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            (currentFocus?.tag as? Entry)?.let { options(it); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) { backHeld = true; openAmazonHome(); return true }
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (!backHeld && event.isTracking && !event.isCanceled) @Suppress("DEPRECATION") onBackPressed()
            backHeld = false
            return true
        }
        return super.onKeyUp(keyCode, event)
    }


    private fun profileName(): String = prefs.getString("profile", null) ?: "LTTV"

    /** Home starts on the first app in the row. */
    private fun focusHome() = row.post { (selectedTile() ?: tiles.firstOrNull())?.requestFocus() ?: homeItem.requestFocus() }

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
            "app:leaguepass" -> {
                if (!openOtherApp("League Pass", listOf("tv.lttv.leaguepass.debug", "tv.lttv.leaguepass"), null)) installLttvApp("League Pass", "lttv-leaguepass.apk")
                return
            }
            "app:lttube" -> {
                if (!openOtherApp("LTTube", listOf("com.lttube.tv"), null)) {
                    toast("LTTube isn't installed yet — installing it now")
                    Store(this) {}.install("https://github.com/lknicks9-a11y/lttube-firetv/releases/latest/download/LTTube-TV.apk", "LTTube")
                }
                return
            }
            "app:ltmusic" -> {
                if (!openOtherApp("LT Music", listOf("com.lttube.music"), null)) {
                    toast("LT Music isn't installed yet — installing it now")
                    Store(this) {}.install("https://github.com/lknicks9-a11y/lttube-firetv/releases/download/music/LTMusic.apk", "LT Music")
                }
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

    /** Our own apps update straight from their releases; anything else opens its page in Amazon's Appstore. */
    private fun updateApp(app: App) {
        val ours = Store(this) {}.updateUrlFor(app.pkg)
        if (ours != null) { Store(this) {}.install(ours.first, ours.second); return }
        for (u in listOf("amzn://apps/android?p=${app.pkg}", "market://details?id=${app.pkg}")) {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {}
        }
        toast("Couldn't open the Appstore for ${app.label}")
    }

    /** The app's page in Fire TV's own Settings (Applications → Manage → this app). */
    private fun appSettings(pkg: String) {
        val uri = Uri.parse("package:$pkg")
        for (settingsPkg in listOf("com.amazon.tv.settings.v2", "com.amazon.tv.settings", null)) {
            val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (settingsPkg != null) i.setPackage(settingsPkg)
            if (i.resolveActivity(packageManager) == null) continue
            try { startActivity(i); return } catch (_: Exception) {}
        }
        system(Settings.ACTION_APPLICATION_SETTINGS, Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)
    }

    private fun showOptions(app: App) {
        val movable = app.pkg != lttv
        val idx = apps.indexOfFirst { it.pkg == app.pkg }
        val items = mutableListOf<Pair<String, () -> Unit>>()
        items += "Open" to { open(app) }
        items += "Update app" to { updateApp(app) }
        items += "App settings" to { appSettings(app.pkg) }
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
        AlertDialog.Builder(this, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle(app.label)
            .setItems(items.map { it.first }.toTypedArray()) { _, w -> items[w].second() }
            .show()
    }

    // ---- the row of apps (like the PS5's) --------------------------------------------------------

    /** One tile in the row: LTTV's own apps (with their pictures), the installed apps, the Store and All Apps. */
    private data class Entry(
        val key: String, val title: String, val sub: String, val accent: Int,
        val tileRes: Int = 0, val heroRes: Int = 0, val app: App? = null, val screen: String? = null,
        val pkgs: List<String> = emptyList(), val slide: Int = -1, val chips: List<String> = emptyList(),
    )

    private val ltEntries = listOf(
        Entry("lt:lttv", "LTTV", "Live TV, sports, movies and shows", Color.parseColor("#4CC2FF"), R.drawable.tile_lttv, R.drawable.hero_lttv, screen = "guide", pkgs = LTTV_PACKAGES, slide = 0, chips = listOf("Live", "Guide")),
        Entry("lt:music", "LT Music", "Every song, no ads", Color.parseColor("#FF3B6B"), R.drawable.tile_music, R.drawable.hero_music, screen = "app:ltmusic", pkgs = listOf("com.lttube.music"), slide = 4, chips = listOf("Lyrics", "No ads")),
        Entry("lt:tube", "LTTube", "Your videos, no ads", Color.parseColor("#FF3B3B"), R.drawable.tile_tube, R.drawable.hero_tube, screen = "app:lttube", pkgs = listOf("com.lttube.tv"), slide = 1, chips = listOf("No ads", "Subscriptions")),
        Entry("lt:league", "League Pass", "Every NBA game tonight", Color.parseColor("#FF8A1F"), R.drawable.tile_league, R.drawable.hero_league, screen = "app:leaguepass", pkgs = listOf("tv.lttv.leaguepass.debug", "tv.lttv.leaguepass"), slide = 2, chips = listOf("Live tonight", "Every team")),
        Entry("lt:blitz", "Blitz", "Every NFL game this week", Color.parseColor("#3DDC84"), R.drawable.tile_blitz, R.drawable.hero_blitz, screen = "app:blitz", pkgs = listOf("tv.lttv.blitz.debug", "tv.lttv.blitz"), slide = 3, chips = listOf("Live this week", "Every game")),
    )
    private val storeEntry = Entry("lt:store", "Store", "Apps and updates for your TV", Color.parseColor("#8B5CF6"), R.drawable.tile_store, R.drawable.hero_store, chips = listOf("Updates", "Installed"))
    private val allEntry = Entry("lt:all", "All Apps", "Every app on this TV", Color.parseColor("#9AA4B2"))

    private var entries: List<Entry> = emptyList()
    private val tiles = mutableListOf<View>()
    private var selected: Entry? = null
    private val colorCache = HashMap<String, Int>()

    private fun selectedTile(): View? = tiles.firstOrNull { (it.tag as? Entry)?.key == selected?.key }

    private fun rebuildGrid() {
        val had = focusKey ?: (currentFocus?.tag as? Entry)?.app?.key ?: selected?.key
        lttv = lttvPkg()
        apps = loadApps()
        val ltPkgs = ltEntries.flatMap { it.pkgs }.toSet()
        entries = ltEntries + apps.filter { it.pkg !in ltPkgs }.map { a ->
            Entry(a.key, a.label, "", colorOf(a), app = a)
        } + storeEntry + allEntry
        row.removeAllViews(); tiles.clear()
        var toFocus: View? = null
        for (e in entries) {
            val t = rowTile(e)
            row.addView(t.second)
            tiles += t.first
            if (e.key == had || e.app?.key == had) toFocus = t.first
        }
        focusKey = null
        val keep = entries.firstOrNull { it.key == selected?.key } ?: entries.first()
        selected = null
        show(keep, instant = true)
        toFocus?.let { v -> v.post { v.requestFocus() } }
    }

    /** A square tile (all the same size, the one you're on bigger, all lined up along the top), as on the PS5. */
    private fun rowTile(e: Entry): Pair<View, LinearLayout> {
        val box = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP; clipChildren = false }
        val radius = tileSmall * 0.16f
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true; tag = e; contentDescription = e.title
            clipToOutline = true
            background = GradientDrawable().apply { cornerRadius = radius; setColor(tileColor(e)) }
        }
        val photo = e.app?.let { Art.drawable(this, it.key) }
        when {
            photo != null -> card.addView(ImageView(this).apply { setImageDrawable(photo); scaleType = ImageView.ScaleType.CENTER_CROP }, FrameLayout.LayoutParams(-1, -1))
            e.tileRes != 0 -> card.addView(ImageView(this).apply { setImageResource(e.tileRes); scaleType = ImageView.ScaleType.CENTER_CROP }, FrameLayout.LayoutParams(-1, -1))
            e.app != null -> card.addView(ImageView(this).apply { setImageDrawable(iconOf(e.app)); scaleType = ImageView.ScaleType.FIT_CENTER },
                FrameLayout.LayoutParams(-1, -1).apply { val m = tileSmall / 7; setMargins(m, m, m, m) })
            else -> card.addView(ImageView(this).apply { setImageResource(R.drawable.ic_apps); setColorFilter(Color.WHITE) },
                FrameLayout.LayoutParams(tileSmall / 2, tileSmall / 2, Gravity.CENTER))
        }
        box.addView(card, LinearLayout.LayoutParams(tileSmall, tileSmall))
        box.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = tileGap }
        card.setOnClickListener { launch(e) }
        card.setOnLongClickListener { options(e); true }
        card.setOnFocusChangeListener { v, f ->
            v.foreground = if (f) GradientDrawable().apply { cornerRadius = tileBig * 0.16f; setStroke(dp(3), Color.WHITE) } else null
            v.elevation = if (f) dp(12).toFloat() else 0f
            if (f) select(e)
        }
        card.setOnKeyListener { _, code, ev ->
            when (code) {
                KeyEvent.KEYCODE_DPAD_DOWN -> { if (ev.action == KeyEvent.ACTION_DOWN) openBtn.requestFocus(); true }
                KeyEvent.KEYCODE_DPAD_UP -> { if (ev.action == KeyEvent.ACTION_DOWN) topItems.first().requestFocus(); true }
                else -> false
            }
        }
        return card to box
    }

    /** Grows / shrinks a tile smoothly (the PS5's tiles ease between sizes). */
    private fun resize(t: View, to: Int, animate: Boolean) {
        val lp = t.layoutParams as LinearLayout.LayoutParams
        (t.getTag(R.id.tile_anim) as? android.animation.ValueAnimator)?.cancel()
        if (!animate || lp.width == to) { lp.width = to; lp.height = to; t.layoutParams = lp; return }
        val anim = android.animation.ValueAnimator.ofInt(lp.width, to).apply {
            duration = 200; interpolator = android.view.animation.DecelerateInterpolator(1.6f)
            addUpdateListener { v -> val n = v.animatedValue as Int; lp.width = n; lp.height = n; t.layoutParams = lp }
        }
        t.setTag(R.id.tile_anim, anim); anim.start()
    }

    /** The row slides so the app you're on rests in the second slot (the one before peeks in at the edge). */
    private fun slideTo(index: Int, animate: Boolean) {
        val x = index * (tileSmall + tileGap)
        if (animate) {
            android.animation.ObjectAnimator.ofInt(rowScroll, "scrollX", rowScroll.scrollX, x).apply {
                duration = 220; interpolator = android.view.animation.DecelerateInterpolator(1.6f) }.start()
        } else rowScroll.scrollTo(x, 0)
    }

    /** The app you're on: its tile grows into the slot and the screen turns to it. */
    private fun select(e: Entry) {
        if (selected?.key == e.key) return
        val prev = selected
        selected = e
        for (t in tiles) {
            val te = t.tag as? Entry ?: continue
            if (te.key == e.key) resize(t, tileBig, prev != null)
            else if (te.key == prev?.key) resize(t, tileSmall, true)
        }
        slideTo(entries.indexOfFirst { it.key == e.key }.coerceAtLeast(0), prev != null)
        show(e, instant = prev == null)
    }

    private var heroKey: String? = null
    private val heroSwap = Runnable { selected?.let { paintHero(it, false) } }
    private val infoIn = Runnable { selected?.let { revealInfo(it) } }

    /**
     * The PS5's motion: the moment you move, the name, line and buttons drop away and the small name by the tile
     * changes; the picture crossfades in (settling from a slight zoom); once you stop, the name, line and buttons
     * fade back in, rising into place.
     */
    private fun show(e: Entry, instant: Boolean) {
        if (selected == null) {
            selected = e
            selectedTile()?.let { resize(it, tileBig, false) }
            row.post { slideTo(entries.indexOfFirst { it.key == e.key }.coerceAtLeast(0), false) }
        }
        tileName.text = e.title
        tileName.alpha = 0f; tileName.animate().alpha(1f).setDuration(180).start()
        main.removeCallbacks(heroSwap); main.removeCallbacks(infoIn)
        if (instant) {
            paintHero(e, true); fillInfo(e)
            infoBlock.alpha = 1f; infoBlock.translationY = 0f; chipRow.alpha = 1f
            return
        }
        infoBlock.animate().cancel(); chipRow.animate().cancel()
        infoBlock.animate().alpha(0f).translationY(screenH * 0.012f).setDuration(110).start()
        chipRow.animate().alpha(0f).setStartDelay(0).setDuration(110).start()
        // Scrolling quickly along the row: pictures and words wait until you pause, so it never stutters.
        main.postDelayed(heroSwap, 120)
        main.postDelayed(infoIn, 430)
    }

    private fun fillInfo(e: Entry) {
        heroTitle.text = e.title
        heroTitle.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenH * (if (e.title.length > 12) 0.085f else 0.125f))
        heroSub.text = e.sub
        heroSub.visibility = if (e.sub.isEmpty()) View.GONE else View.VISIBLE
        openBtn.text = if (e === allEntry || e === storeEntry) "Go" else "Open"
        paintChips(e)
        paintButtons()
    }

    private fun revealInfo(e: Entry) {
        fillInfo(e)
        infoBlock.animate().cancel()
        infoBlock.alpha = 0f; infoBlock.translationY = screenH * 0.03f
        infoBlock.animate().alpha(1f).translationY(0f).setDuration(380).setInterpolator(android.view.animation.DecelerateInterpolator(2f)).start()
        chipRow.alpha = 0f
        chipRow.animate().alpha(1f).setStartDelay(120).setDuration(320).start()
    }

    private fun heroOf(e: Entry): Drawable {
        if (e.slide >= 0) lttvPkg()?.let { p -> Art.drawable(this, "$p/slide${e.slide}") }?.let { return it }
        if (e.heroRes != 0) return resources.getDrawable(e.heroRes, theme)
        Art.drawable(this, Art.BACKGROUND)?.let { return it }
        val c = e.accent
        val base = blend(c, Color.BLACK, 0.80f)
        return GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            colors = intArrayOf(blend(c, Color.BLACK, 0.25f), blend(c, Color.BLACK, 0.62f), base)
            setGradientCenter(0.70f, 0.45f)
            gradientRadius = screenW * 0.62f
        }
    }

    private fun paintHero(e: Entry, instant: Boolean) {
        if (heroKey == e.key) return
        heroKey = e.key
        val d = heroOf(e)
        val icon: Drawable? = if (e.heroRes == 0 && e.app != null && (e.slide < 0)) placeArt(bannerOf(e.app), iconOf(e.app)) else null
        if (instant) {
            heroBack.setImageDrawable(d); heroFront.alpha = 0f
            heroIcon.setImageDrawable(icon); heroIcon.alpha = if (icon != null) 1f else 0f
            return
        }
        heroFront.animate().cancel()
        heroFront.setImageDrawable(d); heroFront.alpha = 0f
        // Fades in while settling from a slight zoom; then it becomes the picture underneath.
        heroFront.scaleX = 1.06f; heroFront.scaleY = 1.06f
        heroFront.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(650).setInterpolator(android.view.animation.DecelerateInterpolator(1.8f)).withEndAction {
            heroBack.setImageDrawable(d); heroFront.alpha = 0f; heroFront.setImageDrawable(null)
        }.start()
        heroIcon.animate().cancel()
        if (icon != null) { heroIcon.setImageDrawable(icon); heroIcon.alpha = 0f; heroIcon.animate().alpha(1f).setDuration(420).start() }
        else heroIcon.animate().alpha(0f).setDuration(200).start()
    }

    /**
     * Another app's own picture on the right: its banner shown wide (or its icon, square), with the edges faded away so
     * it melts into the colour behind it instead of sitting there as a box.
     */
    private fun placeArt(banner: Drawable?, icon: Drawable): Drawable {
        val wide = banner != null
        val w = if (wide) (screenW * 0.50f).toInt() else (screenH * 0.46f).toInt()
        val h = if (wide) w * 9 / 16 else w
        heroIcon.layoutParams = (heroIcon.layoutParams as FrameLayout.LayoutParams).apply {
            width = w; height = h
            leftMargin = (screenW * 0.70f - w / 2f).toInt(); topMargin = (screenH * 0.43f - h / 2f).toInt()
        }
        return android.graphics.drawable.BitmapDrawable(resources, fadeEdges(banner ?: icon, w, h, if (wide) 0.24f else 0.16f))
    }

    private fun fadeEdges(d: Drawable, w: Int, h: Int, edge: Float): android.graphics.Bitmap {
        val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bmp)
        val iw = d.intrinsicWidth; val ih = d.intrinsicHeight
        if (iw > 0 && ih > 0) {
            // Fill the box (crop the overflow), like a picture would.
            val k = maxOf(w / iw.toFloat(), h / ih.toFloat())
            val dw = (iw * k).toInt(); val dh = (ih * k).toInt()
            d.setBounds((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2)
        } else d.setBounds(0, 0, w, h)
        d.draw(c)
        // Keep the middle, fade every edge (sides, top and bottom) to nothing.
        val clear = Color.TRANSPARENT; val solid = Color.BLACK
        val mask = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.DST_IN) }
        mask.shader = android.graphics.LinearGradient(0f, 0f, w.toFloat(), 0f, intArrayOf(clear, solid, solid, clear), floatArrayOf(0f, edge, 1f - edge, 1f), android.graphics.Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), mask)
        mask.shader = android.graphics.LinearGradient(0f, 0f, 0f, h.toFloat(), intArrayOf(clear, solid, solid, clear), floatArrayOf(0f, edge * 1.2f, 1f - edge * 1.2f, 1f), android.graphics.Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), mask)
        return bmp
    }

    private fun launch(e: Entry) {
        when {
            e === storeEntry -> showStore()
            e === allEntry -> showAllApps()
            e.app != null -> open(e.app)
            e.screen != null -> openLttv(e.screen)
        }
    }

    /** "…": the app's options (LTTV's own apps: open, update, its settings). */
    private fun options(e: Entry) {
        if (e.app != null) { showOptions(e.app); return }
        if (e.pkgs.isEmpty()) { launch(e); return }
        loadApps()
        val installed = allApps.firstOrNull { it.pkg in e.pkgs }
        val items = mutableListOf<Pair<String, () -> Unit>>("Open" to { launch(e) })
        if (installed != null) { items += "Update app" to { updateApp(installed) }; items += "App settings" to { appSettings(installed.pkg) } }
        if (e.slide >= 0) items += "Set a photo for this" to { showPhotos() }
        AlertDialog.Builder(this, AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle(e.title).setItems(items.map { it.first }.toTypedArray()) { _, w -> items[w].second() }.show()
    }

    private fun tileColor(e: Entry) = if (e.app != null) blend(e.accent, Color.BLACK, 0.55f) else Color.parseColor("#E6282C34")

    /** An app's main colour (the average of its icon), for its tile and picture. */
    private fun colorOf(a: App): Int = colorCache.getOrPut(a.pkg) {
        try {
            val bmp = android.graphics.Bitmap.createBitmap(16, 16, android.graphics.Bitmap.Config.ARGB_8888)
            val c = android.graphics.Canvas(bmp)
            val d = bannerOf(a) ?: iconOf(a)
            d.setBounds(0, 0, 16, 16); d.draw(c)
            var r = 0L; var g = 0L; var b = 0L; var n = 0L
            for (y in 0 until 16) for (x in 0 until 16) {
                val p = bmp.getPixel(x, y)
                if (Color.alpha(p) < 128) continue
                val s = Color.red(p) + Color.green(p) + Color.blue(p)
                if (s < 60 || s > 720) continue   // skip near-black and near-white so the colour is the brand's
                r += Color.red(p); g += Color.green(p); b += Color.blue(p); n++
            }
            if (n == 0L) Color.parseColor("#5A6472") else Color.rgb((r / n).toInt(), (g / n).toInt(), (b / n).toInt())
        } catch (_: Exception) { Color.parseColor("#5A6472") }
    }

    private fun blend(a: Int, b: Int, t: Float) = Color.rgb(
        (Color.red(a) * (1 - t) + Color.red(b) * t).toInt(),
        (Color.green(a) * (1 - t) + Color.green(b) * t).toInt(),
        (Color.blue(a) * (1 - t) + Color.blue(b) * t).toInt())
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
        overlayPage?.let { root.removeView(it) }
        Glass.unclip(v)
        root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlayPage = v
        updateFocusLock()
    }

    private val homeLayers = mutableListOf<View>()

    /**
     * Only the page on top can take the remote's focus: the home screen (and Settings under a page opened from it)
     * are locked, so moving around a page never lands on tiles behind it.
     */
    private fun updateFocusLock() {
        val top: View? = overlayPage ?: photosPage ?: settingsPage
        for (v in homeLayers + listOfNotNull(settingsPage, photosPage, overlayPage)) {
            val open = if (top == null) v in homeLayers else v === top
            (v as? ViewGroup)?.descendantFocusability = if (open) ViewGroup.FOCUS_AFTER_DESCENDANTS else ViewGroup.FOCUS_BLOCK_DESCENDANTS
        }
    }

    private fun showSearch() {
        val (page, col) = pageScaffold("Search", "Apps on this TV, the Store, and LTTV Home")
        loadApps()
        SearchPage(this,
            apps = { allApps.map { a -> a.label to { open(a) } } },
            store = { q -> Store(this) { closeOverlay() }.searchEntries(q) },
            shortcuts = listOf(
                "Sports scores" to { showScores() }, "Weather" to { showWeather() }, "Store" to { showStore() },
                "All Apps" to { showAllApps() }, "Settings" to { closeOverlay(); showSettings() }, "TV inputs" to { showInputs() },
                "Choose apps on Home" to { showChooseApps() }, "Update Center" to { Updater.checkNow(this) },
            )).build(col)
        showOverlay(page)
    }

    private fun showScores() {
        val (page, col) = pageScaffold("Sports", "Today's scores")
        ScoresPage(this).build(col)
        showOverlay(page)
    }

    private fun showWeather() {
        val (page, col) = pageScaffold("Weather", "Now, the next hours and the week")
        WeatherPage(this).build(col)
        showOverlay(page)
    }

    /** A page's title with a Home button at the end of the same row (reached with Up, never in the way). */
    private fun headerRow(title: String, goHome: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        // Home sits before the title (left), so moving Right along a page's rows never jumps up to it.
        addView(pillButton("‹  Home") { goHome() }.apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setPadding(dp(18), dp(9), dp(20), dp(9)) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(20) })
        addView(TextView(this@HomeActivity).apply { text = title; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f); typeface = Fonts.display },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
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
        updateFocusLock()
        rebuildGrid()
        if (settingsPage == null) focusHome()
        // Opened from Settings: back to Settings.
        settingsPage?.post { settingsFirst?.requestFocus() }
    }

    private var settingsFirst: View? = null

    private fun pageBg() = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.parseColor("#FA0E0E10"), Color.parseColor("#FA000000")))

    private fun pageScaffold(title: String, subtitle: String): Pair<ScrollView, LinearLayout> {
        val page = ScrollView(this).apply { background = pageBg(); isFillViewport = true; isClickable = true; clipToPadding = false }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(headerRow(title) { closeOverlay(); closeSettings(); focusHome() })
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
            Setting("Amazon Home", "Hold OK (or hold Back anywhere) to go to Fire TV's home", "⌂") { toast("Hold OK to go to Fire TV's home") },
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
            Setting("Choose apps on Home", "Pick which apps show in Your Apps", "☑") { showChooseApps() },
            Setting("Update Center", "Check for LTTV Home updates · ${Updater.thisVersion(this)}", "⟳") { Updater.checkNow(this) },
            Setting("Store", "Your apps, Appstore apps, install from a link", "⬇") { showStore() },
            Setting("TV inputs", "HDMI and antenna (on Fire TV smart TVs)", "⎆") { showInputs() },
            Setting("Reset Your Apps order", "Back to the default order", "↺") { prefs.edit().remove("order").apply(); toast("Order reset"); rebuildGrid() },
            Setting("LTTV Settings", "Playlists, guide, profiles", "★") { openLttv("settings") },
        )
        val page = ScrollView(this).apply { background = pageBg(); isFillViewport = true; isClickable = true; clipToPadding = false }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(56), dp(30), dp(56), dp(40)) }
        col.addView(headerRow("Settings") { closeSettings(); focusHome() })
        col.addView(sectionTitle("TV"))
        col.addView(settingsGrid(tv))
        col.addView(sectionTitle("Home screen"))
        col.addView(settingsGrid(home))
        page.addView(col)
        Glass.unclip(page)
        root.addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        settingsPage = page
        settingsFirst = (col.getChildAt(2) as? GridLayout)?.getChildAt(0)
        // Moving around Settings stays on its tiles: Right goes to the next tile (the next row's first at the
        // end of a row), Left to the one before, Up / Down a row — never to something hidden behind the page.
        val tiles = mutableListOf<View>()
        val rows = mutableListOf<List<View>>()
        for (i in 0 until col.childCount) (col.getChildAt(i) as? GridLayout)?.let { g ->
            val l = (0 until g.childCount).map { g.getChildAt(it) }
            tiles += l
            rows += l.chunked(SETTINGS_COLS)
        }
        fun rowOf(v: View) = rows.indexOfFirst { v in it }
        fun inRow(r: Int, c: Int) = rows.getOrNull(r)?.let { it[c.coerceAtMost(it.size - 1)] }
        val homeBtn = (col.getChildAt(0) as? ViewGroup)?.getChildAt(0)
        tiles.forEachIndexed { i, t ->
            t.setOnKeyListener { _, code, ev ->
                // Amazon Home only by holding OK, so a quick press never takes you out of LTTV Home.
                if (i == 0 && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
                    if (ev.action == KeyEvent.ACTION_DOWN && ev.repeatCount == 10) openAmazonHome()
                    else if (ev.action == KeyEvent.ACTION_UP && ev.eventTime - ev.downTime < 500) toast("Hold OK to go to Fire TV's home")
                    return@setOnKeyListener true
                }
                if (ev.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener code in listOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN)
                val target = when (code) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> tiles.getOrNull(i + 1) ?: t
                    KeyEvent.KEYCODE_DPAD_LEFT -> tiles.getOrNull(i - 1) ?: homeBtn ?: t
                    KeyEvent.KEYCODE_DPAD_DOWN -> rowOf(t).let { r -> inRow(r + 1, rows[r].indexOf(t)) } ?: t
                    KeyEvent.KEYCODE_DPAD_UP -> rowOf(t).let { r -> inRow(r - 1, rows[r].indexOf(t)) } ?: homeBtn ?: t
                    else -> return@setOnKeyListener false
                }
                target.requestFocus()
                // keep the tile on screen
                val r = android.graphics.Rect(); target.getDrawingRect(r)
                try { page.offsetDescendantRectToMyCoords(target, r); page.smoothScrollTo(0, (r.top - dp(140)).coerceAtLeast(0)) } catch (_: Exception) {}
                true
            }
        }
        homeBtn?.setOnKeyListener { _, code, ev ->
            if (code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_DPAD_RIGHT) { if (ev.action == KeyEvent.ACTION_DOWN) tiles.firstOrNull()?.requestFocus(); true }
            else code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_LEFT
        }
        updateFocusLock()
        page.post { settingsFirst?.requestFocus() }
    }

    private fun closeSettings() {
        settingsPage?.let { root.removeView(it) }; settingsPage = null
        settingsFirst = null
        updateFocusLock()
    }

    private fun settingsGrid(items: List<Setting>) = GridLayout(this).apply {
        columnCount = SETTINGS_COLS; setPadding(0, dp(8), 0, dp(8))
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

    /**
     * Fire TV's own home screen. Asking for "a home screen" brings back LTTV Home (it's the one set), so this opens
     * Amazon's home directly. Press Home on the remote to come back to LTTV Home.
     */
    private fun openAmazonHome() {
        val pkg = "com.amazon.tv.launcher"
        val tries = mutableListOf<Intent>()
        for (cls in listOf("com.amazon.tv.launcher.ui.HomeActivity_vNext", "com.amazon.tv.launcher.ui.HomeActivity", "com.amazon.tv.launcher.ui.DebugHomeActivity"))
            tries += Intent(Intent.ACTION_MAIN).setComponent(ComponentName(pkg, cls))
        // whatever other home screens the TV has (not this one)
        try {
            for (ri in packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)) {
                val a = ri.activityInfo ?: continue
                if (a.packageName != packageName) tries += Intent(Intent.ACTION_MAIN).setComponent(ComponentName(a.packageName, a.name))
            }
        } catch (_: Exception) {}
        packageManager.getLaunchIntentForPackage(pkg)?.let { tries += it }
        for (i in tries) {
            try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)); toast("Fire TV home — press Home on the remote to come back"); return } catch (_: Exception) {}
        }
        toast("Couldn't open Fire TV's home on this TV")
    }

    private fun system(vararg actions: String) {
        for (a in actions) {
            val i = Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (i.resolveActivity(packageManager) != null) { try { startActivity(i); return } catch (_: Exception) {} }
        }
        for (pkg in listOf("com.amazon.tv.settings.v2", "com.amazon.tv.settings", "com.android.tv.settings")) {
            val i = packageManager.getLaunchIntentForPackage(pkg) ?: packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: continue
            try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {}
        }
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
        updateFocusLock()
        page.post { (col.getChildAt(col.childCount - 1)).requestFocus() }
    }

    private fun closePhotos() {
        artServer?.stop(); artServer = null
        photosPage?.let { root.removeView(it) }; photosPage = null
        updateFocusLock()
        (settingsPage ?: homeItem).requestFocus()
    }

    override fun onDestroy() { artServer?.stop(); super.onDestroy() }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val CONTENT_LEFT = 120
        const val CONTENT_RIGHT = 40
        const val TILE_GAP = 22
        const val SETTINGS_COLS = 4
        val LTTV_PACKAGES = listOf("tv.lttv.app.debug", "tv.lttv.app")
    }
}
