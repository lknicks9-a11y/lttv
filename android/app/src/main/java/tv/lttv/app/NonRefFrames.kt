package tv.lttv.app

import java.nio.ByteBuffer

/**
 * H.264 frames that no other frame is decoded from (nal_ref_idc = 0, usually most B-frames in broadcast
 * streams). A muted Multiview tile can leave them out before the decoder: the picture stays correct (nothing
 * points at them), the tile just runs at a lower frame rate, and the TV's decoder does a fraction of the work
 * — four full-rate HD games at once is more than a Fire TV stick's decoder keeps up with.
 */
object NonRefFrames {
    /**
     * True when the access unit in [data] (bytes [start, end)) is an H.264 picture that nothing references.
     * Works with Annex-B (start codes, as MPEG-TS carries it) and 4-byte length-prefixed NAL units (MP4/HLS fMP4).
     * Anything it can't read with certainty returns false (decode it).
     */
    fun isDisposableH264(data: ByteBuffer, start: Int, end: Int): Boolean {
        if (end - start < 5) return false
        return if (startCodeAt(data, start, end) > 0) annexB(data, start, end) else lengthPrefixed(data, start, end)
    }

    /** Length of a start code (00 00 01 or 00 00 00 01) at [i], or 0. */
    private fun startCodeAt(d: ByteBuffer, i: Int, end: Int): Int {
        if (i + 3 <= end && d.get(i).toInt() == 0 && d.get(i + 1).toInt() == 0) {
            if (d.get(i + 2).toInt() == 1) return 3
            if (i + 4 <= end && d.get(i + 2).toInt() == 0 && d.get(i + 3).toInt() == 1) return 4
        }
        return 0
    }

    /**
     * The first slice decides: every slice of one picture has the same nal_ref_idc (zero for all or none),
     * so the scan stops at the first VCL NAL unit (after the small AUD / SEI / SPS / PPS units).
     */
    private fun verdict(header: Int): Int {
        val type = header and 0x1F
        val refIdc = (header shr 5) and 0x03
        if ((header and 0x80) != 0) return NO // forbidden bit: not H.264 as expected
        return when (type) {
            5 -> NO // IDR: a keyframe
            1 -> if (refIdc == 0) YES else NO
            2, 3, 4, 20, 21 -> NO // data partitions / extensions: leave alone
            else -> MORE // AUD, SEI, SPS, PPS, filler…: keep looking
        }
    }

    private fun annexB(d: ByteBuffer, start: Int, end: Int): Boolean {
        var i = start
        // Only the first few NAL units matter; give up on huge prefixes.
        var units = 0
        while (i < end && units < 16) {
            val sc = startCodeAt(d, i, end)
            if (sc == 0) {
                i++
                continue
            }
            val h = i + sc
            if (h >= end) return false
            when (verdict(d.get(h).toInt() and 0xFF)) {
                YES -> return true
                NO -> return false
            }
            units++
            i = h + 1
        }
        return false
    }

    private fun lengthPrefixed(d: ByteBuffer, start: Int, end: Int): Boolean {
        var i = start
        var units = 0
        while (i + 5 <= end && units < 16) {
            val len = ((d.get(i).toInt() and 0xFF) shl 24) or ((d.get(i + 1).toInt() and 0xFF) shl 16) or
                ((d.get(i + 2).toInt() and 0xFF) shl 8) or (d.get(i + 3).toInt() and 0xFF)
            if (len <= 0 || i + 4 + len > end) return false
            when (verdict(d.get(i + 4).toInt() and 0xFF)) {
                YES -> return true
                NO -> return false
            }
            units++
            i += 4 + len
        }
        return false
    }

    private const val NO = 0
    private const val YES = 1
    private const val MORE = 2
}
