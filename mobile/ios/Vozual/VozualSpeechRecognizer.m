#import "VozualSpeechRecognizer.h"

#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>
#import <UIKit/UIKit.h>

static NSString *const VozualSpeechStartEvent = @"onVozualIosSpeechStart";
static NSString *const VozualSpeechPartialEvent = @"onVozualIosSpeechPartialResults";
static NSString *const VozualSpeechResultsEvent = @"onVozualIosSpeechResults";
static NSString *const VozualSpeechErrorEvent = @"onVozualIosSpeechError";
static NSString *const VozualSpeechEndEvent = @"onVozualIosSpeechEnd";

@interface VozualSpeechRecognizer () <SFSpeechRecognizerDelegate>
@property(nonatomic, strong) SFSpeechRecognizer *speechRecognizer;
@property(nonatomic, strong) SFSpeechAudioBufferRecognitionRequest *recognitionRequest;
@property(nonatomic, strong) SFSpeechRecognitionTask *recognitionTask;
@property(nonatomic, strong) AVAudioEngine *audioEngine;
@property(nonatomic, copy) NSString *localeIdentifier;
@property(nonatomic, assign) BOOL desiredListening;
@property(nonatomic, assign) BOOL phraseMode;
@property(nonatomic, assign) BOOL authorizing;
@property(nonatomic, assign) BOOL starting;
@property(nonatomic, assign) BOOL interrupted;
@property(nonatomic, assign) BOOL restartScheduled;
@property(nonatomic, assign) BOOL audioTapInstalled;
@property(nonatomic, assign) BOOL sessionReceivedTranscript;
@property(nonatomic, assign) BOOL loggedFirstAudioBuffer;
@property(nonatomic, assign) BOOL loggedVoiceEnergy;
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, assign) NSInteger generation;
@property(nonatomic, assign) NSInteger consecutiveErrorCount;
@property(nonatomic, copy) NSArray<NSString *> *contextualStrings;
@end

static BOOL VozualIsBenignSilenceOrCancelError(NSError *error)
{
  if (error == nil) {
    return NO;
  }
  NSInteger code = error.code;
  // 1110 = no speech detected, 203 = empty audio/retry, 216/301 = cancelled request.
  return code == 1110 || code == 203 || code == 216 || code == 301;
}

@implementation VozualSpeechRecognizer

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    _localeIdentifier = @"es-CO";
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self
               selector:@selector(handleAudioInterruption:)
                   name:AVAudioSessionInterruptionNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleAudioRouteChange:)
                   name:AVAudioSessionRouteChangeNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleMediaServicesReset:)
                   name:AVAudioSessionMediaServicesWereResetNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleApplicationDidBecomeActive:)
                   name:UIApplicationDidBecomeActiveNotification
                 object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [self stopResourcesAndDeactivateAudio:YES];
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[
    VozualSpeechStartEvent,
    VozualSpeechPartialEvent,
    VozualSpeechResultsEvent,
    VozualSpeechErrorEvent,
    VozualSpeechEndEvent,
  ];
}

- (void)startObserving
{
  self.hasListeners = YES;
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

- (void)emit:(NSString *)event body:(NSDictionary *)body
{
  if (!self.hasListeners) {
    return;
  }
  [self sendEventWithName:event body:body ?: @{}];
}

- (NSError *)errorWithCode:(NSInteger)code message:(NSString *)message
{
  return [NSError errorWithDomain:@"com.androsja.vozual.speech"
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey: message}];
}

