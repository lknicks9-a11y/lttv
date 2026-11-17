package tv.lttv.home

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import java.io.File
import java.security.MessageDigest

/**
 * The user's own pictures for app tiles and the home screen background, saved on this TV only
 * (app storage, never uploaded anywhere). Keys are "package/class" for an app, or [BACKGROUND].
 */
object Art {
    const val BACKGROUND = "home:background"
    private val cache = HashMap<String, Bitmap?>()

    private fun dir(ctx: Context) = File(ctx.filesDir, "art").apply { mkdirs() }

    fun file(ctx: Context, key: String): File {
        val h = MessageDigest.getInstance("SHA-1").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir(ctx), "$h.jpg")
    }

    fun has(ctx: Context, key: String) = file(ctx, key).isFile

    @Synchronized
    fun bitmap(ctx: Context, key: String): Bitmap? = cache.getOrPut(key) {
        val f = file(ctx, key)
        // RGB_565: half the memory (photos have no transparency), so many tiles fit on a Fire TV Stick.
        if (!f.isFile) null else try { BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 }) } catch (_: Throwable) { null }
    }

    fun drawable(ctx: Context, key: String): Drawable? = bitmap(ctx, key)?.let { BitmapDrawable(ctx.resources, it) }

    /** Saves a picture (any format Android can read), sized for a TV tile / background. */
    @Synchronized
    fun save(ctx: Context, key: String, bytes: ByteArray): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 1280 && bounds.outHeight / (sample * 2) >= 720) sample *= 2
        val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
        // Fill 16:9 (cropping the middle), at most 1280 x 720.
        val w = src.width
        val h = src.height
        val cropW: Int
        val cropH: Int
        if (w * 9 > h * 16) { cropH = h; cropW = h * 16 / 9 } else { cropW = w; cropH = w * 9 / 16 }
        val crop = Bitmap.createBitmap(src, (w - cropW) / 2, (h - cropH) / 2, cropW, cropH)
        val out = if (cropW > 1280) Bitmap.createScaledBitmap(crop, 1280, 720, true) else crop
        file(ctx, key).outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        cache.remove(key)
        return true
    }

    @Synchronized
    fun remove(ctx: Context, key: String) {
        file(ctx, key).delete()
        cache.remove(key)
    }
}
