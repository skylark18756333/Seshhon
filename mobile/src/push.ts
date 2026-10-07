// The spot for registering this phone for push notifications. App.tsx calls it once per sign-in, as soon as the
// native screens are up (after sign-up, login, the login code or the age check). Nothing is registered yet: when
// notifications are built, ask for permission here, get the device's push token, and save it against the account
// with a database function (never a direct table write).
export async function registerPushToken(_userId: string | null): Promise<void> {
  // Not implemented on purpose.
}
