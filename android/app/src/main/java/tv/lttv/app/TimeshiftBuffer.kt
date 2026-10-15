package tv.lttv.app

import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.io.RandomAccessFile

/**
 * The last few minutes of a live stream, kept on the device so it can be paused,
 * rewound and fast-forwarded (live rewind). Bytes are appended as they arrive from
 * the provider and stored in fixed-size chunk files; the oldest chunks are deleted
 * once the buffer is longer than [maxAgeMs] or bigger than [maxBytes].
 *
 * Positions are byte offsets counted from the start of the recording, so they stay
 * valid while old chunks are deleted. Arrival times are recorded every ~half second,
 * which maps a moment in time to a byte offset (streams arrive in real time).
 *
 * Plain JVM code (no Android classes) so it can be tested off-device.
 */
class TimeshiftBuffer(
    private val dir: File,
    @Volatile var maxBytes: Long,
    @Volatile var maxAgeMs: Long,
    private val chunkBytes: Int = 4 * 1024 * 1024,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Chunk(val start: Long, val file: File, val startTime: Long) {
        var length = 0L
    }

    private val lock = Object()
    private val chunks = ArrayDeque<Chunk>()
    /** [arrival time, byte offset] pairs, oldest first. */
    private val marks = ArrayDeque<LongArray>()
    private var writeOffset = 0L
    private var out: RandomAccessFile? = null
    private var seq = 0
    private var closed = false
    @Volatile var failure: IOException? = null
        private set

    init {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() } // leftovers from an earlier run
    }

    /** Offset just past the newest byte (the live edge). */
    val liveOffset: Long get() = synchronized(lock) { writeOffset }

    /** Oldest offset still kept. */
    val earliestOffset: Long get() = synchronized(lock) { chunks.firstOrNull()?.start ?: writeOffset }

    /** Arrival time of the oldest byte still kept (or now, when empty). */
    val earliestTime: Long get() = synchronized(lock) { marks.firstOrNull()?.get(0) ?: clock() }

    val isEmpty: Boolean get() = synchronized(lock) { writeOffset == 0L }

    /** Store bytes that just arrived from the stream. */
    @Throws(IOException::class)
    fun append(b: ByteArray, off: Int, len: Int) {
        if (len <= 0) return
        synchronized(lock) {
            if (closed) throw IOException("closed")
            val now = clock()
            var o = off
            var left = len
            while (left > 0) {
                var c = chunks.lastOrNull()
                if (c == null || c.length >= chunkBytes) {
                    out?.close()
                    c = Chunk(writeOffset, File(dir, "c${seq++}.ts"), now)
                    chunks.addLast(c)
                    out = RandomAccessFile(c.file, "rw")
                }
                val n = minOf(left.toLong(), chunkBytes - c.length).toInt()
                out!!.write(b, o, n)
                c.length += n
                writeOffset += n
                o += n
                left -= n
            }
            val last = marks.lastOrNull()
            if (last == null || now - last[0] >= 500) marks.addLast(longArrayOf(now, writeOffset - len))
            trim(now)
            lock.notifyAll()
        }
    }

    private fun trim(now: Long) {
        var total = chunks.sumOf { it.length }
        // Always keep the newest two chunks so playback near live has data to read.
        while (chunks.size > 2) {
            val oldest = chunks.first()
            val second = chunks.elementAt(1)
            val tooOld = second.startTime < now - maxAgeMs
            if (!tooOld && total <= maxBytes) break
            chunks.removeFirst()
            total -= oldest.length
            oldest.file.delete()
        }
        val first = chunks.firstOrNull()?.start ?: return
        while (marks.size > 1 && marks.elementAt(1)[1] <= first) marks.removeFirst()
        if (marks.isNotEmpty() && marks.first()[1] < first) marks.first()[1] = first
    }

    /** The recording failed for good (the reader reports it as a playback error). */
    fun fail(e: IOException) = synchronized(lock) {
        failure = e
        lock.notifyAll()
    }

    private class Spot(val file: File, val start: Long, val avail: Long)

    /** Where [position] is stored, waiting for it at the live edge; null once closed and fully read. */
    @Throws(IOException::class)
    private fun locate(position: Long): Spot? {
        synchronized(lock) {
            while (position >= writeOffset) {
                failure?.let { throw it }
                if (closed) return null
                try {
                    lock.wait(1000)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw InterruptedIOException()
                }
            }
            val c = chunks.lastOrNull { it.start <= position }
                ?: throw IOException("This part of the recording is no longer kept")
            if (chunks.first().start > position) throw IOException("This part of the recording is no longer kept")
            return Spot(c.file, c.start, c.start + c.length - position)
        }
    }

    /**
     * A reader that keeps its chunk file open between reads (opening a file for every
     * small read is far too slow on TV sticks). One per playback source; close it after.
     */
    inner class Reader : java.io.Closeable {
        private var file: File? = null
        private var raf: RandomAccessFile? = null

        /** Bytes at [position] (waiting at the live edge); -1 once the buffer is closed and read. */
        @Throws(IOException::class)
        fun read(position: Long, buf: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            val spot = locate(position) ?: return -1
            try {
                if (file != spot.file || raf == null) {
                    raf?.close()
                    raf = RandomAccessFile(spot.file, "r")
                    file = spot.file
                }
                val f = raf!!
                f.seek(position - spot.start)
                return f.read(buf, off, minOf(len.toLong(), spot.avail).toInt())
            } catch (e: IOException) {
                close()
                throw IOException("This part of the recording is no longer kept", e)
            }
        }

        override fun close() {
            try {
                raf?.close()
            } catch (_: IOException) {
            }
            raf = null
            file = null
        }
    }

    /** One-off read (tests); playback uses [Reader]. */
    @Throws(IOException::class)
    fun read(position: Long, buf: ByteArray, off: Int, len: Int): Int = Reader().use { it.read(position, buf, off, len) }

    /** Byte offset of the moment [timeMs] (clamped to what is kept). */
    fun offsetForTime(timeMs: Long): Long = synchronized(lock) {
        if (marks.isEmpty()) return writeOffset
        var lo = 0
        var hi = marks.size - 1
        if (timeMs <= marks.first()[0]) return marks.first()[1]
        while (lo < hi) {
            val mid = (lo + hi + 1) / 2
            if (marks.elementAt(mid)[0] <= timeMs) lo = mid else hi = mid - 1
        }
        return marks.elementAt(lo)[1]
    }

    /** Arrival time of the byte at [offset]. */
    fun timeForOffset(offset: Long): Long = synchronized(lock) {
        if (marks.isEmpty()) return clock()
        var best = marks.first()
        for (m in marks) {
            if (m[1] <= offset) best = m else break
        }
        return best[0]
    }

    fun close() {
        synchronized(lock) {
            closed = true
            out?.close()
            out = null
            lock.notifyAll()
        }
    }

    /** Close and delete the files. */
    fun destroy() {
        close()
        synchronized(lock) {
            chunks.forEach { it.file.delete() }
            chunks.clear()
            marks.clear()
        }
    }
}
