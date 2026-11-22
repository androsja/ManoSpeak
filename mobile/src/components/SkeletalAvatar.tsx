import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import RNFS from 'react-native-fs';
import {WebView, WebViewMessageEvent} from 'react-native-webview';
import {readInstalledSignPayload} from '../services/SignLanguageService';
import {KinematicExecutionPlan} from '../services/KinematicExecutionPlan';

// WebView 14 currently publishes cross-platform props as an intersection that
// TypeScript 6 reduces to `never`; the runtime component API remains unchanged.
const AvatarWebView = WebView as unknown as React.ComponentType<any>;

const AVATAR_RUNTIME_URI = Platform.OS === 'ios'
  ? `file://${RNFS.MainBundlePath}/avatar/index.html`
  : 'file:///android_asset/avatar/index.html';

export type AvatarClip = string;
export type AvatarRenderMode = 'points' | 'rigged';

type Props = {
  clip: AvatarClip;
  playbackId: number;
  playbackSpeed: number;
  paused: boolean;
  continuePhrase: boolean;
  avatarZoom: number;
  renderMode: AvatarRenderMode;
  kinematicPlan?: KinematicExecutionPlan;
  onClipEnd: () => void;
  onReady?: () => void;
  onUnavailable?: () => void;
  onPlaybackDiagnostic?: (event: string, value: string) => void;
};

type RuntimeMessage = {
  type?: 'ready' | 'ended' | 'error';
  playbackId?: number;
  message?: string;
  riggedStatus?: string;
  riggedError?: string;
  riggedAligned?: boolean;
  riggedBoneCount?: number;
  riggedHasShoulders?: boolean;
};

