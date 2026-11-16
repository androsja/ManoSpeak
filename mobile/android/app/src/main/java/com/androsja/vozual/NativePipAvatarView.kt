package com.androsja.vozual

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.lang.ref.WeakReference
import org.json.JSONObject

/**
 * Android-owned PiP renderer backed by the same local avatar runtime used on
 * the Home screen. Keeping this WebView outside React Native lets Android
 * continue driving frames while the React tree is paused in Picture-in-Picture.
 */
@SuppressLint("SetJavaScriptEnabled")
class NativePipAvatarView(context: Context) : WebView(context) {
  private var runtimeReady = false
  private var renderMode = DEFAULT_RENDER_MODE
  private var avatarZoom = DEFAULT_AVATAR_ZOOM
  private var playbackSpeed = DEFAULT_PLAYBACK_SPEED
  private var playbackPaused = false
  private var pendingGloss = IDLE_GLOSS
  private var playbackId = 0

  init {
    setBackgroundColor(Color.rgb(32, 42, 56))
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = false
    settings.allowFileAccess = true
    settings.allowContentAccess = false
    settings.allowFileAccessFromFileURLs = true
    settings.allowUniversalAccessFromFileURLs = true
    settings.javaScriptCanOpenWindowsAutomatically = false
    addJavascriptInterface(RuntimeBridge(this), "ReactNativeWebView")
    webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        // The avatar runtime sends its own ready message after the motions and
        // rigged character finish loading. onPageFinished alone is too early.
        Log.i(TAG, "PiP avatar document loaded")
      }
    }
    loadUrl(AVATAR_URL)
  }

  fun configure(mode: String, zoom: Double, speed: Double) {
    renderMode = mode.takeIf(ALLOWED_RENDER_MODES::contains) ?: DEFAULT_RENDER_MODE
    avatarZoom = zoom.coerceIn(MIN_AVATAR_ZOOM, MAX_AVATAR_ZOOM)
    playbackSpeed = speed.coerceIn(MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED)
    if (runtimeReady) applyPresentation()
  }

  fun play(gloss: String, continuePhrase: Boolean = false) {
    pendingGloss = gloss.trim().ifEmpty { IDLE_GLOSS }
    if (!runtimeReady) return
    playbackId += 1
    val installScript = installedMotionScript(pendingGloss)
    val script = "$installScript window.playVozualClip(${JSONObject.quote(pendingGloss)}, $playbackId, $playbackSpeed, $continuePhrase); window.setVozualPlaybackPaused?.($playbackPaused); true;"
    evaluateJavascript(script, null)
  }

  fun setPlaybackPaused(paused: Boolean) {
    playbackPaused = paused
    if (!runtimeReady) return
    evaluateJavascript("window.setVozualPlaybackPaused?.($paused); true;", null)
  }

  private fun installedMotionScript(gloss: String): String {
    if (gloss == IDLE_GLOSS || gloss == PHRASE_WAIT_GLOSS) return ""
    return try {
      val libraryRoot = File(context.filesDir, LIBRARY_DIRECTORY).canonicalFile
      val stateFile = File(libraryRoot, LIBRARY_STATE_FILE)
      if (!stateFile.isFile) return ""
      val state = JSONObject(stateFile.readText())
      val installedSigns = state.optJSONObject("installedSigns") ?: return ""
      val selectedLanguageId = state.optString("selectedLanguageId")
      val sign = installedSigns.keys().asSequence()
        .mapNotNull { installedSigns.optJSONObject(it) }
        .firstOrNull {
          (selectedLanguageId.isBlank() || it.optString("languageId") == selectedLanguageId) &&
            it.optString("gloss").trim().uppercase() == gloss.trim().uppercase()
        }
        ?: return ""
      val motionFile = File(sign.optString("localPath")).canonicalFile
      val allowedPrefix = libraryRoot.path + File.separator
      if (!motionFile.isFile || !motionFile.path.startsWith(allowedPrefix)) return ""
      val content = Base64.encodeToString(motionFile.readBytes(), Base64.NO_WRAP)
      "window.installVozualMotionBase64(${JSONObject.quote(gloss)}, ${JSONObject.quote(content)});"
    } catch (error: Exception) {
      Log.e(TAG, "Could not load installed motion for $gloss", error)
      ""
    }
  }

  fun tick() {
    if (!runtimeReady) return
    evaluateJavascript("window.tickVozualAnimation?.(); true;", null)
  }

  private fun onRuntimeReady() {
    if (runtimeReady) return
    runtimeReady = true
    applyPresentation()
    play(pendingGloss)
    Log.i(TAG, "PiP avatar runtime ready in mode=$renderMode")
  }

  private fun applyPresentation() {
    val script = buildString {
      append("window.setVozualRenderMode(")
      append(JSONObject.quote(renderMode))
      append("); window.setVozualAvatarZoom(")
      append(avatarZoom)
      append("); window.tickVozualAnimation?.(); true;")
    }
    evaluateJavascript(script, null)
  }

  private class RuntimeBridge(view: NativePipAvatarView) {
    private val viewReference = WeakReference(view)

    @JavascriptInterface
    fun postMessage(message: String) {
      val view = viewReference.get() ?: return
      val payload = try {
        JSONObject(message)
      } catch (_: Exception) {
        return
      }
      val type = payload.optString("type")
      if (type == "ready") view.post(view::onRuntimeReady)
      if (type == "ended") {
        val playbackId = payload.optInt("playbackId", -1)
        view.post {
          NativePipAvatarController.onPlaybackEnded(view, playbackId)
        }
      }
    }
  }

  fun isCurrentPlayback(playback: Int): Boolean = playback == playbackId

  companion object {
    private const val TAG = "VozualPipAvatar"
    private const val AVATAR_URL = "file:///android_asset/avatar/index.html"
    private const val IDLE_GLOSS = "IDLE"
    private const val PHRASE_WAIT_GLOSS = "PHRASE_WAIT"
    private const val LIBRARY_DIRECTORY = "vozual-sign-languages"
    private const val LIBRARY_STATE_FILE = "library.json"
    private const val DEFAULT_RENDER_MODE = "rigged"
    private const val DEFAULT_AVATAR_ZOOM = 1.0
    private const val MIN_AVATAR_ZOOM = 0.85
    private const val MAX_AVATAR_ZOOM = 1.3
    private const val DEFAULT_PLAYBACK_SPEED = 1.0
    private const val MIN_PLAYBACK_SPEED = 0.5
    private const val MAX_PLAYBACK_SPEED = 4.0
    private val ALLOWED_RENDER_MODES = setOf("points", "rigged")
  }
}

