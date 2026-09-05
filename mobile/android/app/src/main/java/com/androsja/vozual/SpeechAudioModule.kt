package com.androsja.vozual

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SpeechAudioModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun silenceRecognitionPrompts(promise: Promise) {
    // Speech recognition must never change STREAM_MUSIC. That stream belongs
    // to the user and is shared by YouTube, music players and other apps.
    promise.resolve(null)
  }

  @ReactMethod
  fun restoreAudioAfter(delayMillis: Double) {
    // Kept as a no-op bridge method for the existing React Native lifecycle.
  }

  companion object {
    const val NAME = "SpeechAudio"
  }
}
