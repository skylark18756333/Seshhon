// Where this copy of Seshhon finds its database.
// The project URL and the public ("anon" / "publishable") key are meant to be public:
// the database rules decide what each person can see. NEVER put a secret / service_role
// key or the database password in this file.
window.SESHHON_CONFIG = {
  url: 'https://xfwrhetohauzhqqhkibm.supabase.co',
  key: 'sb_publishable_hv2mIG5TfKBI-iXURTd9WQ_FFHRnj-Y',   // public key, safe to publish
  pollMs: 5000,
  deals: false   // deals are hidden for now; set to true to show the Deals tab and staff code checking
};
