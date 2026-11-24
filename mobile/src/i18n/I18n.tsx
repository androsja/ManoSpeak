import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

export const SUPPORTED_APP_LOCALES = ['es-CO', 'en-US'] as const;
export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number];

const DEFAULT_APP_LOCALE: AppLocale = 'es-CO';
type LocalFileSystem = {
  DocumentDirectoryPath: string;
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, content: string, encoding: string) => Promise<void>;
};

function localFileSystem(): LocalFileSystem {
  // Loading this native module lazily preserves the pure translation catalog's
  // compatibility with Node-based unit tests.
  const module = require('react-native-fs') as LocalFileSystem & {default?: LocalFileSystem};
  return module.default ?? module;
}

const esCO = {
  'language.name.es-CO': 'Español (Colombia)',
  'language.name.en-US': 'English (United States)',
  'language.interface': 'IDIOMA DE LA INTERFAZ',
  'language.interface.detail': 'La voz y las señas siguen en español colombiano (LSC).',
  'activation.subtitle': 'TRADUCTOR DE HABLA A LSC',
  'activation.title': 'Activa tu cuenta gratis',
  'activation.description': 'Guarda tu acceso, el uso mensual y las futuras ventajas Plus. Activar la cuenta no genera ningún cobro.',
  'activation.continueGoogle': 'CONTINUAR CON GOOGLE',
  'activation.continueApple': 'CONTINUAR CON APPLE',
  'activation.preparing.title': 'ACTIVACIÓN EN PREPARACIÓN',
  'activation.preparing.detail': 'Estamos terminando la conexión segura con Google y Apple. La traducción sigue disponible mientras tanto.',
  'activation.useWithoutAccount': 'USAR GRATIS SIN CUENTA',
  'activation.noChargePrivacy': 'No se realiza ningún cobro al activar. VOZUAL tampoco guarda el audio ni las frases que dices.',
  'activation.privacyPolicy': 'POLÍTICA DE PRIVACIDAD',
  'activation.support': 'Soporte: {email}',
  'activation.openPrivacyError': 'No pudimos abrir la política. Escríbenos a {email}.',
  'activation.continueGoogleLabel': 'Continuar con Google',
  'activation.continueAppleLabel': 'Continuar con Apple',
  'activation.useWithoutAccountLabel': 'Usar VOZUAL gratis sin cuenta',
  'activation.openPrivacyLabel': 'Abrir política de privacidad',
  'library.loadError': 'No fue posible consultar las lenguas disponibles. Revisa tu conexión.',
  'library.updated.title': 'Biblioteca actualizada',
  'library.updated.detail': '{count} {count, plural, one {cambio aplicado} other {cambios aplicados}} para {language}. Esta lengua quedó activa.',
  'library.downloadError.title': 'No se pudo descargar',
  'library.downloadError.detail': 'Las señas no se instalaron. Intenta nuevamente.',
  'library.selectError.title': 'No se pudo seleccionar',
  'library.selectError.detail': 'Descarga al menos una seña de esta lengua primero.',
  'library.alsoRecognizes': 'También reconoce: {aliases}',
  'library.status.update': 'ACTUALIZAR',
  'library.status.installed': 'INSTALADA',
  'library.status.available': 'DISPONIBLE',
  'library.action.downloadOne': 'DESCARGAR',
  'library.action.updateOne': 'ACTUALIZAR',
  'library.backLabel': 'Volver a lenguas de señas',
  'library.back': '‹ LENGUAS',
  'library.resourcesSummary': '{published} recursos publicados · {installed} instalados',
  'library.reviewNotice': 'Instalar un recurso no equivale a una aprobación lingüística. Vozual solo lo reproduce en producción cuando su interpretación en LSC ha sido revisada.',
  'library.searchLabel': 'Buscar una seña o frase',
  'library.searchPlaceholder': 'Buscar palabra o frase…',
  'library.filter.all': 'TODAS',
  'library.filter.installed': 'INSTALADAS',
  'library.discoveryPrompt': 'Busca una palabra o elige una categoría',
  'library.resultCount': '{count} {count, plural, one {resultado} other {resultados}}',
  'library.showing': ' · mostrando {count}',
  'library.empty.discovery': 'Para encontrar algo rápidamente, escribe una palabra o selecciona una categoría.',
  'library.empty.results': 'No encontramos un recurso publicado con esa búsqueda.',
  'library.initialTitle': 'Elige tus lenguas de señas',
  'library.title': 'Lenguas de señas',
  'library.description': 'Elige una lengua y descarga las señas publicadas que quieras usar. LSC muestra aquí sus señas disponibles.',
  'library.empty.catalog': 'No pudimos consultar el catálogo. Conéctate a internet para descargar una lengua o continúa sin descargar.',
  'library.action.unavailable': 'NO DISPONIBLE',
  'library.action.current': 'EN USO',
  'library.action.use': 'USAR',
  'library.action.applyChanges': 'APLICAR {count} {count, plural, one {CAMBIO} other {CAMBIOS}}',
  'library.action.download': 'DESCARGAR {count}',
  'library.metadata': '{region} · {count} {count, plural, one {seña} other {señas}} · {size}',
  'library.installedCount': '{count} instaladas',
  'library.availableChanges': '{count} {count, plural, one {cambio disponible} other {cambios disponibles}}',
  'library.pending': 'Pendientes: {signs}',
  'library.downloading': 'Descargando · {progress}%',
  'library.openCatalogLabel': 'Ver señas de {language}',
  'library.noPublishedContent': 'SIN CONTENIDO PUBLICADO',
  'library.openCatalog': 'VER {count} {count, plural, one {SEÑA} other {SEÑAS}}',
  'library.action.downloadGloss': 'DESCARGAR {gloss}',
  'library.retry': 'REINTENTAR',
  'library.tryPhrase': 'PRUEBA UNA FRASE',
  'library.noPhrases': 'No hay frases disponibles',
  'library.phraseHint': 'Usa palabras disponibles en esta lengua.',
  'library.nextPhraseLabel': 'Mostrar otra frase posible',
  'library.nextPhrase': 'OTRA FRASE ↻',
  'library.skip': 'AHORA NO',
  'library.continue': 'CONTINUAR',
  'library.close': 'CERRAR',
  'settings.title': 'AJUSTES',
  'settings.subtitle': 'Personaje, cuenta y acceso',
  'settings.close': 'Cerrar ajustes',
  'listener.speed': 'VELOCIDAD',
  'listener.speedLabel': 'Velocidad {speed}x',
  'listener.subtitle': 'TRADUCTOR DE HABLA A LSC',
  'listener.openSettings': 'Abrir ajustes y cuenta',
  'listener.activateFree': 'Activar cuenta gratis',
  'listener.settings': 'AJUSTES',
  'listener.downloadedSigns': '{count} señas descargadas. Abrir lenguas de señas',
  'listener.translationMode': 'MODO DE TRADUCCIÓN',
  'listener.newSignsLabel': '{count} {count, plural, one {actualización de seña disponible} other {actualizaciones de señas disponibles}}. Revisa y decide si descargarlas',
  'listener.newSignsTitle': '{count} {count, plural, one {ACTUALIZACIÓN DE SEÑA DISPONIBLE} other {ACTUALIZACIONES DE SEÑAS DISPONIBLES}}',
  'listener.newSignsDetail': '¿Quieres descargar los cambios? Revísalos primero.',
  'listener.download': 'REVISAR',
  'listener.mode.phrase.label': 'POR FRASE',
  'listener.mode.phrase.detail': 'Escucha primero y reproduce después',
  'listener.mode.continuous.label': 'EN VIVO',
  'listener.mode.continuous.detail': 'Escucha continuamente y traduce al instante',
  'listener.notAvailableYet': 'No disponible todavía',
  'listener.tutorial.label': 'Guía rápida para usar VOZUAL',
  'listener.tutorial.title': '¿CÓMO TRADUCIR UNA FRASE?',
  'listener.tutorial.close': 'Cerrar guía de uso',
  'listener.tutorial.instructions': '1. Elige POR FRASE. 2. Pulsa HABLAR. 3. Di tu frase. 4. Toca TERMINAR FRASE para verla en LSC.',
  'listener.tutorial.pointer': '↓ EL BOTÓN HABLAR ESTÁ ABAJO ↓',
  'listener.replaying': 'REPRODUCIENDO SEÑAS…',
  'listener.finishPhrase': 'TERMINAR FRASE',
  'listener.speak': 'HABLAR',
  'listener.stopListening': 'DETENER ESCUCHA',
  'listener.activateMicrophone': 'ACTIVAR MICRÓFONO',
  'listener.openFloating': 'Abrir ventana flotante',
  'listener.floatingUnavailable': 'Ventana flotante no disponible todavía',
  'listener.openFloatingAction': 'ABRIR VENTANA FLOTANTE',
  'listener.preparingTranslation': 'Preparando traducción',
  'listener.preparingSign': 'PREPARANDO LA SEÑA…',
  'listener.preparingMicrophone': 'Preparando micrófono',
  'listener.preparingMicrophoneDetail': 'PREPARANDO MICRÓFONO… CASI LISTO',
  'listener.listeningFinish': 'ESCUCHANDO · TOCA TERMINAR CUANDO ACABES',
  'listener.replayingPhrase': 'REPRODUCIENDO FRASE',
  'listener.continuousActive': 'ESCUCHA CONTINUA ACTIVA',
  'listener.detectedWords': 'Oído: {words}',
  'listener.liveListening': 'Escuchando ahora · di una palabra',
  'listener.liveIdle': 'Pulsa HABLAR para reactivar la escucha.',
  'listener.liveRequiresDownload': 'Descarga señas para activar la escucha.',
  'listener.lscEmpty': 'LSC: —',
  'listener.confirmation.title': 'REVISA O EDITA LA FRASE ANTES DE VERLA EN LSC',
  'listener.confirmation.inputLabel': 'Transcripción reconocida',
  'listener.confirmation.cancelLabel': 'Cancelar la frase reconocida',
  'listener.confirmation.cancel': 'CANCELAR',
  'listener.confirmation.confirmLabel': 'Confirmar frase y buscar su interpretación LSC',
  'listener.confirmation.confirm': 'CONFIRMAR',
  'listener.confirmation.empty': 'Escribe una frase antes de confirmar.',
  'listener.ambiguity.title': 'ELIGE EL SIGNIFICADO REVISADO',
  'listener.ambiguity.detail': 'Esta frase tiene más de una interpretación LSC aprobada.',
  'listener.ambiguity.choiceLabel': 'Elegir el significado: {meaning}',
  'listener.playback.pauseLabel': 'Pausar reproducción del avatar',
  'listener.playback.pause': 'PAUSAR',
  'listener.playback.resumeLabel': 'Reanudar reproducción del avatar',
  'listener.playback.resume': 'REANUDAR',
  'listener.playback.resetLabel': 'Detener y reiniciar la frase',
  'listener.playback.reset': 'REINICIAR',
  'listener.recommendedPhrase': 'FRASE RECOMENDADA',
  'listener.possibleCount': '{count} POSIBLES',
  'listener.suggestionHint': 'Usa únicamente señas que ya están descargadas en tu biblioteca.',
  'listener.nextSuggestionLabel': 'Mostrar otra frase recomendada',
  'listener.nextSuggestion': 'OTRA ↻',
  'listener.viewSuggestionLabel': 'Ver en LSC la frase {phrase}',
  'listener.viewInLsc': 'VER EN LSC',
  'listener.recommendedPhrases': 'FRASES RECOMENDADAS',
  'listener.noSuggestions': 'Descarga señas de la biblioteca para recibir frases posibles.',
  'listener.openLibraryLabel': 'Abrir biblioteca de señas',
  'listener.openLibrary': 'ABRIR BIBLIOTECA',
  'settings.interfaceLanguage': 'IDIOMA DE LA INTERFAZ',
  'settings.representation': 'REPRESENTACIÓN',
  'settings.avatar.points': 'PUNTOS',
  'settings.avatar.character': 'PERSONAJE',
  'settings.avatarSize': 'TAMAÑO DEL PERSONAJE',
  'settings.zoomOut': 'Alejar personaje',
  'settings.zoomIn': 'Acercar personaje',
  'settings.signLanguagesLabel': 'Abrir lenguas de señas',
  'settings.signLanguages': '{count} señas descargadas · ADMINISTRAR LENGUAS',
  'settings.userGuideLabel': 'Ver guía de uso',
  'settings.userGuide': 'VER GUÍA DE USO',
  'settings.access': 'ACCESO',
  'settings.plusAccess': 'VOZUAL Plus',
  'settings.freePlan': 'Plan gratuito',
  'settings.freeLaunchAccess': 'Acceso gratuito',
  'settings.noConsumedMinutes': 'Sin consumo este mes',
  'settings.consumedMinutes': '{count} min de señas reproducidas este mes',
  'settings.minuteExplanation': 'Solo cuenta mientras el personaje hace una seña. Escuchar y esperar no consume minutos.',
  'settings.remainingMinutes': '{count} min incluidos disponibles',
  'settings.launchAccessPhrase': 'La traducción por frase está disponible sin costo durante la fase de lanzamiento.',
  'settings.launchAccessAllModes': 'Todos los modos están disponibles sin costo durante la fase de lanzamiento.',
  'settings.sandbox': 'MODO DE PRUEBA · SIN COBROS',
  'settings.sandboxOpen': 'Abrir simulador de VOZUAL Plus',
  'settings.sandboxManage': 'ADMINISTRAR PLUS DE PRUEBA',
  'settings.sandboxTry': 'PROBAR VOZUAL PLUS',
  'settings.account': 'CUENTA',
  'settings.noAccount': 'Sin cuenta activada',
  'settings.appleAccount': 'Cuenta de Apple',
  'settings.googleAccount': 'Cuenta de Google',
  'settings.privateAppleEmail': 'Correo protegido por Apple',
  'settings.protectedAccount': 'Cuenta protegida con inicio de sesión',
  'settings.accountPrompt': 'Actívala para conservar tu prueba y futuro acceso Plus',
  'settings.signOut': 'Cerrar sesión',
  'settings.activateAccount': 'Activar cuenta',
  'settings.signOutAction': 'SALIR',
  'settings.activateAction': 'ACTIVAR',
  'settings.deleteAccount': 'Eliminar cuenta y datos',
  'settings.deleteAccountAction': 'ELIMINAR CUENTA Y DATOS',
  'settings.webDeletion': 'Abrir solicitud web de eliminación',
  'settings.webDeletionAction': 'SOLICITAR ELIMINACIÓN POR WEB',
  'settings.privacy': 'PRIVACIDAD',
  'settings.deleteData': 'ELIMINAR DATOS',
  'settings.openSourceLicenses': 'LICENCIAS DE CÓDIGO ABIERTO',
  'settings.openSourceLicensesSubtitle': 'Componentes de reconocimiento de voz local',
  'settings.closeLicenses': 'Cerrar licencias de código abierto',
  'settings.licenseModelSource': 'Ver ficha del modelo de NVIDIA',
  'settings.licenseNvidia': 'Modelo de reconocimiento de voz en español de NVIDIA, convertido al formato ONNX para Sherpa‑ONNX. Uso bajo CC BY 4.0; se reconoce a NVIDIA como autor y se indica la conversión.',
  'settings.licenseSherpa': 'Motor local de reconocimiento de voz. Licenciado bajo Apache 2.0.',
  'settings.licenseSilero': 'Detector de actividad de voz incluido con el modelo Sherpa‑ONNX. Licenciado bajo MIT.',
} as const;