- (void)authorizeWithCompletion:(void (^)(NSError *error, BOOL justGranted))completion
{
  SFSpeechRecognizerAuthorizationStatus priorSpeechStatus = [SFSpeechRecognizer authorizationStatus];
  AVAudioSession *initialSession = [AVAudioSession sharedInstance];
  AVAudioSessionRecordPermission priorMicPermission = initialSession.recordPermission;

  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    dispatch_async(dispatch_get_main_queue(), ^{
      NSLog(@"[VOZUAL_IOS_ASR] speech auth status=%ld (prior=%ld)", (long)status, (long)priorSpeechStatus);
      if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        completion([self errorWithCode:status message:@"El reconocimiento de voz no está autorizado."], NO);
        return;
      }
      AVAudioSession *session = [AVAudioSession sharedInstance];
      AVAudioSessionRecordPermission permission = session.recordPermission;
      NSLog(@"[VOZUAL_IOS_ASR] mic recordPermission=%lu (prior=%lu)",
            (unsigned long)permission, (unsigned long)priorMicPermission);
      if (permission == AVAudioSessionRecordPermissionGranted) {
        BOOL speechJustGranted = priorSpeechStatus != SFSpeechRecognizerAuthorizationStatusAuthorized;
        completion(nil, speechJustGranted);
        return;
      }
      if (permission == AVAudioSessionRecordPermissionDenied) {
        completion([self errorWithCode:401 message:@"El micrófono no está autorizado."], NO);
        return;
      }
      [session requestRecordPermission:^(BOOL granted) {
        dispatch_async(dispatch_get_main_queue(), ^{
          NSLog(@"[VOZUAL_IOS_ASR] mic requestRecordPermission granted=%d", granted);
          if (!granted) {
            completion([self errorWithCode:401 message:@"El micrófono no está autorizado."], NO);
            return;
          }
          completion(nil, YES);
        });
      }];
    });
  }];
}

- (void)warmUpAudioSessionAfterFirstGrant
{
  // Replicate a full PlayAndRecord activation/deactivation cycle once TCC grants
  // permissions so the very next start receives live hardware mic audio.
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionCategoryOptions options =
    AVAudioSessionCategoryOptionMixWithOthers |
    AVAudioSessionCategoryOptionAllowBluetooth |
    AVAudioSessionCategoryOptionDefaultToSpeaker;
  NSError *sessionError = nil;
  [session setCategory:AVAudioSessionCategoryPlayAndRecord
                  mode:AVAudioSessionModeMeasurement
               options:options
                 error:&sessionError];
  if (sessionError == nil) {
    [session setPreferredIOBufferDuration:0.01 error:&sessionError];
  }
  if (sessionError == nil) {
    [session setActive:YES error:&sessionError];
  }
  [session setActive:NO
         withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
               error:nil];
  NSLog(@"[VOZUAL_IOS_ASR] audio session warm-up after permission grant error=%@",
        sessionError.localizedDescription);
}

RCT_REMAP_METHOD(getPermissionsStatus,
                 getPermissionsStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  SFSpeechRecognizerAuthorizationStatus speechStatus = [SFSpeechRecognizer authorizationStatus];
  AVAudioSessionRecordPermission micPermission = [AVAudioSession sharedInstance].recordPermission;
  if (speechStatus == SFSpeechRecognizerAuthorizationStatusAuthorized
      && micPermission == AVAudioSessionRecordPermissionGranted) {
    resolve(@"granted");
    return;
  }
  if (speechStatus == SFSpeechRecognizerAuthorizationStatusDenied
      || speechStatus == SFSpeechRecognizerAuthorizationStatusRestricted
      || micPermission == AVAudioSessionRecordPermissionDenied) {
    resolve(@"denied");
    return;
  }
  resolve(@"undetermined");
}

RCT_REMAP_METHOD(requestPermissions,
                 requestPermissionsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (self.authorizing) {
    resolve(@"undetermined");
    return;
  }
  self.authorizing = YES;
  [self authorizeWithCompletion:^(NSError *error, BOOL justGranted) {
    if (error != nil) {
      self.authorizing = NO;
      resolve(@"denied");
      return;
    }
    if (justGranted) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.35 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self warmUpAudioSessionAfterFirstGrant];
        self.authorizing = NO;
        resolve(@"granted");
      });
      return;
    }
    self.authorizing = NO;
    resolve(@"granted");
  }];
}

