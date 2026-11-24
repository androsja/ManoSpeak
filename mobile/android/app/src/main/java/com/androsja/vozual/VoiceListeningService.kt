package com.androsja.vozual

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean

/** Owns local Sherpa-ONNX ASR while VOZUAL listens in Home or PiP. */
class VoiceListeningService : Service() {

  @Volatile private var destroyed = false
  @Volatile private var hasReachedReadyState = false
  @Volatile private var finishRequested = false
  private val stopRequested = AtomicBoolean(false)
  private var captureThread: Thread? = null
  private var audioRecord: AudioRecord? = null
  private var recognizer: OfflineRecognizer? = null
  private var vad: Vad? = null
  private val recognizedSegments = mutableListOf<String>()

  override fun onCreate() {
    super.onCreate()
    activeService = WeakReference(this)
    createNotificationChannel()
    val stopIntent = Intent(this, VoiceListeningService::class.java).apply {
      action = ACTION_STOP_LISTENING
    }
    val stopPendingIntent = PendingIntent.getService(
      this,
      STOP_REQUEST_CODE,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("VOZUAL está escuchando")
      .setContentText("El reconocimiento se realiza localmente en este teléfono.")
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .addAction(android.R.drawable.ic_media_pause, "Detener", stopPendingIntent)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
      notification.setContentIntent(PendingIntent.getActivity(
        this,
        OPEN_APP_REQUEST_CODE,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      ))
    }
    startForeground(NOTIFICATION_ID, notification.build())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_LISTENING) {
      sendSpeechEvent(EVENT_STOPPED)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!hasMicrophonePermission()) {
      sendSpeechEvent(EVENT_ERROR, error = ERROR_MICROPHONE_PERMISSION_DENIED)
      stopSelf()
      return START_NOT_STICKY
    }
    if (!hasModelFiles(this)) {
      Log.w(TAG, "Sherpa Spanish model files are missing")
      sendSpeechEvent(EVENT_ERROR, error = ERROR_MODEL_MISSING)
      stopSelf()
      return START_NOT_STICKY
    }
    if (captureThread == null) startSherpaCapture()
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    destroyed = true
    stopRequested.set(true)
    hasReachedReadyState = false
    try { audioRecord?.stop() } catch (_: Exception) { }
    captureThread?.join(1000)
    releaseSherpa()
    sendSpeechEvent(EVENT_END)
    if (activeService?.get() === this) activeService = null
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    sendSpeechEvent(EVENT_STOPPED)
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  private fun startSherpaCapture() {
    captureThread = Thread({ runCaptureLoop() }, "VozualSherpaAudio").also { it.start() }
  }

