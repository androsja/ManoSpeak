import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, StyleSheet, Text, View} from 'react-native';
import RNFS from 'react-native-fs';
import {WebView, WebViewMessageEvent} from 'react-native-webview';

const AVATAR_RUNTIME_URI = Platform.OS === 'ios'
  ? `file://${RNFS.MainBundlePath}/avatar/index.html`
  : 'file:///android_asset/avatar/index.html';

export type AvatarClip = string;
export type AvatarRenderMode = 'points' | 'rigged';

type Props = {
  clip: AvatarClip;
  playbackId: number;
  playbackSpeed: number;
  continuePhrase: boolean;
  avatarZoom: number;
  renderMode: AvatarRenderMode;
  onClipEnd: () => void;
  onReady?: () => void;
  onUnavailable?: () => void;
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

export function SkeletalAvatar({clip, playbackId, playbackSpeed, continuePhrase, avatarZoom, renderMode, onClipEnd, onReady, onUnavailable}: Props) {
  const webView = useRef<WebView>(null);
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
    onUnavailable?.();
    webView.current?.reload();
  }, [onUnavailable]);

  const sendClip = useCallback(() => {
    if (!ready) return;
    // Keep the renderer selection and clip in one command. Android WebView can
    // defer an isolated visibility update while idle, whereas playback wakes
    // the render loop immediately.
    const script = `window.setVozualRenderMode(${JSON.stringify(renderMode)}); window.playVozualClip(${JSON.stringify(clip)}, ${playbackId}, ${playbackSpeed}, ${continuePhrase}); window.tickVozualAnimation?.(); true;`;
    webView.current?.injectJavaScript(script);
  }, [clip, continuePhrase, playbackId, playbackSpeed, ready, renderMode]);

  useEffect(sendClip, [sendClip]);

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
      onReady?.();
    } else if (message.type === 'ended' && message.playbackId === playbackId) {
      onClipEnd();
    } else if (message.type === 'error') {
      const detail = message.message || 'Error desconocido del motor 3D.';
      console.error(`[Captured skeleton] ${detail}`);
      setRuntimeError(`No se pudo cargar el esqueleto: ${detail}`);
    }
  }, [onClipEnd, onReady, playbackId]);

  return (
    <View style={styles.container}>
      <WebView
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
        onLoadStart={() => setReady(false)}
        onContentProcessDidTerminate={restartRuntime}
        style={styles.webView}
        containerStyle={styles.webView}
        overScrollMode="never"
        scrollEnabled={false}
      />
      {!ready && !runtimeError && <Text style={styles.status}>Cargando esqueleto capturado…</Text>}
      {!!runtimeError && <Text style={styles.status}>{runtimeError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignSelf: 'stretch', backgroundColor: '#343936'},
  webView: {flex: 1, backgroundColor: '#343936'},
  status: {position: 'absolute', alignSelf: 'center', top: '48%', color: '#D8E1EC'},
});