RCT_REMAP_METHOD(start,
                 startWithLocale:(NSString *)locale
                 mode:(NSString *)mode
                 contextualStrings:(NSArray *)contextualStrings
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  self.localeIdentifier = locale.length > 0 ? locale : @"es-CO";
  self.phraseMode = [mode isEqualToString:@"phrase"];
  NSMutableArray<NSString *> *phrases = [NSMutableArray array];
  NSMutableSet<NSString *> *seenPhrases = [NSMutableSet set];
  for (id value in contextualStrings) {
    if (![value isKindOfClass:[NSString class]]) {
      continue;
    }
    NSString *phrase = [(NSString *)value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    NSString *key = phrase.lowercaseString;
    if (phrase.length == 0 || [seenPhrases containsObject:key]) {
      continue;
    }
    [seenPhrases addObject:key];
    [phrases addObject:phrase];
    if (phrases.count >= 100) {
      break;
    }
  }
  self.contextualStrings = phrases;
  self.desiredListening = YES;
  self.interrupted = NO;
  self.consecutiveErrorCount = 0;

  if (self.audioEngine.isRunning && self.recognitionTask != nil) {
    resolve(@YES);
    return;
  }
  if (self.authorizing || self.starting) {
    reject(@"SPEECH_BUSY", @"La autorización de voz aún está en curso.", nil);
    return;
  }

  // Block foreground/availability restarts while system permission dialogs are on screen.
  self.authorizing = YES;
  NSLog(@"[VOZUAL_IOS_ASR] start called locale=%@ mode=%@ hints=%lu",
        self.localeIdentifier, mode, (unsigned long)phrases.count);
  [self authorizeWithCompletion:^(NSError *error, BOOL justGranted) {
    if (error != nil) {
      self.authorizing = NO;
      NSLog(@"[VOZUAL_IOS_ASR] authorize failed code=%ld: %@", (long)error.code, error.localizedDescription);
      self.desiredListening = NO;
      reject(@"SPEECH_PERMISSION", error.localizedDescription, error);
      return;
    }
    if (!self.desiredListening) {
      self.authorizing = NO;
      NSLog(@"[VOZUAL_IOS_ASR] stopped while authorizing");
      reject(@"SPEECH_STOPPED", @"La escucha se detuvo antes de iniciar.", nil);
      return;
    }

    void (^beginSession)(void) = ^{
      self.authorizing = NO;
      if (!self.desiredListening) {
        reject(@"SPEECH_STOPPED", @"La escucha se detuvo antes de iniciar.", nil);
        return;
      }
      self.interrupted = NO;
      NSError *startError = nil;
      BOOL started = [self startRecognitionSession:&startError];
      if (!started) {
        NSLog(@"[VOZUAL_IOS_ASR] initial startRecognitionSession failed code=%ld: %@",
              (long)startError.code, startError.localizedDescription);
        self.desiredListening = NO;
        reject(@"SPEECH_START", startError.localizedDescription, startError);
        return;
      }
      resolve(@YES);
    };

    if (justGranted) {
      // Allow iOS TCC, CoreAudio, and on-device Speech XPC to finish activating
      // after first-time permission prompts before opening the first audio session.
      NSLog(@"[VOZUAL_IOS_ASR] permissions just granted; settling 0.45s before starting audio");
      [[AVAudioSession sharedInstance] setActive:NO error:nil];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.45 * NSEC_PER_SEC)), dispatch_get_main_queue(), beginSession);
    } else {
      beginSession();
    }
  }];
}

RCT_REMAP_METHOD(stop,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  self.desiredListening = NO;
  self.authorizing = NO;
  self.restartScheduled = NO;
  [self stopResourcesAndDeactivateAudio:YES];
  [self emit:VozualSpeechEndEvent body:@{@"reason": @"stopped"}];
  resolve(@YES);
}

RCT_REMAP_METHOD(finishPhrase,
                 finishPhraseWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (!self.phraseMode || self.recognitionTask == nil) {
    resolve(@NO);
    return;
  }
  [self.recognitionRequest endAudio];
  [self.recognitionTask finish];
  resolve(@YES);
}

