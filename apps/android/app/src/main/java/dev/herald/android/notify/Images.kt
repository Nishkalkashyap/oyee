package dev.herald.android.notify

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Downloads notification images with a hard timeout and downsampling (notifications must never hang on images). */
class Images(baseClient: OkHttpClient) {
    private val client = baseClient.newBuilder()
        .callTimeout(10, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .build()

    suspend fun download(url: String, maxPx: Int): Bitmap? = withTimeoutOrNull(12_000) {
        withContext(Dispatchers.IO) {
            try {
                client.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val bytes = resp.body.bytes()
                    if (bytes.size > MAX_BYTES) return@use null
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / (sample * 2) >= maxPx || bounds.outHeight / (sample * 2) >= maxPx) sample *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                }
            } catch (e: Exception) {
                Log.w("Images", "Image download failed: $url", e)
                null
            }
        }
    }

    /** Renders an emoji (or 1–2 chars) centred on a transparent square, used as the large icon. */
    fun emojiBitmap(emoji: String, sizePx: Int = 128): Bitmap {
        val bmp = createBitmap(sizePx, sizePx)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = sizePx * 0.72f; textAlign = Paint.Align.CENTER }
        val bounds = Rect()
        paint.getTextBounds(emoji, 0, emoji.length, bounds)
        Canvas(bmp).drawText(emoji, sizePx / 2f, sizePx / 2f - bounds.exactCenterY(), paint)
        return bmp
    }

    private companion object {
        const val MAX_BYTES = 8 * 1024 * 1024
    }
}
