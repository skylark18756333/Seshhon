# Frendzy phone app (iPhone and Android)

This folder is the app that goes in the App Store and Google Play. It is being rebuilt screen by screen:
**Home is a real phone screen** (`src/Home.tsx`), and every other screen is still the web app in `docs/`,
packed into the app when it is built (`npm run bundle-web`, which writes `web/app-html.generated.ts`), so
it opens on its own without loading the website. Both halves use the same database over the internet.

## The two halves

- `src/session.ts` is the sign-in and the two ways of talking to the database (`authCall`, `refreshSession`,
  `rpc`), ported from `docs/app.js`. The app owns the sign-in: it keeps it in the phone's secure storage
  (`expo-secure-store`) under the same name the web app uses in the browser, `seshhon-session-v1`.
- `App.tsx` hands that sign-in to the packed page before the page's own scripts run, so the page opens
  already signed in. The page tells the app whenever its sign-in changes (sign-up, login, a refreshed token,
  log out) and the app saves the new one. The page also says when it is past sign-up, the login code and the
  age check, so none of those steps is cut short by the native Home appearing over them.
- The tab bar at the bottom is native. Home is the native screen; the other tabs open the packed page on that
  tab (the page is told which tab to open, and which to switch to while it is already open). Signing up or
  logging in stays on the packed page for now, because of the "are you human" check.
- Accounts the native screens don't cover yet — waiting for a login code, the 18+ check, venue and admin
  accounts — are handed to the packed page in full, with its own tab bar.

The fonts in `assets/fonts` are the web app's fonts from `docs/fonts`, saved as `.ttf` (which phones can load)
instead of `.woff2`. They carry the same licences, which are in that folder.

Because the screens travel inside the app, a change to `docs/` reaches phones only with the next app build.
Build a new version after web changes, especially ones that go with a database change.

The shell adds the parts a web page can't do well on a phone:

- the phone's own share sheet for invite links
- the Android back button
- outside links (a venue's website, maps) open in the browser, not inside the app
- `seshhon://invite/CODE` links open the app on that invite
- a "No connection" screen with a retry button instead of a blank page
- "Near me" on the map, using the phone's location (it asks first)
- proper icon, splash screen, and notch / home-bar spacing

The packed page runs as if it were at the address in `app.json` > `extra.webUrl` (frendzy.au), so logins,
the human check and invite links work exactly as on the web. The name people see is "Frendzy" (`app.json` > `name`).
The hidden IDs (`com.seshhon.app`, the `seshhon://` link) keep the old name; they can't be changed once the app is in a store,
and nobody sees them.

The older `app/` folder is an earlier single-player version with sample data. It is kept for reference;
this folder replaces it for the store.

## Everything is built in the cloud

No computer is needed. Builds run on Expo's servers (EAS), started from GitHub on a phone:

**GitHub > Actions > Phone app > Run workflow**, then pick:

| Platform | Profile | Submit | What you get |
| --- | --- | --- | --- |
| android | preview | off | An `.apk` file to install straight onto Android phones for testing. |
| android | production | on | A store build sent to Google Play internal testing. |
| ios | production | on | A store build sent to TestFlight, for testing on iPhones. |

The build itself shows up at expo.dev, where you can follow it and download the result.

## One-time setup

### 1. Expo (free)

1. Sign up at expo.dev.
2. Account settings > Access tokens > Create token.
3. In GitHub: the repository > Settings > Secrets and variables > Actions > New repository secret.
   Name `EXPO_TOKEN`, value the token.

That is enough for Android test builds.

### 2. Apple (US$99 a year)

1. Enrol in the Apple Developer Program, in the **Apple Developer** app on an iPhone (individual).
2. When it's approved, in App Store Connect (appstoreconnect.apple.com):
   - **Apps > + > New App**: name Frendzy, bundle ID `com.seshhon.app` (create it in the developer
     site first if it isn't listed), SKU `seshhon`.
   - Note the app's **Apple ID** (a number) under App Information. Secret `ASC_APP_ID`.
   - **Users and Access > Integrations > App Store Connect API > +**, access "App Manager". Download the
     key once. Secrets:
     - `ASC_API_KEY_P8`: the whole text of the downloaded file
     - `ASC_KEY_ID`: the key's ID
     - `ASC_ISSUER_ID`: the Issuer ID above the list
3. developer.apple.com > Account > Membership details > Team ID. Secret `APPLE_TEAM_ID`.

The first iPhone build creates the signing certificate and profile by itself using that key.

### 3. Google Play (US$25 once)

1. Create a developer account at play.google.com/console (personal). Google checks your ID.
2. **Create app**: Frendzy, app, free.
3. The first upload has to be done by hand: run an android / production build, download the `.aab` from
   expo.dev, and upload it in Play Console > Testing > Internal testing.
4. After that, for automatic uploads: create a Google Cloud service account with Play access and upload
   its key on expo.dev > the project > Credentials > Android.

New personal Play accounts must run a **closed test with at least 12 testers for 14 days in a row**
before they can publish to everyone.

## Before sending to review

- Fill in the blanks in `docs/privacy.html` and `docs/terms.html` (operator name and ABN, contact email,
  Supabase data region). Both stores ask for the privacy policy link.
- Age rating: answer the questionnaires honestly (alcohol references, user chat). Expect 17+ on Apple and
  Mature 17+ / 18+ on Google.
- Both stores require in-app account deletion (already in the You tab) and, because of the sesh chat,
  block and report (already built).
- Screenshots: 6.9" iPhone and phone screenshots for Play. They can be taken on a phone.
- Apple can reject apps that are "just a website". The native share sheet, offline screen and invite
  links help; push notifications ("Dan just went On") are the strongest next step if review pushes back.

## For a developer

```bash
cd mobile
npm install
npx tsc --noEmit       # typecheck
npx expo start         # run in Expo Go on a phone
```

Icons and splash are drawn by `node tools/live/phone-icons.mjs` from the repository root, using the same Frendzy
mark as the web app icon.