type TranslationKey = keyof typeof esCO;
type TranslationCatalog = Record<TranslationKey, string>;

const enUS: TranslationCatalog = {
  'language.name.es-CO': 'Spanish (Colombia)',
  'language.name.en-US': 'English (United States)',
  'language.interface': 'INTERFACE LANGUAGE',
  'language.interface.detail': 'Voice and sign language remain Colombian Spanish (LSC).',
  'activation.subtitle': 'SPEECH-TO-LSC TRANSLATOR',
  'activation.title': 'Activate your free account',
  'activation.description': 'Keep your access, monthly usage and future Plus benefits. Activating your account never creates a charge.',
  'activation.continueGoogle': 'CONTINUE WITH GOOGLE',
  'activation.continueApple': 'CONTINUE WITH APPLE',
  'activation.preparing.title': 'ACTIVATION IN PREPARATION',
  'activation.preparing.detail': 'We are finalizing the secure Google and Apple connection. Translation remains available in the meantime.',
  'activation.useWithoutAccount': 'USE FOR FREE WITHOUT AN ACCOUNT',
  'activation.noChargePrivacy': 'Activating never creates a charge. VOZUAL does not store your audio or the phrases you say.',
  'activation.privacyPolicy': 'PRIVACY POLICY',
  'activation.support': 'Support: {email}',
  'activation.openPrivacyError': 'We could not open the policy. Contact us at {email}.',
  'activation.continueGoogleLabel': 'Continue with Google',
  'activation.continueAppleLabel': 'Continue with Apple',
  'activation.useWithoutAccountLabel': 'Use VOZUAL for free without an account',
  'activation.openPrivacyLabel': 'Open privacy policy',
  'library.loadError': 'We could not load the available sign languages. Check your connection.',
  'library.updated.title': 'Library updated',
  'library.updated.detail': '{count} {count, plural, one {change applied} other {changes applied}} for {language}. This sign language is now active.',
  'library.downloadError.title': 'Download failed',
  'library.downloadError.detail': 'The signs were not installed. Please try again.',
  'library.selectError.title': 'Could not select sign language',
  'library.selectError.detail': 'Download at least one sign for this language first.',
  'library.alsoRecognizes': 'Also recognizes: {aliases}',
  'library.status.update': 'UPDATE',
  'library.status.installed': 'INSTALLED',
  'library.status.available': 'AVAILABLE',
  'library.action.downloadOne': 'DOWNLOAD',
  'library.action.updateOne': 'UPDATE',
  'library.backLabel': 'Back to sign languages',
  'library.back': '‹ LANGUAGES',
  'library.resourcesSummary': '{published} published resources · {installed} installed',
  'library.reviewNotice': 'Installing a resource does not amount to linguistic approval. Vozual only plays it in production once its LSC interpretation has been reviewed.',
  'library.searchLabel': 'Search for a sign or phrase',
  'library.searchPlaceholder': 'Search for a word or phrase…',
  'library.filter.all': 'ALL',
  'library.filter.installed': 'INSTALLED',
  'library.discoveryPrompt': 'Search for a word or select a category',
  'library.resultCount': '{count} {count, plural, one {result} other {results}}',
  'library.showing': ' · showing {count}',
  'library.empty.discovery': 'To find something quickly, type a word or select a category.',
  'library.empty.results': 'We could not find a published resource matching that search.',
  'library.initialTitle': 'Choose your sign languages',
  'library.title': 'Sign languages',
  'library.description': 'Choose a sign language and download the published signs you want to use. Available LSC signs are listed here.',
  'library.empty.catalog': 'We could not load the catalogue. Connect to the internet to download a sign language, or continue without downloading.',
  'library.action.unavailable': 'UNAVAILABLE',
  'library.action.current': 'IN USE',
  'library.action.use': 'USE',
  'library.action.applyChanges': 'APPLY {count} {count, plural, one {CHANGE} other {CHANGES}}',
  'library.action.download': 'DOWNLOAD {count}',
  'library.metadata': '{region} · {count} {count, plural, one {sign} other {signs}} · {size}',
  'library.installedCount': '{count} installed',
  'library.availableChanges': '{count} {count, plural, one {change available} other {changes available}}',
  'library.pending': 'Pending: {signs}',
  'library.downloading': 'Downloading · {progress}%',
  'library.openCatalogLabel': 'View signs for {language}',
  'library.noPublishedContent': 'NO PUBLISHED CONTENT',
  'library.openCatalog': 'VIEW {count} {count, plural, one {SIGN} other {SIGNS}}',
  'library.action.downloadGloss': 'DOWNLOAD {gloss}',
  'library.retry': 'TRY AGAIN',
  'library.tryPhrase': 'TRY A PHRASE',
  'library.noPhrases': 'No phrases available',
  'library.phraseHint': 'Use words available in this sign language.',
  'library.nextPhraseLabel': 'Show another possible phrase',
  'library.nextPhrase': 'ANOTHER PHRASE ↻',
  'library.skip': 'NOT NOW',
  'library.continue': 'CONTINUE',
  'library.close': 'CLOSE',
  'settings.title': 'SETTINGS',
  'settings.subtitle': 'Avatar, account and access',
  'settings.close': 'Close settings',
  'listener.speed': 'SPEED',
  'listener.speedLabel': 'Speed {speed}x',
  'listener.subtitle': 'SPEECH-TO-LSC TRANSLATOR',
  'listener.openSettings': 'Open settings and account',
  'listener.activateFree': 'Activate your free account',
  'listener.settings': 'SETTINGS',
  'listener.downloadedSigns': '{count} signs downloaded. Open sign languages',
  'listener.translationMode': 'TRANSLATION MODE',
  'listener.newSignsLabel': '{count} {count, plural, one {sign update available} other {sign updates available}}. Review and choose whether to download',
  'listener.newSignsTitle': '{count} {count, plural, one {SIGN UPDATE AVAILABLE} other {SIGN UPDATES AVAILABLE}}',
  'listener.newSignsDetail': 'Do you want to download these changes? Review them first.',
  'listener.download': 'REVIEW',
  'listener.mode.phrase.label': 'BY PHRASE',
  'listener.mode.phrase.detail': 'Listen first and play afterwards',
  'listener.mode.continuous.label': 'LIVE',
  'listener.mode.continuous.detail': 'Listen continuously and translate instantly',
  'listener.notAvailableYet': 'Not available yet',
  'listener.tutorial.label': 'Quick guide to using VOZUAL',
  'listener.tutorial.title': 'HOW DO I TRANSLATE A PHRASE?',
  'listener.tutorial.close': 'Close user guide',
  'listener.tutorial.instructions': '1. Choose BY PHRASE. 2. Tap SPEAK. 3. Say your phrase. 4. Tap FINISH PHRASE to see it in LSC.',
  'listener.tutorial.pointer': '↓ THE SPEAK BUTTON IS BELOW ↓',
  'listener.replaying': 'PLAYING SIGNS…',
  'listener.finishPhrase': 'FINISH PHRASE',
  'listener.speak': 'SPEAK',
  'listener.stopListening': 'STOP LISTENING',
  'listener.activateMicrophone': 'ACTIVATE MICROPHONE',
  'listener.openFloating': 'Open floating window',
  'listener.floatingUnavailable': 'Floating window not available yet',
  'listener.openFloatingAction': 'OPEN FLOATING WINDOW',
  'listener.preparingTranslation': 'Preparing translation',
  'listener.preparingSign': 'PREPARING SIGN…',
  'listener.preparingMicrophone': 'Preparing microphone',
  'listener.preparingMicrophoneDetail': 'PREPARING MICROPHONE… ALMOST READY',
  'listener.listeningFinish': 'LISTENING · TAP FINISH WHEN YOU ARE DONE',
  'listener.replayingPhrase': 'PLAYING PHRASE',
  'listener.continuousActive': 'CONTINUOUS LISTENING ACTIVE',
  'listener.detectedWords': 'Heard: {words}',
  'listener.liveListening': 'Listening now · say a word',
  'listener.liveIdle': 'Tap SPEAK to resume listening.',
  'listener.liveRequiresDownload': 'Download signs to enable listening.',
  'listener.lscEmpty': 'LSC: —',
  'listener.confirmation.title': 'REVIEW OR EDIT THE PHRASE BEFORE VIEWING IT IN LSC',
  'listener.confirmation.inputLabel': 'Recognized transcript',
  'listener.confirmation.cancelLabel': 'Cancel the recognized phrase',
  'listener.confirmation.cancel': 'CANCEL',
  'listener.confirmation.confirmLabel': 'Confirm phrase and find its LSC interpretation',
  'listener.confirmation.confirm': 'CONFIRM',
  'listener.confirmation.empty': 'Enter a phrase before confirming.',
  'listener.ambiguity.title': 'CHOOSE THE REVIEWED MEANING',
  'listener.ambiguity.detail': 'This phrase has more than one approved LSC interpretation.',
  'listener.ambiguity.choiceLabel': 'Choose the meaning: {meaning}',
  'listener.playback.pauseLabel': 'Pause avatar playback',
  'listener.playback.pause': 'PAUSE',
  'listener.playback.resumeLabel': 'Resume avatar playback',
  'listener.playback.resume': 'RESUME',
  'listener.playback.resetLabel': 'Stop and restart the phrase',
  'listener.playback.reset': 'RESET',
  'listener.recommendedPhrase': 'RECOMMENDED PHRASE',
  'listener.possibleCount': '{count} POSSIBLE',
  'listener.suggestionHint': 'Use only signs that have already been downloaded to your library.',
  'listener.nextSuggestionLabel': 'Show another recommended phrase',
  'listener.nextSuggestion': 'ANOTHER ↻',
  'listener.viewSuggestionLabel': 'View the phrase {phrase} in LSC',
  'listener.viewInLsc': 'VIEW IN LSC',
  'listener.recommendedPhrases': 'RECOMMENDED PHRASES',
  'listener.noSuggestions': 'Download signs from the library to get possible phrases.',
  'listener.openLibraryLabel': 'Open sign language library',
  'listener.openLibrary': 'OPEN LIBRARY',
  'settings.interfaceLanguage': 'INTERFACE LANGUAGE',
  'settings.representation': 'REPRESENTATION',
  'settings.avatar.points': 'POINTS',
  'settings.avatar.character': 'CHARACTER',
  'settings.avatarSize': 'CHARACTER SIZE',
  'settings.zoomOut': 'Zoom out character',
  'settings.zoomIn': 'Zoom in character',
  'settings.signLanguagesLabel': 'Open sign languages',
  'settings.signLanguages': '{count} signs downloaded · MANAGE LANGUAGES',
  'settings.userGuideLabel': 'View user guide',
  'settings.userGuide': 'VIEW USER GUIDE',
  'settings.access': 'ACCESS',
  'settings.plusAccess': 'VOZUAL Plus',
  'settings.freePlan': 'Free plan',
  'settings.freeLaunchAccess': 'Free access',
  'settings.noConsumedMinutes': 'No usage this month',
  'settings.consumedMinutes': '{count} min of signs played this month',
  'settings.minuteExplanation': 'Only time while the character performs a sign counts. Listening and waiting do not use minutes.',
  'settings.remainingMinutes': '{count} included min available',
  'settings.launchAccessPhrase': 'Phrase translation is available at no cost during the launch phase.',
  'settings.launchAccessAllModes': 'All modes are available at no cost during the launch phase.',
  'settings.sandbox': 'TEST MODE · NO CHARGES',
  'settings.sandboxOpen': 'Open VOZUAL Plus simulator',
  'settings.sandboxManage': 'MANAGE TEST PLUS',
  'settings.sandboxTry': 'TRY VOZUAL PLUS',
  'settings.account': 'ACCOUNT',
  'settings.noAccount': 'No active account',
  'settings.appleAccount': 'Apple account',
  'settings.googleAccount': 'Google account',
  'settings.privateAppleEmail': 'Email protected by Apple',
  'settings.protectedAccount': 'Account protected by sign-in',
  'settings.accountPrompt': 'Activate it to keep your trial and future Plus access',
  'settings.signOut': 'Sign out',
  'settings.activateAccount': 'Activate account',
  'settings.signOutAction': 'SIGN OUT',
  'settings.activateAction': 'ACTIVATE',
  'settings.deleteAccount': 'Delete account and data',
  'settings.deleteAccountAction': 'DELETE ACCOUNT AND DATA',
  'settings.webDeletion': 'Open web deletion request',
  'settings.webDeletionAction': 'REQUEST DELETION ON THE WEB',
  'settings.privacy': 'PRIVACY',
  'settings.deleteData': 'DELETE DATA',
  'settings.openSourceLicenses': 'OPEN-SOURCE LICENSES',
  'settings.openSourceLicensesSubtitle': 'On-device speech recognition components',
  'settings.closeLicenses': 'Close open-source licenses',
  'settings.licenseModelSource': 'View NVIDIA model card',
  'settings.licenseNvidia': 'NVIDIA Spanish speech recognition model, converted to ONNX format for Sherpa‑ONNX. Used under CC BY 4.0; NVIDIA is credited as the author and the conversion is noted.',
  'settings.licenseSherpa': 'On-device speech recognition engine. Licensed under Apache 2.0.',
  'settings.licenseSilero': 'Voice activity detector included with the Sherpa‑ONNX model. Licensed under MIT.',
};

