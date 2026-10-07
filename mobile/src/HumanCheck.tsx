// The Cloudflare Turnstile "are you human" check on sign-up, login and recovery (mountCaptcha and captchaReady
// in docs/app.js). Turnstile only runs in a web page, so the phone shows it in a small WebView that is given the
// website's address (the widget's hostname list in Cloudflare has frendzy.au on it) and passes the token back.
// take() waits for the check to finish, hands over the token once, and starts a fresh check for any retry.
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import { CAPTCHA_SITE_KEY } from './config';
import { C, F } from './theme';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
export type HumanCheckHandle = { take: () => Promise<string> };

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:#050506;display:flex;align-items:center;justify-content:center}</style>
<script>
function post(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
var widget = null;
function mount(){
  if (!window.turnstile) return setTimeout(mount, 100);
  widget = window.turnstile.render('#box', {
    sitekey: ${JSON.stringify(CAPTCHA_SITE_KEY)}, theme: 'dark',
    callback: function (t) { post({ type: 'token', token: t }); },
    'expired-callback': function () { post({ type: 'expired' }); },
    'error-callback': function (code) { post({ type: 'expired' }); }
  });
}
window.resetCheck = function () { if (window.turnstile && widget !== null) { try { window.turnstile.reset(widget); } catch (e) {} } };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onload="mount()" onerror="post({ type: 'load-failed' })"></script>
</head><body><div id="box"></div></body></html>`;

const HumanCheck = forwardRef<HumanCheckHandle, { onWait?: (waiting: boolean) => void }>(function HumanCheck({ onWait }, ref) {
  const token = useRef('');
  const web = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'token') token.current = String(m.token || '');
      else if (m.type === 'expired') token.current = '';
      else if (m.type === 'load-failed') setFailed(true);
    } catch (x) {}
  }, []);

  useImperativeHandle(ref, () => ({
    // Waits for the human check to finish (it can take a few seconds, or ask for a tap) instead of turning the person away.
    take: () => {
      if (!CAPTCHA_SITE_KEY) return Promise.resolve('');
      return new Promise<string>((resolve, reject) => {
        const started = Date.now();
        if (!token.current && onWait) onWait(true);
        const wait = () => {
          if (token.current) {
            const t = token.current;
            token.current = '';   // a token works once, so get a fresh one for any retry
            web.current?.injectJavaScript('window.resetCheck && window.resetCheck(); true;');
            if (onWait) onWait(false);
            return resolve(t);
          }
          if (Date.now() - started > 30000) {
            if (onWait) onWait(false);
            return reject(new Error('The "are you human" check didn\'t finish. If it asks you to tap it, tap it, then try again.'));
          }
          setTimeout(wait, 200);
        };
        wait();
      });
    }
  }), [onWait]);

  if (!CAPTCHA_SITE_KEY) return null;
  if (failed) return <Text style={styles.error}>The "are you human" check couldn't load. Check your internet connection, then try again.</Text>;
  return (
    <View style={styles.box}>
      <WebView
        ref={web}
        source={{ html: PAGE, baseUrl: WEB_URL }}
        style={styles.web}
        originWhitelist={['https://*', 'http://*', 'about:*']}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        accessibilityLabel="Are you human check"
      />
    </View>
  );
});
export default HumanCheck;

const styles = StyleSheet.create({
  box: { height: 70, borderRadius: 14, overflow: 'hidden', backgroundColor: C.bg },
  web: { flex: 1, backgroundColor: C.bg },
  error: { fontFamily: F.bodyMid, fontSize: 14, color: C.off }
});
