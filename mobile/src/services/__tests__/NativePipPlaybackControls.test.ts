const fs = require('fs');
const path = require('path');

export {};

function mobileSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('native PiP avatar playback controls', () => {
  it('retains pause state and forwards it to the packaged local avatar runtime', () => {
    const viewSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/NativePipAvatarView.kt',
    );
    const moduleSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/PictureInPictureModule.kt',
    );

    expect(viewSource).toContain('private var playbackPaused = false');
    expect(viewSource).toContain('fun setPlaybackPaused(paused: Boolean)');
    expect(viewSource).toContain('window.setVozualPlaybackPaused?.($paused)');
    expect(viewSource).toContain('window.setVozualPlaybackPaused?.($playbackPaused)');
    expect(moduleSource).toContain('fun setPlaybackPaused(paused: Boolean)');
    expect(moduleSource).toContain('NativePipAvatarController.setPlaybackPaused(paused)');
    expect(moduleSource).toContain('if (paused) stopAnimationClock() else startAnimationClock()');
  });

  it('accepts the accessible half-speed playback setting in PiP', () => {
    const viewSource = mobileSource(
      'android/app/src/main/java/com/androsja/vozual/NativePipAvatarView.kt',
    );
    const listenerSource = mobileSource('src/components/ListenerScreen.tsx');

    expect(viewSource).toContain('private const val MIN_PLAYBACK_SPEED = 0.5');
    expect(listenerSource).toContain('const PLAYBACK_SPEEDS = [0.5, 1, 2, 3, 4] as const;');
  });

  it('records local avatar load and recovery diagnostics without a transcript', () => {
    const avatarSource = mobileSource('src/components/SkeletalAvatar.tsx');

    expect(avatarSource).toContain("'avatar-runtime-ready-ms'");
    expect(avatarSource).toContain("'avatar-motion-base64-bytes'");
    expect(avatarSource).toContain("'avatar-motion-missing'");
    expect(avatarSource).toContain("'avatar-web-content-terminated'");
    expect(avatarSource).toContain("'avatar-runtime-error'");
  });

  it('makes a missing local motion recoverable with an accessible retry action', () => {
    const avatarSource = mobileSource('src/components/SkeletalAvatar.tsx');

    expect(avatarSource).toContain('La seña ${clip} no está descargada.');
    expect(avatarSource).toContain('accessibilityRole="alert"');
    expect(avatarSource).toContain('accessibilityLabel="Reintentar cargar el avatar"');
    expect(avatarSource).toContain('onPress={restartRuntime}');
  });
});
