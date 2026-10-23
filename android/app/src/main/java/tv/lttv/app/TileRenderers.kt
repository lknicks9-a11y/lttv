package tv.lttv.app

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/**
 * Multiview tiles: while a tile is muted (another game has the sound), its video renderer leaves out H.264
 * frames nothing depends on before they reach the decoder (see [NonRefFrames]). The game with the sound keeps
 * every frame. Four games at full frame rate is what made every tile stutter on a Fire TV stick.
 */
@OptIn(UnstableApi::class)
class TileRenderersFactory(context: Context, private val light: () -> Boolean) : DefaultRenderersFactory(context) {
    override fun buildVideoRenderers(
        context: Context,
        extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector,
        enableDecoderFallback: Boolean,
        eventHandler: Handler,
        eventListener: VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long,
        out: ArrayList<Renderer>,
    ) {
        out.add(
            LightVideoRenderer(context, mediaCodecSelector, allowedVideoJoiningTimeMs, enableDecoderFallback, eventHandler, eventListener, light),
        )
    }
}

@OptIn(UnstableApi::class)
class LightVideoRenderer(
    context: Context,
    selector: MediaCodecSelector,
    joiningMs: Long,
    fallback: Boolean,
    handler: Handler,
    listener: VideoRendererEventListener,
    private val light: () -> Boolean,
) : MediaCodecVideoRenderer(context, selector, joiningMs, fallback, handler, listener, 50) {
    override fun shouldSkipDecoderInputBuffer(buffer: DecoderInputBuffer): Boolean {
        if (super.shouldSkipDecoderInputBuffer(buffer)) return true
        if (!light() || buffer.isKeyFrame || buffer.isEncrypted || buffer.isLastSample) return false
        if (codecInfo?.mimeType != MimeTypes.VIDEO_H264) return false
        val data = buffer.data ?: return false
        // Not flipped yet: the sample is bytes [0, position).
        return NonRefFrames.isDisposableH264(data, 0, data.position())
    }
}
