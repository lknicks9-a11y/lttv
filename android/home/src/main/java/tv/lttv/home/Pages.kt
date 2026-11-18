package tv.lttv.home

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Small helpers shared by LTTV Home's own pages (Search, Sports scores, Weather). */
private val main = Handler(Looper.getMainLooper())
private fun dp(a: Activity, v: Int) = Glass.dp(a, v)

private fun fetchJson(url: String): String {
    var u = URL(url); var hops = 0
    while (true) {
        val c = u.openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false; c.connectTimeout = 12_000; c.readTimeout = 15_000
        c.setRequestProperty("User-Agent", "LTTV-Home"); c.setRequestProperty("Accept", "application/json")
        val code = c.responseCode
        if (code in 300..399 && hops++ < 6) { u = URL(u, c.getHeaderField("Location")); c.disconnect(); continue }
        if (code != 200) throw Exception("HTTP $code")
        return c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() }
    }
}

private fun bg(job: () -> Unit) = Thread { try { job() } catch (_: Exception) { } }.start()

/** A focusable glass tile: white when you're on it. */
private fun tile(a: Activity, click: (() -> Unit)?, build: (LinearLayout) -> Unit): LinearLayout = LinearLayout(a).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(a, 18), dp(a, 14), dp(a, 18), dp(a, 14))
    background = Glass.surface(a, 16)
    isFocusable = true; isClickable = click != null
    build(this)
    if (click != null) setOnClickListener { click() }
    setOnFocusChangeListener { v, f ->
        v.background = Glass.surface(a, 16, f)
        for (i in 0 until (v as ViewGroup).childCount) recolor(v.getChildAt(i), f)
        Glass.lift(v, f)
    }
}
private fun recolor(v: View, f: Boolean) {
    if (v is TextView) {
        val base = (v.tag as? Int) ?: Color.WHITE
        v.setTextColor(if (f) Color.parseColor("#14102A") else base)
    } else if (v is ViewGroup) for (i in 0 until v.childCount) recolor(v.getChildAt(i), f)
}
private fun label(a: Activity, s: String, sp: Float, color: String = "#FFFFFF", bold: Boolean = false) = TextView(a).apply {
    text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); typeface = if (bold) Fonts.bold else Fonts.medium
    val c = Color.parseColor(color); setTextColor(c); tag = c
}

// ---------------------------------------------------------------------------------------------------------
/** Home → Search: apps on this TV, apps in the Store, and Home's own pages and settings. Not LTTV's search. */
class SearchPage(
    private val a: Activity,
    private val apps: () -> List<Pair<String, () -> Unit>>,
    private val store: (String) -> List<Triple<String, String, () -> Unit>>,
    private val shortcuts: List<Pair<String, () -> Unit>>,
) {
    fun build(col: LinearLayout) {
        val box = EditText(a).apply {
            hint = "Search apps, the Store, settings…"; setHintTextColor(Color.parseColor("#9A93C0")); setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f); typeface = Fonts.medium; isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            background = Glass.surface(a, 18, strong = true); setPadding(dp(a, 22), dp(a, 14), dp(a, 22), dp(a, 14))
        }
        col.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(a, 18) })
        val results = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        col.addView(results)
        fun show(q: String) {
            results.removeAllViews()
            val t = q.trim().lowercase()
            val hits = mutableListOf<Triple<String, String, () -> Unit>>()
            for ((n, act) in apps()) if (t.isEmpty() || n.lowercase().contains(t)) hits += Triple(n, "Open app", act)
            if (t.isNotEmpty()) hits += store(t)
            for ((n, act) in shortcuts) if (t.isNotEmpty() && n.lowercase().contains(t)) hits += Triple(n, "LTTV Home", act)
            if (hits.isEmpty()) { results.addView(label(a, "Nothing found for “$q”.", 18f, "#C9C3E8")); return }
            val g = android.widget.GridLayout(a).apply { columnCount = 3 }
            val w = (a.resources.displayMetrics.widthPixels - dp(a, 112) - 3 * dp(a, 16)) / 3
            for ((n, sub, act) in hits.take(30)) g.addView(tile(a, act) { it.addView(label(a, n, 18f, bold = true)); it.addView(label(a, sub, 13f, "#C9C3E8")) },
                android.widget.GridLayout.LayoutParams().apply { width = w; setMargins(dp(a, 8), dp(a, 8), dp(a, 8), dp(a, 8)) })
            results.addView(g)
        }
        box.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = show(s?.toString() ?: "")
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })
        box.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEARCH) { results.requestFocus(); (results.getChildAt(0) as? ViewGroup)?.getChildAt(0)?.requestFocus(); true } else false }
        show("")
        box.post { box.requestFocus() }
    }
}

