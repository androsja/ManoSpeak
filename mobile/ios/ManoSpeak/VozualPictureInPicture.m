#import "VozualPictureInPicture.h"

#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <WebKit/WebKit.h>

static NSString *const VozualPictureInPictureChangedEvent = @"onVozualPictureInPictureChanged";
static const NSInteger VozualPictureInPictureWidth = 360;
static const NSInteger VozualPictureInPictureHeight = 640;
static const double VozualPictureInPictureFramesPerSecond = 12.0;

@interface VozualPictureInPicture ()
  <AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate>
@property(nonatomic, strong) AVPictureInPictureController *pictureInPictureController;
@property(nonatomic, strong) AVSampleBufferDisplayLayer *displayLayer;
@property(nonatomic, strong) UIView *displayHostView;
@property(nonatomic, weak) UIView *avatarView;
@property(nonatomic, weak) WKWebView *avatarWebView;
@property(nonatomic, strong) UIImage *lastValidAvatarImage;
@property(nonatomic, strong) dispatch_source_t frameTimer;
@property(nonatomic, assign) BOOL hasListeners;
@end

@implementation VozualPictureInPicture

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[VozualPictureInPictureChangedEvent];
}

- (void)startObserving
{
  self.hasListeners = YES;
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

- (void)emitPictureInPictureState:(BOOL)active
{
  if (self.hasListeners) {
    [self sendEventWithName:VozualPictureInPictureChangedEvent body:@(active)];
  }
}

- (UIWindow *)activeWindow
{
  UIWindow *fallbackWindow = nil;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateUnattached &&
        [scene isKindOfClass:[UIWindowScene class]]) {
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *window in windowScene.windows) {
        if (window.isKeyWindow) return window;
        if (fallbackWindow == nil) fallbackWindow = window;
      }
    }
  }
  return fallbackWindow;
}

- (UIView *)findAvatarViewInView:(UIView *)view
{
  if ([view.accessibilityIdentifier isEqualToString:@"vozual-avatar-webview"]) {
    return view;
  }
  for (UIView *subview in view.subviews) {
    UIView *match = [self findAvatarViewInView:subview];
    if (match != nil) return match;
  }
  return nil;
}

- (WKWebView *)findWebViewInView:(UIView *)view
{
  if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
  for (UIView *subview in view.subviews) {
    WKWebView *match = [self findWebViewInView:subview];
    if (match != nil) return match;
  }
  return nil;
}

- (BOOL)preparePictureInPicture
{
  if (@available(iOS 15.0, *)) {
    if (![AVPictureInPictureController isPictureInPictureSupported]) return NO;
    UIWindow *window = [self activeWindow];
    if (window == nil) return NO;
    UIView *avatar = [self findAvatarViewInView:window];
    if (avatar == nil) return NO;
    self.avatarView = avatar;
    self.avatarWebView = [self findWebViewInView:avatar];

    if (self.displayLayer == nil) {
      self.displayLayer = [[AVSampleBufferDisplayLayer alloc] init];
      self.displayLayer.videoGravity = AVLayerVideoGravityResizeAspect;
      self.displayLayer.backgroundColor = [UIColor colorWithRed:0.13 green:0.17 blue:0.23 alpha:1].CGColor;
    }
    if (self.displayHostView == nil) {
      self.displayHostView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 2, 2)];
      self.displayHostView.userInteractionEnabled = NO;
      self.displayHostView.alpha = 0.01;
      [window insertSubview:self.displayHostView atIndex:0];
      [self.displayHostView.layer addSublayer:self.displayLayer];
      self.displayLayer.frame = self.displayHostView.bounds;
    }
    if (self.pictureInPictureController == nil) {
      AVPictureInPictureControllerContentSource *source =
        [[AVPictureInPictureControllerContentSource alloc]
          initWithSampleBufferDisplayLayer:self.displayLayer
          playbackDelegate:self];
      self.pictureInPictureController =
        [[AVPictureInPictureController alloc] initWithContentSource:source];
      self.pictureInPictureController.delegate = self;
      self.pictureInPictureController.canStartPictureInPictureAutomaticallyFromInline = YES;
      self.pictureInPictureController.requiresLinearPlayback = YES;
    }
    [self captureAndEnqueueFrame];
    return YES;
  }
  return NO;
}

