# SeshOn

Tell your friends you're up for a sesh, pick a place together, and use a deal when you get there.

Your status is a traffic light, set with a G / A / R switch you slide or flick across:

- **Green:** ready to go out. Lasts 4 hours, then switches itself to red.
- **Amber:** browsing, undecided. Lasts 2 hours. Nobody gets pinged.
- **Red:** off and hidden. This is where everyone starts.

(Inside the code and database these are still called `on`, `thinking` and `off`.)

## What is in this repository

| Folder | What it is | State |
| --- | --- | --- |
| `web/` | The test version that runs in a web browser. Open `web/index.html`. | Works. Single player, example friends and venues. |
| `docs/` | The live, multi-friend web app. | Live on GitHub Pages. |
| `mobile/` | The App Store / Google Play app: a native shell around the live web app, built in the cloud. See `mobile/README.md`. | Ready to build once the Expo, Apple and Google accounts exist. |
| `app/` | An earlier phone app version (React Native, single player, sample data). | Kept for reference; `mobile/` replaces it for the stores. |
| `app/src/core/` | The rules: status expiry, deal limits, deal codes, vote counting. | Covered by automated tests. |
| `supabase/` | The database for the real, multi-phone version. | Tested on a local database. **Not yet connected to a Supabase project.** |
| `tools/preview/` | Lets a developer run the phone app's code in a web browser. | Works. |

Friends, venues and deals are examples until the database is connected.

## The rules that are built in

**Deals that involve alcohol** follow limits taken from the WA Director of Liquor Licensing policy on
responsible promotion of liquor. The app and the database both refuse a deal that breaks them:

- no more than 50% off
- no longer than 60 minutes
- finished by 7pm
- at most two alcohol deals per venue per day

These are applied to every alcohol deal, which is stricter than the policy requires. A liquor lawyer
should confirm them before the pilot. Food, entry and event deals have no such limits.

**Deal codes** last 15 minutes and each person can use a deal once per night.

**Privacy:** only accepted friends can see your status, and only while it is Green or Amber.
Sign-up requires confirming you are 18 or over.

## Running the phone app (for a developer)

The app's dependencies are not pinned in this repository yet, because it was written in an
environment that could not install them. To run it:

```bash
npx create-expo-app@latest seshhon-app --template blank-typescript
cd seshhon-app
npx expo install @react-native-async-storage/async-storage
# copy app/App.tsx and app/src/ from this repository over the new project's files
npx expo start
```

Then scan the QR code with the Expo Go app on a phone.

Known gap: the screens use fixed padding at the top and bottom instead of reading the phone's safe
areas. Add `react-native-safe-area-context` before release.

## Checks (for a developer)

```bash
npm install
npm test          # the rules
npm run check     # builds the phone app's code for the browser and runs the main flow
npm run test:db   # the database rules, on a throwaway local Postgres
```

## Connecting the real backend

1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_init.sql` in the project's SQL editor.
3. Switch on the `pg_cron` extension so expired statuses are cleared every five minutes.
4. Replace `app/src/data/sample.ts` with calls to the database. This step is not built yet.

Do not run `supabase/tests/00_supabase_stub.sql` on a real project. It exists only for local testing.

## Live web version (docs/)

`docs/` is the shared, multi-friend web app (plain HTML, no build step). It talks to a Supabase project through the
functions in `supabase/migrations/0002_live_web_app.sql`.

- `supabase/setup.sql`: everything to paste into the Supabase SQL editor on a new project (rebuild with `tools/live/build-setup.sh`).
- `docs/config.js`: the project URL and public (anon/publishable) key. Never put a service_role key or the database password here.
- `docs/app.js`: the app's code. It is a separate file, not inline in `index.html`, because the page's Content Security Policy
  forbids inline scripts. If the Supabase project URL changes, update `connect-src` in `docs/index.html` too (`check.mjs` fails if they differ).

### Web address (custom domain)

The site is served by GitHub Pages from `docs/`. `docs/CNAME` names the main address, `frendzy.au`; the old
`skylark18756333.github.io/Seshhon/` address then redirects there on its own. GitHub Pages serves one domain per site, so
`frendzy.com.au`, if bought later, is pointed at it with a redirect at the registrar or Cloudflare. When the address changes:

1. DNS for `frendzy.au`: `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`,
   `AAAA` records `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`, and
   `www` as a `CNAME` to `skylark18756333.github.io`.
2. Optional, `frendzy.com.au` (and `www.frendzy.com.au`): a permanent (301) redirect to `https://frendzy.au/`.
3. GitHub, Settings, Pages: check the custom domain shows `frendzy.au` and DNS is OK, then tick **Enforce HTTPS**.
4. Supabase, Authentication, URL Configuration: Site URL `https://frendzy.au/`, and add `https://frendzy.au/**`
   to the redirect URLs (keep the old address until the move is done).
