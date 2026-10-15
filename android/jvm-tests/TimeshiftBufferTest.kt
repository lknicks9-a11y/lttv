// Off-device test of the live-rewind buffer (plain JVM). Run from android/:
//   kotlinc jvm-tests/TimeshiftBufferTest.kt app/src/main/java/tv/lttv/app/TimeshiftBuffer.kt -include-runtime -d build/tsbuf.jar && java -jar build/tsbuf.jar
import tv.lttv.app.TimeshiftBuffer
import java.io.File
import kotlin.concurrent.thread

fun check(c: Boolean, m: String) { if (!c) { println("FAIL: $m"); kotlin.system.exitProcess(1) } else println("ok: $m") }

fun main() {
    var now = 1_000_000L
    val dir = File("build/tsbuf-test/data")
    val b = TimeshiftBuffer(dir, maxBytes = 10_000, maxAgeMs = 60_000, chunkBytes = 1000, clock = { now })
    // 1 second = 500 bytes
    val data = ByteArray(500) { (it % 251).toByte() }
    for (i in 0 until 10) { b.append(data, 0, 500); now += 1000 }
    check(b.liveOffset == 5000L, "live offset")
    check(b.earliestOffset == 0L, "nothing trimmed yet")
    check(b.offsetForTime(1_000_000L + 3000) == 1500L, "offset for 3s in")
    check(b.timeForOffset(2600) == 1_000_000L + 5000, "time for offset")
    val buf = ByteArray(300)
    val n = b.read(950, buf, 0, 300)
    check(n == 50, "read stops at chunk end ($n)")
    check(buf[0] == data[450], "right bytes")
    // trimming by size: 30 more seconds = 15000 bytes total > 10000
    for (i in 0 until 20) { b.append(data, 0, 500); now += 1000 }
    check(b.earliestOffset >= 5000L, "trimmed by size (${b.earliestOffset})")
    check(b.offsetForTime(1_000_000L) == b.earliestOffset, "old time clamps to earliest")
    var threw = false
    try { b.read(10, buf, 0, 10) } catch (e: java.io.IOException) { threw = true }
    check(threw, "reading trimmed data fails")
    // blocking read at live edge
    val edge = b.liveOffset
    var got = -2
    val t = thread { got = b.read(edge, buf, 0, 100) }
    Thread.sleep(200)
    check(got == -2, "waits at live edge")
    b.append(data, 0, 40)
    t.join(2000)
    check(got == 40, "wakes when data arrives")
    // interrupt
    var interrupted = false
    val t2 = thread { try { b.read(b.liveOffset, buf, 0, 10) } catch (e: java.io.InterruptedIOException) { interrupted = true } }
    Thread.sleep(100); t2.interrupt(); t2.join(2000)
    check(interrupted, "interruptible")
    // age trim
    val b2 = TimeshiftBuffer(File("build/tsbuf-test/d2"), maxBytes = 1_000_000, maxAgeMs = 5000, chunkBytes = 1000, clock = { now })
    for (i in 0 until 20) { b2.append(data, 0, 500); now += 1000 }
    check(now - b2.earliestTime <= 8000, "trimmed by age (${now - b2.earliestTime})")
    b2.close()
    check(b2.read(b2.liveOffset, buf, 0, 10) == -1, "closed -> end")
    b.fail(java.io.IOException("x"))
    threw = false
    try { b.read(b.liveOffset, buf, 0, 10) } catch (e: java.io.IOException) { threw = true }
    check(threw, "failure surfaces")
    b.destroy(); b2.destroy()
    check((dir.listFiles()?.size ?: 0) == 0, "files deleted")
    println("ALL OK")
}
