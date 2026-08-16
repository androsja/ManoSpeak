import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {WebView, WebViewMessageEvent} from 'react-native-webview';

export type AvatarClip = string;

type Props = {
  clip: AvatarClip;
  playbackId: number;
  onClipEnd: () => void;
  onReady?: () => void;
};

type RuntimeMessage = {
  type?: 'ready' | 'ended' | 'error';
  playbackId?: number;
  message?: string;
};

export function SkeletalAvatar({clip, playbackId, onClipEnd, onReady}: Props) {
  const webView = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');

  const sendClip = useCallback(() => {
    if (!ready) return;
    const script = `window.playVozualClip(${JSON.stringify(clip)}, ${playbackId}); true;`;
    webView.current?.injectJavaScript(script);
  }, [clip, playbackId, ready]);

  useEffect(sendClip, [sendClip]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let message: RuntimeMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as RuntimeMessage;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      setRuntimeError('');
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
        source={{uri: 'file:///android_asset/avatar/index.html'}}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        onMessage={onMessage}
        onContentProcessDidTerminate={() => webView.current?.reload()}
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
