package com.manospeak

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Android-owned PiP renderer. React Native is paused while an Activity is
 * pinned, so its SVG tree cannot advance even though speech callbacks arrive.
 * This view reads the existing compact motion assets and draws their skeleton
 * directly on Android's Canvas.
 */
class NativePipAvatarView(context: Context) : View(context) {
  private data class Frame(val body: FloatArray, val face: FloatArray)
  private data class Motion(val fps: Int, val frames: List<Frame>)

  private val handler = Handler(Looper.getMainLooper())
  private val background = Paint().apply { color = Color.rgb(7, 17, 31) }
  private val torsoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(53, 75, 98)
    style = Paint.Style.FILL
  }
  private val limbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(120, 153, 186)
    strokeCap = Paint.Cap.ROUND
    strokeWidth = 15f
  }
  private val handPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(165, 255, 249)
    strokeCap = Paint.Cap.ROUND
    strokeWidth = 3.5f
  }
  private val jointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
  private val facePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(112, 221, 214) }

  private var motion: Motion? = null
  private var startedAt = 0L
  private var currentFrame: Frame? = null

  private val ticker = object : Runnable {
    override fun run() {
      val activeMotion = motion ?: return
      val elapsedSeconds = (SystemClock.uptimeMillis() - startedAt) / 1000f
      val index = min(activeMotion.frames.lastIndex, floor(elapsedSeconds * activeMotion.fps).toInt())
      currentFrame = activeMotion.frames[index]
      invalidate()
      if (index < activeMotion.frames.lastIndex) handler.postDelayed(this, FRAME_DELAY_MILLIS)
    }
  }

  fun play(gloss: String) {
    val loaded = loadMotion(gloss) ?: return
    motion = loaded
    currentFrame = loaded.frames.firstOrNull()
    startedAt = SystemClock.uptimeMillis()
    handler.removeCallbacks(ticker)
    handler.post(ticker)
  }

  override fun onDetachedFromWindow() {
    handler.removeCallbacks(ticker)
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
    val frame = currentFrame ?: return
    if (width == 0 || height == 0) return
    val body = frame.body

    fun valid(index: Int) = index * 3 + 1 < body.size &&
      (body[index * 3] != 0f || body[index * 3 + 1] != 0f)
    // These match the PiP SVG projection. The motion is retargeted below to
    // a fixed human frame, then projected without using the camera crop.
    fun x(index: Int) = width / 2f + (body[index * 3] - .5f) * width * 1.49f
    fun y(index: Int) = height * (.022f + body[index * 3 + 1] * .838f)
    fun line(from: Int, to: Int, paint: Paint) {
      if (valid(from) && valid(to)) canvas.drawLine(x(from), y(from), x(to), y(to), paint)
    }

    val torso = intArrayOf(11, 12, 24, 23)
    if (torso.all(::valid)) {
      val path = Path().apply {
        moveTo(x(torso[0]), y(torso[0]))
        torso.drop(1).forEach { lineTo(x(it), y(it)) }
        close()
      }
      canvas.drawPath(path, torsoPaint)
    }
    arrayOf(11 to 13, 13 to 15, 12 to 14, 14 to 16, 11 to 12, 11 to 23, 12 to 24, 23 to 24)
      .forEach { (from, to) -> line(from, to, limbPaint) }

    arrayOf(33, 54).forEachIndexed { handIndex, start ->
      val wrist = if (handIndex == 0) 15 else 16
      line(wrist, start, handPaint)
      HAND_SEGMENTS.forEach { (from, to) -> line(start + from, start + to, handPaint) }
      if (valid(start)) canvas.drawCircle(x(start), y(start), 4f, jointPaint)
    }
    intArrayOf(11, 12, 13, 14, 15, 16).forEach { index ->
      if (valid(index)) canvas.drawCircle(x(index), y(index), 5f, jointPaint)
    }
    // Face landmarks are stored after the body/hand points in the compact
    // motion asset. Draw them natively too, so PiP preserves facial cues.
    val face = frame.face
    val faceAnchor = faceAnchor(face)
    for (index in face.indices step 3) {
      if (face[index] == 0f && face[index + 1] == 0f) continue
      val anchor = faceAnchor ?: continue
      val normalizedX = anchor.first + (face[index] - anchor.first) * 1.05f
      val normalizedY = anchor.second + (face[index + 1] - anchor.second) * 1.18f
      val faceX = width / 2f + (normalizedX - .5f) * width * 1.49f
      val faceY = height * (.022f + normalizedY * .838f)
      canvas.drawCircle(faceX, faceY, 1.45f, facePaint)
    }
  }

  private fun loadMotion(gloss: String): Motion? {
    val filename = gloss.trim().lowercase(Locale.ROOT)
    motionCache[filename]?.let { return it }
    return try {
      val bytes = context.assets.open("avatar/motions/$filename.motion.bin").use { it.readBytes() }
      if (bytes.size < HEADER_SIZE || bytes[0].toInt() != 'V'.code || bytes[1].toInt() != 'Z'.code ||
        bytes[2].toInt() != 'M'.code || bytes[3].toInt() != 'B'.code || bytes[4].toInt() != 2) return null
      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      val fps = buffer.getShort(6).toInt() and 0xffff
      val frameCount = buffer.getShort(8).toInt() and 0xffff
      val bodyPointCount = buffer.getShort(10).toInt() and 0xffff
      val facePointCount = buffer.getShort(12).toInt() and 0xffff
      val scale = buffer.getShort(14).toInt() and 0xffff
      if (fps == 0 || frameCount == 0 || bodyPointCount < 55 || scale == 0) return null
      val expectedSize = HEADER_SIZE + frameCount * (bodyPointCount + facePointCount) * 6
      if (bytes.size != expectedSize) return null
      buffer.position(HEADER_SIZE)
      val frames = ArrayList<Frame>(frameCount)
      repeat(frameCount) {
        val body = FloatArray(bodyPointCount * 3)
        repeat(bodyPointCount) { point ->
          body[point * 3] = buffer.short / scale.toFloat()
          body[point * 3 + 1] = buffer.short / scale.toFloat()
          body[point * 3 + 2] = buffer.short / scale.toFloat()
        }
        val face = FloatArray(facePointCount * 3)
        repeat(facePointCount) { point ->
          face[point * 3] = buffer.short / scale.toFloat()
          face[point * 3 + 1] = buffer.short / scale.toFloat()
          face[point * 3 + 2] = buffer.short / scale.toFloat()
        }
        frames.add(Frame(body, face))
      }
      Motion(fps, retargetFrames(frames)).also { motionCache[filename] = it }
    } catch (_: Exception) {
      null
    }
  }

  /**
   * Fits every recorded motion to the same shoulder, torso and face bounds
   * used by the home renderer. Raw MediaPipe landmarks include the source
   * camera framing, which otherwise makes the avatar change shape in PiP.
   */
  private fun retargetFrames(frames: List<Frame>): List<Frame> {
    val reference = frames.firstOrNull() ?: return frames
    if (!validPoint(reference.body, 11) || !validPoint(reference.body, 12) ||
      !validPoint(reference.body, 23) || !validPoint(reference.body, 24)) return frames

    val shoulderCenterX = (pointX(reference.body, 11) + pointX(reference.body, 12)) / 2f
    val shoulderCenterY = (pointY(reference.body, 11) + pointY(reference.body, 12)) / 2f
    val hipY = (pointY(reference.body, 23) + pointY(reference.body, 24)) / 2f
    val bodyScaleX = .42f / max(.001f, kotlin.math.abs(pointX(reference.body, 11) - pointX(reference.body, 12)))
    val bodyScaleY = .47f / max(.001f, kotlin.math.abs(hipY - shoulderCenterY))

    val usableFacePoints = (reference.face.indices step 3)
      .filter { validPoint(reference.face, it / 3) }
    val faceCenterX = usableFacePoints.map { reference.face[it] }.let { values ->
      if (values.isEmpty()) null else (values.minOrNull()!! + values.maxOrNull()!!) / 2f
    }
    val faceCenterY = usableFacePoints.map { reference.face[it + 1] }.let { values ->
      if (values.isEmpty()) null else (values.minOrNull()!! + values.maxOrNull()!!) / 2f
    }
    val faceScaleX = faceCenterX?.let {
      .22f / max(.001f, usableFacePoints.map { point -> reference.face[point] }.let { values -> values.maxOrNull()!! - values.minOrNull()!! })
    }
    val faceScaleY = faceCenterY?.let {
      .30f / max(.001f, usableFacePoints.map { point -> reference.face[point + 1] }.let { values -> values.maxOrNull()!! - values.minOrNull()!! })
    }

    return frames.map { frame ->
      val body = frame.body.copyOf()
      for (index in body.indices step 3) {
        if (!validPoint(body, index / 3)) continue
        body[index] = .5f + (body[index] - shoulderCenterX) * bodyScaleX
        body[index + 1] = .68f + (body[index + 1] - shoulderCenterY) * bodyScaleY
      }
      val face = frame.face.copyOf()
      if (faceCenterX != null && faceCenterY != null && faceScaleX != null && faceScaleY != null) {
        for (index in face.indices step 3) {
          if (!validPoint(face, index / 3)) continue
          face[index] = .5f + (face[index] - faceCenterX) * faceScaleX
          face[index + 1] = .39f + (face[index + 1] - faceCenterY) * faceScaleY
        }
      }
      Frame(body, face)
    }
  }

  private fun faceAnchor(face: FloatArray): Pair<Float, Float>? {
    if (!validPoint(face, 10) || !validPoint(face, 152) ||
      !validPoint(face, 33) || !validPoint(face, 263)) return null
    return Pair(
      (pointX(face, 33) + pointX(face, 263)) / 2f,
      (pointY(face, 10) + pointY(face, 152)) / 2f,
    )
  }

  private fun validPoint(points: FloatArray, index: Int): Boolean = index * 3 + 1 < points.size &&
    (points[index * 3] != 0f || points[index * 3 + 1] != 0f)

  private fun pointX(points: FloatArray, index: Int): Float = points[index * 3]
  private fun pointY(points: FloatArray, index: Int): Float = points[index * 3 + 1]

  companion object {
    private const val HEADER_SIZE = 16
    private const val FRAME_DELAY_MILLIS = 33L
    private val motionCache = mutableMapOf<String, Motion>()
    private val HAND_SEGMENTS = arrayOf(
      0 to 1, 1 to 2, 2 to 3, 3 to 4, 0 to 5, 5 to 6, 6 to 7, 7 to 8,
      0 to 9, 9 to 10, 10 to 11, 11 to 12, 0 to 13, 13 to 14, 14 to 15,
      15 to 16, 0 to 17, 17 to 18, 18 to 19, 19 to 20,
    )
  }
}

object NativePipAvatarController {
  private var viewReference: WeakReference<NativePipAvatarView>? = null
  private var pendingGloss: String? = null

  fun attach(view: NativePipAvatarView) {
    viewReference = WeakReference(view)
    pendingGloss?.let(view::play)
  }

  fun detach(view: NativePipAvatarView) {
    if (viewReference?.get() === view) viewReference = null
  }

  fun play(gloss: String) {
    pendingGloss = gloss
    viewReference?.get()?.post { viewReference?.get()?.play(gloss) }
  }
}
