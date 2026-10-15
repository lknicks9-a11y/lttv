package tv.lttv.app

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.extractor.ts.TsExtractor
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Native playback with Media3 ExoPlayer (HLS, DASH, MPEG-TS, MP4 and more, using the
 * device's hardware decoders). Reports state to the page as JSON; the page decides
 * about retries so desktop and TV behave the same.
 */
@OptIn(UnstableApi::class)
class PlayerController(
    private val activity: MainActivity,
    /** Multiview tiles don't take audio focus (several players run at once; volume picks the one you hear). */
    private val audioFocus: Boolean = true,
    private val emit: (String) -> Unit,
) {

    val view: PlayerView = PlayerView(activity).apply {
        useController = false
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        setShutterBackgroundColor(Color.BLACK)
        setKeepContentOnPlayerReset(false)
        visibility = View.INVISIBLE
        isFocusable = false
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var exo: ExoPlayer? = null
    private var bufferSec = 8
    private var timeoutSec = 15
    private var dirty = true
    private var generation = 0
    private var currentUrl: String? = null
    private var hasRendered = false
    private var size: VideoSize = VideoSize.UNKNOWN
    private var volume = 1f

    // ---- live rewind ----
    /** Minutes of a raw MPEG-TS channel kept on the device for pausing / rewinding (0 = off). */
    private var rewindMin = 30
    private var tsBuffer: TimeshiftBuffer? = null
    private var recorder: TimeshiftRecorder? = null
    /** Byte offset in [tsBuffer] where the current ExoPlayer source starts. */
    private var tsBase = 0L
    private var tsExtractors: DefaultExtractorsFactory? = null
    /** How far behind live playback runs when "at live" (the player's own buffer); measured once playing. */
    private var liveLagMs = -1L
    private var hlsGapMs = -1L
    private var lastLive = ""

    fun configure(bufferSec: Int, timeoutSec: Int, rewindMin: Int = this.rewindMin) {
        main.post {
            this.rewindMin = rewindMin.coerceIn(0, 120)
            if (bufferSec != this.bufferSec || timeoutSec != this.timeoutSec) {
                this.bufferSec = bufferSec.coerceIn(2, 60)
                this.timeoutSec = timeoutSec.coerceIn(5, 120)
                dirty = true
            }
        }
    }

    private val liveTicker = object : Runnable {
        override fun run() {
            emitLive()
            main.postDelayed(this, 1000)
        }
    }

    init {
        // Only the main player reports its live-rewind position (Multiview tiles are plain live).
        if (audioFocus) main.postDelayed(liveTicker, 1000)
    }

    private fun ensurePlayer(): ExoPlayer {
        val existing = exo
        if (existing != null && !dirty) return existing
        existing?.release()
        // IPTV streams are bursty: keep a healthy buffer and wait a little longer after a
        // stall before resuming, so playback doesn't stutter in and out of buffering.
        val minMs = (bufferSec * 2000).coerceAtLeast(15000)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(minMs, (minMs * 3).coerceAtLeast(50000), 2500, 6000.coerceAtMost(minMs))
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        // Fall back to another decoder (e.g. software) when the preferred one can't start.
        val renderers = DefaultRenderersFactory(activity).setEnableDecoderFallback(true)
        val p = ExoPlayer.Builder(activity, renderers)
            .setLoadControl(loadControl)
            .build()
        p.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            /* handleAudioFocus = */ audioFocus,
        )
        p.volume = volume
        p.repeatMode = Player.REPEAT_MODE_ONE // VOD-style test streams loop; live streams never end
        p.addListener(listener)
        view.player = p
        exo = p
        dirty = false
        return p
    }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_BUFFERING -> send(if (hasRendered) "buffering" else "loading")
                Player.STATE_READY -> send(if (exo?.playWhenReady == true) "playing" else "paused")
                Player.STATE_ENDED -> send("error", "The stream ended.")
                else -> Unit
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) {
                hasRendered = true
                send("playing")
                main.postDelayed({ measureLiveLag() }, 1500)
            }
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            size = videoSize
        }

        override fun onPlayerError(error: PlaybackException) {
            val p = exo ?: return
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                // Fell behind a live window (e.g. after a stall): jump back to live.
                p.seekToDefaultPosition()
                p.prepare()
                return
            }
            val buf = tsBuffer
            if (buf != null && buf.failure == null && !buf.isEmpty) {
                // Paused or rewound past what is still kept on the device: continue from the oldest part.
                reopenAt(buf.offsetForTime(buf.earliestTime + 2000))
                return
            }
            val (message, fatal) = describe(error)
            send("error", message, fatal)
        }
    }

    private fun describe(e: PlaybackException): Pair<String, Boolean> {
        var cause: Throwable? = e.cause
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException || cause is StreamHttpException) {
                val code = if (cause is StreamHttpException) cause.code else (cause as HttpDataSource.InvalidResponseCodeException).responseCode
                return when (code) {
                    401, 403 -> "Access denied by the stream server ($code). Your subscription or token may have expired." to false
                    404 -> "Stream not found (404). The channel may be offline." to false
                    else -> "The stream server answered HTTP $code." to false
                }
            }
            cause = cause.cause
        }
        return when (e.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "Network error: the stream server could not be reached." to false
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "The stream server did not respond in time." to false
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "Stream not found." to false
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED -> "The stream sent invalid data." to false
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED -> "This stream format is not supported." to true
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "This device can't decode this channel's video/audio format." to true
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> "The video decoder could not start. Try again or restart the device." to false
            else -> "Playback failed (${e.errorCodeName})." to false
        }
    }

    private fun send(state: String, error: String? = null, fatal: Boolean = false) {
        val o = JSONObject().put("state", state)
        if (error != null) o.put("error", error)
        if (fatal) o.put("fatal", true)
        if (size.width > 0) o.put("width", size.width).put("height", size.height)
        emit(o.toString())
    }

    fun play(url: String, headers: Map<String, String>) {
        main.post {
            val gen = ++generation
            currentUrl = url
            hasRendered = false
            liveLagMs = -1L
            hlsGapMs = -1L
            // Close the previous stream first: many providers allow only one connection.
            exo?.stop()
            stopTimeshift()
            send("loading")
            val known = inferMime(url)
            if (known != null || url.startsWith("asset:") || url.startsWith("file:")) {
                start(url, headers, known)
            } else {
                // No hint in the URL: peek at the first bytes to tell HLS/DASH from progressive streams.
                io.execute {
                    val mime = probe(url, headers)
                    main.post { if (gen == generation) start(url, headers, mime) }
                }
            }
        }
    }

    private fun start(url: String, headers: Map<String, String>, mime: String?) {
        val p = ensurePlayer()
        val ua = headers.entries.firstOrNull { it.key.equals("User-Agent", true) }?.value ?: USER_AGENT
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(ua)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(timeoutSec * 1000)
            .setReadTimeoutMs(timeoutSec * 1000)
            .setDefaultRequestProperties(headers.filterKeys { !it.equals("User-Agent", true) })
        val dataSource = DefaultDataSource.Factory(activity, http)
        val item = MediaItem.Builder().setUri(Uri.parse(url)).apply { if (mime != null) setMimeType(mime) }.build()
        // IPTV MPEG-TS often starts without an IDR frame or lacks access-unit markers;
        // these flags let ExoPlayer start such streams instead of failing or showing black.
        val tsFlags = DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
        if (mime == MimeTypes.VIDEO_MP2T && audioFocus && rewindMin > 0 && (url.startsWith("http://") || url.startsWith("https://"))) {
            // Raw MPEG-TS can't be rewound by the player itself: record it on the device and play the recording.
            startTimeshift(url, headers, tsFlags)
            return
        }
        val source = if (mime == MimeTypes.APPLICATION_M3U8) {
            HlsMediaSource.Factory(dataSource)
                .setExtractorFactory(DefaultHlsExtractorFactory(tsFlags, true))
                .setAllowChunklessPreparation(true)
                .createMediaSource(item)
        } else {
            val extractors = DefaultExtractorsFactory()
                .setTsExtractorFlags(tsFlags)
                .setTsExtractorTimestampSearchBytes(TsExtractor.DEFAULT_TIMESTAMP_SEARCH_BYTES * 3)
            DefaultMediaSourceFactory(dataSource, extractors).createMediaSource(item)
        }
        p.setMediaSource(source)
        p.prepare()
        p.playWhenReady = true
    }

    // ---- live rewind (timeshift) ----

    private fun startTimeshift(url: String, headers: Map<String, String>, tsFlags: Int) {
        val p = ensurePlayer()
        val dir = File(activity.cacheDir, "timeshift")
        dir.mkdirs()
        // About 10 Mbit/s per minute, but never more than 40% of the free space (max 3 GB).
        val wanted = rewindMin * 60L * 1_250_000L
        val maxBytes = minOf(wanted, (dir.usableSpace * 0.4).toLong(), 3_000_000_000L).coerceAtLeast(16L * 1024 * 1024)
        val buf = TimeshiftBuffer(dir, maxBytes, rewindMin * 60_000L)
        val rec = TimeshiftRecorder(url, headers, timeoutSec * 1000, buf)
        tsBuffer = buf
        recorder = rec
        tsExtractors = DefaultExtractorsFactory()
            .setTsExtractorFlags(tsFlags)
            .setTsExtractorTimestampSearchBytes(TsExtractor.DEFAULT_TIMESTAMP_SEARCH_BYTES * 3)
        rec.start()
        tsBase = 0L
        p.setMediaSource(timeshiftSource(buf, 0L))
        p.prepare()
        p.playWhenReady = true
    }

    private fun timeshiftSource(buf: TimeshiftBuffer, base: Long): MediaSource =
        ProgressiveMediaSource.Factory(TimeshiftDataSource.Factory(buf, base), tsExtractors ?: DefaultExtractorsFactory())
            .createMediaSource(MediaItem.fromUri(Uri.parse("lttv-timeshift://live/$base")))

    private fun stopTimeshift() {
        recorder?.stopRecording()
        recorder = null
        tsBuffer?.destroy()
        tsBuffer = null
        tsBase = 0L
    }

    /** Play the recording from byte [offset] (the player restarts reading there). */
    private fun reopenAt(offset: Long) {
        val p = exo ?: return
        val buf = tsBuffer ?: return
        tsBase = offset.coerceIn(buf.earliestOffset, buf.liveOffset)
        p.setMediaSource(timeshiftSource(buf, tsBase))
        p.prepare()
        p.playWhenReady = true
    }

    /** Wall-clock moment that is on screen now (timeshift mode). */
    private fun playingAt(): Long {
        val buf = tsBuffer ?: return System.currentTimeMillis()
        return buf.timeForOffset(tsBase) + (exo?.currentPosition ?: 0L)
    }

    private fun measureLiveLag() {
        val p = exo ?: return
        if (!p.isPlaying) return
        if (tsBuffer != null) {
            if (liveLagMs < 0) liveLagMs = (System.currentTimeMillis() - playingAt()).coerceIn(0L, 60_000L)
        } else if (hlsGapMs < 0 && p.isCurrentMediaItemLive && p.duration != C.TIME_UNSET) {
            hlsGapMs = (p.duration - p.currentPosition).coerceAtLeast(0L)
        }
    }

    /** Rewind / fast forward by [deltaMs] (negative = back). */
    fun seekBy(deltaMs: Long) = main.post {
        val p = exo ?: return@post
        if (currentUrl == null) return@post
        val buf = tsBuffer
        if (buf != null) {
            val now = System.currentTimeMillis()
            val lag = liveLagMs.coerceAtLeast(0L)
            val target = playingAt() + deltaMs
            if (target >= now - lag - 1500) {
                goLiveNow()
                return@post
            }
            reopenAt(buf.offsetForTime(maxOf(target, buf.earliestTime + 1000)))
            emitLive()
            return@post
        }
        if (!p.isCurrentMediaItemSeekable) return@post
        val dur = p.duration
        val target = p.currentPosition + deltaMs
        if (p.isCurrentMediaItemLive && (dur == C.TIME_UNSET || target >= dur - hlsGapMs.coerceAtLeast(3000L))) {
            p.seekToDefaultPosition()
        } else {
            p.seekTo(if (dur == C.TIME_UNSET) target.coerceAtLeast(0L) else target.coerceIn(0L, dur))
        }
        p.playWhenReady = true
        emitLive()
    }

    /** Back to the live edge. */
    fun goLive() = main.post { goLiveNow() }

    private fun goLiveNow() {
        val p = exo ?: return
        if (currentUrl == null) return
        val buf = tsBuffer
        if (buf != null) {
            val lag = if (liveLagMs >= 0) liveLagMs else bufferSec * 1000L
            reopenAt(buf.offsetForTime(System.currentTimeMillis() - lag))
        } else {
            if (p.playbackState == Player.STATE_IDLE) p.prepare()
            p.seekToDefaultPosition()
            p.playWhenReady = true
        }
        emitLive()
    }

    /** Tell the page where playback is inside the rewind window. */
    private fun emitLive() {
        val p = exo
        val o = JSONObject().put("type", "live")
        if (p == null || currentUrl == null) {
            o.put("seekable", false).put("behind", 0).put("window", 0)
        } else {
            val buf = tsBuffer
            if (buf != null) {
                val now = System.currentTimeMillis()
                val lag = liveLagMs.coerceAtLeast(0L)
                val behind = (now - playingAt() - lag).coerceAtLeast(0L)
                val window = (now - buf.earliestTime).coerceAtLeast(0L)
                o.put("seekable", window > 3000).put("behind", if (behind < 2500 && p.playWhenReady) 0 else behind).put("window", window)
            } else {
                val dur = p.duration
                val seekable = p.isCurrentMediaItemSeekable && dur != C.TIME_UNSET && dur > 5000
                val gap = hlsGapMs.coerceAtLeast(0L)
                val behind = if (seekable && p.isCurrentMediaItemLive) (dur - p.currentPosition - gap).coerceAtLeast(0L) else 0L
                o.put("seekable", seekable).put("behind", if (behind < 2500 && p.playWhenReady) 0 else behind).put("window", if (seekable) dur else 0)
            }
        }
        val s = o.toString()
        if (s != lastLive) {
            lastLive = s
            emit(s)
        }
    }

    fun stop() = main.post {
        generation++
        currentUrl = null
        stopTimeshift()
        exo?.stop()
        exo?.clearMediaItems()
        send("idle")
    }

    fun setVolume(v: Float) = main.post {
        volume = v
        exo?.volume = v
    }

    fun pause() = main.post {
        exo?.playWhenReady = false
    }

    /** Continue where it was paused (live rewind keeps the place; too far back rejoins what is kept). */
    fun resume() = main.post {
        val p = exo ?: return@post
        if (currentUrl == null) return@post
        if (p.playbackState == Player.STATE_IDLE) p.prepare()
        // Without a rewind window a paused live stream can only rejoin live.
        if (p.isCurrentMediaItemLive && !p.isCurrentMediaItemSeekable && tsBuffer == null) p.seekToDefaultPosition()
        p.playWhenReady = true
    }

    fun isActive(): Boolean = currentUrl != null && exo?.playWhenReady == true

    fun release() {
        main.removeCallbacks(liveTicker)
        stopTimeshift()
        io.shutdownNow()
        exo?.release()
        exo = null
    }

    companion object {
        val USER_AGENT = "LTTV/${BuildConfig.VERSION_NAME} (Android TV; ExoPlayer)"

        fun inferMime(url: String): String? {
            val path = Uri.parse(url).path?.lowercase() ?: ""
            val query = url.substringAfter('?', "").lowercase()
            return when {
                path.endsWith(".m3u8") || path.endsWith(".m3u") || Regex("(^|&)(type|output|format)=(m3u8|hls)").containsMatchIn(query) -> MimeTypes.APPLICATION_M3U8
                path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
                path.endsWith(".ts") || Regex("(^|&)(type|output|format)=(ts|mpegts)").containsMatchIn(query) -> MimeTypes.VIDEO_MP2T
                path.endsWith(".mp4") || path.endsWith(".m4v") -> MimeTypes.VIDEO_MP4
                else -> null
            }
        }

        /** Read the first bytes of a stream to decide its type; null = let ExoPlayer detect it. */
        fun probe(url: String, headers: Map<String, String>): String? = try {
            val c = Net.open(url, headers + mapOf("Range" to "bytes=0-1023"), 10000)
            try {
                val buf = ByteArray(1024)
                val n = c.inputStream.read(buf)
                val head = if (n > 0) String(buf, 0, n, Charsets.ISO_8859_1).trimStart() else ""
                val ctype = (c.contentType ?: "").lowercase()
                when {
                    head.startsWith("#EXTM3U") || ctype.contains("mpegurl") -> MimeTypes.APPLICATION_M3U8
                    head.contains("<MPD") || ctype.contains("dash+xml") -> MimeTypes.APPLICATION_MPD
                    n > 0 && buf[0] == 0x47.toByte() -> MimeTypes.VIDEO_MP2T
                    else -> null
                }
            } finally {
                c.disconnect()
            }
        } catch (e: Exception) {
            null
        }
    }
}
