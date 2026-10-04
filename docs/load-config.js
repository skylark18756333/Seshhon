// Loads config.js fresh every time (with a timestamp) so phones never use a stale copy.
// It is a file of its own, not inline, because the page's security policy blocks inline scripts.
document.write('<script src="config.js?t=' + Date.now() + '"><\/script>');
