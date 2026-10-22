import fs from 'node:fs';
import path from 'node:path';

describe('premium feature visibility contract', () => {
  it('does not render unavailable premium controls', () => {
    const listenerSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ListenerScreen.tsx'),
      'utf8',
    );

    expect(listenerSource).toContain("LISTENING_MODES.filter(mode => (");
    expect(listenerSource).toContain('accessPolicy.canUseContinuousMode');
    expect(listenerSource).toContain('{accessPolicy.canUsePictureInPicture && <Pressable');
    expect(listenerSource).not.toContain("t('listener.floatingUnavailable')");
  });
});
