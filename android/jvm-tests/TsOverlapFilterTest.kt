// Off-device test of the reconnect repeat-skipper (plain JVM). Run from android/:
//   kotlinc jvm-tests/TsOverlapFilterTest.kt app/src/main/java/tv/lttv/app/TsOverlapFilter.kt -include-runtime -d build/tsf.jar && java -jar build/tsf.jar
import tv.lttv.app.TsOverlapFilter

fun ok(c: Boolean, m: String) { if (!c) { println("FAIL: $m"); kotlin.system.exitProcess(1) } else println("ok: $m") }

/** One PCR packet (pid 0x100) every 100 ms followed by 4 video packets (pid 0x101) tagged with the time. */
fun stream(fromMs: Long, toMs: Long, pcrBase: Long = 0L): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    var t = fromMs
    while (t < toMs) {
        val pcr = (pcrBase + t * 90) and ((1L shl 33) - 1)
        val p = ByteArray(188)
        p[0] = 0x47; p[1] = 0x01; p[2] = 0x00; p[3] = 0x20 // adaptation only
        p[4] = 183.toByte(); p[5] = 0x10
        p[6] = (pcr shr 25).toByte(); p[7] = (pcr shr 17).toByte(); p[8] = (pcr shr 9).toByte(); p[9] = (pcr shr 1).toByte(); p[10] = ((pcr and 1) shl 7).toByte()
        out.write(p)
        repeat(4) {
            val v = ByteArray(188)
            v[0] = 0x47; v[1] = 0x01; v[2] = 0x01; v[3] = 0x10
            java.nio.ByteBuffer.wrap(v, 4, 8).putLong(t)
            out.write(v)
        }
        t += 100
    }
    return out.toByteArray()
}

fun feed(f: TsOverlapFilter, data: ByteArray, step: Int): List<Long> {
    val times = ArrayList<Long>()
    val dst = ByteArray(step + 188)
    var i = 0
    while (i < data.size) {
        val n = minOf(step, data.size - i)
        val k = f.process(data, i, n, dst)
        var p = 0
        while (p < k) {
            if (dst[p + 2] == 0x01.toByte()) times.add(java.nio.ByteBuffer.wrap(dst, p + 4, 8).long)
            p += 188
        }
        i += n
    }
    return times
}

fun main() {
    // Connection 1: 0–10 s. Drop. Connection 2: the server starts 6 s back (4–20 s).
    val f = TsOverlapFilter()
    val a = feed(f, stream(0, 10_000), 1000)
    f.reconnected()
    val b = feed(f, stream(4_000, 20_000), 777)
    val all = a + b
    ok(all.zipWithNext().all { (x, y) -> y >= x }, "time never goes back")
    ok(all.first() == 0L && all.last() == 19_900L, "starts at 0, ends at 19.9 s")
    ok(all.distinct().size * 4 == all.size, "no repeated moments (${all.size} packets)")
    ok(f.droppedTotal > 0, "repeat dropped (${f.droppedTotal} bytes)")

    // Without the filter the same input would repeat 6 seconds.
    val raw = feed(TsOverlapFilter(), stream(0, 10_000), 1000) + feed(TsOverlapFilter(), stream(4_000, 20_000), 777)
    ok(raw.size - all.size == 60 * 4, "6 s of repeats removed")

    // The channel restarted its clock (far behind): accept straight away.
    val g = TsOverlapFilter()
    feed(g, stream(0, 5_000, pcrBase = 90_000L * 3600), 500)
    g.reconnected()
    val c = feed(g, stream(0, 2_000, pcrBase = 0), 500)
    ok(c.size == 20 * 4, "new clock accepted at once")

    // Clock wrap-around (33 bits) counts as moving forward.
    val h = TsOverlapFilter()
    val wrapBase = (1L shl 33) - 90L * 3000 // wraps 3 s in
    feed(h, stream(0, 5_000, wrapBase), 400)
    h.reconnected()
    val d = feed(h, stream(2_000, 8_000, wrapBase), 400)
    ok(d.first() >= 5_000L && d.size == 30 * 4, "wrap-around handled (${d.firstOrNull()})")

    // Garbage before the first packet is skipped, packets split across reads are kept.
    val j = TsOverlapFilter()
    val junk = ByteArray(77) { 1 } + stream(0, 1_000)
    ok(feed(j, junk, 13).size == 40, "resync + split packets")
    println("all passed")
}
