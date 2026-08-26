package com.manospeak

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

class PictureInPictureModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val mainHandler = Handler(Looper.getMainLooper())

  init {
    activeModule = WeakReference(this)
  }

  override fun getName(): String = "VozualPictureInPicture"

  @ReactMethod
  fun enter(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(false)
      return
    }
    val activity = currentActivity as? MainActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "VOZUAL no tiene una ventana activa.")
      return
    }
    try {
      // Start the microphone foreground service while the activity is still
      // visible. Android does not deliver microphone input to an
      // activity-owned recognizer after the activity enters PiP.
      ContextCompat.startForegroundService(
        reactApplicationContext,
        Intent(reactApplicationContext, VoiceListeningService::class.java),
      )
      val entered = activity.enterVozualPictureInPicture()
      if (!entered) stopVoiceListeningService()
      promise.resolve(entered)
    } catch (error: Exception) {
      stopVoiceListeningService()
      promise.reject("PIP_LISTENING_FAILED", "No se pudo mantener activo el micrófono.", error)
    }
  }

  @ReactMethod
  fun startListeningService(promise: Promise) {
    try {
      ContextCompat.startForegroundService(
        reactApplicationContext,
        Intent(reactApplicationContext, VoiceListeningService::class.java),
      )
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject(
        "NATIVE_LISTENING_FAILED",
        "No se pudo iniciar el escuchador nativo.",
        error,
      )
    }
  }

  @ReactMethod
  fun isListeningServiceReady(promise: Promise) {
    promise.resolve(VoiceListeningService.hasReadyRecognition())
  }

  @ReactMethod
  fun stopListeningService(promise: Promise) {
    stopAnimationClock()
    promise.resolve(stopVoiceListeningService())
  }

  @ReactMethod
  fun finishListeningPhrase(promise: Promise) {
    promise.resolve(VoiceListeningService.finishCurrentPhrase())
  }

  @ReactMethod
  fun isActive(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(false)
      return
    }
    val activity = currentActivity as? MainActivity
    promise.resolve(activity?.isInPictureInPictureMode == true)
  }

  @ReactMethod
  fun setAvatarPresentation(renderMode: String, avatarZoom: Double, playbackSpeed: Double) {
    NativePipAvatarController.configure(
      renderMode,
      avatarZoom,
      playbackSpeed,
    )
  }

  @ReactMethod
  fun setListeningMode(mode: String, microphoneActive: Boolean) {
    (currentActivity as? MainActivity)?.updateVozualPipAction(mode, microphoneActive)
  }

  @ReactMethod
  fun enqueueSigns(glosses: ReadableArray) {
    val queue = buildList {
      for (index in 0 until glosses.size()) {
        glosses.getString(index)?.let(::add)
      }
    }
    NativePipAvatarController.enqueue(queue)
    startAnimationClock()
  }

  @ReactMethod
  fun resetPlayback() {
    NativePipAvatarController.reset()
    startAnimationClock()
  }

  @ReactMethod
  fun reportPlaybackEvent(event: String, publishedGloss: String?) {
    val safeEvent = event.take(48).replace(Regex("[^A-Za-z0-9_-]"), "_")
    val safeGloss = publishedGloss
      ?.take(80)
      ?.replace(Regex("[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]"), "_")
      ?: "none"
    Log.i(TAG, "React PiP event=$safeEvent publishedGloss=$safeGloss")
  }

  private fun stopVoiceListeningService(): Boolean =
    reactApplicationContext.stopService(
      Intent(reactApplicationContext, VoiceListeningService::class.java),
    )

  // React Native pauses JS timers in PiP on some Android builds. The native
  // foreground path remains active, so it supplies a short-lived frame clock
  // whenever a sign has been requested.
  private var animationClock: Runnable? = null

  private fun startAnimationClock() {
    stopAnimationClock()
    // PiP can suspend WebView requestAnimationFrame. Drive the same time-based
    // renderer at display cadence so short signs remain legible at 3x/4x.
    var remainingFrames = 300 // Five seconds at 60 FPS; each queued sign renews this clock.
    val clock = object : Runnable {
      override fun run() {
        // The PiP WebView is independent from React Native. Drive its Three.js
        // frame explicitly because Android may pause requestAnimationFrame
        // while the activity is pinned.
        NativePipAvatarController.tick()
        remainingFrames -= 1
        if (remainingFrames > 0 && animationClock === this) {
          mainHandler.postDelayed(this, 16L)
        } else {
          animationClock = null
        }
      }
    }
    animationClock = clock
    mainHandler.post(clock)
  }

  private fun stopAnimationClock() {
    animationClock?.let(mainHandler::removeCallbacks)
    animationClock = null
  }

  private fun forwardSpeechEvent(event: String, values: ArrayList<String>?, error: String?) {
    mainHandler.post {
      val payloadValues = Arguments.createArray().apply {
        values.orEmpty().forEach(::pushString)
      }
      val payload = Arguments.createMap().apply {
        putString("type", event)
        putArray("value", payloadValues)
        putString("error", error)
      }
      try {
        reactApplicationContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("onVozualPipSpeechEvent", payload)
        Log.i(TAG, "Forwarded PiP speech event type=$event resultCount=${values.orEmpty().size}")
      } catch (bridgeError: RuntimeException) {
        Log.e(TAG, "Could not forward PiP speech event type=$event", bridgeError)
      }
    }
  }

  override fun invalidate() {
    stopAnimationClock()
    if (activeModule?.get() === this) activeModule = null
    super.invalidate()
  }

  companion object {
    private const val TAG = "VozualPipBridge"

    @Volatile
    private var activeModule: WeakReference<PictureInPictureModule>? = null

    fun startNativeAnimationClock() {
      activeModule?.get()?.startAnimationClock()
    }

    fun emitSpeechEvent(event: String, values: ArrayList<String>?, error: String?) {
      val module = activeModule?.get()
      if (module == null) {
        Log.w(TAG, "No React module available for PiP speech event type=$event")
        return
      }
      module.forwardSpeechEvent(event, values, error)
    }

    fun emitPipAction() {
      val module = activeModule?.get() ?: return
      module.mainHandler.post {
        val payload = Arguments.createMap()
        try {
          module.reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onVozualPipPrimaryAction", payload)
        } catch (bridgeError: RuntimeException) {
          Log.e(TAG, "Could not forward PiP action", bridgeError)
        }
      }
    }
  }
}
