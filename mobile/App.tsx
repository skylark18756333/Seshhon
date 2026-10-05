// Frendzy phone app. The screens are the web app in docs/, packed into the app by scripts/bundle-web.mjs, so
// the app opens on its own without loading the website. It still talks to the same database over the internet.
// The page is shown as if it were at frendzy.au, so logins, the human check and invite links work as on the web.
// The shell adds what a web page can't do well on a phone: the native share sheet, the Android back
// button, opening outside links in the browser, invite links, and a proper screen when there is no signal.
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import APP_HTML from './web/app-html.generated';

const BG = '#050506';
const FG = '#F4F1EA';
const GREEN = '#3DDC84';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
const WEB_ORIGIN = new URL(WEB_URL).origin;
const WEB_PATH = new URL(WEB_URL).pathname;
const AGE_CHECK_HOSTS = ['https://verify.didit.me/', 'https://age.yoti.com'];

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
  // The address the packed page pretends to be at (frendzy.au, plus ?invite=... when opened from an invite).
  const [page, setPage] = useState<string | null>(null);
  const [opens, setOpens] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [failed, setFailed] = useState(false);

  // Open on the invite the app was launched with, and follow invite links tapped while it is open.
  useEffect(() => {
    Linking.getInitialURL().then((url) => setPage(pageFor(inviteFrom(url)))).catch(() => setPage(WEB_URL));
    const sub = Linking.addEventListener('url', ({ url }) => {
      const invite = inviteFrom(url);
      if (invite) { setFailed(false); setPage(pageFor(invite)); setOpens((n) => n + 1); }
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
    if (url === 'about:blank' || url === page) return true;
    // Coming back to the app's own address (e.g. from the age check): show the packed page again, not the website.
    const own = WEB_ORIGIN + WEB_PATH;
    if (url === own.replace(/\/$/, '') || url.startsWith(own + '?') || url.startsWith(own + '#')) {
      setPage(url); setOpens((n) => n + 1);
      return false;
    }
    if (url.startsWith(own)) return true;
    // The 18+ age check runs on the provider's page; it stays in the app so it can send the person back here.
    if (AGE_CHECK_HOSTS.some((h) => url.startsWith(h))) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }, [page]);

  if (failed) {
    return (
      <View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frendzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); web.current?.reload(); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!page) return <View style={styles.fill} />;

  return (
    <WebView
      key={opens}
      ref={web}
      source={{ html: APP_HTML, baseUrl: page }}
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
