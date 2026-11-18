package tv.lttv.home

import android.app.Activity
import android.graphics.Color
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.media.tv.TvView
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Watching an HDMI / AV input (or the antenna) full screen. Fire TV only lets Amazon's own apps use its input
 * switcher, so LTTV Home shows the input itself with Android's standard TV view — the picture and sound come
 * straight from the TV's input. Back or Home returns to LTTV Home.
 */
class InputActivity : Activity() {
    companion object {
        const val EXTRA_ID = "inputId"
        const val EXTRA_LABEL = "label"
        const val EXTRA_PASSTHROUGH = "passthrough"
    }

    private lateinit var tv: TvView
    private lateinit var badge: TextView
    private val main = Handler(Looper.getMainLooper())
    private val hide = Runnable { badge.animate().alpha(0f).setDuration(400).start() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        tv = TvView(this)
        root.addView(tv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val label = intent.getStringExtra(EXTRA_LABEL) ?: "Input"
        badge = TextView(this).apply {
            text = "$label   ·   Back to return to Home"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            background = Glass.surface(this@InputActivity, 18, strong = true)
            setPadding(Glass.dp(context, 22), Glass.dp(context, 12), Glass.dp(context, 22), Glass.dp(context, 12))
        }
        root.addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            leftMargin = Glass.dp(this@InputActivity, 40); topMargin = Glass.dp(this@InputActivity, 32)
        })
        setContentView(root)
        tune()
    }

    private fun tune() {
        val id = intent.getStringExtra(EXTRA_ID) ?: return finish()
        val passthrough = intent.getBooleanExtra(EXTRA_PASSTHROUGH, true)
        tv.setCallback(object : TvView.TvInputCallback() {
            override fun onVideoAvailable(inputId: String?) { main.removeCallbacks(hide); main.postDelayed(hide, 3000) }
            override fun onVideoUnavailable(inputId: String?, reason: Int) {
                badge.alpha = 1f
                badge.text = when (reason) {
                    TvInputManager.VIDEO_UNAVAILABLE_REASON_TUNING -> "Switching to ${intent.getStringExtra(EXTRA_LABEL)}…"
                    else -> "${intent.getStringExtra(EXTRA_LABEL)}: no signal. Is the device on?   ·   Back to return"
                }
            }
            override fun onDisconnected(inputId: String?) { badge.alpha = 1f; badge.text = "The input disconnected   ·   Back to return" }
        })
        val uri: Uri = if (passthrough) TvContract.buildChannelUriForPassthroughInput(id) else TvContract.buildChannelsUriForInput(id)
        try {
            tv.tune(id, uri)
        } catch (e: Exception) {
            badge.text = "This TV wouldn't open that input (${e.message ?: "refused"})   ·   Back to return"
        }
        main.postDelayed(hide, 5000)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) { finish(); return true }
        // Any other button shows which input this is again.
        if (keyCode != KeyEvent.KEYCODE_HOME) {
            badge.animate().cancel(); badge.alpha = 1f
            main.removeCallbacks(hide); main.postDelayed(hide, 3000)
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onStop() {
        super.onStop()
        try { tv.reset() } catch (_: Exception) { }
        finish()
    }
}
