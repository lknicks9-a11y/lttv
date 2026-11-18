package tv.lttv.home

import android.content.Context
import android.graphics.Typeface

/** LTTV Home's typeface: Inter (bundled), instead of the TV's plain default font. */
object Fonts {
    var regular: Typeface = Typeface.DEFAULT; private set
    var medium: Typeface = Typeface.DEFAULT; private set
    var bold: Typeface = Typeface.DEFAULT_BOLD; private set
    var display: Typeface = Typeface.DEFAULT_BOLD; private set
    private var ready = false

    fun init(c: Context) {
        if (ready) return
        fun load(name: String, fallback: Typeface) = try { Typeface.createFromAsset(c.assets, "fonts/$name") } catch (_: Exception) { fallback }
        regular = load("inter-regular.otf", Typeface.DEFAULT)
        medium = load("inter-medium.otf", Typeface.DEFAULT)
        bold = load("inter-semibold.otf", Typeface.DEFAULT_BOLD)
        display = load("inter-display-extrabold.otf", Typeface.DEFAULT_BOLD)
        ready = true
    }
}
