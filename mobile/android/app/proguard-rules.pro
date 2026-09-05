# VOZUAL-specific release rules. Dependencies provide their own consumer rules;
# keep only native entry points that are instantiated from JNI or the manifest.
-keep class com.androsja.vozual.MediaPipeFrameProcessorPlugin { *; }
-keep class com.androsja.vozual.VoiceListeningService { *; }
-keep class com.androsja.vozual.PipActionReceiver { *; }
