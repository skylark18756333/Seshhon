// Frendzy phone app. Home, Sesh and You are native screens; every other tab (map, venues, events, and signing
// up or logging in) is the web app in docs/, packed into the app by scripts/bundle-web.mjs, so it opens on its
// own without loading the website. Both halves talk to the same database over the internet.
// The app owns the sign-in: it keeps it in the phone's secure storage and hands it to the packed page, which
// is shown as if it were at frendzy.au, so logins, the human check and invite links work as on the web.
// The shell adds what a web page can't do well on a phone: the native share sheet, the Android back
// button, opening outside links in the browser, invite links, and a proper screen when there is no signal.
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import Home from './src/Home';
import Sesh from './src/Sesh';
import Tabs from './src/Tabs';
import You from './src/You';
import { C } from './src/theme';
import { useFrendzy } from './src/useFrendzy';
import { SESSION_KEY, loadStoredSession, onSessionChange, pageStoreScript, pageStored, sessionForPage, setSession, type Session } from './src/session';
import APP_HTML from './web/app-html.generated';

const BG = C.bg;
const FG = '#F4F1EA';
const GREEN = C.on;

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
const WEB_ORIGIN = new URL(WEB_URL).origin;
const WEB_PATH = new URL(WEB_URL).pathname;
const AGE_CHECK_HOSTS = ['https://verify.didit.me/', 'https://age.yoti.com'];

