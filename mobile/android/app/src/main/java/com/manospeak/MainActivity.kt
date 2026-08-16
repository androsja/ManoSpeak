package com.manospeak

import android.app.PictureInPictureParams
import android.content.res.Configuration
import android.os.Build
import android.util.Rational
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onResume() {
    super.onResume()
    // PiP expansion can resume the activity without delivering the callback
    // to the React context. Re-sample the native flag for several layout
    // passes so the full screen WebView is rebuilt reliably after expansion.
    schedulePipStateChecks()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      // Expanding PiP does not call onResume consistently on every Android
      // build. Window focus is the final reliable signal that the full
      // activity is visible again.
      schedulePipStateChecks()
    }
  }

  private fun schedulePipStateChecks() {
    longArrayOf(0L, 120L, 300L, 650L, 1000L).forEach { delayMillis ->
      window.decorView.postDelayed({
        emitPipState(isInPictureInPictureMode)
      }, delayMillis)
    }
  }

  private fun emitPipState(isInPictureInPictureMode: Boolean) {
    try {
      reactInstanceManager.currentReactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("onVozualPictureInPictureChanged", isInPictureInPictureMode)
    } catch (_: NullPointerException) {
      // React Native may be recreating its context during a PiP transition.
    }
  }

  fun enterVozualPictureInPicture(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val builder = PictureInPictureParams.Builder()
      .setAspectRatio(Rational(9, 16))
    // WebView/Canvas content can briefly disappear during a seamless resize
    // on some Android emulator/device builds. A regular PiP transition keeps
    // the rendered surface visible instead of presenting a black placeholder.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setSeamlessResizeEnabled(false)
    }
    val params = builder.build()
    return enterPictureInPictureMode(params)
  }

  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    emitPipState(isInPictureInPictureMode)
    if (!isInPictureInPictureMode) schedulePipStateChecks()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "ManoSpeak"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
