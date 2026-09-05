package com.androsja.vozual

import android.app.Application
import android.webkit.WebView
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(SpeechAudioPackage())
          add(PictureInPicturePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.DEBUG) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    loadReactNative(this)

    FrameProcessorPluginRegistry.addFrameProcessorPlugin("media_pipe_holistic") { proxy, options ->
        MediaPipeFrameProcessorPlugin(proxy, options)
    }
  }
}
