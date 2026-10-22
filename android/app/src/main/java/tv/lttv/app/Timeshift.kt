package tv.lttv.app

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.net.HttpURLConnection

/** The provider answered with an HTTP error. */
class StreamHttpException(val code: Int) : IOException("HTTP $code")

/**
 * Downloads a raw MPEG-TS live stream into a [TimeshiftBuffer] on its own thread,
 * reconnecting after short drops (common with IPTV servers). Uses one connection,
 * like normal playback, so providers' connection limits are respected.
 */
class TimeshiftRecorder(
    private val url: String,
    private val headers: Map<String, String>,
    private val timeoutMs: Int,
    private val buffer: TimeshiftBuffer,
) : Thread("lttv-timeshift") {
    @Volatile private var stopped = false
    @Volatile private var conn: HttpURLConnection? = null

    init {
        isDaemon = true
    }

    override fun run() {
        var failures = 0
        val chunk = ByteArray(64 * 1024)
        val out = ByteArray(chunk.size + TsOverlapFilter.PACKET)
        // A reconnect makes the server send its last seconds again: skip them so the recording doesn't repeat.
        val filter = TsOverlapFilter()
        var connected = false
        while (!stopped) {
            try {
                val c = Net.open(url, headers, timeoutMs)
                conn = c
                val code = c.responseCode
                if (code !in 200..299) {
                    c.disconnect()
                    throw StreamHttpException(code)
                }
                if (connected) filter.reconnected()
                connected = true
                c.inputStream.use { input ->
                    while (!stopped) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        val k = filter.process(chunk, 0, n, out)
                        if (k > 0) buffer.append(out, 0, k)
                        failures = 0
                    }
                }
                if (stopped) break
                failures++ // the server closed the stream
            } catch (e: StreamHttpException) {
                if (stopped) break
                // Refused before anything played: report it straight away.
                if (buffer.isEmpty || e.code == 401 || e.code == 403) {
                    buffer.fail(e)
                    return
                }
                failures++
            } catch (e: IOException) {
                if (stopped) break
                if (buffer.isEmpty && failures >= 1) {
                    buffer.fail(e)
                    return
                }
                failures++
            } finally {
                conn?.disconnect()
                conn = null
            }
            if (failures >= 6) {
                buffer.fail(IOException("The stream connection dropped."))
                return
            }
            try {
                sleep(minOf(4000L, 500L * failures))
            } catch (e: InterruptedException) {
                break
            }
        }
    }

    fun stopRecording() {
        stopped = true
        try {
            conn?.disconnect()
        } catch (_: Exception) {
        }
        interrupt()
    }
}

/** Lets ExoPlayer read the recording from a byte offset, waiting at the live edge. */
@OptIn(UnstableApi::class)
class TimeshiftDataSource(private val buffer: TimeshiftBuffer, private val base: Long) : BaseDataSource(/* isNetwork = */ true) {
    private var uri: Uri? = null
    private var pos = 0L
    private var opened = false
    private var reader: TimeshiftBuffer.Reader? = null

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        pos = base + dataSpec.position
        reader?.close()
        reader = buffer.Reader()
        opened = true
        transferStarted(dataSpec)
        return C.LENGTH_UNSET.toLong()
    }

    override fun read(target: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        val n = (reader ?: buffer.Reader().also { reader = it }).read(pos, target, offset, length)
        if (n < 0) return C.RESULT_END_OF_INPUT
        pos += n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        reader?.close()
        reader = null
        if (opened) {
            opened = false
            transferEnded()
        }
        uri = null
    }

    class Factory(private val buffer: TimeshiftBuffer, private val base: Long) : DataSource.Factory {
        override fun createDataSource(): DataSource = TimeshiftDataSource(buffer, base)
    }
}