RCT_REMAP_METHOD(isListening,
                 isListeningWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  BOOL active = self.desiredListening && (
    self.authorizing ||
    self.starting ||
    self.restartScheduled ||
    (self.audioEngine.isRunning && self.recognitionTask != nil)
  );
  resolve(@(active));
}

- (BOOL)startRecognitionSession:(NSError **)error
{
  if (!self.desiredListening || self.starting || self.authorizing || self.interrupted) {
    if (error != NULL) {
      *error = [self errorWithCode:409 message:@"La sesión de voz no está disponible todavía."];
    }
    return NO;
  }

  AVAudioSession *audioSession = [AVAudioSession sharedInstance];
  if ([SFSpeechRecognizer authorizationStatus] != SFSpeechRecognizerAuthorizationStatusAuthorized
      || audioSession.recordPermission != AVAudioSessionRecordPermissionGranted) {
    if (error != NULL) {
      *error = [self errorWithCode:401 message:@"El micrófono o reconocimiento de voz no está autorizado."];
    }
    return NO;
  }

  self.starting = YES;
  self.restartScheduled = NO;
  self.sessionReceivedTranscript = NO;
  self.loggedFirstAudioBuffer = NO;
  self.loggedVoiceEnergy = NO;
  [self stopResourcesAndDeactivateAudio:NO];
  self.generation += 1;
  NSInteger sessionGeneration = self.generation;

  NSLocale *locale = [NSLocale localeWithLocaleIdentifier:self.localeIdentifier];
  self.speechRecognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
  self.speechRecognizer.delegate = self;
  NSLog(@"[VOZUAL_IOS_ASR] session %ld check available=%d onDevice=%d",
        (long)sessionGeneration,
        self.speechRecognizer.isAvailable,
        (int)self.speechRecognizer.supportsOnDeviceRecognition);
  if (self.speechRecognizer == nil || !self.speechRecognizer.isAvailable) {
    self.starting = NO;
    if (error != NULL) {
      *error = [self errorWithCode:503 message:@"El reconocedor de voz de iOS no está disponible."];
    }
    return NO;
  }
  if (@available(iOS 13.0, *)) {
    if (!self.speechRecognizer.supportsOnDeviceRecognition) {
      self.starting = NO;
      if (error != NULL) {
        *error = [self errorWithCode:412
                             message:@"El reconocimiento local de español (Colombia) no está disponible. Descarga el idioma en los ajustes del dispositivo."];
      }
      return NO;
    }
  } else {
    self.starting = NO;
    if (error != NULL) {
      *error = [self errorWithCode:412
                           message:@"Este iPhone no admite reconocimiento de voz local para VOZUAL."];
    }
    return NO;
  }

  AVAudioSessionCategoryOptions options =
    AVAudioSessionCategoryOptionMixWithOthers |
    AVAudioSessionCategoryOptionAllowBluetooth |
    AVAudioSessionCategoryOptionDefaultToSpeaker;
  NSError *audioError = nil;
  [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                       mode:AVAudioSessionModeMeasurement
                    options:options
                      error:&audioError];
  if (audioError == nil) {
    [audioSession setPreferredIOBufferDuration:0.01 error:&audioError];
  }
  if (audioError == nil) {
    [audioSession setActive:YES error:&audioError];
  }
  if (audioError != nil) {
    self.starting = NO;
    if (error != NULL) {
      *error = audioError;
    }
    return NO;
  }

  self.recognitionRequest = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
  self.recognitionRequest.requiresOnDeviceRecognition = YES;
  self.recognitionRequest.shouldReportPartialResults = YES;
  self.recognitionRequest.contextualStrings = self.contextualStrings;
  self.recognitionRequest.taskHint = SFSpeechRecognitionTaskHintDictation;
  self.audioEngine = [[AVAudioEngine alloc] init];
  self.audioTapInstalled = NO;
  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  AVAudioFormat *format = [inputNode inputFormatForBus:0];
  NSLog(@"[VOZUAL_IOS_ASR] session %ld format sampleRate=%.0f channels=%u",
        (long)sessionGeneration, format.sampleRate, (unsigned int)format.channelCount);
  if (format.sampleRate <= 0 || format.channelCount == 0) {
    self.starting = NO;
    if (error != NULL) {
      *error = [self errorWithCode:422 message:@"iOS no entregó un formato válido para el micrófono."];
    }
    [self stopResourcesAndDeactivateAudio:YES];
    return NO;
  }

  __weak typeof(self) weakSelf = self;
  self.recognitionTask = [self.speechRecognizer
    recognitionTaskWithRequest:self.recognitionRequest
    resultHandler:^(SFSpeechRecognitionResult *result, NSError *recognitionError) {
      dispatch_async(dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) self = weakSelf;
        if (self == nil || sessionGeneration != self.generation) {
          return;
        }
        if (result != nil) {
          NSString *text = result.bestTranscription.formattedString ?: @"";
          NSNumber *confidence = nil;
          NSArray<SFTranscriptionSegment *> *segments = result.bestTranscription.segments;
          if (segments.count > 0) {
            float total = 0;
            for (SFTranscriptionSegment *segment in segments) {
              total += segment.confidence;
            }
            confidence = @(total / segments.count);
          }
          // Dictation can format separate spoken numbers into one string.
          // Offer the original token boundaries to the installed-sign matcher.
          NSArray<NSString *> *tokens = [segments valueForKey:@"substring"];
          NSString *segmentedText = [tokens componentsJoinedByString:@" "];
          NSArray *alternatives = segmentedText.length && ![text isEqualToString:segmentedText]
            ? @[text, segmentedText] : @[text];
          NSDictionary *payload = confidence == nil
            ? @{@"value": alternatives}
            : @{@"value": alternatives, @"confidence": @[confidence]};
          if (text.length > 0) {
            if (!self.sessionReceivedTranscript) {
              NSLog(@"[VOZUAL_IOS_ASR] session %ld first transcript len=%lu",
                    (long)sessionGeneration, (unsigned long)text.length);
            }
            self.sessionReceivedTranscript = YES;
            self.consecutiveErrorCount = 0;
            [self emit:VozualSpeechPartialEvent body:payload];
          }
          if (result.isFinal) {
            if (text.length > 0) {
              [self emit:VozualSpeechResultsEvent body:payload];
            }
            [self handleTerminalSession:sessionGeneration error:nil];
            return;
          }
        }
        if (recognitionError != nil) {
          [self handleTerminalSession:sessionGeneration error:recognitionError];
        }
      });
    }];

  @try {
    [inputNode installTapOnBus:0
                    bufferSize:1024
                        format:format
                         block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
      __strong typeof(weakSelf) self = weakSelf;
      if (self != nil && sessionGeneration == self.generation && self.recognitionRequest != nil) {
        if ((!self.loggedFirstAudioBuffer || !self.loggedVoiceEnergy) && buffer.frameLength > 0) {
          float peak = 0.0f;
          if (buffer.floatChannelData != NULL && buffer.floatChannelData[0] != NULL) {
            AVAudioFrameCount frames = buffer.frameLength;
            const float *samples = buffer.floatChannelData[0];
            for (AVAudioFrameCount i = 0; i < frames; i++) {
              float v = fabsf(samples[i]);
              if (v > peak) peak = v;
            }
          }
          if (!self.loggedFirstAudioBuffer) {
            self.loggedFirstAudioBuffer = YES;
            NSLog(@"[VOZUAL_IOS_ASR] session %ld first audio buffer frames=%u peak=%.5f",
                  (long)sessionGeneration, (unsigned int)buffer.frameLength, peak);
          }
          if (!self.loggedVoiceEnergy && peak > 0.02f) {
            self.loggedVoiceEnergy = YES;
            NSLog(@"[VOZUAL_IOS_ASR] session %ld voice energy detected peak=%.5f",
                  (long)sessionGeneration, peak);
          }
        }
        [self.recognitionRequest appendAudioPCMBuffer:buffer];
      }
    }];
    self.audioTapInstalled = YES;
  } @catch (NSException *exception) {
    self.starting = NO;
    if (error != NULL) {
      *error = [self errorWithCode:500 message:exception.reason ?: @"No se pudo conectar el micrófono."];
    }
    [self stopResourcesAndDeactivateAudio:YES];
    return NO;
  }

  [self.audioEngine prepare];
  BOOL engineStarted = [self.audioEngine startAndReturnError:&audioError];
  self.starting = NO;
  if (!engineStarted || audioError != nil) {
    if (error != NULL) {
      *error = audioError ?: [self errorWithCode:500 message:@"No se pudo iniciar el motor de audio."];
    }
    [self stopResourcesAndDeactivateAudio:YES];
    return NO;
  }

  NSLog(@"[VOZUAL_IOS_ASR] session %ld started with %lu vocabulary hints",
        (long)sessionGeneration,
        (unsigned long)self.contextualStrings.count);
  [self emit:VozualSpeechStartEvent body:@{@"generation": @(sessionGeneration)}];
  [self schedulePreventiveRotationForGeneration:sessionGeneration];
  return YES;
}

