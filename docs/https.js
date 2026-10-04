// Sends anyone who opens the plain http:// address to the https:// one, so passwords and codes are never typed over an
// unencrypted connection. GitHub Pages' "Enforce HTTPS" setting does this too; this is the backup if it is ever off.
// Local addresses are left alone so the checks in tools/ can still serve the app over plain http.
if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}