  private fun runCaptureLoop() {
    try {
      val files = modelFiles(this)
      copyVadAssetIfNeeded(files.vad)
      val modelConfig = OfflineModelConfig(
        nemo = OfflineNemoEncDecCtcModelConfig(model = files.model.absolutePath),
        tokens = files.tokens.absolutePath,
        numThreads = MODEL_THREADS,
        provider = "cpu",
      )
      recognizer = OfflineRecognizer(
        null,
        OfflineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80, dither = 0.0f),
          modelConfig = modelConfig,
        ),
      )
      vad = Vad(
        null,
        VadModelConfig(
          sileroVadModelConfig = SileroVadModelConfig(
            model = files.vad.absolutePath,
            threshold = VAD_THRESHOLD,
            minSilenceDuration = VAD_MIN_SILENCE_SECONDS,
            minSpeechDuration = VAD_MIN_SPEECH_SECONDS,
            maxSpeechDuration = VAD_MAX_SPEECH_SECONDS,
          ),
          sampleRate = SAMPLE_RATE,
          numThreads = 1,
          provider = "cpu",
        ),
      )
      val bufferBytes = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (bufferBytes <= 0) throw IllegalStateException("No se pudo configurar el micrófono.")
      val recorder = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(bufferBytes * 2, SAMPLE_RATE / 2),
      )
      if (recorder.state != AudioRecord.STATE_INITIALIZED) {
        recorder.release()
        throw IllegalStateException("Android no pudo abrir el micrófono.")
      }
      audioRecord = recorder
      recorder.startRecording()
      hasReachedReadyState = true
      sendSpeechEvent(EVENT_START)
      Log.i(TAG, "Sherpa-ONNX local CTC recognizer started")

      val pcm = ShortArray(1024)
      while (!destroyed && !stopRequested.get()) {
        val count = recorder.read(pcm, 0, pcm.size, AudioRecord.READ_BLOCKING)
        if (count < 0) throw IllegalStateException("No se pudo leer el micrófono ($count).")
        if (count > 0) {
          val samples = FloatArray(count) { index -> pcm[index] / 32768.0f }
          vad?.acceptWaveform(samples)
          decodeAvailableSegments()
        }
        if (finishRequested) {
          vad?.flush()
          decodeAvailableSegments()
          finishCurrentPhraseResult()
          break
        }
      }
    } catch (error: SecurityException) {
      Log.e(TAG, "Microphone permission was revoked", error)
      sendSpeechEvent(EVENT_ERROR, error = ERROR_MICROPHONE_PERMISSION_DENIED)
    } catch (error: Exception) {
      Log.e(TAG, "Sherpa speech recognition failed", error)
      if (!destroyed && !stopRequested.get()) {
        sendSpeechEvent(EVENT_ERROR, error = error.message ?: "No se pudo iniciar el reconocimiento local.")
      }
    } finally {
      hasReachedReadyState = false
      try { audioRecord?.stop() } catch (_: Exception) { }
      audioRecord?.release()
      audioRecord = null
      releaseSherpa()
      captureThread = null
      if (finishRequested && !destroyed) sendSpeechEvent(EVENT_END)
    }
  }

  private fun decodeAvailableSegments() {
    val activeVad = vad ?: return
    val activeRecognizer = recognizer ?: return
    while (!activeVad.empty()) {
      val samples = activeVad.front().samples
      activeVad.pop()
      if (samples.isEmpty()) continue
      val stream = activeRecognizer.createStream()
      try {
        stream.acceptWaveform(samples, SAMPLE_RATE)
        activeRecognizer.decode(stream)
        val text = activeRecognizer.getResult(stream).text.trim()
        if (text.isNotEmpty()) {
          recognizedSegments.add(text)
          val joined = recognizedSegments.joinToString(" ")
          if (listeningMode == MODE_CONTINUOUS) {
            sendSpeechEvent(EVENT_RESULTS, arrayListOf(text))
            recognizedSegments.clear()
          } else {
            sendSpeechEvent(EVENT_PARTIAL_RESULTS, arrayListOf(joined))
          }
        }
      } finally {
        stream.release()
      }
    }
  }

  private fun finishCurrentPhraseResult() {
    val phrase = recognizedSegments.joinToString(" ").trim()
    if (phrase.isNotEmpty()) sendSpeechEvent(EVENT_RESULTS, arrayListOf(phrase))
    recognizedSegments.clear()
  }

  private fun releaseSherpa() {
    try { vad?.release() } catch (_: Exception) { }
    vad = null
    try { recognizer?.release() } catch (_: Exception) { }
    recognizer = null
  }

  private fun copyVadAssetIfNeeded(target: File) {
    if (target.isFile && target.length() > 0) return
    target.parentFile?.mkdirs()
    assets.open("sherpa/silero_vad.onnx").use { input ->
      FileOutputStream(target).use { output -> input.copyTo(output) }
    }
  }

  private fun hasMicrophonePermission(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun sendSpeechEvent(event: String, values: ArrayList<String>? = null, error: String? = null) {
    PictureInPictureModule.emitSpeechEvent(event, values, error)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Escucha continua de VOZUAL", NotificationManager.IMPORTANCE_LOW)
        .apply { description = "Mantiene activo el micrófono de VOZUAL durante la traducción." },
    )
  }

  companion object {
    private const val TAG = "VozualSherpaAsr"
    private const val SAMPLE_RATE = 16000
    private const val MODEL_THREADS = 4
    private const val VAD_THRESHOLD = 0.5f
    private const val VAD_MIN_SILENCE_SECONDS = 0.35f
    private const val VAD_MIN_SPEECH_SECONDS = 0.15f
    private const val VAD_MAX_SPEECH_SECONDS = 5.0f
    private const val MODE_CONTINUOUS = "continuous"
    private const val CHANNEL_ID = "vozual_voice_listening"
    private const val NOTIFICATION_ID = 2701
    private const val STOP_REQUEST_CODE = 2702
    private const val OPEN_APP_REQUEST_CODE = 2703
    const val ACTION_SPEECH_EVENT = "com.androsja.vozual.VOZUAL_SPEECH_EVENT"
    const val EXTRA_EVENT = "event"
    const val EXTRA_VALUES = "values"
    const val EXTRA_ERROR = "error"
    const val EVENT_START = "start"
    const val EVENT_PARTIAL_RESULTS = "partialResults"
    const val EVENT_RESULTS = "results"
    const val EVENT_END = "end"
    const val EVENT_ERROR = "error"
    const val EVENT_STOPPED = "stopped"
    const val ACTION_STOP_LISTENING = "com.androsja.vozual.STOP_VOICE_LISTENING"
    const val ERROR_MICROPHONE_PERMISSION_DENIED = "microphone_permission_denied"
    const val ERROR_MODEL_MISSING = "sherpa_model_missing"

    @Volatile private var activeService: WeakReference<VoiceListeningService>? = null
    @Volatile private var listeningMode: String = "phrase"

    fun setListeningMode(mode: String) { listeningMode = mode }
    fun finishCurrentPhrase(): Boolean {
      val service = activeService?.get() ?: return false
      if (service.destroyed || !service.hasReachedReadyState) return false
      service.finishRequested = true
      return true
    }
    fun hasReadyRecognition(): Boolean = activeService?.get()?.hasReachedReadyState == true
    fun isActive(): Boolean = activeService?.get()?.destroyed == false
    fun hasModelFiles(context: android.content.Context): Boolean {
      val files = modelFiles(context)
      return files.model.isFile && files.tokens.isFile && files.model.length() > 0 && files.tokens.length() > 0
    }
    private data class ModelFiles(val model: File, val tokens: File, val vad: File)
    private fun modelFiles(context: android.content.Context): ModelFiles {
      val directory = File(context.getExternalFilesDir(null) ?: context.filesDir, "sherpa-es")
      return ModelFiles(
        File(directory, "model.onnx"),
        File(directory, "tokens.txt"),
        File(context.filesDir, "sherpa/silero_vad.onnx"),
      )
    }
  }
}