- (void)handleTerminalSession:(NSInteger)sessionGeneration error:(NSError *)error
{
  if (sessionGeneration != self.generation) {
    return;
  }
  BOOL benignError = VozualIsBenignSilenceOrCancelError(error);
  if (error == nil || benignError) {
    self.consecutiveErrorCount = 0;
  } else {
    self.consecutiveErrorCount += 1;
  }
  BOOL fatalLoopError = error != nil && !benignError && !self.sessionReceivedTranscript && self.consecutiveErrorCount >= 3;
  BOOL shouldContinue = self.desiredListening && !self.phraseMode && !fatalLoopError;
  if (self.phraseMode || fatalLoopError) {
    self.desiredListening = NO;
  }
  [self stopResourcesAndDeactivateAudio:!shouldContinue];
  if (error != nil) {
    NSLog(@"[VOZUAL_IOS_ASR] session ended with error %ld (consecutive=%ld, fatal=%d): %@",
          (long)error.code,
          (long)self.consecutiveErrorCount,
          fatalLoopError,
          error.localizedDescription);
    [self emit:VozualSpeechErrorEvent
          body:@{
            @"error": @{
              @"code": @(error.code),
              @"message": error.localizedDescription ?: @"",
              @"fatal": @(fatalLoopError),
            }
          }];
  }
  [self emit:VozualSpeechEndEvent
        body:@{
          @"willRestart": @(shouldContinue),
          @"reason": fatalLoopError ? @"consecutive-errors" : @"session-end",
        }];
  if (shouldContinue) {
    NSTimeInterval delay = error == nil || benignError
      ? 0.12
      : MIN(0.45 * self.consecutiveErrorCount, 1.5);
    [self scheduleRestartAfter:delay];
  }
}