5. Cloudflare Turnstile widget: add `frendzy.au` to its hostnames, or sign-up fails on the new address.
6. Supabase Edge Functions secret `AGE_CHECK_RETURN_URLS`: add `https://frendzy.au/`.
7. Phone app: `extra.webUrl` in `mobile/app.json` is the address it opens. Make a new build after the move.

The page's security policy uses `'self'`, so it needs no change for a new address.

### Security

- Every table has row level security, signed-out visitors can read or call nothing, and since `0006_security_hardening.sql`
  anything new added to the database starts locked until a migration grants it.
- Sign-up spam: set a Cloudflare Turnstile site key as `captchaSiteKey` in `docs/config.js` first, then switch on CAPTCHA
  protection in Supabase (Authentication, Attack Protection). The other order breaks sign-up.
- Old data is deleted on a schedule (`purge_old_data()` via pg_cron): seshes as soon as they end (8 hours at most), deal codes after the night,
  unfinished sign-ins after 2 days, chat when the sesh ends, reports after 90 days.
- Optional username and password (`0008_username_login.sql`), with no email: the username is stored as
  `<username>@users.seshon.invalid` in Supabase Auth, and a one-time recovery code (hashed, 5 wrong tries a day) replaces
  "forgot password" emails. Needs the Email provider ON in Supabase with "Confirm email" left ON.
- `node tools/live/check.mjs`: three simulated phones use the app against a local test database (needs PostgreSQL 15+ and Chromium).
- `bash supabase/tests/run.sh`: database rule tests.

`supabase/migrations/0004_sesh_chat.sql` adds the self-erasing sesh chat with block and report. Run new migrations in the Supabase SQL editor in order.

`supabase/migrations/0024_private_seshes.sql` adds private seshes: the person starting one picks which friends can see and
join it, and can invite more later. Friends who weren't picked can't see it at all. Until it is run, starting a private
sesh shows an error and ordinary seshes work as before.

`supabase/migrations/0025_planned_seshes.sql` adds planned seshes: a sesh can be planned for a date and time up to 2 weeks
ahead, for all friends or only picked ones. Friends can say they're in, vote and chat before it starts; it goes live at
that time (or earlier with "Start it now") and is deleted 8 hours after its start time. Until it is run, planning a sesh
shows an error and everything else works as before. The same migration lets the host add a private pres (pre-drinks)
address to a sesh: only people who have said they're in see it, from 4 hours before the start; it is never on the map
and is deleted with the sesh.

If your project was set up before the age gate and sign up says it cannot find `public.api_sign_up(p_birth_date, p_name)`,
paste `supabase/update.sql` into the Supabase SQL editor and press Run once. It adds migrations 0003 onwards.

## Age check (third-party selfie age check)

Sign-up can require a third-party age check before anyone gets in: a live selfie age estimate, and
photo ID (matched to the selfie) or a digital ID only when the estimate is under 25. It is **off**
until switched on. **Didit** is the chosen provider; Yoti is also built in as an alternative.

How it fits together:

- `supabase/migrations/0005_age_check.sql` and `0017_age_check_didit.sql`: the settings row, a record
  of each check (outcome only: no photo, ID, date of birth or estimated age), sign-up and going
  Green/Amber refused until passed.
- `supabase/functions/age-check/`: the Edge Function that holds the provider keys, starts a check and
  reads the result. `providers.ts` has the Didit and Yoti code; `npm test` checks it.
- `docs/app.js`: the "Quick age check" screen after the name and date of birth.
- `mobile/`: the phone app keeps the Didit page inside the app and asks for the camera. This needs a
  new phone app build to reach phones.

To switch it on with Didit:

1. Sign up at business.didit.me (free for 500 checks a month).
2. In the Didit console, create a **workflow** with age estimation set to a minimum age of 18,
   liveness on, and the ID fallback on for anyone whose estimate is under 25. Copy its **workflow ID**.
3. In the Didit console, create an **API key** and copy it. Set data retention to the shortest
   period offered.
4. Run `supabase/migrations/0005_age_check.sql` and then `0017_age_check_didit.sql` in the Supabase
   SQL editor (both are safe to run twice; skip any already run).
5. In Supabase, go to Edge Functions, create a function called `age-check` with the two files from
   `supabase/functions/age-check/` (`index.ts` and `providers.ts`), and turn **Verify JWT** off (the
   function checks the sign-in itself). Or with the Supabase CLI:
   `supabase functions deploy age-check --no-verify-jwt`.
