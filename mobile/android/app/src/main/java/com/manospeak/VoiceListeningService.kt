package com.manospeak

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.app.NotificationCompat
import java.lang.ref.WeakReference

/**
 * Owns continuous speech recognition while VOZUAL is listening in Home or PiP.
 *
 * Each recognizer receives a unique session id. Android may deliver callbacks
 * after a recognizer has been destroyed, so callbacks from older sessions must
 * never restart or destroy the current recognizer.
 */
class VoiceListeningService : Service() {

  private val handler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var activeSessionId = 0L
  private var recognitionInProgress = false
  private var consecutiveErrors = 0
  private var consecutiveSpokenNoMatches = 0
  private var destroyed = false
  private var scheduledRestart: Runnable? = null
  private var lastPartialResults: ArrayList<String>? = null
  private var speechStarted = false
  private var hasReachedReadyState = false
  private var recognitionLanguageIndex = DEFAULT_RECOGNITION_LANGUAGE_INDEX

  override fun onCreate() {
    super.onCreate()
    activeService = WeakReference(this)
    recognitionLanguageIndex = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      .getInt(PREFERENCE_RECOGNITION_LANGUAGE_INDEX, DEFAULT_RECOGNITION_LANGUAGE_INDEX)
      .coerceIn(RECOGNITION_LANGUAGES.indices)
    Log.i(TAG, "PiP speech service created")
    createNotificationChannel()
    startForeground(
      NOTIFICATION_ID,
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("VOZUAL está escuchando")
        .setContentText("VOZUAL traducirá las palabras publicadas.")
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .build(),
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android retains the activity-owned speech session briefly after
    // SpeechRecognizer.destroy(). Give it time to release the remote Google
    // recognition slot before the foreground service requests a new one.
    if (recognizer == null && scheduledRestart == null) {
      scheduleRecognition(delayMillis = INITIAL_HANDOFF_DELAY_MILLIS, recreate = true)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    Log.i(TAG, "PiP speech service destroyed")
    destroyed = true
    hasReachedReadyState = false
    scheduledRestart?.let(handler::removeCallbacks)
    scheduledRestart = null
    releaseRecognizer()
    sendSpeechEvent(EVENT_END)
    if (activeService?.get() === this) activeService = null
    super.onDestroy()
  }

  private fun finishPhrase() {
    handler.post {
      if (destroyed || !recognitionInProgress) return@post
      Log.i(TAG, "Finishing current phrase on explicit user request session=$activeSessionId")
      try {
        recognizer?.stopListening()
      } catch (error: Exception) {
        Log.e(TAG, "Unable to finish current phrase", error)
        sendSpeechEvent(EVENT_ERROR, error = error.message ?: "No se pudo terminar la frase.")
      }
    }
  }

  private fun scheduleRecognition(delayMillis: Long, recreate: Boolean) {
    if (destroyed) return
    scheduledRestart?.let(handler::removeCallbacks)
    val restart = Runnable {
      scheduledRestart = null
      if (destroyed) return@Runnable
      if (recreate || recognizer == null) createRecognizer()
      startCurrentRecognizer()
    }
    scheduledRestart = restart
    handler.postDelayed(restart, delayMillis)
  }

  private fun createRecognizer() {
    releaseRecognizer()
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      Log.w(TAG, "Speech recognition is unavailable")
      sendSpeechEvent(EVENT_ERROR, error = "El reconocimiento de voz no está disponible.")
      scheduleRecognition(delayMillis = 3000L, recreate = true)
      return
    }

    val sessionId = ++activeSessionId
    try {
      // PiP must use the same Android-selected recognition provider as the
      // visible screen. Forcing Google's explicit service here produced
      // ERROR_NO_MATCH after the microphone had already detected speech on
      // some devices, so no transcript ever reached the avatar queue.
      recognizer = SpeechRecognizer.createSpeechRecognizer(this).also {
        it.setRecognitionListener(createRecognitionListener(sessionId))
      }
      Log.i(TAG, "Created default service-owned recognizer session=$sessionId")
    } catch (error: Exception) {
      Log.e(TAG, "Unable to create service-owned recognizer", error)
      sendSpeechEvent(EVENT_ERROR, error = error.message ?: "No se pudo iniciar el micrófono.")
      scheduleRecognition(delayMillis = 1800L, recreate = true)
    }
  }

  private fun startCurrentRecognizer() {
    if (destroyed || recognitionInProgress) return
    val current = recognizer ?: return
    try {
      recognitionInProgress = true
      Log.i(
        TAG,
        "Starting service-owned recognition session=$activeSessionId " +
          "language=${RECOGNITION_LANGUAGES[recognitionLanguageIndex]}",
      )
      current.startListening(createRecognitionIntent())
    } catch (error: Exception) {
      recognitionInProgress = false
      Log.e(TAG, "Unable to start service-owned recognition", error)
      sendSpeechEvent(EVENT_ERROR, error = error.message ?: "No se pudo iniciar el micrófono.")
      scheduleRecognition(delayMillis = 1800L, recreate = true)
    }
  }

  private fun releaseRecognizer() {
    // Invalidate the listener before cancel/destroy, because both calls may
    // synchronously or asynchronously emit terminal callbacks.
    activeSessionId += 1
    recognitionInProgress = false
    val previous = recognizer
    recognizer = null
    try {
      previous?.cancel()
    } catch (_: Exception) {
      // The recognizer may already have disconnected from its system service.
    }
    try {
      previous?.destroy()
    } catch (_: Exception) {
      // Destruction is best-effort during Android service teardown.
    }
  }

  private fun isCurrentSession(sessionId: Long): Boolean =
    !destroyed && sessionId == activeSessionId

  private fun createRecognitionListener(sessionId: Long): RecognitionListener =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {
        if (!isCurrentSession(sessionId)) return
        hasReachedReadyState = true
        lastPartialResults = null
        speechStarted = false
        Log.i(TAG, "Service-owned recognition is ready session=$sessionId")
        sendSpeechEvent(EVENT_START)
      }

      override fun onBeginningOfSpeech() {
        if (!isCurrentSession(sessionId)) return
        speechStarted = true
        Log.i(TAG, "Service-owned recognition detected speech session=$sessionId")
      }

      override fun onRmsChanged(rmsdB: Float) = Unit

      override fun onBufferReceived(buffer: ByteArray?) = Unit

      override fun onEndOfSpeech() {
        if (!isCurrentSession(sessionId)) return
        sendSpeechEvent(EVENT_END)
        // Results or an error always follow this callback. Restarting here can
        // overlap the still-finishing request and produce ERROR_RECOGNIZER_BUSY.
      }

      override fun onError(error: Int) {
        if (!isCurrentSession(sessionId)) {
          Log.d(TAG, "Ignoring stale recognition error session=$sessionId code=$error")
          return
        }
        recognitionInProgress = false
        val normalSilence =
          error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        if (normalSilence) {
          // A timeout without speech is expected while continuous listening
          // is armed. It must not make a later genuine recovery slower.
          consecutiveErrors = 0
        } else {
          consecutiveErrors += 1
        }
        if (
          error == SpeechRecognizer.ERROR_NO_MATCH &&
          speechStarted &&
          lastPartialResults.isNullOrEmpty()
        ) {
          consecutiveSpokenNoMatches += 1
        } else if (!normalSilence || !speechStarted) {
          consecutiveSpokenNoMatches = 0
        }
        Log.w(
          TAG,
          "Service-owned recognition error session=$sessionId code=$error speechStarted=$speechStarted",
        )

        // Google's recognizer sometimes emits useful partial text and then
        // closes an otherwise valid phrase with ERROR_NO_MATCH. Confirm the
        // last partial result before reporting the terminal error so the PiP
        // avatar can still react to the spoken sign. The JS queue deduplicates
        // this value when the same partial was already consumed.
        if (
          (error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) &&
          !lastPartialResults.isNullOrEmpty()
        ) {
          Log.i(TAG, "Promoting partial result after terminal error session=$sessionId")
          sendSpeechEvent(EVENT_RESULTS, lastPartialResults)
        }
        lastPartialResults = null
        sendSpeechEvent(EVENT_ERROR, error = error.toString())

        // Never rotate after ordinary silence. If the recognizer repeatedly
        // detects real speech but returns no text, however, its current locale
        // is unhealthy for this device/session. Move once to the next Spanish
        // provider and recreate the recognizer instead of failing forever.
        val shouldTryNextLanguage = consecutiveSpokenNoMatches >= 2
        if (shouldTryNextLanguage) {
          recognitionLanguageIndex = (recognitionLanguageIndex + 1) % RECOGNITION_LANGUAGES.size
          getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
            .edit()
            .putInt(PREFERENCE_RECOGNITION_LANGUAGE_INDEX, recognitionLanguageIndex)
            .apply()
          consecutiveSpokenNoMatches = 0
          Log.i(TAG, "Switching recognition locale after repeated spoken no-match")
        }

        val requiresRecreation =
          shouldTryNextLanguage ||
            error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
            error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED ||
            error == SpeechRecognizer.ERROR_CLIENT
        val baseDelay = when (error) {
          SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 900L
          SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> 1400L
          SpeechRecognizer.ERROR_CLIENT -> 750L
          // Silence is a normal terminal state of Android's phrase-based
          // recognizer, not a fault. Restart it quickly and never accumulate
          // a backoff just because the person has not spoken for a while.
          SpeechRecognizer.ERROR_NO_MATCH,
          SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> 180L
          else -> 500L
        }
        val backoff = if (
          normalSilence
        ) {
          0L
        } else {
          ((consecutiveErrors - 1).coerceAtMost(3) * 250L)
        }
        scheduleRecognition(baseDelay + backoff, recreate = requiresRecreation)
      }

      override fun onResults(results: Bundle?) {
        if (!isCurrentSession(sessionId)) return
        recognitionInProgress = false
        consecutiveErrors = 0
        consecutiveSpokenNoMatches = 0
        lastPartialResults = null
        val recognizedValues =
          results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        if (!recognizedValues.isNullOrEmpty()) {
          getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
            .edit()
            .putInt(PREFERENCE_RECOGNITION_LANGUAGE_INDEX, recognitionLanguageIndex)
            .apply()
        }
        Log.i(TAG, "Service-owned recognition delivered results session=$sessionId")
        sendSpeechEvent(
          EVENT_RESULTS,
          recognizedValues,
        )
        // Reuse the healthy recognizer. Recreating it after every phrase can
        // disconnect Google's speech service while the previous request closes.
        scheduleRecognition(delayMillis = 180L, recreate = false)
      }

      override fun onPartialResults(partialResults: Bundle?) {
        if (!isCurrentSession(sessionId)) return
        lastPartialResults =
          partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        Log.d(TAG, "Service-owned recognition delivered partial results session=$sessionId")
        sendSpeechEvent(
          EVENT_PARTIAL_RESULTS,
          lastPartialResults,
        )
      }

      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

  private fun createRecognitionIntent(): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(
        RecognizerIntent.EXTRA_LANGUAGE,
        RECOGNITION_LANGUAGES[recognitionLanguageIndex],
      )
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      // These are hints (recognition providers can choose their own limits),
      // but supported providers keep a listening session open long enough for
      // natural pauses instead of reporting a timeout immediately.
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L)
      // The Pixel reports that its on-device SODA pack does not support
      // es-CO. Explicitly allow Google's network recognizer instead of ending
      // every PiP phrase with ERROR_NO_MATCH.
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
    }

  private fun sendSpeechEvent(
    event: String,
    values: ArrayList<String>? = null,
    error: String? = null,
  ) {
    PictureInPictureModule.emitSpeechEvent(event, values, error)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Escucha continua de VOZUAL",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Mantiene activo el micrófono de VOZUAL durante la traducción."
      },
    )
  }

  companion object {
    private const val TAG = "VozualPipSpeech"
    @Volatile
    private var activeService: WeakReference<VoiceListeningService>? = null

    fun finishCurrentPhrase(): Boolean {
      val service = activeService?.get() ?: return false
      service.finishPhrase()
      return true
    }

    fun hasReadyRecognition(): Boolean =
      activeService?.get()?.hasReachedReadyState == true
    const val ACTION_SPEECH_EVENT = "com.manospeak.VOZUAL_SPEECH_EVENT"
    const val EXTRA_EVENT = "event"
    const val EXTRA_VALUES = "values"
    const val EXTRA_ERROR = "error"
    const val EVENT_START = "start"
    const val EVENT_PARTIAL_RESULTS = "partialResults"
    const val EVENT_RESULTS = "results"
    const val EVENT_END = "end"
    const val EVENT_ERROR = "error"

    private const val CHANNEL_ID = "vozual_voice_listening"
    private const val NOTIFICATION_ID = 2701
    private const val INITIAL_HANDOFF_DELAY_MILLIS = 350L
    private const val PREFERENCES_NAME = "vozual_voice_listening"
    private const val PREFERENCE_RECOGNITION_LANGUAGE_INDEX = "recognition_language_index"
    // The device log confirmed that Google's network recognizer returned
    // complete Spanish results with this locale. A successful result is then
    // remembered, so this is only the first-run fallback.
    private const val DEFAULT_RECOGNITION_LANGUAGE_INDEX = 2
    private val RECOGNITION_LANGUAGES = arrayOf("es-CO", "es-ES", "es-MX")
  }
}
