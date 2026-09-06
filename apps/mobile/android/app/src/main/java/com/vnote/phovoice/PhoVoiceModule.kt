package com.vnote.phovoice

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.*

class PhoVoiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "PhoVoiceModule"
        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    }

    private var recognizer: OnlineRecognizer? = null
    private var stream: OnlineStream? = null
    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    private var isRecording = false

    private var currentTranscript = ""
    private var recordingStartTime = 0L

    override fun getName(): String {
        return "PhoVoiceModule"
    }

    /**
     * Khoi tao mo hinh PhoVoice Sherpa-ONNX tu Assets
     */
    private fun initModelIfNeeded(): Boolean {
        if (recognizer != null) return true

        try {
            val assetManager = reactContext.assets

            // Kiem tra mo hinh PhoVoice Zipformer 30M Streaming trong assets
            val modelDir = "phovoice"
            val tokens = "$modelDir/tokens.txt"
            val encoder = "$modelDir/encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"
            val decoder = "$modelDir/decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"
            val joiner = "$modelDir/joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"

            val config = OnlineRecognizerConfig(
                featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
                modelConfig = OnlineModelConfig(
                    transducer = OnlineTransducerModelConfig(
                        encoder = encoder,
                        decoder = decoder,
                        joiner = joiner,
                    ),
                    tokens = tokens,
                    numThreads = 2,
                    provider = "cpu",
                ),
            )

            recognizer = OnlineRecognizer(assetManager = assetManager, config = config)
            Log.i(TAG, "PhoVoice Sherpa-ONNX model initialized successfully.")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize PhoVoice Sherpa-ONNX model: ${e.message}", e)
            return false
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = Arguments.createMap().apply {
            putBoolean("isLoaded", value = (recognizer != null))
            putString("modelName", "PhoVoice Zipformer 30M Streaming (Vietnamese)")
            putString("engine", "Sherpa-ONNX Native Android Engine")
            putBoolean("isOffline", value = true)
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun startRecording(promise: Promise) {
        if (isRecording) {
            val isAlreadyRecording = true
            promise.resolve(isAlreadyRecording)
            return
        }

        try {
            if (ContextCompat.checkSelfPermission(
                    reactContext,
                    Manifest.permission.RECORD_AUDIO,
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                promise.reject("PERMISSION_DENIED", "Quyen truy cap Micro (RECORD_AUDIO) chua duoc cap.")
                return
            }

            initModelIfNeeded()

            val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize * 2,
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                promise.reject("AUDIO_RECORD_ERROR", "Khong the khoi tao AudioRecord")
                return
            }

            stream = recognizer?.createStream()
            currentTranscript = ""
            recordingStartTime = System.currentTimeMillis()
            isRecording = true
            audioRecord?.startRecording()

            recordingThread = Thread(
                {
                    val buffer = ShortArray(bufferSize)
                    val floatBuffer = FloatArray(bufferSize)

                    while (isRecording) {
                        val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                        if (read > 0) {
                            for (i in 0 until read) {
                                floatBuffer[i] = buffer[i] / 32768.0f
                            }

                            val st = stream
                            val rec = recognizer
                            if ((st != null) && (rec != null)) {
                                st.acceptWaveform(floatBuffer.copyOfRange(0, read), SAMPLE_RATE)
                                while (rec.isReady(st)) {
                                    rec.decode(st)
                                }

                                val text = rec.getResult(st).text.trim()
                                if ((text.isNotEmpty()) && (text != currentTranscript)) {
                                    currentTranscript = text
                                    sendEvent(
                                        "PhoVoiceTranscription",
                                        Arguments.createMap().apply {
                                            putString("text", currentTranscript)
                                            putBoolean("isFinal", value = false)
                                            putDouble("timestamp", System.currentTimeMillis().toDouble())
                                        },
                                    )
                                }
                            }
                        }
                    }
                },
                "PhoVoiceRecordingThread",
            )

            recordingThread?.start()
            val startSuccess = true
            promise.resolve(startSuccess)
        } catch (e: Exception) {
            Log.e(TAG, "startRecording error: ${e.message}", e)
            promise.reject("RECORD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        if (!isRecording) {
            promise.resolve(
                Arguments.createMap().apply {
                    putString("text", currentTranscript)
                    putDouble("durationMs", 0.0)
                    putBoolean("success", value = true)
                },
            )
            return
        }

        try {
            isRecording = false
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null

            recordingThread?.join(1000)
            recordingThread = null

            val duration = System.currentTimeMillis() - recordingStartTime

            // Final decode
            val st = stream
            val rec = recognizer
            if ((st != null) && (rec != null)) {
                while (rec.isReady(st)) {
                    rec.decode(st)
                }
                currentTranscript = rec.getResult(st).text.trim()
                st.release()
                stream = null
            }

            sendEvent(
                "PhoVoiceTranscription",
                Arguments.createMap().apply {
                    putString("text", currentTranscript)
                    putBoolean("isFinal", value = true)
                    putDouble("timestamp", System.currentTimeMillis().toDouble())
                },
            )

            promise.resolve(
                Arguments.createMap().apply {
                    putString("text", currentTranscript)
                    putDouble("durationMs", duration.toDouble())
                    putBoolean("success", value = true)
                },
            )
        } catch (e: Exception) {
            Log.e(TAG, "stopRecording error: ${e.message}", e)
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
        // Keep: Required for RN built-in Event Emitter Calls.
    }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {
        // Keep: Required for RN built-in Event Emitter Calls.
    }

    @Suppress("SameParameterValue")
    private fun sendEvent(eventName: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
