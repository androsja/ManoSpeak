import fs from 'node:fs';
import path from 'node:path';

const mobileRoot = path.resolve(__dirname, '../../..');
const repositoryRoot = path.resolve(mobileRoot, '..');

function readRepositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('Android account privacy contract', () => {
  it('provides discoverable in-app and external account deletion paths', () => {
    const appSource = readRepositoryFile('mobile/App.tsx');
    const activationSource = readRepositoryFile(
      'mobile/src/components/AccountActivationScreen.tsx',
    );
    const listenerSource = readRepositoryFile('mobile/src/components/ListenerScreen.tsx');
    const privacyConstants = readRepositoryFile(
      'mobile/src/services/PrivacyPolicyService.ts',
    );

    expect(appSource).toContain('deleteActivationAccount');
    expect(listenerSource).toContain('ELIMINAR CUENTA Y DATOS');
    expect(listenerSource).toContain('VOZUAL_ACCOUNT_DELETION_URL');
    expect(listenerSource).toContain('VOZUAL_PRIVACY_POLICY_URL');
    expect(privacyConstants).toContain('/eliminar-cuenta');
    expect(privacyConstants).toContain('/privacidad');
    expect(activationSource).toContain('USAR GRATIS SIN CUENTA');
    expect(activationSource).toContain('VOZUAL_PRIVACY_POLICY_URL');
  });

  it('ships public privacy and deletion pages through Firebase Hosting', () => {
    const firebaseConfig = JSON.parse(readRepositoryFile('firebase.json'));
    const privacyPage = readRepositoryFile('hosting/privacidad.html');
    const deletionPage = readRepositoryFile('hosting/eliminar-cuenta.html');

    expect(firebaseConfig.hosting.public).toBe('hosting');
    expect(privacyPage).toContain('Política de privacidad');
    expect(privacyPage).toContain('no los guarda ni los envía');
    expect(deletionPage).toContain('Eliminar tu cuenta y datos');
    expect(deletionPage).toContain('INICIAR SOLICITUD');
    expect(deletionPage).not.toMatch(/contraseña[^<]*(envía|compart)/i);
  });

  it('allows owner deletion without allowing entitlement mutation', () => {
    const rules = readRepositoryFile('firestore.rules');

    expect(rules).toMatch(/match \/access\/\{uid\}[\s\S]*allow delete: if owns\(uid\)/);
    expect(rules).toMatch(/match \/usage\/\{uid\}[\s\S]*allow delete: if owns\(uid\)/);
    expect(rules).toMatch(/match \/usage\/\{uid\}\/periods\/\{periodId\}[\s\S]*allow delete: if owns\(uid\)/);
    expect(rules).toContain('allow create, update: if false;');
  });

  it('does not bundle analytics, crash reporting, or advertising SDKs', () => {
    const packageJson = JSON.parse(readRepositoryFile('mobile/package.json'));
    const dependencies = Object.keys(packageJson.dependencies ?? {});

    expect(dependencies).not.toEqual(expect.arrayContaining([
      '@react-native-firebase/analytics',
      '@react-native-firebase/crashlytics',
      'react-native-google-mobile-ads',
    ]));
  });
});