- (void)scheduleRestartAfter:(NSTimeInterval)delay
{
  if (!self.desiredListening || self.phraseMode || self.authorizing || self.interrupted || self.restartScheduled) {
    return;
  }
  self.restartScheduled = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    self.restartScheduled = NO;
    if (!self.desiredListening || self.phraseMode || self.authorizing || self.interrupted || self.starting || self.audioEngine.isRunning) {
      return;
    }
    NSError *restartError = nil;
    if (![self startRecognitionSession:&restartError]) {
      NSLog(@"[VOZUAL_IOS_ASR] restart failed: %@", restartError.localizedDescription);
      self.desiredListening = NO;
      [self emit:VozualSpeechErrorEvent
            body:@{@"error": @{ @"code": @(restartError.code), @"message": restartError.localizedDescription ?: @"", @"fatal": @YES }}];
      [self emit:VozualSpeechEndEvent body:@{@"willRestart": @NO, @"reason": @"restart-failed"}];
    }
  });
}

- (void)schedulePreventiveRotationForGeneration:(NSInteger)sessionGeneration
{
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(48.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (!self.desiredListening || self.phraseMode || self.authorizing || self.interrupted || sessionGeneration != self.generation) {
      return;
    }
    NSLog(@"[VOZUAL_IOS_ASR] rotating session %ld before the system limit", (long)sessionGeneration);
    [self stopResourcesAndDeactivateAudio:NO];
    [self emit:VozualSpeechEndEvent body:@{@"willRestart": @YES, @"reason": @"rotation"}];
    [self scheduleRestartAfter:0.08];
  });
}

