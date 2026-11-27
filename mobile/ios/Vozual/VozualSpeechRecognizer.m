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
@property(nonatomic, assign) BOOL starting;
@property(nonatomic, assign) BOOL interrupted;
@property(nonatomic, assign) BOOL restartScheduled;
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, assign) NSInteger generation;
@property(nonatomic, copy) NSArray<NSString *> *contextualStrings;
@end

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
    _audioEngine = [[AVAudioEngine alloc] init];
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self
               selector:@selector(handleAudioInterruption:)
                   name:AVAudioSessionInterruptionNotification
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

- (void)authorizeWithCompletion:(void (^)(NSError *error))completion
{
  [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        completion([self errorWithCode:status message:@"El reconocimiento de voz no está autorizado."]);
        return;
      }
      AVAudioSession *session = [AVAudioSession sharedInstance];
      AVAudioSessionRecordPermission permission = session.recordPermission;
      if (permission == AVAudioSessionRecordPermissionGranted) {
        completion(nil);
        return;
      }
      if (permission == AVAudioSessionRecordPermissionDenied) {
        completion([self errorWithCode:401 message:@"El micrófono no está autorizado."]);
        return;
      }
      [session requestRecordPermission:^(BOOL granted) {
        dispatch_async(dispatch_get_main_queue(), ^{
          completion(granted ? nil : [self errorWithCode:401 message:@"El micrófono no está autorizado."]);
        });
      }];
    });
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

  if (self.audioEngine.isRunning && self.recognitionTask != nil) {
    resolve(@YES);
    return;
  }

  [self authorizeWithCompletion:^(NSError *error) {
    if (error != nil) {
      self.desiredListening = NO;
      reject(@"SPEECH_PERMISSION", error.localizedDescription, error);
      return;
    }
    NSError *startError = nil;
    BOOL started = [self startRecognitionSession:&startError];
    if (!started) {
      self.desiredListening = NO;
      reject(@"SPEECH_START", startError.localizedDescription, startError);
      return;
    }
    resolve(@YES);
  }];
}

RCT_REMAP_METHOD(stop,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  self.desiredListening = NO;
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
  BOOL active = self.desiredListening && self.audioEngine.isRunning && self.recognitionTask != nil;
  resolve(@(active));
}

- (BOOL)startRecognitionSession:(NSError **)error
{
  if (!self.desiredListening || self.starting || self.interrupted) {
    if (error != NULL) {
      *error = [self errorWithCode:409 message:@"La sesión de voz no está disponible todavía."];
    }
    return NO;
  }

  self.starting = YES;
  self.restartScheduled = NO;
  [self stopResourcesAndDeactivateAudio:NO];
  self.generation += 1;
  NSInteger sessionGeneration = self.generation;

  NSLocale *locale = [NSLocale localeWithLocaleIdentifier:self.localeIdentifier];
  self.speechRecognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
  self.speechRecognizer.delegate = self;
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

  AVAudioSession *audioSession = [AVAudioSession sharedInstance];
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
  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  AVAudioFormat *format = [inputNode inputFormatForBus:0];
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
        [self.recognitionRequest appendAudioPCMBuffer:buffer];
      }
    }];
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
  BOOL shouldContinue = self.desiredListening && !self.phraseMode;
  if (self.phraseMode) {
    self.desiredListening = NO;
  }
  [self stopResourcesAndDeactivateAudio:!shouldContinue];
  if (error != nil) {
    NSLog(@"[VOZUAL_IOS_ASR] session ended with error %ld: %@", (long)error.code, error.localizedDescription);
    [self emit:VozualSpeechErrorEvent
          body:@{@"error": @{ @"code": @(error.code), @"message": error.localizedDescription ?: @"" }}];
  }
  [self emit:VozualSpeechEndEvent body:@{@"willRestart": @(shouldContinue)}];
  if (shouldContinue) {
    [self scheduleRestartAfter:error == nil ? 0.12 : 0.28];
  }
}

- (void)scheduleRestartAfter:(NSTimeInterval)delay
{
  if (!self.desiredListening || self.phraseMode || self.interrupted || self.restartScheduled) {
    return;
  }
  self.restartScheduled = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    self.restartScheduled = NO;
    if (!self.desiredListening || self.phraseMode || self.interrupted || self.starting || self.audioEngine.isRunning) {
      return;
    }
    NSError *restartError = nil;
    if (![self startRecognitionSession:&restartError]) {
      NSLog(@"[VOZUAL_IOS_ASR] restart failed: %@", restartError.localizedDescription);
      self.desiredListening = NO;
      [self emit:VozualSpeechErrorEvent
            body:@{@"error": @{ @"code": @(restartError.code), @"message": restartError.localizedDescription ?: @"" }}];
      [self emit:VozualSpeechEndEvent body:@{@"willRestart": @NO, @"reason": @"restart-failed"}];
    }
  });
}

- (void)schedulePreventiveRotationForGeneration:(NSInteger)sessionGeneration
{
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(48.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (!self.desiredListening || self.phraseMode || self.interrupted || sessionGeneration != self.generation) {
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

  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  @try {
    [inputNode removeTapOnBus:0];
  } @catch (__unused NSException *exception) {
  }
  if (self.audioEngine.isRunning) {
    [self.audioEngine stop];
  }
  [self.audioEngine reset];
  self.audioEngine = nil;
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
    if (self.desiredListening) {
      [self stopResourcesAndDeactivateAudio:NO];
      [self emit:VozualSpeechEndEvent body:@{@"willRestart": @YES, @"reason": @"interruption"}];
    }
    return;
  }
  self.interrupted = NO;
  if (self.desiredListening) {
    [self scheduleRestartAfter:0.12];
  }
}

- (void)handleMediaServicesReset:(NSNotification *)notification
{
  if (!self.desiredListening) {
    return;
  }
  [self stopResourcesAndDeactivateAudio:NO];
  [self scheduleRestartAfter:0.25];
}

- (void)handleApplicationDidBecomeActive:(NSNotification *)notification
{
  if (self.desiredListening && !self.audioEngine.isRunning && !self.interrupted) {
    [self scheduleRestartAfter:0.08];
  }
}

- (void)speechRecognizer:(SFSpeechRecognizer *)speechRecognizer availabilityDidChange:(BOOL)available
{
  if (available && self.desiredListening && !self.audioEngine.isRunning) {
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
