package com.manospeak

import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarker
import com.google.mediapipe.tasks.vision.holisticlandmarker.HolisticLandmarkerResult
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import java.util.Optional

import com.google.mediapipe.tasks.core.Delegate

class MediaPipeFrameProcessorPlugin(proxy: VisionCameraProxy, options: Map<String, Any>?) : FrameProcessorPlugin() {

    private val holistic: HolisticLandmarker

    init {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("models/holistic_landmarker.task")
            .setDelegate(Delegate.GPU)
            .build()
            
        val holisticOptions = HolisticLandmarker.HolisticLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .build()
            
        holistic = HolisticLandmarker.createFromOptions(proxy.context, holisticOptions)
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    override fun callback(frame: Frame, arguments: Map<String, Any>?): Any? {
        try {
            val image = frame.image
            Log.d("ManoSpeak", "Frame received: format=${image.format}, ${image.width}x${image.height}")
            
            // VisionCamera with pixelFormat="rgb" gives RGBA_8888 (Format 1 or 0x22).
            // We must extract the pixels safely into a Bitmap because MediaPipe tasks-vision
            // has a bug where it rejects native YUV/hardware images in createImage()
            val plane = image.planes[0]
            val buffer = plane.buffer
            buffer.rewind()
            
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            val widthWithPadding = rowStride / pixelStride

            // Create a Bitmap with the exact memory width (including padding)
            val paddedBitmap = Bitmap.createBitmap(widthWithPadding, image.height, Bitmap.Config.ARGB_8888)
            paddedBitmap.copyPixelsFromBuffer(buffer)
            
            // Crop out the padding to get the true image width
            val finalBitmap = if (widthWithPadding > image.width) {
                Bitmap.createBitmap(paddedBitmap, 0, 0, image.width, image.height)
            } else {
                paddedBitmap
            }
            
            // The Android front camera sensor is mounted such that when holding in portrait,
            // the top of the head points to the left or right side of the landscape sensor.
            // 270 degrees clockwise rotation typically stands the user upright.
            // We also apply a horizontal flip (-1f scale on X) because it's a front camera (mirror effect),
            // which is critical so the AI doesn't confuse left and right hands for sign language.
            val matrix = android.graphics.Matrix()
            matrix.postRotate(270f)
            matrix.postScale(-1f, 1f)
            
            // Apply rotation and flip
            val rotatedBitmap = Bitmap.createBitmap(finalBitmap, 0, 0, finalBitmap.width, finalBitmap.height, matrix, false)
            
            val mpImage = com.google.mediapipe.framework.image.BitmapImageBuilder(rotatedBitmap).build()
            
            val result = holistic.detect(mpImage)
            
            if (result == null) {
                Log.w("ManoSpeak", "Holistic detect returned null")
                return emptyMockArray()
            }
            
            val pose = result.poseLandmarks()
            Log.d("ManoSpeak", "Holistic success! Pose points: ${pose?.size ?: 0}")
            
            return extractLandmarks(result)
        } catch (t: Throwable) {
            Log.e("ManoSpeak", "CRITICAL ERROR in Frame Processor: ${t.message}", t)
            return emptyMockArray()
        }
    }

    private fun extractLandmarks(result: HolisticLandmarkerResult): ArrayList<ArrayList<Double>> {
        val allLandmarks = ArrayList<ArrayList<Double>>()
        
        // 1. Pose (33)
        val pose = result.poseLandmarks()
        for (i in 0 until 33) {
            val point = ArrayList<Double>()
            if (pose != null && i < pose.size) {
                point.addAll(listOf(pose[i].x().toDouble(), pose[i].y().toDouble(), pose[i].z().toDouble()))
            } else {
                point.addAll(listOf(0.0, 0.0, 0.0))
            }
            allLandmarks.add(point)
        }

        // 2. Left Hand (21)
        val leftHand = result.leftHandLandmarks()
        for (i in 0 until 21) {
            val point = ArrayList<Double>()
            if (leftHand != null && i < leftHand.size) {
                point.addAll(listOf(leftHand[i].x().toDouble(), leftHand[i].y().toDouble(), leftHand[i].z().toDouble()))
            } else {
                point.addAll(listOf(0.0, 0.0, 0.0))
            }
            allLandmarks.add(point)
        }

        // 3. Right Hand (21)
        val rightHand = result.rightHandLandmarks()
        for (i in 0 until 21) {
            val point = ArrayList<Double>()
            if (rightHand != null && i < rightHand.size) {
                point.addAll(listOf(rightHand[i].x().toDouble(), rightHand[i].y().toDouble(), rightHand[i].z().toDouble()))
            } else {
                point.addAll(listOf(0.0, 0.0, 0.0))
            }
            allLandmarks.add(point)
        }

        // 4. Face (468)
        val face = result.faceLandmarks()
        for (i in 0 until 468) {
            val point = ArrayList<Double>()
            if (face != null && i < face.size) {
                point.addAll(listOf(face[i].x().toDouble(), face[i].y().toDouble(), face[i].z().toDouble()))
            } else {
                point.addAll(listOf(0.0, 0.0, 0.0))
            }
            allLandmarks.add(point)
        }

        return allLandmarks
    }

    private fun emptyMockArray(): ArrayList<ArrayList<Double>> {
        val result = ArrayList<ArrayList<Double>>()
        for (i in 0 until 543) {
            result.add(ArrayList(listOf(0.0, 0.0, 0.0)))
        }
        return result
    }
}
