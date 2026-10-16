// Takes app.json as it is and adds Firebase's google-services.json for Android push notifications, but only when
// that file exists, so the app builds and opens without it (notifications then simply stay off until Firebase is set up).
// Two ways to provide it: save the file as mobile/google-services.json, or add it on Expo as a file environment
// variable named GOOGLE_SERVICES_JSON (Expo > project > Environment variables > type "File").
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  const local = path.join(__dirname, 'google-services.json');
  const file = fromEnv && fs.existsSync(fromEnv) ? fromEnv : fs.existsSync(local) ? './google-services.json' : null;
  if (!file) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
