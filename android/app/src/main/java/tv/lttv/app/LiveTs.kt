package tv.lttv.app

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.io.InterruptedIOException

/**
 * A live MPEG-TS channel that reconnects by itself. When the provider's connection drops or stalls, it
 * reconnects quietly (the player just keeps reading from its buffer) and skips what the server repeats,
 * so the picture neither stops with an error nor jumps back. Gives up after [maxOutageMs] without data.
 */
@OptIn(UnstableApi::class)
class LiveTsDataSource(
    private val upstream: DataSource,
    private val filter: TsOverlapFilter,
    private val maxOutageMs: Long,
) : BaseDataSource(/* isNetwork = */ true) {
    private var spec: DataSpec? = null
    private var upstreamOpen = false
    private var opened = false
    private val inBuf = ByteArray(32 * 1024)
    private val outBuf = ByteArray(32 * 1024 + TsOverlapFilter.PACKET)
    private var outPos = 0
    private var outLen = 0
    private var lastDataAt = 0L

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        // Live: always from "now" (no byte ranges — servers ignore or refuse them for live channels).
        val s = dataSpec.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET.toLong()).build()
        spec = s
        outPos = 0
        outLen = 0
        if (filter.lastPcr >= 0) filter.reconnected() // the player itself reopened us (or a restart of the same channel)
        upstream.open(s)
        upstreamOpen = true
        lastDataAt = System.currentTimeMillis()
        opened = true
        transferStarted(dataSpec)
        return C.LENGTH_UNSET.toLong()
    }

    override fun read(target: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        var failures = 0
        while (outPos >= outLen) {
            var error: IOException? = null
            val n = try {
                if (!upstreamOpen) reopen()
                upstream.read(inBuf, 0, inBuf.size)
            } catch (e: InterruptedIOException) {
                throw e
            } catch (e: IOException) {
                error = e
                C.RESULT_END_OF_INPUT
            }
            if (n == C.RESULT_END_OF_INPUT) {
                // Dropped or ended: reconnect unless it's been out too long.
                closeUpstream()
                if (System.currentTimeMillis() - lastDataAt > maxOutageMs) throw error ?: IOException("The stream connection dropped.")
                failures++
                try {
                    Thread.sleep(minOf(2000L, 250L * failures))
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw InterruptedIOException()
                }
                filter.reconnected()
                continue
            }
            if (n > 0) {
                lastDataAt = System.currentTimeMillis()
                failures = 0
                outPos = 0
                outLen = filter.process(inBuf, 0, n, outBuf)
            }
        }
        val k = minOf(length, outLen - outPos)
        System.arraycopy(outBuf, outPos, target, offset, k)
        outPos += k
        bytesTransferred(k)
        return k
    }

    private fun reopen() {
        upstream.open(spec ?: throw IOException("not open"))
        upstreamOpen = true
    }

    private fun closeUpstream() {
        if (!upstreamOpen) return
        upstreamOpen = false
        try {
            upstream.close()
        } catch (_: IOException) {
        }
    }

    override fun getUri(): Uri? = spec?.uri

    override fun close() {
        closeUpstream()
        spec = null
        if (opened) {
            opened = false
            transferEnded()
        }
    }

    class Factory(
        private val upstream: DataSource.Factory,
        private val filter: TsOverlapFilter,
        private val maxOutageMs: Long,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = LiveTsDataSource(upstream.createDataSource(), filter, maxOutageMs)
    }
}
