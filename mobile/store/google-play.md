# Google Play: everything to paste in

Draft for the first Play Store release of Frenzy. Copy each part into Play Console when it asks.
Check anything marked **[confirm]** first.

## App details (Create app)

- App name: **Frenzy** (up to 30 characters; can be changed later, the hidden ID `com.seshhon.app` can't)
- Default language: English (Australia)
- App or game: App
- Free or paid: Free
- Category: Social
- Contact email: **[confirm: the email people can contact you on]**
- Privacy policy: `https://skylark18756333.github.io/Seshhon/privacy.html`
  (fill in the [ ] blanks on that page first)

## Store listing

**Short description** (80 characters max)

> Tell your mates you're up for a night out, pick a venue together, and go.

**Full description**

> Frenzy is the social app that gets you off the apps and out the door.
>
> Set your light and your friends see it:
> 🟢 Green: you're up for it. Let's go out.
> 🟡 Amber: you're keen but thinking about it.
> 🔴 Red: you're off and out of the app.
>
> When your mates are Green too, start a sesh. Everyone votes on where to go from venues near you, and the sesh chat keeps it all in one place. Messages delete themselves when the night is over.
>
> • See which friends are up for a night out right now
> • Find bars, pubs and clubs on the map, with opening hours and ratings
> • Vote on a venue together and see how far it is
> • Chat with the group, then it's gone when the sesh ends
> • Rate venues after you've been
> • Block or report anyone, any time
> • Women and non-binary only mode, if you want it
>
> Frenzy is for people aged 18 and over. Please drink responsibly.

**Graphics**

| Item | Size | File |
| --- | --- | --- |
| App icon | 512 × 512 PNG | `mobile/store/icon-512.png` |
| Feature graphic | 1024 × 500 PNG | `mobile/store/feature-graphic.png` |
| Phone screenshots | at least 2, portrait | take them on your phone in the app (Home, Map, Sesh chat, Venue) |

## App content (the Policy section)

**Privacy policy**: the link above.

**App access**: All or some functionality is restricted. Give the reviewer a test login:
- Username: **[make a test account in the app, then paste its username]**
- Password: **[its password]**
- Note: "Tap Log in on the first screen. To see seshes and chat, the test account has one friend added."

**Ads**: No, the app does not contain ads.

**Content rating** (IARC questionnaire), category Social / communication:
- User-generated content or chat between users: **Yes** (sesh chat, with block and report)
- Shares the user's location with other users: **No** (Near me stays on the phone)
- References to alcohol: **Yes** (venues are bars and pubs; deals are off for now)
- Violence, sexual content, gambling, swearing in app content: **No**
- Digital purchases: **No**

**Target audience**: 18 and over only. Not designed for children.

**News app**: No. **COVID-19 app**: No. **Government app**: No.
**Financial features**: None. **Health**: None.

**Data safety** (answers match the privacy policy and the code as of October 2026):

- Does the app collect or share user data? **Yes, collects. Does not share.**
- Is data encrypted in transit? **Yes**
- Can users ask for their data to be deleted? **Yes** (in app: You > Your account > Delete my account)
- Account deletion URL: `https://skylark18756333.github.io/Seshhon/privacy.html` (the "How long we keep it" section explains it)

| Data type | Collected | Why | Optional? |
| --- | --- | --- | --- |
| Personal info > Name | Yes | App functionality | Required |
| Personal info > Other info (gender) | Yes | App functionality (women and non-binary mode) | Optional |
| Personal info > Other info (date of birth check, 18+) | Yes, only the result is kept | App functionality, fraud prevention | Required |
| Photos > Photos (profile photo) | Yes | App functionality | Optional |
| Messages > Other in-app messages (sesh chat) | Yes | App functionality | Optional |
| App activity > Other user-generated content (venue ratings, votes) | Yes | App functionality | Optional |
| App info and performance > Crash logs, Diagnostics | No | | |
| Device or other IDs | No | | |
| Location | No (Near me is worked out on the phone, never sent) | | |

**The privacy policy needs two updates before review**: it still says "We do not collect your photos",
but profile photos now exist, and it doesn't mention the optional gender setting. Google checks that the
policy and the Data safety form agree.

## Releasing

1. Build the store file: GitHub > Actions > Phone app > Run workflow, choose **android** and **production**.
   Download the `.aab` from the expo.dev build page when it finishes.
2. Play Console > Testing > **Closed testing** > Create track > upload the `.aab`.
3. Add your testers' Gmail addresses and share the opt-in link with them.
4. Personal developer accounts: keep **at least 12 testers opted in for 14 days in a row**. Then
   Dashboard > Apply for production, and answer the short questions about the test.
5. Production > Create release > the same `.aab` > send for review. First reviews can take up to a week.

After the first upload, later builds can go straight to Play from the workflow ("submit" ticked) once a
Google service account key is added on expo.dev (Project > Credentials > Android).