- (UIImage *)captureAvatarImage
{
  UIView *avatar = self.avatarView;
  if (avatar == nil || avatar.bounds.size.width < 1 || avatar.bounds.size.height < 1) return nil;
  CGSize outputSize = CGSizeMake(VozualPictureInPictureWidth, VozualPictureInPictureHeight);
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = YES;
  format.scale = 1;
  UIGraphicsImageRenderer *renderer =
    [[UIGraphicsImageRenderer alloc] initWithSize:outputSize format:format];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [[UIColor colorWithRed:0.13 green:0.17 blue:0.23 alpha:1] setFill];
    UIRectFill(CGRectMake(0, 0, outputSize.width, outputSize.height));
    // The in-app avatar surface is nearly square, while iOS PiP is portrait.
    // Aspect-fit made the character much smaller than Android and introduced
    // large empty bands. Crop the sides instead, keeping the signing space and
    // the character at the same apparent height as the source view.
    CGFloat scale = MAX(outputSize.width / avatar.bounds.size.width,
                        outputSize.height / avatar.bounds.size.height);
    CGFloat width = avatar.bounds.size.width * scale;
    CGFloat height = avatar.bounds.size.height * scale;
    CGRect destination = CGRectMake((outputSize.width - width) / 2,
                                    (outputSize.height - height) / 2,
                                    width,
                                    height);
    CGContextSaveGState(context.CGContext);
    CGContextTranslateCTM(context.CGContext, destination.origin.x, destination.origin.y);
    CGContextScaleCTM(context.CGContext, scale, scale);
    [avatar drawViewHierarchyInRect:avatar.bounds afterScreenUpdates:NO];
    CGContextRestoreGState(context.CGContext);
  }];
}

- (BOOL)imageContainsVisibleAvatar:(CGImageRef)image
{
  if (image == nil) return NO;
  // A backgrounded WKWebView can briefly return only its solid background
  // while the PiP window is dragged or resized. Detect that frame before it
  // replaces the last useful avatar image.
  static const size_t sampleWidth = 24;
  static const size_t sampleHeight = 40;
  uint8_t pixels[sampleWidth * sampleHeight * 4] = {0};
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(pixels,
                                                sampleWidth,
                                                sampleHeight,
                                                8,
                                                sampleWidth * 4,
                                                colorSpace,
                                                kCGBitmapByteOrder32Big |
                                                  kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(colorSpace);
  if (context == nil) return NO;
  CGContextSetInterpolationQuality(context, kCGInterpolationLow);
  CGContextDrawImage(context, CGRectMake(0, 0, sampleWidth, sampleHeight), image);
  CGContextRelease(context);

  const uint8_t *reference = pixels;
  NSInteger differentSamples = 0;
  for (size_t y = 3; y + 3 < sampleHeight; y += 2) {
    for (size_t x = 3; x + 3 < sampleWidth; x += 2) {
      const uint8_t *pixel = pixels + (y * sampleWidth + x) * 4;
      NSInteger difference = MAX(labs((long)pixel[0] - reference[0]),
                                 MAX(labs((long)pixel[1] - reference[1]),
                                     labs((long)pixel[2] - reference[2])));
      if (difference > 22 && ++differentSamples >= 10) return YES;
    }
  }
  return NO;
}

- (CVPixelBufferRef)pixelBufferFromImage:(CGImageRef)image
{
  NSDictionary *attributes = @{
    (NSString *)kCVPixelBufferCGImageCompatibilityKey: @YES,
    (NSString *)kCVPixelBufferCGBitmapContextCompatibilityKey: @YES,
    (NSString *)kCVPixelBufferIOSurfacePropertiesKey: @{},
  };
  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn result = CVPixelBufferCreate(kCFAllocatorDefault,
                                         VozualPictureInPictureWidth,
                                         VozualPictureInPictureHeight,
                                         kCVPixelFormatType_32BGRA,
                                         (__bridge CFDictionaryRef)attributes,
                                         &pixelBuffer);
  if (result != kCVReturnSuccess || pixelBuffer == NULL) return NULL;
  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(baseAddress,
                                                VozualPictureInPictureWidth,
                                                VozualPictureInPictureHeight,
                                                8,
                                                bytesPerRow,
                                                colorSpace,
                                                kCGBitmapByteOrder32Little |
                                                  kCGImageAlphaPremultipliedFirst);
  CGColorSpaceRelease(colorSpace);
  if (context == NULL) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
    return NULL;
  }
  // AVSampleBufferDisplayLayer consumes the pixel-buffer rows in display
  // order. Drawing the already-upright renderer image without an additional
  // UIKit flip avoids the inverted PiP image seen on physical iPhones.
  CGContextDrawImage(context,
                     CGRectMake(0, 0, VozualPictureInPictureWidth, VozualPictureInPictureHeight),
                     image);
  CGContextRelease(context);
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
  return pixelBuffer;
}