const catalogs: Record<AppLocale, TranslationCatalog> = { 'es-CO': esCO, 'en-US': enUS };
export type TranslationValues = Record<string, string | number>;

function formatMessage(template: string, values: TranslationValues): string {
  return template
    .replace(/\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g, (_match, key, one, other) => (
      Number(values[key]) === 1 ? one : other
    ))
    .replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? `{${key}}`));
}

export function translate(locale: AppLocale, key: TranslationKey, values: TranslationValues = {}): string {
  return formatMessage(catalogs[locale][key] ?? catalogs[DEFAULT_APP_LOCALE][key], values);
}

export async function loadAppLocale(): Promise<AppLocale> {
  try {
    const fileSystem = localFileSystem();
    const preferencePath = `${fileSystem.DocumentDirectoryPath}/vozual-ui-locale.json`;
    const saved = JSON.parse(await fileSystem.readFile(preferencePath, 'utf8')) as {locale?: unknown};
    return SUPPORTED_APP_LOCALES.includes(saved.locale as AppLocale)
      ? saved.locale as AppLocale
      : DEFAULT_APP_LOCALE;
  } catch {
    return DEFAULT_APP_LOCALE;
  }
}

export async function saveAppLocale(locale: AppLocale): Promise<void> {
  const fileSystem = localFileSystem();
  const preferencePath = `${fileSystem.DocumentDirectoryPath}/vozual-ui-locale.json`;
  await fileSystem.writeFile(preferencePath, JSON.stringify({locale}), 'utf8');
}

type I18nContextValue = {
  locale: AppLocale;
  ready: boolean;
  setLocale: (locale: AppLocale) => Promise<void>;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({children}: {children: React.ReactNode}) {
  const [locale, setCurrentLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadAppLocale().then(savedLocale => {
      if (mounted) setCurrentLocale(savedLocale);
    }).finally(() => {
      if (mounted) setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  const setLocale = useCallback(async (nextLocale: AppLocale) => {
    setCurrentLocale(nextLocale);
    try {
      await saveAppLocale(nextLocale);
    } catch {
      // Keeping the selected locale for this session is preferable to failing
      // the interface because local preference persistence is unavailable.
    }
  }, []);
  const t = useCallback((key: TranslationKey, values?: TranslationValues) => (
    translate(locale, key, values)
  ), [locale]);
  const value = useMemo(() => ({locale, ready, setLocale, t}), [locale, ready, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider.');
  return context;
}