object NativePipAvatarController {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var viewReference: WeakReference<NativePipAvatarView>? = null
  private var pendingGloss = "IDLE"
  private var renderMode = "rigged"
  private var avatarZoom = 1.0
  private var playbackSpeed = 1.0
  private var playbackPaused = false
  private val pendingSigns = ArrayDeque<String>()
  private var playingSign = false
  private var phraseInProgress = false
  private var finishPhraseTask: Runnable? = null

  fun attach(view: NativePipAvatarView) {
    viewReference = WeakReference(view)
    view.configure(renderMode, avatarZoom, playbackSpeed)
    if (playingSign) {
      view.play(pendingGloss, phraseInProgress)
    } else {
      view.play("IDLE")
      playNextIfAvailable()
    }
    view.setPlaybackPaused(playbackPaused)
  }

  fun detach(view: NativePipAvatarView) {
    if (viewReference?.get() === view) viewReference = null
  }

  fun configure(mode: String, zoom: Double, speed: Double) {
    renderMode = mode
    avatarZoom = zoom
    playbackSpeed = speed
    viewReference?.get()?.post {
      viewReference?.get()?.configure(renderMode, avatarZoom, playbackSpeed)
    }
  }

  fun setPlaybackPaused(paused: Boolean) {
    playbackPaused = paused
    viewReference?.get()?.post {
      viewReference?.get()?.setPlaybackPaused(playbackPaused)
    }
  }

  fun play(gloss: String) {
    clearFinishPhraseTask()
    val continuePhrase = phraseInProgress && gloss != "IDLE"
    pendingGloss = gloss
    phraseInProgress = gloss != "IDLE"
    playingSign = gloss != "IDLE" && gloss != "PHRASE_WAIT"
    viewReference?.get()?.post {
      viewReference?.get()?.play(gloss, continuePhrase)
      PictureInPictureModule.startNativeAnimationClock()
    }
  }

  fun enqueue(glosses: List<String>) {
    val cleanGlosses = glosses.map(String::trim).filter(String::isNotEmpty)
    if (cleanGlosses.isEmpty()) return
    clearFinishPhraseTask()
    pendingSigns.addAll(cleanGlosses)
    Log.i("VozualPipQueue", "Queued ${cleanGlosses.size} sign(s); pending=${pendingSigns.size}")
    if (!playingSign) playNextIfAvailable()
  }

  fun reset() {
    clearFinishPhraseTask()
    pendingSigns.clear()
    playingSign = false
    phraseInProgress = false
    pendingGloss = "IDLE"
    playbackPaused = false
    viewReference?.get()?.post {
      viewReference?.get()?.play("IDLE")
      PictureInPictureModule.startNativeAnimationClock()
    }
  }

  fun onPlaybackEnded(view: NativePipAvatarView, playbackId: Int) {
    if (viewReference?.get() !== view || !view.isCurrentPlayback(playbackId)) return
    if (!playingSign) return
    Log.i("VozualPipQueue", "Completed $pendingGloss playbackId=$playbackId")
    playingSign = false
    playNextIfAvailable()
  }

  private fun playNextIfAvailable() {
    clearFinishPhraseTask()
    val nextGloss = pendingSigns.removeFirstOrNull()
    if (nextGloss != null) {
      val continuePhrase = phraseInProgress
      pendingGloss = nextGloss
      phraseInProgress = true
      playingSign = true
      Log.i("VozualPipQueue", "Playing $nextGloss continue=$continuePhrase pending=${pendingSigns.size}")
      viewReference?.get()?.post {
        viewReference?.get()?.play(nextGloss, continuePhrase)
        PictureInPictureModule.startNativeAnimationClock()
      }
      return
    }
    if (!phraseInProgress) return
    pendingGloss = "PHRASE_WAIT"
    viewReference?.get()?.post {
      viewReference?.get()?.play("PHRASE_WAIT", true)
      PictureInPictureModule.startNativeAnimationClock()
    }
    val finish = Runnable {
      finishPhraseTask = null
      if (pendingSigns.isNotEmpty()) {
        playNextIfAvailable()
        return@Runnable
      }
      phraseInProgress = false
      pendingGloss = "IDLE"
      viewReference?.get()?.post {
        viewReference?.get()?.play("IDLE")
        PictureInPictureModule.startNativeAnimationClock()
      }
    }
    finishPhraseTask = finish
    mainHandler.postDelayed(finish, PHRASE_CONTINUATION_GRACE_MILLIS)
  }

  private fun clearFinishPhraseTask() {
    finishPhraseTask?.let(mainHandler::removeCallbacks)
    finishPhraseTask = null
  }

  fun tick() {
    viewReference?.get()?.post { viewReference?.get()?.tick() }
  }

  private const val PHRASE_CONTINUATION_GRACE_MILLIS = 550L
}
