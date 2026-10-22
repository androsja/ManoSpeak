import fs from 'node:fs';
import path from 'node:path';

describe('Android release configuration', () => {
  const appGradle = fs.readFileSync(
    path.join(process.cwd(), 'android/app/build.gradle'),
    'utf8',
  );
  const rootGradle = fs.readFileSync(
    path.join(process.cwd(), 'android/build.gradle'),
    'utf8',
  );
  const gradleProperties = fs.readFileSync(
    path.join(process.cwd(), 'android/gradle.properties'),
    'utf8',
  );
  const manifest = fs.readFileSync(
    path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const mainActivity = fs.readFileSync(
    path.join(
      process.cwd(),
      'android/app/src/main/java/com/androsja/vozual/MainActivity.kt',
    ),
    'utf8',
  );

  it('targets the installed stable Android API 36', () => {
    expect(rootGradle).toContain('compileSdkVersion = 36');
    expect(rootGradle).toContain('targetSdkVersion = 36');
  });

  it('fails closed instead of falling back to debug signing', () => {
    expect(appGradle).toContain('requestedReleaseArtifact');
    expect(appGradle).toContain('Debug signing is never used for release.');
    expect(appGradle).toContain('CN=Android Debug');
    expect(appGradle).not.toMatch(
      /release\s*\{[^}]*signingConfig\s+signingConfigs\.debug/s,
    );
  });

  it('optimizes release output and limits it to mobile ABIs', () => {
    expect(appGradle).toMatch(/release\s*\{[\s\S]*?minifyEnabled true/);
    expect(appGradle).toMatch(/release\s*\{[\s\S]*?shrinkResources true/);
    expect(gradleProperties).toContain(
      'reactNativeArchitectures=armeabi-v7a,arm64-v8a',
    );
  });

  it('removes obsolete shared-storage permissions from merged manifests', () => {
    expect(manifest).toContain(
      'android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"',
    );
    expect(manifest).toContain(
      'android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"',
    );
  });

  it('configures edge-to-edge windows while preserving readable system controls', () => {
    expect(mainActivity).toContain('WindowCompat.enableEdgeToEdge(window)');
    expect(mainActivity).toContain('window.isNavigationBarContrastEnforced = false');
    expect(mainActivity).toContain('isAppearanceLightStatusBars = false');
    expect(mainActivity).toContain('isAppearanceLightNavigationBars = false');
  });
});
