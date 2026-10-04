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

If your project was set up before the age gate and sign up says it cannot find `public.api_sign_up(p_birth_date, p_name)`,
paste `supabase/update.sql` into the Supabase SQL editor and press Run once. It adds migrations 0003 onwards.

## Age check (third-party selfie age check)

Sign-up can require a third-party age check before anyone gets in: a live selfie age estimate, and
photo ID (matched to the selfie) or a digital ID only when the estimate is under 25. It is **off**
until switched on. Two providers are built in: **Yoti** (recommended) and **Didit**.

How it fits together:

- `supabase/migrations/0005_age_check.sql`: the settings row, a record of each check (outcome only:
  no photo, ID, date of birth or estimated age), sign-up and going Green/Amber refused until passed.
- `supabase/functions/age-check/`: the Edge Function that holds the provider keys, starts a check and
  reads the result. `providers.ts` has the Yoti and Didit code; `npm test` checks it.
- `docs/index.html`: the "Quick age check" screen after the name and date of birth.

To switch it on:

1. Create an account with the provider.
   - **Yoti:** sign up at the Yoti Hub, create an Age Verification app, and note its SDK ID and API key.
     Ask Yoti sales for live pricing.
   - **Didit:** sign up at business.didit.me, create a workflow with age estimation (minimum age 18)
     and liveness, with the ID fallback for anyone who looks under 25. Note the workflow ID and API key.
     Set the data retention to the shortest period offered.
2. Run `supabase/migrations/0005_age_check.sql` in the Supabase SQL editor (safe to run twice).
3. In Supabase, go to Edge Functions, create a function called `age-check` with the two files from
   `supabase/functions/age-check/` (`index.ts` and `providers.ts`), and turn **Verify JWT** off (the
   function checks the sign-in itself). Or with the Supabase CLI:
   `supabase functions deploy age-check --no-verify-jwt`.
4. In Edge Functions, Secrets, add:
   - `AGE_CHECK_RETURN_URLS`: the web app address, e.g. `https://skylark18756333.github.io/Seshhon/`
   - for Yoti: `YOTI_SDK_ID` and `YOTI_API_KEY`; for Didit: `DIDIT_API_KEY` and `DIDIT_WORKFLOW_ID`
   - optional `AGE_ESTIMATE_MIN` (default 25): the estimated age needed to pass without ID
5. Switch it on in the SQL editor:
   `update public.app_settings set age_check_provider = 'yoti', age_check_required = true;`
   (use `'didit'` for Didit). Switch it off again with `age_check_required = false`.

People who signed up before the switch are asked to do the check the next time they open the app,
and cannot go Green or Amber until they pass. Each person gets at most 5 attempts a day.

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

