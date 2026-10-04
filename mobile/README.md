# Frenzy phone app (iPhone and Android)

This folder is the app that goes in the App Store and Google Play. It is a native shell around the live
web app in `docs/`, so the phone app and the web link always show the same thing, and a fix to `docs/`
reaches every phone without a store update.

The shell adds the parts a web page can't do well on a phone:

- the phone's own share sheet for invite links
- the Android back button
- outside links (a venue's website, maps) open in the browser, not inside the app
- `seshhon://invite/CODE` links open the app on that invite
- a "No connection" screen with a retry button instead of a blank page
- "Near me" on the map, using the phone's location (it asks first)
- proper icon, splash screen, and notch / home-bar spacing

The page it loads is set in `app.json` under `extra.webUrl`. The name people see is "Frenzy" (`app.json` > `name`).
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
   - **Apps > + > New App**: name Frenzy, bundle ID `com.seshhon.app` (create it in the developer
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
2. **Create app**: Frenzy, app, free.
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

Icons and splash are drawn by `node tools/live/phone-icons.mjs` from the repository root, using the same Frenzy
mark as the web app icon.
