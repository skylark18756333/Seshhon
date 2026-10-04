// Frenzy phone app: a native shell around the live web app in docs/.
// The shell adds what a web page can't do well on a phone: the native share sheet, the Android back
// button, opening outside links in the browser, invite links, and a proper screen when there is no signal.
// Everything else (sign-up, friends, status, sesh chat) is the live web app, so it stays in one place.
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

const BG = '#050506';
const FG = '#F4F1EA';
const GREEN = '#3DDC84';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://skylark18756333.github.io/Seshhon/';
const WEB_ORIGIN = new URL(WEB_URL).origin;
const WEB_PATH = new URL(WEB_URL).pathname;

// Runs in the page before its own script, so the page's existing "share" button uses the phone's share sheet.
const BRIDGE = `
(function () {
  window.SESHHON_NATIVE = ${JSON.stringify(Platform.OS)};
  navigator.share = function (data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'share', data: data || {} }));
    return Promise.resolve();
  };
})();
true;
`;

// seshhon://invite/ABC123, seshhon://?invite=ABC123 or a web invite link all open the app on that invite.
function inviteFrom(url: string | null): string | null {
  if (!url) return null;
  const query = url.match(/[?&]invite=([A-Za-z0-9_-]{1,16})/);
  if (query) return query[1];
  const path = url.match(/^seshhon:\/\/invite\/([A-Za-z0-9_-]{1,16})/);
  return path ? path[1] : null;
}
function pageFor(invite: string | null): string {
  return invite ? WEB_URL + '?invite=' + encodeURIComponent(invite) : WEB_URL;
}

function Shell() {
  const web = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);

  // Open on the invite the app was launched with, and follow invite links tapped while it is open.
  useEffect(() => {
    Linking.getInitialURL().then((url) => setUri(pageFor(inviteFrom(url)))).catch(() => setUri(WEB_URL));
    const sub = Linking.addEventListener('url', ({ url }) => {
      const invite = inviteFrom(url);
      if (invite) { setFailed(false); setUri(pageFor(invite) + '#' + Date.now()); }
    });
    return () => sub.remove();
  }, []);

  // Android back button: go back inside the app (e.g. from the privacy page) before leaving it.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; data?: { title?: string; text?: string; url?: string } } | null = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type !== 'share' || !msg.data) return;
    const { title, text, url } = msg.data;
    const message = [text, url].filter(Boolean).join(' ');
    Share.share(Platform.OS === 'ios' && url ? { title, message: text || '', url } : { title, message }).catch(() => {});
  }, []);

  // Pages of the web app open inside the app; anything else (a venue's website, maps, email) opens outside it.
  const onNavigate = useCallback((req: WebViewNavigation & { isTopFrame?: boolean }) => {
    if (req.isTopFrame === false) return true;
    const url = req.url;
    if (url === 'about:blank') return true;
    if (url.startsWith(WEB_ORIGIN + WEB_PATH) || url === WEB_ORIGIN + WEB_PATH.replace(/\/$/, '')) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  if (failed) {
    return (
      <View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frenzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); web.current?.reload(); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!uri) return <View style={styles.fill} />;

  return (
    <WebView
      ref={web}
      source={{ uri }}
      style={styles.fill}
      containerStyle={styles.fill}
      originWhitelist={['https://*', 'http://*', 'about:*']}
      injectedJavaScriptBeforeContentLoaded={BRIDGE}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onNavigate}
      onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
      onError={() => setFailed(true)}
      onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
      onContentProcessDidTerminate={() => web.current?.reload()}
      onRenderProcessGone={() => web.current?.reload()}
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      domStorageEnabled
      geolocationEnabled
      javaScriptEnabled
      sharedCookiesEnabled
      pullToRefreshEnabled={false}
      overScrollMode="never"
      bounces={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      textZoom={100}
      webviewDebuggingEnabled={__DEV__}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" />
        <Shell />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  fill: { flex: 1, backgroundColor: BG },
  offline: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: FG, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  body: { color: FG, opacity: 0.8, fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: GREEN, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 28 },
  buttonText: { color: BG, fontSize: 16, fontWeight: '800' },
});
