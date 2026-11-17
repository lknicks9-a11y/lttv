package tv.lttv.app

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
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
import android.text.format.DateFormat
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
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.Date

/**
 * LTTV Home: a clean, ad-free home screen for the Fire TV. It only lists and opens the apps
 * installed on the device — LTTV first, then the user's favorites (Hulu, YouTube...), then
 * every app A–Z, plus Settings. Fire OS has no setting to pick a home app, so the user sets
 * this one with a launcher tool (Launcher Manager Mini) or a remote's app button.
 *
 * Favorites are kept on the device ("home" preferences) as "package/class" lines, in order.
 * Hold Select (or press Menu) on any app to add, remove or move it.
 */
class HomeActivity : AppCompatActivity() {

    private data class App(val pkg: String, val cls: String, val label: String, val leanback: Boolean) {
        val key get() = "$pkg/$cls"
    }

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }
    private lateinit var content: LinearLayout
    private lateinit var clock: TextView
    private lateinit var date: TextView
    private var apps: List<App> = emptyList()
    /** Key of the tile that had focus, so it keeps focus after the screen is rebuilt. */
    private var focusKey: String? = null
    private var focusRow: String? = null

    private val tick = object : Runnable {
        override fun run() {
            val now = Date()
            clock.text = DateFormat.getTimeFormat(this@HomeActivity).format(now)
            date.text = DateFormat.format("EEEE, MMMM d", now)
            main.postDelayed(this, 15_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#0B1726"), Color.parseColor("#08080A"), Color.parseColor("#120A18")),
        )

        val scroll = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(28), dp(48), dp(40))
        }

        // Header: LTTV wordmark on the left, time and date on the right.
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(this).apply {
            text = "LTTV"
            setTextColor(Color.parseColor("#4CC2FF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            letterSpacing = 0.04f
        })
        header.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        val when_ = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.END }
        clock = TextView(this).apply {
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
        }
        date = TextView(this).apply { setTextColor(Color.parseColor("#9AA4B2")); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f) }
        when_.addView(clock); when_.addView(date)
        header.addView(when_)
        column.addView(header)

        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(content)
        scroll.addView(column)
        root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        main.post(tick)
        rebuild() // apps may have been installed or removed while away
    }

    override fun onPause() {
        super.onPause()
        main.removeCallbacks(tick)
    }

    // The home screen is the bottom of the stack: Back has nowhere to go.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* stay home */ }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            val v = currentFocus
            val tag = v?.tag as? Pair<*, *>
            val app = tag?.second as? App
            if (app != null) { showOptions(app, tag.first == "fav"); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    // ---- apps ---------------------------------------------------------------------------

    private fun loadApps(): List<App> {
        val pm = packageManager
        val found = LinkedHashMap<String, App>()
        fun add(list: List<ResolveInfo>, leanback: Boolean) {
            for (r in list) {
                val ai = r.activityInfo ?: continue
                if (ai.packageName == packageName && ai.name == HomeActivity::class.java.name) continue
                if (ai.packageName == packageName && ai.name.endsWith(".HomeAlias")) continue
                if (found.containsKey(ai.packageName)) continue // one tile per app; TV entry wins
                val label = r.loadLabel(pm)?.toString()?.trim().orEmpty().ifEmpty { ai.packageName }
                found[ai.packageName] = App(ai.packageName, ai.name, label, leanback)
            }
        }
        add(query(Intent.CATEGORY_LEANBACK_LAUNCHER), true)
        add(query(Intent.CATEGORY_LAUNCHER), false)
        return found.values.sortedBy { it.label.lowercase() }
    }

    private fun query(category: String): List<ResolveInfo> =
        try { packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(category), 0) } catch (_: Exception) { emptyList() }

    private fun lttv(): App? = apps.firstOrNull { it.pkg == packageName }

    /** Saved favorites in order; first run picks LTTV and the usual streaming apps that are installed. */
    private fun favorites(): List<App> {
        val byKey = apps.associateBy { it.key }
        val byPkg = apps.associateBy { it.pkg }
        val saved = prefs.getString("favs", null)
        if (saved != null) {
            return saved.split('\n').filter { it.isNotBlank() }.mapNotNull { k -> byKey[k] ?: byPkg[k.substringBefore('/')] }.distinctBy { it.pkg }
        }
        val picks = mutableListOf<App>()
        lttv()?.let { picks += it }
        for (word in DEFAULT_PICKS) {
            val hit = apps.firstOrNull { a ->
                val l = a.label.lowercase()
                l.contains(word) && (word == "kids" || !l.contains("kids")) && picks.none { it.pkg == a.pkg }
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
            val i = Intent(Intent.ACTION_MAIN)
                .addCategory(if (app.leanback) Intent.CATEGORY_LEANBACK_LAUNCHER else Intent.CATEGORY_LAUNCHER)
                .setComponent(ComponentName(app.pkg, app.cls))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            startActivity(i)
        } catch (_: Exception) {
            val fallback = packageManager.getLeanbackLaunchIntentForPackage(app.pkg) ?: packageManager.getLaunchIntentForPackage(app.pkg)
            if (fallback != null) startActivity(fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            else Toast.makeText(this, "Couldn't open ${app.label}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showOptions(app: App, inFavorites: Boolean) {
        val favs = favorites().toMutableList()
        val isFav = favs.any { it.pkg == app.pkg }
        val idx = favs.indexOfFirst { it.pkg == app.pkg }
        val items = mutableListOf<Pair<String, () -> Unit>>()
        items += "Open" to { open(app) }
        if (isFav) {
            if (idx > 0) items += "Move left" to { favs.add(idx - 1, favs.removeAt(idx)); saveFavorites(favs); keepFocus("fav", app); rebuild() }
            if (idx < favs.size - 1) items += "Move right" to { favs.add(idx + 1, favs.removeAt(idx)); saveFavorites(favs); keepFocus("fav", app); rebuild() }
            if (idx > 0) items += "Move to front" to { favs.add(0, favs.removeAt(idx)); saveFavorites(favs); keepFocus("fav", app); rebuild() }
            items += "Remove from Favorites" to { favs.removeAt(idx); saveFavorites(favs); keepFocus(if (inFavorites) "all" else "all", app); rebuild() }
        } else {
            items += "Add to Favorites" to { favs += app; saveFavorites(favs); keepFocus("fav", app); rebuild() }
        }
        items += "App info" to {
            try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.pkg}"))) } catch (_: Exception) {}
        }
        AlertDialog.Builder(this)
            .setTitle(app.label)
            .setItems(items.map { it.first }.toTypedArray()) { _, which -> items[which].second() }
            .show()
    }

    private fun keepFocus(row: String, app: App) { focusRow = row; focusKey = app.pkg }

    // ---- screen -------------------------------------------------------------------------

    private fun rebuild() {
        val had = currentFocus?.tag as? Pair<*, *>
        if (focusKey == null && had != null) { focusRow = had.first as? String; focusKey = (had.second as? App)?.pkg }
        apps = loadApps()
        content.removeAllViews()
        var toFocus: View? = null

        // Favorites: big banners in one row.
        val favs = favorites()
        content.addView(sectionTitle("Favorites"))
        val favRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(6), dp(10), dp(6), dp(16)) }
        for (a in favs) {
            val t = tile(a, "fav", dp(232), dp(130), true)
            favRow.addView(t)
            if (focusRow == "fav" && focusKey == a.pkg) toFocus = t.getChildAt(0)
        }
        if (favs.isEmpty()) favRow.addView(hint("Hold Select on any app below to add it here."))
        content.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false
            addView(favRow)
        })

        // Every app, A–Z.
        content.addView(sectionTitle("All apps"))
        val grid = GridLayout(this).apply { columnCount = 6; setPadding(dp(6), dp(10), dp(6), dp(16)) }
        for (a in apps) {
            val t = tile(a, "all", dp(138), dp(78), false)
            grid.addView(t)
            if (focusRow == "all" && focusKey == a.pkg) toFocus = t.getChildAt(0)
        }
        content.addView(grid)

        // System: Fire TV settings, and Amazon's own home screen as a way back.
        content.addView(sectionTitle("System"))
        val sys = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(6), dp(10), dp(6), dp(16)) }
        sys.addView(actionTile("Settings") {
            try { startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        })
        sys.addView(actionTile("Amazon Home") {
            val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(AMAZON_LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { startActivity(i) } catch (_: Exception) { Toast.makeText(this, "Amazon home isn't available", Toast.LENGTH_SHORT).show() }
        })
        content.addView(sys)

        focusKey = null; focusRow = null
        val target = toFocus ?: (favRow.getChildAt(0) as? ViewGroup)?.getChildAt(0) ?: (grid.getChildAt(0) as? ViewGroup)?.getChildAt(0)
        target?.post { target.requestFocus() }
    }

    /** One app: a 16:9 card (the app's TV banner, or its icon on a dark card) with the name under it. */
    private fun tile(app: App, row: String, w: Int, h: Int, big: Boolean): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(dp(10), dp(8), dp(10), dp(8))
            }
            clipChildren = false
        }
        val card = FrameLayout(this).apply {
            isFocusable = true; isClickable = true
            tag = row to app
            background = cardBg(false)
            setPadding(dp(3), dp(3), dp(3), dp(3))
            clipToOutline = true
        }
        val pm = packageManager
        val banner: Drawable? = try {
            pm.getActivityBanner(ComponentName(app.pkg, app.cls)) ?: pm.getApplicationBanner(app.pkg)
        } catch (_: Exception) { null }
        val img = ImageView(this)
        if (banner != null) {
            img.setImageDrawable(banner); img.scaleType = ImageView.ScaleType.CENTER_CROP
            card.addView(img, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            img.setImageDrawable(try { pm.getActivityIcon(ComponentName(app.pkg, app.cls)) } catch (_: Exception) { pm.defaultActivityIcon })
            img.scaleType = ImageView.ScaleType.FIT_CENTER
            val s = (h * 0.62f).toInt()
            card.addView(img, FrameLayout.LayoutParams(s, s, Gravity.CENTER))
        }
        val name = TextView(this).apply {
            text = app.label
            setTextColor(Color.parseColor("#C9D1DB"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 15f else 12f)
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(4), dp(8), dp(4), 0)
            layoutParams = LinearLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        card.setOnClickListener { open(app) }
        card.setOnLongClickListener { showOptions(app, row == "fav"); true }
        card.setOnFocusChangeListener { v, focused ->
            v.background = cardBg(focused)
            v.animate().scaleX(if (focused) 1.08f else 1f).scaleY(if (focused) 1.08f else 1f).setDuration(140).start()
            name.setTextColor(if (focused) Color.WHITE else Color.parseColor("#C9D1DB"))
            name.typeface = if (focused) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        box.addView(card, LinearLayout.LayoutParams(w, h))
        box.addView(name)
        return box
    }

    private fun actionTile(label: String, onClick: () -> Unit): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(dp(10), dp(8), dp(10), dp(8))
            }
        }
        val card = TextView(this).apply {
            text = label; gravity = Gravity.CENTER
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            isFocusable = true; isClickable = true
            background = cardBg(false)
            setOnClickListener { onClick() }
            setOnFocusChangeListener { v, focused ->
                v.background = cardBg(focused)
                v.animate().scaleX(if (focused) 1.08f else 1f).scaleY(if (focused) 1.08f else 1f).setDuration(140).start()
            }
        }
        box.addView(card, LinearLayout.LayoutParams(dp(170), dp(64)))
        return box
    }

    private fun cardBg(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(Color.parseColor(if (focused) "#22303F" else "#161C24"))
        setStroke(dp(if (focused) 3 else 1), Color.parseColor(if (focused) "#4CC2FF" else "#262E39"))
    }

    private fun sectionTitle(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(Color.parseColor("#E6EAF0"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(16), dp(22), 0, 0)
    }

    private fun hint(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(Color.parseColor("#9AA4B2"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(10), dp(20), dp(10), dp(20))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val AMAZON_LAUNCHER = "com.amazon.tv.launcher"
        /** First-run favorites, in this order, when the app is installed (matched by name). */
        val DEFAULT_PICKS = listOf(
            "hulu", "youtube", "netflix", "prime video", "disney", "max", "peacock",
            "paramount", "espn", "fox sports", "fox one", "nbc", "directv", "apple tv", "spotify",
        )
    }
}
