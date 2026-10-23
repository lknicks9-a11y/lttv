package tv.lttv.app

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/**
 * Multiview tiles play every frame. Only when a muted tile is actually falling behind (the TV is dropping its
 * frames) does it step down, as little as needed: level 1 leaves out H.264 frames nothing depends on before the
 * decoder (see [NonRefFrames]); level 2 also shows at most ~30 frames a second. The game with the sound always
 * stays at full frame rate. [level] is decided by PlayerController from the tile's dropped frames.
 */
@OptIn(UnstableApi::class)
class TileRenderersFactory(context: Context, private val level: () -> Int) : DefaultRenderersFactory(context) {
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
            LightVideoRenderer(context, mediaCodecSelector, allowedVideoJoiningTimeMs, enableDecoderFallback, eventHandler, eventListener, level),
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
    private val level: () -> Int,
) : MediaCodecVideoRenderer(context, selector, joiningMs, fallback, handler, listener, 50) {
    override fun shouldSkipDecoderInputBuffer(buffer: DecoderInputBuffer): Boolean {
        if (super.shouldSkipDecoderInputBuffer(buffer)) return true
        if (level() < 1 || buffer.isKeyFrame || buffer.isEncrypted || buffer.isLastSample) return false
        if (codecInfo?.mimeType != MimeTypes.VIDEO_H264) return false
        val data = buffer.data ?: return false
        // Not flipped yet: the sample is bytes [0, position).
        return NonRefFrames.isDisposableH264(data, 0, data.position())
    }

    // ---- Level 2: at most ~30 frames a second (half the screen updates of a 60 fps channel) ----
    private var lastShownUs = Long.MIN_VALUE

    /** True when this frame comes too soon after the last one shown (level 2 only). */
    private fun tooSoon(ptsUs: Long): Boolean {
        val last = lastShownUs
        if (level() < 2 || last == Long.MIN_VALUE || ptsUs < last) return false // first frame / new stream: show it
        return ptsUs - last < MIN_GAP_US
    }

    // (Every frame goes through renderOutputBufferV21: Media3 1.5's minimum is API 21.)
    override fun renderOutputBufferV21(codec: MediaCodecAdapter, index: Int, presentationTimeUs: Long, releaseTimeNs: Long) {
        if (tooSoon(presentationTimeUs)) return skipOutputBuffer(codec, index, presentationTimeUs)
        lastShownUs = presentationTimeUs
        super.renderOutputBufferV21(codec, index, presentationTimeUs, releaseTimeNs)
    }

    override fun onPositionReset(positionUs: Long, joining: Boolean) {
        lastShownUs = Long.MIN_VALUE
        super.onPositionReset(positionUs, joining)
    }

    private companion object {
        /** 30 fps (a 30 fps channel keeps every frame; 60 fps shows every other one). */
        const val MIN_GAP_US = 30_000L
    }
}