- (void)captureAndEnqueueFrame
{
  if (self.displayLayer == nil || self.avatarView == nil) return;
  [self.avatarWebView evaluateJavaScript:@"window.tickVozualAnimation?.(); true;"
                      completionHandler:nil];
  UIImage *capturedImage = [self captureAvatarImage];
  if (capturedImage.CGImage != nil &&
      [self imageContainsVisibleAvatar:capturedImage.CGImage]) {
    self.lastValidAvatarImage = capturedImage;
  }
  // Never enqueue a transient blank WebView capture. Reusing the last valid
  // image also gives AVKit a stable frame while SpringBoard moves the window.
  UIImage *image = self.lastValidAvatarImage;
  if (image.CGImage == nil) return;
  CVPixelBufferRef pixelBuffer = [self pixelBufferFromImage:image.CGImage];
  if (pixelBuffer == NULL) return;
  CMVideoFormatDescriptionRef formatDescription = NULL;
  OSStatus status = CMVideoFormatDescriptionCreateForImageBuffer(kCFAllocatorDefault,
                                                                  pixelBuffer,
                                                                  &formatDescription);
  if (status != noErr || formatDescription == NULL) {
    CVPixelBufferRelease(pixelBuffer);
    return;
  }
  CMSampleTimingInfo timing = {
    .duration = CMTimeMake(1, (int32_t)VozualPictureInPictureFramesPerSecond),
    .presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock()),
    .decodeTimeStamp = kCMTimeInvalid,
  };
  CMSampleBufferRef sampleBuffer = NULL;
  status = CMSampleBufferCreateReadyWithImageBuffer(kCFAllocatorDefault,
                                                     pixelBuffer,
                                                     formatDescription,
                                                     &timing,
                                                     &sampleBuffer);
  if (status == noErr && sampleBuffer != NULL) {
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, YES);
    if (attachments != NULL && CFArrayGetCount(attachments) > 0) {
      CFMutableDictionaryRef attachment =
        (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
      CFDictionarySetValue(attachment, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
    }
    if (self.displayLayer.status == AVQueuedSampleBufferRenderingStatusFailed) {
      [self.displayLayer flush];
    }
    if (self.displayLayer.isReadyForMoreMediaData) {
      [self.displayLayer enqueueSampleBuffer:sampleBuffer];
    }
    CFRelease(sampleBuffer);
  }
  CFRelease(formatDescription);
  CVPixelBufferRelease(pixelBuffer);
}

- (void)startFrameTimer
{
  if (self.frameTimer != nil) return;
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                                    dispatch_get_main_queue());
  uint64_t interval = (uint64_t)(NSEC_PER_SEC / VozualPictureInPictureFramesPerSecond);
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), interval,
                            (uint64_t)(0.01 * NSEC_PER_SEC));
  __weak typeof(self) weakSelf = self;
  dispatch_source_set_event_handler(timer, ^{
    [weakSelf captureAndEnqueueFrame];
  });
  self.frameTimer = timer;
  dispatch_resume(timer);
}

