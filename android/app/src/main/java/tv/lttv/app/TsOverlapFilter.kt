package tv.lttv.app

/**
 * Removes the part of a live MPEG-TS stream that the server sends again after a reconnect.
 *
 * IPTV servers start every new connection with the last several seconds of the channel. Played as-is,
 * the picture jumps back that far each time a connection hiccups. This filter remembers the stream's own
 * clock (the PCR in the packets) and, after [reconnected], drops packets until the clock passes the point
 * already delivered — so playback continues where it was instead of repeating.
 *
 * Plain JVM code (no Android classes) so it can be tested off-device.
 */
class TsOverlapFilter {
    private val carry = ByteArray(PACKET)
    private var carryLen = 0
    private var pcrPid = -1
    /** Last PCR delivered (90 kHz units, 33 bits), -1 = none yet. */
    var lastPcr = -1L
        private set
    var skipping = false
        private set
    private var skippedBytes = 0L
    /** Bytes dropped as repeats since the filter was made (diagnostics / tests). */
    var droppedTotal = 0L
        private set

    /** A new connection starts now: skip what was already delivered. */
    fun reconnected() {
        carryLen = 0
        if (lastPcr >= 0) {
            skipping = true
            skippedBytes = 0
        }
    }

    /** Filter [len] bytes of [src] into [dst] (at least len + 188 bytes); returns bytes written. */
    fun process(src: ByteArray, off: Int, len: Int, dst: ByteArray): Int {
        var w = 0
        var i = off
        val end = off + len
        // Finish a packet split across reads.
        if (carryLen > 0) {
            val need = PACKET - carryLen
            if (len < need) {
                System.arraycopy(src, off, carry, carryLen, len)
                carryLen += len
                return 0
            }
            System.arraycopy(src, off, carry, carryLen, need)
            carryLen = 0
            i += need
            w += packet(carry, 0, dst, w)
        }
        while (i < end) {
            if (src[i] != SYNC) {
                i++ // lost sync: skip to the next packet start
                continue
            }
            if (end - i < PACKET) {
                System.arraycopy(src, i, carry, 0, end - i)
                carryLen = end - i
                break
            }
            w += packet(src, i, dst, w)
            i += PACKET
        }
        return w
    }

    private fun packet(b: ByteArray, p: Int, dst: ByteArray, w: Int): Int {
        val pid = ((b[p + 1].toInt() and 0x1F) shl 8) or (b[p + 2].toInt() and 0xFF)
        val pcr = pcrOf(b, p)
        if (pcr >= 0 && pcrPid < 0) pcrPid = pid
        val clock = if (pcr >= 0 && pid == pcrPid) pcr else -1L
        if (skipping) {
            if (clock >= 0 && (passed(clock) || skippedBytes > MAX_SKIP_BYTES)) {
                skipping = false
            } else {
                if (skippedBytes > MAX_SKIP_BYTES * 2) skipping = false // a stream without a usable clock
                else {
                    skippedBytes += PACKET
                    droppedTotal += PACKET
                    return 0
                }
            }
        }
        if (clock >= 0) lastPcr = clock
        System.arraycopy(b, p, dst, w, PACKET)
        return PACKET
    }

    /** The clock moved past what was delivered (or jumped to a new timeline). */
    private fun passed(pcr: Long): Boolean {
        val d = (pcr - lastPcr) and MASK33
        if (d == 0L) return false
        if (d < HALF) return true // ahead (also a big jump forward = new timeline)
        val behind = MASK33 + 1 - d
        return behind > NEW_TIMELINE // far behind: the channel restarted its clock
    }

    companion object {
        const val PACKET = 188
        private const val SYNC = 0x47.toByte()
        private const val MASK33 = (1L shl 33) - 1
        private const val HALF = 1L shl 32
        /** More than 60 s behind is a new clock, not a repeat. */
        private const val NEW_TIMELINE = 60L * 90_000
        /** Never skip more than ~64 MB looking for the clock. */
        private const val MAX_SKIP_BYTES = 64L * 1024 * 1024

        /** The PCR base (90 kHz) in a packet's adaptation field, or -1. */
        fun pcrOf(b: ByteArray, p: Int): Long {
            val afc = (b[p + 3].toInt() shr 4) and 3
            if (afc != 2 && afc != 3) return -1
            if ((b[p + 4].toInt() and 0xFF) < 7 || (b[p + 5].toInt() and 0x10) == 0) return -1
            return ((b[p + 6].toLong() and 0xFF) shl 25) or
                ((b[p + 7].toLong() and 0xFF) shl 17) or
                ((b[p + 8].toLong() and 0xFF) shl 9) or
                ((b[p + 9].toLong() and 0xFF) shl 1) or
                ((b[p + 10].toLong() and 0x80) ushr 7)
        }
    }
}