export function SkeletalAvatar({clip, playbackId, playbackSpeed, paused, continuePhrase, avatarZoom, renderMode, kinematicPlan, onClipEnd, onReady, onUnavailable, onPlaybackDiagnostic}: Props) {
  const webView = useRef<WebView>(null);
  const runtimeLoadStartedAt = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');

  const restartRuntime = useCallback(() => {
    // WKWebView may terminate only its WebContent process under memory
    // pressure. Native speech keeps recognizing words, but the old playback
    // never sends `ended`, leaving the sign queue blocked. Reset readiness so
    // the current clip is injected again after the reloaded runtime announces
    // itself.
    setReady(false);
    setRuntimeError('');
    onPlaybackDiagnostic?.('avatar-web-content-terminated', 'reloading');
    onUnavailable?.();
    webView.current?.reload();
  }, [onPlaybackDiagnostic, onUnavailable]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const send = async () => {
      if (kinematicPlan) {
        setRuntimeError('');
        const script = `window.setVozualRenderMode(${JSON.stringify(renderMode)}); window.playVozualKinematicPlan(${JSON.stringify(kinematicPlan)}, ${playbackId}, ${playbackSpeed}); window.tickVozualAnimation?.(); true;`;
        webView.current?.injectJavaScript(script);
        return;
      }
      let installScript = '';
      if (clip !== 'IDLE' && clip !== 'PHRASE_WAIT') {
        const payload = await readInstalledSignPayload(clip);
        if (cancelled) return;
        if (!payload) {
          setRuntimeError(`La seña ${clip} no está descargada.`);
          onPlaybackDiagnostic?.('avatar-motion-missing', clip);
          onClipEnd();
          return;
        }
        onPlaybackDiagnostic?.(
          payload.motionDocument ? 'avatar-motion-json-frames' : 'avatar-motion-base64-bytes',
          payload.motionDocument
            ? String(payload.motionDocument.frames.length)
            : String(payload.contentBase64.length),
        );
        installScript = payload.motionDocument
          ? `window.installVozualMotionJson(${JSON.stringify(clip)}, ${JSON.stringify(payload.motionDocument)}, ${JSON.stringify(payload.avatarProfile)}); `
          : `window.installVozualMotionBase64(${JSON.stringify(clip)}, ${JSON.stringify(payload.contentBase64)}, ${JSON.stringify(payload.avatarProfile)}); `;
      }
      setRuntimeError('');
      // Keep the renderer selection and clip in one command. Android WebView
      // can defer an isolated visibility update while idle, whereas playback
      // wakes the render loop immediately.
      const script = `${installScript}window.setVozualRenderMode(${JSON.stringify(renderMode)}); window.playVozualClip(${JSON.stringify(clip)}, ${playbackId}, ${playbackSpeed}, ${continuePhrase}); window.tickVozualAnimation?.(); true;`;
      webView.current?.injectJavaScript(script);
    };
    send().catch(error => {
      if (cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[Captured skeleton] Motion load failed: ${detail}`);
      setRuntimeError(`No se pudo cargar la seña ${clip}.`);
      onPlaybackDiagnostic?.('avatar-motion-load-error', detail.slice(0, 120));
      onClipEnd();
    });
    return () => { cancelled = true; };
  }, [clip, continuePhrase, kinematicPlan, onClipEnd, onPlaybackDiagnostic, playbackId, playbackSpeed, ready, renderMode]);

  const sendZoom = useCallback(() => {
    if (!ready) return;
    webView.current?.injectJavaScript(`window.setVozualAvatarZoom(${avatarZoom}); true;`);
  }, [avatarZoom, ready]);

  useEffect(sendZoom, [sendZoom]);

  const sendRenderMode = useCallback(() => {
    if (!ready) return;
    webView.current?.postMessage(JSON.stringify({type: 'set-render-mode', mode: renderMode}));
    // Retain injection as a compatibility fallback for older WebView builds.
    webView.current?.injectJavaScript(`window.setVozualRenderMode(${JSON.stringify(renderMode)}); true;`);
  }, [ready, renderMode]);

  useEffect(sendRenderMode, [sendRenderMode]);

  useEffect(() => {
    if (!ready) return;
    webView.current?.injectJavaScript(`window.setVozualPlaybackPaused?.(${paused}); true;`);
  }, [paused, ready]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let message: RuntimeMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as RuntimeMessage;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      const riggedError = message.riggedError
        ? `No se pudo cargar el personaje: ${message.riggedError}`
        : message.riggedStatus === 'loaded' && !message.riggedAligned
          ? `El personaje cargó, pero no se alineó (${message.riggedBoneCount ?? 0} huesos; hombros: ${message.riggedHasShoulders ? 'sí' : 'no'}).`
        : '';
      if (riggedError) console.error(`[Rigged avatar] ${riggedError}`);
      setRuntimeError(riggedError);
      setReady(true);
      if (runtimeLoadStartedAt.current !== undefined) {
        onPlaybackDiagnostic?.(
          'avatar-runtime-ready-ms',
          String(Math.max(0, Date.now() - runtimeLoadStartedAt.current)),
        );
        runtimeLoadStartedAt.current = undefined;
      }
      onReady?.();
    } else if (message.type === 'ended' && message.playbackId === playbackId) {
      onPlaybackDiagnostic?.('avatar-playback-ended', clip);
      onClipEnd();
    } else if (message.type === 'error') {
      const detail = message.message || 'Error desconocido del motor 3D.';
      console.error(`[Captured skeleton] ${detail}`);
      onPlaybackDiagnostic?.('avatar-playback-error', detail.slice(0, 120));
      setRuntimeError(`No se pudo cargar el esqueleto: ${detail}`);
      onPlaybackDiagnostic?.('avatar-runtime-error', 'reported');
    }
  }, [clip, onClipEnd, onPlaybackDiagnostic, onReady, playbackId]);

  return (
    <View style={styles.container}>
      <AvatarWebView
        ref={webView}
        testID="vozual-avatar-webview"
        source={{uri: AVATAR_RUNTIME_URI}}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        onMessage={onMessage}
        onLoadStart={() => {
          runtimeLoadStartedAt.current = Date.now();
          setReady(false);
        }}
        onContentProcessDidTerminate={restartRuntime}
        style={styles.webView}
        containerStyle={styles.webView}
        overScrollMode="never"
        scrollEnabled={false}
      />
      {!ready && !runtimeError && <Text style={styles.status}>Cargando esqueleto capturado…</Text>}
      {!!runtimeError && <View style={styles.recovery}>
        <Text accessibilityRole="alert" style={styles.recoveryText}>{runtimeError}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reintentar cargar el avatar"
          onPress={restartRuntime}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>REINTENTAR AVATAR</Text>
        </Pressable>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignSelf: 'stretch', backgroundColor: '#343936'},
  webView: {flex: 1, backgroundColor: '#343936'},
  status: {position: 'absolute', alignSelf: 'center', top: '48%', color: '#D8E1EC'},
  recovery: {position: 'absolute', alignSelf: 'center', top: '43%', alignItems: 'center', gap: 12},
  recoveryText: {color: '#D8E1EC', textAlign: 'center', paddingHorizontal: 20},
  retryButton: {borderWidth: 1, borderColor: '#6FE3DF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9},
  retryButtonText: {color: '#6FE3DF', fontWeight: '700', fontSize: 12},
});
