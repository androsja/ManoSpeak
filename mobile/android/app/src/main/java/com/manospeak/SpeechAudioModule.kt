package com.manospeak

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SpeechAudioModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val audioManager =
      reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private var savedMusicVolume: Int? = null
  private var savedNotificationVolume: Int? = null
  private var muteGeneration = 0

  override fun getName(): String = NAME

  @ReactMethod
  fun silenceRecognitionPrompts(promise: Promise) {
    mainHandler.post {
      try {
        muteGeneration += 1
        if (savedMusicVolume == null) {
          savedMusicVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
        }
        if (savedNotificationVolume == null) {
          savedNotificationVolume =
              audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION)
        }
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
        audioManager.setStreamVolume(AudioManager.STREAM_NOTIFICATION, 0, 0)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("SPEECH_AUDIO_MUTE_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun restoreAudioAfter(delayMillis: Double) {
    val generation = muteGeneration
    mainHandler.postDelayed(
        {
          if (generation == muteGeneration) {
            restoreAudio()
          }
        },
        delayMillis.coerceAtLeast(0.0).toLong(),
    )
  }

  private fun restoreAudio() {
    savedMusicVolume?.let {
      audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, it, 0)
    }
    savedNotificationVolume?.let {
      audioManager.setStreamVolume(AudioManager.STREAM_NOTIFICATION, it, 0)
    }
    savedMusicVolume = null
    savedNotificationVolume = null
  }

  override fun invalidate() {
    restoreAudio()
    super.invalidate()
  }

  companion object {
    const val NAME = "SpeechAudio"
  }
}