- (void)stopFrameTimer
{
  if (self.frameTimer == nil) return;
  dispatch_source_cancel(self.frameTimer);
  self.frameTimer = nil;
}

RCT_REMAP_METHOD(enter,
                 enterWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self preparePictureInPicture]) {
    resolve(@NO);
    return;
  }
  [self startFrameTimer];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    if (!self.pictureInPictureController.isPictureInPicturePossible) {
      [self stopFrameTimer];
      resolve(@NO);
      return;
    }
    [self.pictureInPictureController startPictureInPicture];
    resolve(@YES);
  });
}

RCT_REMAP_METHOD(isActive,
                 isActiveWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(self.pictureInPictureController.isPictureInPictureActive));
}

RCT_REMAP_METHOD(startListeningService,
                 startListeningWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_REMAP_METHOD(stopListeningService,
                 stopListeningWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_REMAP_METHOD(finishListeningPhrase,
                 finishListeningWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_EXPORT_METHOD(enqueueSigns:(NSArray<NSString *> *)glosses) {}
RCT_EXPORT_METHOD(resetPlayback) {}
RCT_EXPORT_METHOD(setListeningMode:(NSString *)mode microphoneActive:(BOOL)microphoneActive) {}
RCT_EXPORT_METHOD(setAvatarPresentation:(NSString *)renderMode
                  avatarZoom:(double)avatarZoom
                  playbackSpeed:(double)playbackSpeed) {}
RCT_EXPORT_METHOD(reportPlaybackEvent:(NSString *)event publishedGloss:(NSString *)publishedGloss) {}

- (void)pictureInPictureControllerDidStartPictureInPicture:
  (AVPictureInPictureController *)pictureInPictureController
{
  [self captureAndEnqueueFrame];
  [self emitPictureInPictureState:YES];
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController
  failedToStartPictureInPictureWithError:(NSError *)error
{
  NSLog(@"[VOZUAL_IOS_PIP] failed to start: %@", error.localizedDescription);
  [self stopFrameTimer];
  [self emitPictureInPictureState:NO];
}

- (void)pictureInPictureControllerDidStopPictureInPicture:
  (AVPictureInPictureController *)pictureInPictureController
{
  [self stopFrameTimer];
  [self emitPictureInPictureState:NO];
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController
  restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL restored))completionHandler
{
  completionHandler(YES);
}

- (CMTimeRange)pictureInPictureControllerTimeRangeForPlayback:
  (AVPictureInPictureController *)pictureInPictureController
{
  return CMTimeRangeMake(kCMTimeZero, kCMTimePositiveInfinity);
}

- (BOOL)pictureInPictureControllerIsPlaybackPaused:
  (AVPictureInPictureController *)pictureInPictureController
{
  return NO;
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController
  setPlaying:(BOOL)playing
{
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController
  didTransitionToRenderSize:(CMVideoDimensions)newRenderSize
{
  // AVKit may recreate its presentation surface after a drag or resize. Push
  // the cached frame immediately and again after the transition settles.
  [pictureInPictureController invalidatePlaybackState];
  [self captureAndEnqueueFrame];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.08 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self captureAndEnqueueFrame];
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.24 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self captureAndEnqueueFrame];
  });
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController
  skipByInterval:(CMTime)skipInterval
  completionHandler:(void (^)(void))completionHandler
{
  completionHandler();
}

- (void)invalidate
{
  [self stopFrameTimer];
  [self.pictureInPictureController stopPictureInPicture];
  self.pictureInPictureController.delegate = nil;
  self.pictureInPictureController = nil;
  [self.displayLayer flushAndRemoveImage];
  [self.displayHostView removeFromSuperview];
  self.displayHostView = nil;
  self.displayLayer = nil;
  self.lastValidAvatarImage = nil;
  [super invalidate];
}

@end
