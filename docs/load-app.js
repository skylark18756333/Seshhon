// Loads hours.js, tour.js and app.js fresh every time (with a timestamp), like load-config.js does for config.js,
// so a phone never runs an old copy of the app against a newer database.
// It is a file of its own, not inline, because the page's security policy blocks inline scripts.
var seshhonT = Date.now();
document.write('<script src="hours.js?t=' + seshhonT + '"><\/script><script src="tour.js?t=' + seshhonT + '"><\/script><script src="app.js?t=' + seshhonT + '"><\/script>');
