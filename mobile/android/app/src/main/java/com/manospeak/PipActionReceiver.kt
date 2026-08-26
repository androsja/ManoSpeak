package com.manospeak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Forwards the single context-sensitive PiP action to the shared UI state. */
class PipActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    if (intent?.action == ACTION_PRIMARY) PictureInPictureModule.emitPipAction()
  }

  companion object {
    const val ACTION_PRIMARY = "com.manospeak.action.VOZUAL_PIP_PRIMARY"
  }
}
