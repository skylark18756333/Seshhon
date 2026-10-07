// Frendzy phone app. Signing up, logging in (with its email code and the 18+ check), Home, Sesh and You are native
// screens; the map, venues and events tabs are the web app in docs/, packed into the app by scripts/bundle-web.mjs,
// so they open on their own without loading the website. Only the "are you human" check and the age check
// provider's page are web pages on the sign-up and login screens. Both halves talk to the same database over the internet.
// The app owns the sign-in: it keeps it in the phone's secure storage and hands it to the packed page, which
// is shown as if it were at frendzy.au, so logins, the human check and invite links work as on the web.
// The shell adds what a web page can't do well on a phone: the native share sheet, the Android back
// button, opening outside links in the browser, invite links, and a proper screen when there is no signal.
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { Colour } from './src/api';
import Home from './src/Home';
import AgeCheck from './src/AgeCheck';
import Auth, { type AuthDone, type AuthStart } from './src/Auth';
import Crews from './src/Crews';
import { Glow, Toast } from './src/Parts';
import { askAfterTour, registerPushToken, watchNotificationTaps } from './src/push';
import Sesh from './src/Sesh';
import Tabs from './src/Tabs';
import Tour from './src/Tour';
import TwoStep from './src/TwoStep';
import You from './src/You';
import { C, first } from './src/theme';
import { useFrendzy } from './src/useFrendzy';
import { SESSION_KEY, clearTour, currentSession, loadStoredSession, onSessionChange, pageStoreScript, pageStored, pendingInvite, rpc, sessionForPage, setPendingInvite, setSession, tourPending, type ApiError, type Session } from './src/session';
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
const NATIVE_TABS = ['home', 'sesh', 'you', 'crews'];   // the tabs with a native screen ('crews' is opened from You or Home, and shows You in the tab bar)
// venue: open the page on that venue's page (from the native Sesh tab); closing it goes back to the Sesh tab.
function bridge(tab: string | null, venue: string | null): string {
  const saved = sessionForPage();
  const want = venue ? 'sesh' : tab && PAGE_TABS.indexOf(tab) >= 0 ? tab : 'home';
  return `
(function () {
  window.SESHHON_NATIVE = ${JSON.stringify(Platform.OS)};
  window.SESHHON_TAB = ${JSON.stringify(want)};${venue ? `
  window.SESHHON_VENUE = ${JSON.stringify(venue)};` : ''}
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
  // Inside the app the app draws the status glow behind the status bar, so the page's own background is clear.
  document.addEventListener('DOMContentLoaded', function () {
    var st = document.createElement('style');
    st.textContent = 'html,body{background:transparent !important}';
    document.head.appendChild(st);
  });
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

// The screen's base: the background colour over the whole phone, the status glow (native tabs only) drawn from the
// very top edge, and the content kept clear of the status bar, notch and home bar. The glow is outside the padded
// area on purpose, so it reaches behind the status bar.
function Layer({ glow, children }: { glow?: Colour; children: React.ReactNode }) {
  const inset = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      {glow ? <Glow colour={glow} /> : null}
      <View style={[styles.fill, styles.clear, { paddingTop: inset.top, paddingBottom: inset.bottom, paddingLeft: inset.left, paddingRight: inset.right }]}>
        {children}
      </View>
    </View>
  );
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
  // True while the native sign-up or login screens are in the middle of something that needs a sign-in to exist
  // (the age check, the email code, the recovery code): they keep the screen until they say they are done, so
  // those steps are never cut short by the native Home.
  const [authOwns, setAuthOwns] = useState(false);
  // Which sign-in screen opens first, and a line for it to show (after a log out or a deleted account).
  const [authStart, setAuthStart] = useState<AuthStart>('join');
  // The walkthrough, shown over Home after sign-up until it is finished or skipped.
  const [tour, setTour] = useState(false);
  const [inviteTick, setInviteTick] = useState(0);
  // Which tab is open. 'home' and 'sesh' are native screens; anything else is the packed page, shown on that
  // tab. 'venue' is the packed page showing one venue, opened from the native Sesh tab.
  const [tab, setTab] = useState('home');
  const [venue, setVenue] = useState<string | null>(null);
  // The tab to go back to from the You page or Crews (Android back button, and Crews' own back arrow).
  const [before, setBefore] = useState('home');
  // A line for the page to show once it opens, after the native You page logged out or deleted the account.
  const [pageNote, setPageNote] = useState<string | null>(null);   // read when the sign-in screen opens

  const signedIn = !!session;
  const onWeb = !NATIVE_TABS.includes(tab);
  const f = useFrendzy(signedIn && !authOwns, onWeb);
  const me = f.state && f.state.me;
  const native = signedIn && !authOwns && f.phase === 'ready' && !!me;
  // Signed out, in the middle of signing up, or signed in as someone who never finished making an account.
  const needsAuth = session !== undefined && (!signedIn || authOwns || (f.phase === 'ready' && !me));

  // Open on the invite the app was launched with, and follow invite links tapped while it is open.
  useEffect(() => {
    // The invite code is kept until someone is signed in (the sign-up screen says a friend invited you), then the
    // friend request is sent (sendPendingInvite in docs/app.js).
    Linking.getInitialURL().then((url) => {
      const invite = inviteFrom(url);
      if (invite) { setPendingInvite(invite); setInviteTick((n) => n + 1); }
      setPage(WEB_URL);
    }).catch(() => setPage(WEB_URL));
    const sub = Linking.addEventListener('url', ({ url }) => {
      const invite = inviteFrom(url);
      if (invite) { setPendingInvite(invite); setInviteTick((n) => n + 1); }
    });
    return () => sub.remove();
  }, []);

  // The sign-in: read it once, then follow it (the page tells the app when it changes, and so does a log out).
  useEffect(() => {
    loadStoredSession().then((s) => { setLocalSession(s); if (!s) setAuthOwns(true); });
    return onSessionChange((s) => {
      setLocalSession(s);
      if (!s) { setTab('home'); setAuthOwns(true); }   // signed out: the sign-up and login screens show again
    });
  }, []);

  // Android back button: go back inside the page, then out of the page to Home, before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (onWeb && canGoBack && web.current) { web.current.goBack(); return true; }
      if (onWeb && native) { setTab(tab === 'venue' ? 'sesh' : 'home'); return true; }
      if (native && (tab === 'you' || tab === 'crews')) { setTab(before); return true; }
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
    if (msg?.type === 'ready') return;   // the packed page is past its own sign-in (the native screens do that now)
    // The page's sign-in changed (sign-up, login, a refreshed token, log out): the app keeps the new one.
    if (msg?.type === 'session') { setSession(msg.session || null); return; }
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
    // 'you' and 'crews' remember where they were opened from; from Crews to You, back goes where Crews came from.
    if (next === 'you' || next === 'crews') setBefore(tab === 'crews' ? (before === 'you' ? 'home' : before) : tab === 'venue' ? 'sesh' : tab);
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

  // Tapping a notification opens the screen it is about (Home, Sesh or Crews), once the native screens are up.
  const [tapTab, setTapTab] = useState<string | null>(null);
  useEffect(() => watchNotificationTaps(setTapTab), []);
  useEffect(() => {
    if (!native || !tapTab) return;
    setTapTab(null);
    pickTab(tapTab);
  }, [native, tapTab, pickTab]);

  // The native You page logged out or deleted the account (it already cleared the sign-in): the login screen
  // opens and says what happened.
  const signedOut = useCallback((note: string) => {
    setPageNote(note);
    setAuthStart('join');
    setTour(false);
    setVenue(null);
  }, []);

  // The sign-up and login screens are done (a login, or the recovery code saved after sign-up): the native
  // screens load, and a new account gets the tour.
  const authDone = useCallback((r: AuthDone) => {
    setPageNote(null);
    setAuthOwns(false);
    if (r.you) { setBefore('home'); setTab('you'); } else setTab('home');
    if (r.tour) setTour(true);
    if (r.note) setTimeout(() => f.say(r.note as string), 600);
    f.retry();
  }, [f.retry, f.say]);

  // Everything the native screens do once a person is signed in and the screens are up.
  useEffect(() => {
    if (!native) return;
    const s = currentSession();
    registerPushToken(s ? s.user_id : null).catch(() => {});   // refreshes the push token when notifications are already allowed (never asks)
    if (tourPending()) setTour(true);
  }, [native]);
  // An invite link opened before or after signing in: the friend request goes out as soon as there is an account.
  useEffect(() => {
    if (!native || !pendingInvite()) return;
    const code = pendingInvite() as string;
    setPendingInvite(null);
    rpc('request_friend', { p_code: code }).then((r: any) => {
      if (r && r.state === 'accepted') f.say('You and ' + first(r.name) + ' are now friends.');
      else if (r) f.say('Friend request sent to ' + first(r.name) + '.');
      f.refresh();
    }, (e: ApiError) => { if (!e.signedOut) f.say(e.message); });
  }, [native, inviteTick]);

  if (failed) {
    return (
      <Layer><View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frendzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); f.retry(); web.current?.reload(); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View></Layer>
    );
  }
  // The native screens could not reach the database at all.
  if (signedIn && f.phase === 'failed') {
    return (
      <Layer><View style={styles.offline}>
        <Text style={styles.title}>No connection</Text>
        <Text style={styles.body}>Frendzy needs the internet to see who's out. Check your signal and try again.</Text>
        <Pressable style={styles.button} onPress={f.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View></Layer>
    );
  }

  if (!page || session === undefined) return <Layer><View style={styles.fill} /></Layer>;

  // Not signed in, or in the middle of signing up: the native sign-up and login screens.
  if (needsAuth) return <Layer><Auth start={authStart} note={pageNote} onDone={authDone} /></Layer>;

  // The emailed login code, and the 18+ check, for an account that has just logged in.
  if (signedIn && f.phase === 'twostep') {
    return (
      <Layer>
        <TwoStep
          onDone={f.retry}
          onRecover={() => { setAuthStart('recover'); setSession(null); }}
          onCancel={() => { clearTour(); setAuthStart('join'); setSession(null); }}
        />
      </Layer>
    );
  }
  if (signedIn && f.phase === 'age') {
    return <Layer><AgeCheck onPassed={() => { f.say("Thanks, you're verified."); f.retry(); }} /><Toast text={f.toast} /></Layer>;
  }
  if (signedIn && f.phase === 'loading') return <Layer><View style={styles.fill} /></Layer>;

  const webView = (
    <WebView
      key={opens}
      ref={web}
      source={{ html: APP_HTML, baseUrl: page }}
      style={styles.clearFill}
      containerStyle={styles.clearFill}
      originWhitelist={['https://*', 'http://*', 'about:*']}
      injectedJavaScriptBeforeContentLoaded={bridge(tab, tab === 'venue' ? venue : null)}
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

  // Venue and admin accounts are run from a computer.
  if (signedIn && f.phase === 'computer') {
    return (
      <Layer><View style={styles.offline}>
        <Text style={styles.title}>Use frendzy.au on a computer</Text>
        <Text style={styles.body}>Venue and admin accounts are run from a computer. The phone app is for people going out.</Text>
        <Pressable style={styles.button} onPress={() => { clearTour(); setAuthStart('join'); setSession(null); }} accessibilityRole="button">
          <Text style={styles.buttonText}>Log out</Text>
        </Pressable>
      </View></Layer>
    );
  }

  if (!native) return <Layer><View style={styles.fill} /></Layer>;

  return (
    <Layer glow={me ? me.colour : undefined}>
      {onWeb ? webView
        : tab === 'sesh' ? <Sesh f={f} onOpenWeb={pickTab} onVenue={openVenue} />
        : tab === 'you' ? <You f={f} onOpenWeb={pickTab} onSignedOut={signedOut} />
        : tab === 'crews' ? <Crews f={f} onBack={() => setTab(before)} onPlanned={() => pickTab('sesh')} />
        : <Home f={f} onOpenWeb={pickTab} />}
      <Tabs tab={tab === 'venue' ? 'sesh' : tab === 'crews' ? 'you' : tab} requests={f.state ? f.state.requests_in.length : 0} onPick={pickTab} />
      {tour && me ? <Tour name={first(me.name)} onClose={() => { clearTour(); setTour(false); askAfterTour().catch(() => {}); }} /> : null}
    </Layer>
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
      <StatusBar style="light" />
      {fontsReady ? <Shell /> : <Layer><View style={styles.fill} /></Layer>}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  fill: { flex: 1, backgroundColor: BG },
  clear: { backgroundColor: 'transparent' },
  clearFill: { flex: 1, backgroundColor: 'transparent' },
  offline: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: FG, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  body: { color: FG, opacity: 0.8, fontSize: 16, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: GREEN, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 28 },
  buttonText: { color: BG, fontSize: 16, fontWeight: '800' }
});