// ---------------------------------------------------------------------------------------------------------
/** Home → Sports: today's scores (ESPN's public scoreboards), league by league. */
class ScoresPage(private val a: Activity) {
    private data class League(val name: String, val path: String)
    private val leagues = listOf(
        League("NFL", "football/nfl"), League("NBA", "basketball/nba"), League("NHL", "hockey/nhl"), League("MLB", "baseball/mlb"),
        League("College Football", "football/college-football"), League("College Basketball", "basketball/mens-college-basketball"),
        League("WNBA", "basketball/wnba"), League("MLS", "soccer/usa.1"), League("Premier League", "soccer/eng.1"),
    )
    private lateinit var games: LinearLayout
    private lateinit var status: TextView
    private val chips = mutableListOf<TextView>()
    private var current = 0
    private var auto: Runnable? = null

    fun build(col: LinearLayout) {
        val row = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
        leagues.forEachIndexed { i, l ->
            val c = TextView(a).apply {
                text = l.name; setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f); typeface = Fonts.bold
                setPadding(dp(a, 20), dp(a, 10), dp(a, 20), dp(a, 10)); isFocusable = true; isClickable = true
                setOnClickListener { pick(i) }
                setOnFocusChangeListener { _, _ -> paintChips() }
            }
            chips += c; row.addView(c, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(a, 10) })
        }
        col.addView(HorizontalScrollView(a).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; setPadding(dp(a, 4), dp(a, 6), dp(a, 4), dp(a, 12)); addView(row) })
        status = label(a, "", 15f, "#C9C3E8"); col.addView(status)
        games = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(a, 10), 0, 0) }
        col.addView(games)
        pick(0)
        col.post { chips.firstOrNull()?.requestFocus() }
    }

    private fun paintChips() = chips.forEachIndexed { i, c ->
        val on = i == current; val f = c.isFocused
        c.background = GradientDrawable().apply { cornerRadius = dp(a, 22).toFloat(); setColor(if (f) Color.WHITE else if (on) Color.parseColor("#55FFFFFF") else Color.parseColor("#1FFFFFFF")) }
        c.setTextColor(if (f) Color.parseColor("#14102A") else Color.WHITE)
    }

    private fun pick(i: Int) {
        current = i; paintChips()
        status.text = "Loading ${leagues[i].name}…"
        load(i)
        auto?.let { main.removeCallbacks(it) }
        auto = Runnable { if (games.isAttachedToWindow) { load(current); main.postDelayed(auto!!, 60_000) } }.also { main.postDelayed(it, 60_000) }
    }

    private fun load(i: Int) = bg {
        val j = JSONObject(fetchJson("https://site.api.espn.com/apis/site/v2/sports/${leagues[i].path}/scoreboard"))
        val events = j.optJSONArray("events") ?: JSONArray()
        main.post { if (i == current) show(events) }
    }

    private fun show(events: JSONArray) {
        games.removeAllViews()
        if (events.length() == 0) { status.text = "No ${leagues[current].name} games today."; return }
        status.text = "${leagues[current].name} · ${events.length()} games · updates every minute"
        val g = android.widget.GridLayout(a).apply { columnCount = 3 }
        val w = (a.resources.displayMetrics.widthPixels - dp(a, 112) - 3 * dp(a, 16)) / 3
        for (k in 0 until events.length()) {
            val e = events.getJSONObject(k)
            val comp = e.optJSONArray("competitions")?.optJSONObject(0) ?: continue
            val st = comp.optJSONObject("status")?.optJSONObject("type") ?: e.optJSONObject("status")?.optJSONObject("type")
            val state = st?.optString("state") ?: "pre"
            val detail = st?.optString("shortDetail") ?: ""
            val teams = comp.optJSONArray("competitors") ?: continue
            val sorted = (0 until teams.length()).map { teams.getJSONObject(it) }.sortedBy { if (it.optString("homeAway") == "away") 0 else 1 }
            g.addView(tile(a, {}) { t ->
                t.addView(label(a, if (state == "in") "● LIVE · $detail" else detail, 13f, if (state == "in") "#FF6B6B" else "#C9C3E8", bold = state == "in"))
                for (c in sorted) {
                    val team = c.optJSONObject("team") ?: JSONObject()
                    val line = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(a, 6), 0, 0) }
                    val color = team.optString("color").takeIf { it.length == 6 }?.let { "#$it" } ?: "#5A4FA0"
                    line.addView(View(a).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(color)); setStroke(dp(a, 1), Color.parseColor("#66FFFFFF")) } }, LinearLayout.LayoutParams(dp(a, 14), dp(a, 14)).apply { marginEnd = dp(a, 10) })
                    val name = team.optString("shortDisplayName").ifEmpty { team.optString("abbreviation") }
                    val rec = c.optJSONArray("records")?.optJSONObject(0)?.optString("summary") ?: ""
                    line.addView(label(a, name, 19f, bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    if (state == "pre") line.addView(label(a, rec, 14f, "#C9C3E8"))
                    else line.addView(label(a, c.optString("score"), 22f, bold = true))
                    t.addView(line)
                }
                val net = comp.optJSONArray("broadcasts")?.optJSONObject(0)?.optJSONArray("names")?.optString(0)
                if (!net.isNullOrEmpty()) t.addView(label(a, net, 12f, "#9A93C0").apply { setPadding(0, dp(a, 6), 0, 0) })
            }, android.widget.GridLayout.LayoutParams().apply { width = w; setMargins(dp(a, 8), dp(a, 8), dp(a, 8), dp(a, 8)) })
        }
        games.addView(g)
        Glass.unclip(g)
    }
}

