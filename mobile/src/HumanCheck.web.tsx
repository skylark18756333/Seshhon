// The browser version of the human check, used by tools/live/native.mjs to try the screens out: it loads Turnstile
// straight into the page, as docs/app.js does, so the test's pretend Turnstile can answer it.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Text } from 'react-native';
import { CAPTCHA_SITE_KEY } from './config';
import { C, F } from './theme';

export type HumanCheckHandle = { take: () => Promise<string> };

const HumanCheck = forwardRef<HumanCheckHandle, { onWait?: (waiting: boolean) => void }>(function HumanCheck({ onWait }, ref) {
  const box = useRef<any>(null);
  const token = useRef('');
  const widget = useRef<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!CAPTCHA_SITE_KEY) return;
    const w = window as any;
    let gone = false;
    const mount = () => {
      if (gone || !box.current) return;
      widget.current = w.turnstile.render(box.current, {
        sitekey: CAPTCHA_SITE_KEY,
        callback: (t: string) => { token.current = t; },
        'expired-callback': () => { token.current = ''; },
        'error-callback': () => { token.current = ''; }
      });
    };
    if (w.turnstile) mount();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = mount;
      s.onerror = () => setFailed(true);
      document.head.appendChild(s);
    }
    return () => { gone = true; try { if (widget.current !== null) w.turnstile.remove(widget.current); } catch (e) {} };
  }, []);

  useImperativeHandle(ref, () => ({
    take: () => {
      if (!CAPTCHA_SITE_KEY) return Promise.resolve('');
      return new Promise<string>((resolve, reject) => {
        const started = Date.now();
        if (!token.current && onWait) onWait(true);
        const wait = () => {
          if (token.current) {
            const t = token.current;
            token.current = '';
            try { (window as any).turnstile.reset(widget.current); } catch (e) {}
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
  if (failed) return <Text style={{ fontFamily: F.bodyMid, fontSize: 14, color: C.off }}>The "are you human" check couldn't load. Check your internet connection, then try again.</Text>;
  return React.createElement('div', { ref: box, style: { minHeight: 20, color: C.muted, fontFamily: 'sans-serif', fontSize: 13 } });
});
export default HumanCheck;