- (void)stopResourcesAndDeactivateAudio:(BOOL)deactivate
{
  self.generation += 1;
  SFSpeechRecognitionTask *task = self.recognitionTask;
  self.recognitionTask = nil;
  [task cancel];
  [self.recognitionRequest endAudio];
  self.recognitionRequest = nil;

  if (self.audioEngine != nil) {
    if (self.audioTapInstalled) {
      @try {
        [self.audioEngine.inputNode removeTapOnBus:0];
      } @catch (__unused NSException *exception) {
      }
      self.audioTapInstalled = NO;
    }
    if (self.audioEngine.isRunning) {
      [self.audioEngine stop];
    }
    [self.audioEngine reset];
    self.audioEngine = nil;
  }
  self.speechRecognizer.delegate = nil;
  self.speechRecognizer = nil;
  self.starting = NO;

  if (deactivate) {
    [[AVAudioSession sharedInstance]
      setActive:NO
      withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
      error:nil];
  }
}

- (void)handleAudioInterruption:(NSNotification *)notification
{
  AVAudioSessionInterruptionType type =
    [notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
  if (type == AVAudioSessionInterruptionTypeBegan) {
    self.interrupted = YES;
    if (self.desiredListening && !self.authorizing) {
      [self stopResourcesAndDeactivateAudio:NO];
      [self emit:VozualSpeechEndEvent body:@{@"willRestart": @YES, @"reason": @"interruption"}];
    }
    return;
  }
  self.interrupted = NO;
  if (self.desiredListening && !self.authorizing) {
    [self scheduleRestartAfter:0.12];
  }
}

- (void)handleAudioRouteChange:(NSNotification *)notification
{
  if (!self.desiredListening || self.phraseMode || self.authorizing || self.starting || self.interrupted) {
    return;
  }
  AVAudioSessionRouteChangeReason reason =
    [notification.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];
  if (reason != AVAudioSessionRouteChangeReasonNewDeviceAvailable
      && reason != AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self.desiredListening || self.phraseMode || self.authorizing || self.starting || self.interrupted) {
      return;
    }
    [self stopResourcesAndDeactivateAudio:NO];
    [self scheduleRestartAfter:0.20];
  });
}

- (void)handleMediaServicesReset:(NSNotification *)notification
{
  if (!self.desiredListening || self.authorizing) {
    return;
  }
  [self stopResourcesAndDeactivateAudio:NO];
  [self scheduleRestartAfter:0.25];
}

- (void)handleApplicationDidBecomeActive:(NSNotification *)notification
{
  if (!self.desiredListening || self.authorizing) {
    return;
  }
  if (self.interrupted) {
    // Recover if iOS dropped InterruptionTypeEnded while returning from background or system UI.
    NSError *reactivateError = nil;
    if ([[AVAudioSession sharedInstance] setActive:YES error:&reactivateError]) {
      self.interrupted = NO;
    } else {
      return;
    }
  }
  if (!self.audioEngine.isRunning) {
    [self scheduleRestartAfter:0.08];
  }
}

- (void)speechRecognizer:(SFSpeechRecognizer *)speechRecognizer availabilityDidChange:(BOOL)available
{
  if (available && self.desiredListening && !self.authorizing && !self.audioEngine.isRunning) {
    [self scheduleRestartAfter:0.25];
  }
}

- (void)invalidate
{
  self.desiredListening = NO;
  [self stopResourcesAndDeactivateAudio:YES];
  [super invalidate];
}

@end
