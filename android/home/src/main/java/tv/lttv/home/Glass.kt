package tv.lttv.home

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** The "liquid glass" look: frosted, see-through surfaces with a soft sheen and a thin bright edge. */
object Glass {
    fun dp(c: Context, v: Int) = (v * c.resources.displayMetrics.density).toInt()

    /** A frosted panel or tile. Focused = bright white glass. */
    fun surface(c: Context, radiusDp: Int, focused: Boolean = false, strong: Boolean = false): GradientDrawable {
        val colors = when {
            focused -> intArrayOf(Color.parseColor("#F7FFFFFF"), Color.parseColor("#E3EEF2F8"))
            strong -> intArrayOf(Color.parseColor("#4DFFFFFF"), Color.parseColor("#1FFFFFFF"))
            else -> intArrayOf(Color.parseColor("#2EFFFFFF"), Color.parseColor("#0FFFFFFF"))
        }
        return GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, colors).apply {
            cornerRadius = dp(c, radiusDp).toFloat()
            setStroke(dp(c, if (focused) 2 else 1), Color.parseColor(if (focused) "#FFFFFFFF" else "#40FFFFFF"))
        }
    }

    /** A large dark glass sheet behind a whole page. */
    fun sheet(c: Context, radiusDp: Int = 0) = GradientDrawable(GradientDrawable.Orientation.TL_BR,
        intArrayOf(Color.parseColor("#D9161A24"), Color.parseColor("#C70E1016"))).apply {
        cornerRadius = dp(c, radiusDp).toFloat()
        setStroke(dp(c, 1), Color.parseColor("#2EFFFFFF"))
    }

    fun text(c: Context, sp: Float, color: String = "#FFFFFF", bold: Boolean = false) = TextView(c).apply {
        setTextColor(Color.parseColor(color))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        typeface = if (bold) Typeface.create("sans-serif-medium", Typeface.NORMAL) else Typeface.DEFAULT
    }

    /** A glass pill button that turns solid white when focused. */
    fun button(c: Context, label: String, onClick: () -> Unit) = text(c, 15f, bold = true).apply {
        text = label
        gravity = Gravity.CENTER
        setPadding(dp(c, 20), dp(c, 9), dp(c, 20), dp(c, 9))
        isFocusable = true; isClickable = true
        background = surface(c, 22)
        setOnClickListener { onClick() }
        setOnFocusChangeListener { v, f ->
            v.background = surface(c, 22, f)
            (v as TextView).setTextColor(Color.parseColor(if (f) "#0B0D12" else "#FFFFFF"))
        }
    }

    /** Focus animation shared by tiles: lift + scale. */
    fun lift(v: View, f: Boolean) {
        v.animate().scaleX(if (f) 1.06f else 1f).scaleY(if (f) 1.06f else 1f).setDuration(140).start()
        v.translationZ = if (f) dp(v.context, 10).toFloat() else 0f
    }

    fun row(c: Context) = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }

    /** Lets focused tiles grow past their row / grid without their borders being cut off. */
    fun unclip(v: android.view.View) {
        if (v is android.view.ViewGroup) {
            if (v !is android.widget.ScrollView && v !is android.widget.HorizontalScrollView) {
                v.clipChildren = false
                v.clipToPadding = false
            } else v.clipToPadding = false
            for (i in 0 until v.childCount) unclip(v.getChildAt(i))
        }
    }
}
