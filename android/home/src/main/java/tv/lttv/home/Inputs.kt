package tv.lttv.home

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.os.Build
import android.provider.Settings

/**
 * The TV's inputs (HDMI 1, HDMI 2, Antenna…) on Fire TV smart TVs, and switching to one —
 * the same way Fire TV's own home screen does it (a "passthrough" channel for that input).
 */
object Inputs {
    data class Input(val id: String, val label: String, val type: Int, val passthrough: Boolean)

    fun list(c: Context): List<Input> {
        if (Build.VERSION.SDK_INT < 21) return emptyList()
        val tim = c.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager ?: return emptyList()
        val out = mutableListOf<Input>()
        val list = try { tim.tvInputList } catch (_: Exception) { emptyList<TvInputInfo>() }
        for (i in list) {
            try {
                if (Build.VERSION.SDK_INT >= 23 && i.isHidden(c)) continue
                // Only real inputs on the TV (HDMI, AV, antenna/cable tuner), not apps' channel sources.
                val physical = i.isPassthroughInput || i.type == TvInputInfo.TYPE_TUNER
                if (!physical) continue
                val custom = if (Build.VERSION.SDK_INT >= 24) i.loadCustomLabel(c)?.toString() else null
                val label = (custom ?: i.loadLabel(c)?.toString() ?: "").ifBlank { typeName(i.type) }
                out += Input(i.id, label, i.type, i.isPassthroughInput)
            } catch (_: Exception) { }
        }
        return out.sortedWith(compareBy({ it.type != TvInputInfo.TYPE_TUNER }, { it.label }))
    }

    fun typeName(t: Int) = when (t) {
        TvInputInfo.TYPE_HDMI -> "HDMI"
        TvInputInfo.TYPE_TUNER -> "Antenna / Cable"
        TvInputInfo.TYPE_COMPOSITE -> "AV"
        TvInputInfo.TYPE_COMPONENT -> "Component"
        TvInputInfo.TYPE_DISPLAY_PORT -> "DisplayPort"
        TvInputInfo.TYPE_VGA -> "VGA"
        else -> "Input"
    }

    /** Switches the TV to this input. Returns false if the TV wouldn't do it. */
    fun open(a: Activity, input: Input): Boolean {
        val uri = if (input.passthrough) TvContract.buildChannelUriForPassthroughInput(input.id)
                  else TvContract.buildChannelsUriForInput(input.id)
        val tries = listOf(
            Intent(Intent.ACTION_VIEW, uri),
            Intent(Intent.ACTION_VIEW, uri).setPackage("com.amazon.tv.livetv"),
            Intent(Intent.ACTION_VIEW, uri).setPackage("com.android.tv"),
        )
        for (i in tries) {
            try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true } catch (_: Exception) { }
        }
        return false
    }

    /** Fire TV's own inputs screen, if this isn't a TV with inputs we can list. */
    fun openSystemInputs(a: Activity): Boolean {
        val tries = listOf(
            Intent("com.amazon.tv.settings.v2.TV_INPUTS"),
            Intent("com.amazon.tv.settings.INPUTS"),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (i in tries) {
            try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true } catch (_: Exception) { }
        }
        return false
    }
}