// Runs in the page before its own script: the page's "share" button uses the phone's share sheet, the page
// starts on the tab the app asked for, and it starts signed in as whoever the app is signed in as.
const PAGE_TABS = ['home', 'sesh', 'map', 'venues', 'events', 'you'];
const NATIVE_TABS = ['home', 'sesh', 'you'];   // the tabs with a native screen
// venue: open the page on that venue's page (from the native Sesh tab); closing it goes back to the Sesh tab.
// note: a line for the page to show when it opens (after a log out or a deleted account on the native You page).
function bridge(tab: string | null, venue: string | null, note: string | null): string {
  const saved = sessionForPage();
  const want = venue ? 'sesh' : tab && PAGE_TABS.indexOf(tab) >= 0 ? tab : 'home';
  return `
(function () {
  window.SESHHON_NATIVE = ${JSON.stringify(Platform.OS)};
  window.SESHHON_TAB = ${JSON.stringify(want)};${venue ? `
  window.SESHHON_VENUE = ${JSON.stringify(venue)};` : ''}${note ? `
  window.SESHHON_TOAST = ${JSON.stringify(note)};` : ''}
  // The app is where the sign-in lives, so the page is given it before the page looks for one of its own.
  try {
    ${saved
      ? `localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(saved)});`
      : `localStorage.removeItem(${JSON.stringify(SESSION_KEY)});`}
  } catch (e) {}
  // The other things the native screens changed in the page's storage (remembered phone, last username, tour).
  try {
    ${pageStoreScript()}
  } catch (e) {}
  navigator.share = function (data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'share', data: data || {} }));
    return Promise.resolve();
  };
})();
true;
`;
}
// While the app's own tab bar is on screen, the page's tab bar would be a second one, so it is hidden.
const HIDE_PAGE_TABS = "(function () { var n = document.getElementById('tabs'); if (n) n.style.display = 'none'; })(); true;";

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
  // The sign-in, read off the phone at start-up: undefined while it is being read, null when nobody is signed in.
  const [session, setLocalSession] = useState<Session | null | undefined>(undefined);
  // True while the packed page is in the middle of signing someone up or in: it keeps the screen until it says
  // it is done, so the recovery code, the login code and the age check are never cut short by the native Home.
  const [webOwns, setWebOwns] = useState(false);
  // Which tab is open. 'home' and 'sesh' are native screens; anything else is the packed page, shown on that
  // tab. 'venue' is the packed page showing one venue, opened from the native Sesh tab.
  const [tab, setTab] = useState('home');
  const [venue, setVenue] = useState<string | null>(null);
  // The tab to go back to from the You page (Android back button).
  const [before, setBefore] = useState('home');
  // A line for the page to show once it opens, after the native You page logged out or deleted the account.
  const [pageNote, setPageNote] = useState<string | null>(null);

  const signedIn = !!session;
  const onWeb = !NATIVE_TABS.includes(tab);
  const f = useFrendzy(signedIn, onWeb);
  const me = f.state && f.state.me;
  const native = signedIn && f.phase === 'ready' && !!me && !webOwns;

  // Open on the invite the app was launched with, and follow invite links tapped while it is open.
  useEffect(() => {
    Linking.getInitialURL().then((url) => setPage(pageFor(inviteFrom(url)))).catch(() => setPage(WEB_URL));
    const sub = Linking.addEventListener('url', ({ url }) => {
      const invite = inviteFrom(url);
      // An invite is accepted by the web half, so the page opens on it.
      if (invite) { setFailed(false); setTab('invite'); setPage(pageFor(invite)); setOpens((n) => n + 1); }
    });
    return () => sub.remove();
  }, []);

  // The sign-in: read it once, then follow it (the page tells the app when it changes, and so does a log out).
  useEffect(() => {
    loadStoredSession().then((s) => { setLocalSession(s); if (!s) setWebOwns(true); });
    return onSessionChange((s) => {
      setLocalSession(s);
      if (!s) { setTab('home'); setWebOwns(true); }   // signed out: the page shows sign-up and login again
    });
  }, []);

  // Android back button: go back inside the page, then out of the page to Home, before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (onWeb && canGoBack && web.current) { web.current.goBack(); return true; }
      if (onWeb && native) { setTab(tab === 'venue' ? 'sesh' : 'home'); return true; }
      if (native && tab === 'you') { setTab(before); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack, onWeb, native, tab, before]);

  // The page says which tab it moved to by itself (closing a venue, "Stop 2 on the Sesh Map", voting from a
  // venue page): Home and Sesh are native, so the app shows its own screen for those.
  const nativeNow = useRef(false);
  nativeNow.current = native;

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; data?: { title?: string; text?: string; url?: string }; session?: Session | null; tab?: unknown } | null = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    // The page is past sign-up and the checks, so the native screens can take over.
    if (msg?.type === 'ready') { setWebOwns(false); setPageNote(null); return; }
    // The page's sign-in changed (sign-up, login, a refreshed token, log out): the app keeps the new one.
    if (msg?.type === 'session') { setSession(msg.session || null); if (msg.session) setPageNote(null); return; }
    // The page changed something else the native screens also keep (remembered phone, last username, tour).
    if (msg?.type === 'store') {
      const m = msg as { key?: unknown; value?: unknown };
      if (typeof m.key === 'string') pageStored(m.key, typeof m.value === 'string' ? m.value : null);
      return;
    }
    if (msg?.type === 'tab') {
      const next = typeof msg.tab === 'string' ? msg.tab : '';
      if (nativeNow.current && PAGE_TABS.indexOf(next) >= 0) setTab((now) => (now === next ? now : next));
      return;
    }
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

  // Tapping a tab: Home and Sesh are native screens, the rest open the page. If the page is already open it
  // is just told to switch tabs, which keeps the map where it was.
  const pickTab = useCallback((next: string) => {
    if (next === tab) return;
    if (next === 'you') setBefore(tab === 'venue' ? 'sesh' : tab);
    if (!NATIVE_TABS.includes(next) && onWeb && web.current) {
      web.current.injectJavaScript('window.FrendzyNative && window.FrendzyNative.go(' + JSON.stringify(next) + '); true;');
      setTab(next);
      return;
    }
    setFailed(false);
    setTab(next);
    setVenue(null);
    if (!NATIVE_TABS.includes(next)) { setPage(WEB_URL); setOpens((n) => n + 1); }
  }, [tab, onWeb]);

  // A venue from the native Sesh tab: the packed page opens on that venue's page (it has the map and the
  // venue's details); its back button returns to the Sesh tab.
  const openVenue = useCallback((id: string) => {
    setFailed(false);
    setVenue(id);
    setTab('venue');
    setPage(WEB_URL); setOpens((n) => n + 1);
  }, []);

  // The native You page logged out or deleted the account (it already cleared the sign-in): the page opens
  // fresh, without the sign-in, and says what happened.
  const signedOut = useCallback((note: string) => {
    setPageNote(note);
    setFailed(false);
    setVenue(null);
    setPage(WEB_URL); setOpens((n) => n + 1);
  }, []);

  if (failed) {
    return (
      <View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frendzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); f.retry(); web.current?.reload(); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  // The native screens could not reach the database at all.
  if (signedIn && f.phase === 'failed') {
    return (
      <View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frendzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={f.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!page || session === undefined || (signedIn && f.phase === 'loading')) return <View style={styles.fill} />;

  const webView = (
    <WebView
      key={opens}
      ref={web}
      source={{ html: APP_HTML, baseUrl: page }}
      style={styles.fill}
      containerStyle={styles.fill}
      originWhitelist={['https://*', 'http://*', 'about:*']}
      injectedJavaScriptBeforeContentLoaded={bridge(tab, tab === 'venue' ? venue : null, pageNote)}
      injectedJavaScript={native ? HIDE_PAGE_TABS : undefined}
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

  // Not signed in, or an account the native screens don't cover yet (a login code, the 18+ check, a venue
  // account): the packed page runs the whole app, with its own tab bar.
  if (!native) return webView;

  return (
    <View style={styles.fill}>
      {onWeb ? webView
        : tab === 'sesh' ? <Sesh f={f} onOpenWeb={pickTab} onVenue={openVenue} />
        : tab === 'you' ? <You f={f} onOpenWeb={pickTab} onSignedOut={signedOut} />
        : <Home f={f} onOpenWeb={pickTab} />}
      <Tabs tab={tab === 'venue' ? 'sesh' : tab} requests={f.state ? f.state.requests_in.length : 0} onPick={pickTab} />
    </View>
  );
}

export default function App() {
  // The web app's fonts, as .ttf files a phone can load (see assets/fonts).
  const [fontsReady] = useFonts({
    'TiltNeon-Regular': require('./assets/fonts/TiltNeon-Regular.ttf'),
    'Montserrat-Bold': require('./assets/fonts/Montserrat-Bold.ttf'),
    'Montserrat-ExtraBold': require('./assets/fonts/Montserrat-ExtraBold.ttf'),
    'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
    'Inter-Bold': require('./assets/fonts/Inter-Bold.ttf')
  });
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" />
        {fontsReady ? <Shell /> : <View style={styles.fill} />}
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
  buttonText: { color: BG, fontSize: 16, fontWeight: '800' }
});