6. In Edge Functions, Secrets, add:
   - `DIDIT_API_KEY`: the API key from step 3
   - `DIDIT_WORKFLOW_ID`: the workflow ID from step 2
   - `AGE_CHECK_RETURN_URLS`: the web app address, `https://frendzy.au/` (during a domain move, list
     both old and new addresses, comma separated)
   - optional `AGE_ESTIMATE_MIN` (default 25): the estimated age needed to pass without ID
7. Switch it on in the SQL editor: `update public.app_settings set age_check_required = true;`
   Switch it off again with `age_check_required = false`.

To use Yoti instead: add `YOTI_SDK_ID` and `YOTI_API_KEY` from the Yoti Hub and run
`update public.app_settings set age_check_provider = 'yoti';`.

People who signed up before the switch are asked to do the check the next time they open the app,
and cannot go Green or Amber until they pass. Each person gets at most 5 attempts a day.

## Email login codes (two-step login)

When someone saves a username and password, they also give an email address and confirm it with a
6-digit code. After that, logging in on a new phone needs the password and a fresh code from that email.
A phone that has had its code is remembered for 30 days, so logging back in there needs only the password.
The email is private: it is never shown to anyone (the owner only sees a hint like f•••@gmail.com).
Accounts saved before this keep logging in with just their password until they add an email on the You
page. A recovery code still gets someone back in if they lose their email too.

- `supabase/migrations/0018_email_two_step.sql`: stores the email and hashed codes, and the login check.
- `supabase/migrations/0022_email_recovery_code.sql`: lets the Edge Function email a copy of each new recovery
  code to the account's confirmed email. The code is still shown on screen, and only its hash is stored.
- `supabase/migrations/0023_remember_this_phone.sql`: once the code has been typed on a phone, that phone's
  next logins skip the code for 30 days (the password is still needed). The phone keeps a secret and the
  database a hash of it. A new password, or using a recovery code, forgets every remembered phone. Without
  this migration the app simply asks for the code every time.
- `supabase/functions/email-code/`: the Edge Function that emails the codes. It holds the email service key.

To switch it on, in this order:

1. Run `supabase/migrations/0018_email_two_step.sql`, then `0022_email_recovery_code.sql`, then
   `0023_remember_this_phone.sql`, in the Supabase SQL editor.
2. Make a free account with an email service. Brevo works without owning a web domain: add and verify a
   sender address under **Senders**, then create an API key under **SMTP & API**. (Resend also works,
   but needs a domain of your own.)
3. In Supabase, go to Edge Functions, create a function called `email-code` with
   `supabase/functions/email-code/index.ts`, and turn **Verify JWT** off (it checks the sign-in itself).
   Or: `supabase functions deploy email-code --no-verify-jwt`.
4. In Edge Functions, Secrets, add `BREVO_API_KEY` (or `RESEND_API_KEY`) and `EMAIL_FROM` (the verified
   sender address).
5. Last, in Authentication, Hooks, add a **Customize Access Token (JWT) Claims** hook: type Postgres,
   schema `public`, function `two_step_token_hook`. This is what makes the database refuse a login
   until its code is typed. If logins ever break, switch the hook off: everyone can log in with just
   their password again, and nothing else is lost.

## Google ratings (optional, paid)

Venue cards can show a venue's Google rating ("4.4 ★ on Google Maps (812)") next to Frendzy's own
ratings. It is **off** until switched on, and each look-up is billed by Google to your Google Cloud
account. Google's terms allow keeping a venue's Google place ID but not its rating, so the rating is
fetched fresh each time someone opens a venue, and each person is limited to 100 look-ups a day.

- `supabase/functions/google-rating/`: the Edge Function that holds the Google key, finds the venue on
  Google (once, then remembers its place ID) and fetches the rating.
- `supabase/migrations/0016_google_ratings.sql`: the daily limit and the place ID helpers.

To switch it on:

1. In Google Cloud Console, create a project, turn on billing, and enable **Places API (New)**.
   Create an API key, restrict it to Places API (New), and set a monthly budget alert.
2. Run `supabase/migrations/0016_google_ratings.sql` in the Supabase SQL editor.
3. In Supabase, go to Edge Functions, create a function called `google-rating` with
   `supabase/functions/google-rating/index.ts`, and turn **Verify JWT** off (it checks the sign-in itself).
   Or: `supabase functions deploy google-rating --no-verify-jwt`.
4. In Edge Functions, Secrets, add `GOOGLE_PLACES_KEY` with the key.
5. In `docs/config.js`, set `googleRatings: true`.

