// Takes app.json as it is and adds two things that come from outside the repo, each only when it exists, so the app
// builds and opens without them:
//
// 1. Firebase's google-services.json for Android push notifications (notifications simply stay off until Firebase is set up).
//    Two ways to provide it: save the file as mobile/google-services.json, or add it on Expo as a file environment
//    variable named GOOGLE_SERVICES_JSON (Expo > project > Environment variables > type "File").
//
// 2. The Google Maps key for the native Map tab on Android: the environment variable GOOGLE_MAPS_ANDROID_KEY (on Expo:
//    project > Environment variables, visibility "Secret" or "Sensitive"; for a local build, export it in the shell).
//    The key is only ever read from the environment at build time and is never written into this repo. With the key,
//    the build gets the native Google map and the Map tab uses it (extra.nativeMap is true, which only says that a key was
//    given, not what it is). Without it the build is exactly as before and the Map tab stays the packed web map.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  let out = config;

  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  const local = path.join(__dirname, 'google-services.json');
  const file = fromEnv && fs.existsSync(fromEnv) ? fromEnv : fs.existsSync(local) ? './google-services.json' : null;
  if (file) out = { ...out, android: { ...out.android, googleServicesFile: file } };

  const mapsKey = String(process.env.GOOGLE_MAPS_ANDROID_KEY || '').trim();
  if (mapsKey) {
    out = {
      ...out,
      android: { ...out.android, config: { ...(out.android && out.android.config), googleMaps: { apiKey: mapsKey } } },
      extra: { ...out.extra, nativeMap: true }
    };
  }
  return out;
};
