package tv.lttv.app

import android.graphics.Color
import android.net.Uri
import android.os.Build
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
import androidx.media3.common.Format
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
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

    // ---- SD movies / episodes: not blown up to full screen ----
    /** "sharp": SD video (576 lines or less) is shown at most 1.5× its size, centered, in its own shape; "full": fill the screen. */
    private var sdMode = "sharp"

    fun setPictureMode(mode: String) = main.post {
        sdMode = if (mode == "full") "full" else "sharp"
        applySdFrame()
    }

    private fun applySdFrame() {
        val w = view.width
        val h = view.height
        val vh = size.height
        if (!vod || sdMode == "full" || vh <= 0 || vh > 576 || w <= 0 || h <= 0) {
            if (view.paddingTop != 0 || view.paddingLeft != 0) view.setPadding(0, 0, 0, 0)
            return
        }
        // At most 1.5× the video's own height (720 px for 480-line video on a 1080p screen); the shape stays the video's.
        val pad = ((h - (vh * 1.5f).toInt()) / 2).coerceAtLeast(0)
        if (view.paddingTop != pad) view.setPadding(0, pad, 0, pad)
    }
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
    /** Playing a movie / episode (seekable, ends, no live recording). */
    private var vod = false
    private var startMs = 0L
    /** Show subtitles / closed captions when the stream has them. */
    private var captions = false
    private var lastTracks = ""

    fun setCaptions(on: Boolean) = main.post {
        captions = on
        applyTrackPrefs()
    }

    /** The picture isn't on screen (menus, Sports…): stop decoding video so the remote stays fast; sound keeps playing. */
    private var videoOff = false
    private val hideVideo = Runnable {
        if (!videoOff) {
            videoOff = true
            applyTrackPrefs()
        }
    }

    fun setVideoVisible(on: Boolean) = main.post {
        main.removeCallbacks(hideVideo)
        if (on) {
            if (videoOff) {
                videoOff = false
                applyTrackPrefs()
            }
        } else if (!videoOff) {
            // Wait a moment: switching screens hides the video briefly before the next screen shows it again.
            main.postDelayed(hideVideo, 2500)
        }
    }

    /** Captions on/off (English first), and the best quality the stream offers on the main player. */
    private fun applyTrackPrefs() {
        val p = exo ?: return
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, videoOff)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !captions)
            // (Multiview tiles keep their audio track and are silenced by volume: switching the audio track
            // on/off as sound moved between games made a live stream reconnect — and IPTV servers start a
            // new connection with the last ~10 s, so the picture jumped back 10 seconds.)
            .setPreferredTextLanguage("en")
            .setSelectUndeterminedTextLanguage(true)
            // The main player always takes the stream's best quality (live channels too: adaptive streams otherwise
            // start low and climb slowly, so a game looked soft for its first minutes). Multiview tiles stay adaptive.
            .setForceHighestSupportedBitrate(vod || audioFocus)
            // Multiview tiles: no more resolution than the tile shows (less bandwidth per stream,
            // so several games at once don't starve each other or the provider connection).
            .setMaxVideoSize(if (audioFocus) Int.MAX_VALUE else tileMaxW, if (audioFocus) Int.MAX_VALUE else tileMaxH)
            .build()
    }

    private var playingHls = false
    /** Where the live channel's clock was, so a restart of the same channel doesn't repeat the last seconds. */
    private var tsFilter: TsOverlapFilter? = null
    private var tsFilterUrl: String? = null
    private var tsFilterAt = 0L
    private var tileMaxW = 1280
    private var tileMaxH = 720

    /** Multiview: the tile's size in screen pixels; streams that offer several qualities pick one that fits. */
    fun setTileSize(w: Int, h: Int) = main.post {
        if (audioFocus || w <= 0 || h <= 0) return@post
        // Round up to the usual stream sizes so a tile slightly larger than 540p still gets 720p.
        val (mw, mh) = when {
            h <= 360 -> 640 to 360
            // A quarter of the screen (4 games): 540p is plenty and halves what each stream downloads/decodes.
            h <= 600 -> 960 to 540
            h <= 740 -> 1280 to 720
            else -> 1920 to 1080
        }
        if (mw != tileMaxW || mh != tileMaxH) {
            tileMaxW = mw
            tileMaxH = mh
            // Only streams with several qualities (HLS) can switch while playing; a plain live stream would
            // reconnect (and jump back ~10 s) for nothing — it uses the new size from its next start.
            if (playingHls || currentUrl == null) applyTrackPrefs()
        }
    }

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
            // Position updates only matter while the picture is on screen.
            main.postDelayed(this, if (videoOff || view.visibility != View.VISIBLE) 5000 else 1000)
        }
    }

    init {
        view.addOnLayoutChangeListener { _, l, t, rr, b, ol, ot, or2, ob -> if (rr - l != or2 - ol || b - t != ob - ot) applySdFrame() }
        // Only the main player reports its live-rewind position (Multiview tiles are plain live).
        if (audioFocus) main.postDelayed(liveTicker, 1000)
    }

    private fun ensurePlayer(): ExoPlayer {
        val existing = exo
        if (existing != null && !dirty) return existing
        existing?.release()
        // IPTV streams are bursty: keep a healthy buffer and wait a little longer after a
        // stall before resuming, so playback doesn't stutter in and out of buffering.
        // Multiview tiles keep a smaller buffer: four streams with big buffers ran the TV out of memory
        // and downloaded in bursts that made the other tiles stall.
        val minMs = if (audioFocus) (bufferSec * 2000).coerceAtLeast(15000) else 10000
        val maxMs = if (audioFocus) (minMs * 3).coerceAtLeast(50000) else 25000
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(minMs, maxMs, 2500, 6000.coerceAtMost(minMs))
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        // Main player: fall back to another decoder (e.g. software) when the preferred one can't start.
        // Multiview tiles: hardware video decoders only. When the TV ran out of hardware decoders, a tile
        // quietly fell back to software decoding on the TV's small CPU, and every game (and the remote) lagged.
        // Tiles may still try every hardware decoder the TV lists (not just the first).
        val renderers = DefaultRenderersFactory(activity).setEnableDecoderFallback(true)
        if (!audioFocus) {
            renderers.setMediaCodecSelector { mime, secure, tunneling ->
                val all = MediaCodecSelector.DEFAULT.getDecoderInfos(mime, secure, tunneling)
                if (MimeTypes.isVideo(mime)) all.filter { !it.softwareOnly } else all
            }
        }
        val p = ExoPlayer.Builder(activity, renderers)
            .setLoadControl(loadControl)
            .build()
        p.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            /* handleAudioFocus = */ audioFocus,
        )
        p.volume = volume
        // Multiview tiles never ask the TV to switch its refresh rate (several games asking for 30 / 60 Hz judders).
        if (!audioFocus) p.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF)
        p.repeatMode = Player.REPEAT_MODE_ONE // VOD-style test streams loop; live streams never end
        p.addListener(listener)
        p.addAnalyticsListener(analytics)
        view.player = p
        exo = p
        dirty = false
        return p
    }

    // ---- Diagnostics (Multiview "Stream info") ----
    private var decoderName = ""
    private var droppedFrames = 0L
    private var videoFormat = ""
    private var lastError = ""
    private val analytics = object : AnalyticsListener {
        override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
            this@PlayerController.decoderName = decoderName
        }
        override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
            this@PlayerController.droppedFrames += droppedFrames
        }
        override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
            val fps = if (format.frameRate > 0) " ${Math.round(format.frameRate)}fps" else ""
            videoFormat = "${format.width}x${format.height}$fps ${format.sampleMimeType ?: ""} ${if (format.bitrate > 0) "${format.bitrate / 1000}kbps" else ""}".trim()
        }
    }

    /** What this player is doing right now (for the Stream info panel). */
    fun diag(): JSONObject {
        val p = exo
        val state = when (p?.playbackState) {
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> if (p.playWhenReady) "playing" else "paused"
            Player.STATE_ENDED -> "ended"
            else -> if (currentUrl == null) "idle" else "starting"
        }
        return JSONObject()
            .put("state", state)
            .put("decoder", decoderName)
            .put("format", videoFormat)
            .put("dropped", droppedFrames)
            .put("bufferedMs", p?.totalBufferedDuration ?: 0L)
            .put("audio", volume > 0f)
            .put("error", lastError)
    }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_BUFFERING -> send(if (hasRendered) "buffering" else "loading")
                Player.STATE_READY -> send(if (exo?.playWhenReady == true) "playing" else "paused")
                Player.STATE_ENDED -> if (vod) send("ended") else send("error", "The stream ended.")
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
            applySdFrame()
        }

        override fun onTracksChanged(tracks: Tracks) {
            val text = tracks.groups.count { it.type == C.TRACK_TYPE_TEXT }
            val o = JSONObject().put("type", "tracks").put("text", text)
            if (o.toString() != lastTracks) {
                lastTracks = o.toString()
                emit(lastTracks)
            }
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
            lastError = "${error.errorCodeName}: ${generateSequence(error as Throwable) { it.cause }.mapNotNull { it.message }.firstOrNull { it.isNotBlank() }?.take(140) ?: ""}"
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
            // Only a real "out of decoder resources" answer from the TV means there's no free decoder.
            // Any other decoding error is usually a glitch in the stream: reconnect instead of giving up
            // (this used to be reported as "no free decoder" and the game stopped).
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED -> when {
                !audioFocus && outOfDecoders(e) -> "Your TV has no free video decoder for another game — remove a game or choose fewer games." to true
                e.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED -> "The stream sent damaged video — reconnecting." to false
                else -> "The video decoder could not start. Trying again." to false
            }
            else -> if (!audioFocus && outOfDecoders(e)) "Your TV needed this game's video decoder for another one — choose fewer games." to true
                else "Playback failed (${e.errorCodeName})." to false
        }
    }

    /** The TV said it has no decoder resources left (MediaCodec insufficient-resource / reclaimed). */
    private fun outOfDecoders(e: PlaybackException): Boolean {
        if (e.errorCodeName.contains("RECLAIMED")) return true
        var c: Throwable? = e
        while (c != null) {
            if (c is android.media.MediaCodec.CodecException && Build.VERSION.SDK_INT >= 23 &&
                (c.errorCode == android.media.MediaCodec.CodecException.ERROR_INSUFFICIENT_RESOURCE || c.errorCode == android.media.MediaCodec.CodecException.ERROR_RECLAIMED)) return true
            val m = c.message?.lowercase() ?: ""
            if (m.contains("insufficient resource") || m.contains("no more resource") || m.contains("resource busy") || m.contains("too many instances")) return true
            c = c.cause
        }
        return false
    }

    private fun send(state: String, error: String? = null, fatal: Boolean = false) {
        val o = JSONObject().put("state", state)
        if (error != null) o.put("error", error)
        if (fatal) o.put("fatal", true)
        if (size.width > 0) o.put("width", size.width).put("height", size.height)
        emit(o.toString())
    }

    fun play(url: String, headers: Map<String, String>, vod: Boolean = false, startMs: Long = 0L) {
        main.post {
            val gen = ++generation
            val currentUrlBefore = currentUrl ?: tsFilterUrl
            currentUrl = url
            this.vod = vod
            this.startMs = startMs
            hasRendered = false
            size = VideoSize.UNKNOWN
            view.setPadding(0, 0, 0, 0)
            droppedFrames = 0L
            lastError = ""
            liveLagMs = -1L
            hlsGapMs = -1L
            if (currentUrlBefore != null) tsFilterAt = System.currentTimeMillis()
            // Close the previous stream first: many providers allow only one connection.
            exo?.stop()
            stopTimeshift()
            send("loading")
            // (A type learned from the same server earlier saves opening an extra connection to check it:
            // with a 4-connection plan, that extra one could make the provider drop another game.)
            val known = inferMime(url) ?: probeCache[probeKey(url)]
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
        p.repeatMode = if (vod) Player.REPEAT_MODE_OFF else Player.REPEAT_MODE_ONE
        lastTracks = ""
        applyTrackPrefs()
        if (!vod && mime == MimeTypes.VIDEO_MP2T && audioFocus && rewindMin > 0 && (url.startsWith("http://") || url.startsWith("https://"))) {
            // Raw MPEG-TS can't be rewound by the player itself: record it on the device and play the recording.
            startTimeshift(url, headers, tsFlags)
            return
        }
        playingHls = mime == MimeTypes.APPLICATION_M3U8
        val liveTs = !vod && mime == MimeTypes.VIDEO_MP2T && (url.startsWith("http://") || url.startsWith("https://"))
        val source = if (liveTs) {
            // Live channel: reconnects by itself and skips what the server repeats (no jumping back).
            // The same channel started again (a retry) keeps its place too.
            val filter = if (url == tsFilterUrl && tsFilter != null && System.currentTimeMillis() - tsFilterAt < 120_000) tsFilter!! else TsOverlapFilter()
            tsFilter = filter
            tsFilterUrl = url
            val extractors = DefaultExtractorsFactory()
                .setTsExtractorFlags(tsFlags)
                .setTsExtractorTimestampSearchBytes(TsExtractor.DEFAULT_TIMESTAMP_SEARCH_BYTES * 3)
            // A live channel that sends nothing for 6 s has stalled: reconnect then, before the picture runs dry.
            http.setReadTimeoutMs(minOf(timeoutSec * 1000, 6000))
            ProgressiveMediaSource.Factory(LiveTsDataSource.Factory(http, filter, maxOf(20_000L, timeoutSec * 1000L)), extractors)
                .createMediaSource(item)
        } else if (mime == MimeTypes.APPLICATION_M3U8) {
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
        // Movies: resume where they were left.
        if (vod && startMs > 5000) p.seekTo(startMs)
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
                val live = p.isCurrentMediaItemLive || !vod
                if (!live && seekable) {
                    // Movie / episode: window = length, behind = time left.
                    o.put("seekable", true).put("behind", (dur - p.currentPosition).coerceAtLeast(0L)).put("window", dur).put("live", false)
                } else {
                    val gap = hlsGapMs.coerceAtLeast(0L)
                    val behind = if (seekable && p.isCurrentMediaItemLive) (dur - p.currentPosition - gap).coerceAtLeast(0L) else 0L
                    o.put("seekable", seekable).put("behind", if (behind < 2500 && p.playWhenReady) 0 else behind).put("window", if (seekable) dur else 0)
                }
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

    /**
     * Stop and give back the video decoder. stop() alone keeps the decoder reserved for a quick restart,
     * and a TV has only a few: a stopped main player (or a removed Multiview game) held one, so the
     * third game in Multiview found none free.
     */
    fun freeDecoder() = main.post {
        generation++
        currentUrl = null
        stopTimeshift()
        view.player = null
        exo?.release()
        exo = null
        dirty = true
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

        private val probeCache = java.util.concurrent.ConcurrentHashMap<String, String>()
        /** Channels from one provider share a type: server + folder of the address. */
        private fun probeKey(url: String) = url.substringBefore('?').substringBeforeLast('/')

        /** Read the first bytes of a stream to decide its type; null = let ExoPlayer detect it. */
        fun probe(url: String, headers: Map<String, String>): String? = probeOnce(url, headers)?.also { probeCache[probeKey(url)] = it }

        private fun probeOnce(url: String, headers: Map<String, String>): String? = try {
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
