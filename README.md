# Seshhon

Tell your friends you're up for a sesh, pick a place together, and use a deal when you get there.

Your status is a traffic light:

- **On (green):** ready to go out. Lasts 4 hours, then switches itself off.
- **Thinking (yellow):** browsing, undecided. Lasts 2 hours. Nobody gets pinged.
- **Off (red):** hidden. This is where everyone starts.

## What is in this repository

| Folder | What it is | State |
| --- | --- | --- |
| `web/` | The test version that runs in a web browser. Open `web/index.html`. | Works. Single player, example friends and venues. |
| `app/` | The phone app code (React Native, for iPhone and Android). | Written and tested in a browser stand-in. **Not yet run on a phone.** |
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

**Privacy:** only accepted friends can see your status, and only while it is On or Thinking.
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