// ---------------------------------------------------------------------------------------------------------
/** Home → Weather: now, the next hours and the week, for where the TV is (or a place you pick). Open-Meteo. */
class WeatherPage(private val a: Activity) {
    private val prefs by lazy { a.getSharedPreferences("home", Activity.MODE_PRIVATE) }
    private lateinit var body: LinearLayout

    fun build(col: LinearLayout) {
        body = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        col.addView(body)
        val change = Glass.button(a, "Change place") { askPlace() }
        col.addView(change, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(a, 22) })
        body.addView(label(a, "Finding the weather…", 18f, "#C9C3E8"))
        locate()
        col.post { change.requestFocus() }
    }

    private fun locate() = bg {
        val saved = prefs.getString("weatherPlace", null)
        val (lat, lon, name) = if (saved != null) {
            val o = JSONObject(saved); Triple(o.getDouble("lat"), o.getDouble("lon"), o.getString("name"))
        } else {
            val j = JSONObject(fetchJson("https://ipwho.is/"))
            Triple(j.getDouble("latitude"), j.getDouble("longitude"), listOf(j.optString("city"), j.optString("region_code")).filter { it.isNotBlank() }.joinToString(", "))
        }
        val f = JSONObject(fetchJson("https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
            "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day" +
            "&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
            "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7"))
        main.post { show(name, f) }
    }

    private fun askPlace() {
        val input = EditText(a).apply { hint = "City or ZIP"; isSingleLine = true }
        android.app.AlertDialog.Builder(a, android.app.AlertDialog.THEME_DEVICE_DEFAULT_DARK)
            .setTitle("Weather for…").setView(input)
            .setPositiveButton("Show") { _, _ ->
                val q = input.text.toString().trim()
                if (q.isEmpty()) { prefs.edit().remove("weatherPlace").apply(); locate(); return@setPositiveButton }
                bg {
                    val r = JSONObject(fetchJson("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=" + URLEncoder.encode(q, "UTF-8"))).optJSONArray("results")?.optJSONObject(0)
                    main.post {
                        if (r == null) { android.widget.Toast.makeText(a, "Couldn't find “$q”", android.widget.Toast.LENGTH_SHORT).show(); return@post }
                        val name = listOf(r.optString("name"), r.optString("admin1")).filter { it.isNotBlank() }.joinToString(", ")
                        prefs.edit().putString("weatherPlace", JSONObject().put("lat", r.getDouble("latitude")).put("lon", r.getDouble("longitude")).put("name", name).toString()).apply()
                        locate()
                    }
                }
            }
            .setNeutralButton("Use the TV's location") { _, _ -> prefs.edit().remove("weatherPlace").apply(); locate() }
            .setNegativeButton("Cancel", null).show()
    }

    private fun describe(code: Int): Pair<String, String> = when (code) {
        0 -> "☀️" to "Clear"; 1 -> "🌤" to "Mostly clear"; 2 -> "⛅" to "Partly cloudy"; 3 -> "☁️" to "Cloudy"
        45, 48 -> "🌫" to "Fog"; 51, 53, 55 -> "🌦" to "Drizzle"; 56, 57 -> "🌧" to "Freezing drizzle"
        61, 63 -> "🌧" to "Rain"; 65 -> "🌧" to "Heavy rain"; 66, 67 -> "🌧" to "Freezing rain"
        71, 73 -> "🌨" to "Snow"; 75, 77 -> "❄️" to "Heavy snow"; 80, 81, 82 -> "🌦" to "Showers"
        85, 86 -> "🌨" to "Snow showers"; 95, 96, 99 -> "⛈" to "Thunderstorms"; else -> "🌡" to "—"
    }

    private fun show(place: String, f: JSONObject) {
        body.removeAllViews()
        val cur = f.getJSONObject("current")
        val (icon, words) = describe(cur.optInt("weather_code"))
        val top = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(label(a, icon, 64f))
        val txt = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(a, 22), 0, 0, 0) }
        txt.addView(label(a, "${cur.optDouble("temperature_2m").toInt()}°", 64f, bold = true).apply { typeface = Fonts.display })
        txt.addView(label(a, "$words · feels like ${cur.optDouble("apparent_temperature").toInt()}°", 20f))
        txt.addView(label(a, "$place · wind ${cur.optDouble("wind_speed_10m").toInt()} mph · humidity ${cur.optInt("relative_humidity_2m")}%", 15f, "#C9C3E8"))
        top.addView(txt)
        body.addView(top)

        // next 12 hours
        body.addView(label(a, "Next hours", 19f, bold = true).apply { setPadding(0, dp(a, 26), 0, dp(a, 8)) })
        val hourly = f.getJSONObject("hourly")
        val times = hourly.getJSONArray("time"); val temps = hourly.getJSONArray("temperature_2m"); val codes = hourly.getJSONArray("weather_code")
        val rain = hourly.optJSONArray("precipitation_probability")
        val tz = TimeZone.getTimeZone(f.optString("timezone", TimeZone.getDefault().id))
        val parse = SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US).apply { timeZone = tz }
        val hourFmt = SimpleDateFormat("h a", Locale.US).apply { timeZone = tz }
        val now = System.currentTimeMillis()
        var start = 0
        for (i in 0 until times.length()) { if ((parse.parse(times.getString(i))?.time ?: 0) >= now - 3_600_000) { start = i; break } }
        val hrs = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
        for (i in start until minOf(times.length(), start + 12)) {
            hrs.addView(tile(a, null) { t ->
                t.gravity = Gravity.CENTER_HORIZONTAL
                t.addView(label(a, hourFmt.format(parse.parse(times.getString(i)) ?: Date()), 14f, "#C9C3E8"))
                t.addView(label(a, describe(codes.optInt(i)).first, 26f))
                t.addView(label(a, "${temps.optDouble(i).toInt()}°", 20f, bold = true))
                val p = rain?.optInt(i) ?: 0
                if (p >= 20) t.addView(label(a, "$p%", 12f, "#7FC8FF"))
            }.apply { isFocusable = false }, LinearLayout.LayoutParams(dp(a, 92), ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(a, 10) })
        }
        body.addView(HorizontalScrollView(a).apply { isHorizontalScrollBarEnabled = false; addView(hrs) })

        // the week
        body.addView(label(a, "This week", 19f, bold = true).apply { setPadding(0, dp(a, 26), 0, dp(a, 8)) })
        val daily = f.getJSONObject("daily")
        val days = daily.getJSONArray("time"); val hi = daily.getJSONArray("temperature_2m_max"); val lo = daily.getJSONArray("temperature_2m_min")
        val dcode = daily.getJSONArray("weather_code"); val dr = daily.optJSONArray("precipitation_probability_max")
        val dayParse = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = tz }
        val dayFmt = SimpleDateFormat("EEE", Locale.US).apply { timeZone = tz }
        val wk = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
        for (i in 0 until days.length()) {
            wk.addView(tile(a, null) { t ->
                t.gravity = Gravity.CENTER_HORIZONTAL
                t.addView(label(a, if (i == 0) "Today" else dayFmt.format(dayParse.parse(days.getString(i)) ?: Date()), 15f, bold = true))
                t.addView(label(a, describe(dcode.optInt(i)).first, 30f))
                t.addView(label(a, "${hi.optDouble(i).toInt()}° / ${lo.optDouble(i).toInt()}°", 16f))
                val p = dr?.optInt(i) ?: 0
                if (p >= 20) t.addView(label(a, "💧 $p%", 12f, "#7FC8FF"))
            }.apply { isFocusable = false }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(a, 10) })
        }
        body.addView(wk, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
}
