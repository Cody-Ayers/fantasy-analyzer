# Lineup Lab

A phone-first analyzer for ESPN fantasy football leagues. It finds your best
lineup each week, the waiver pickups and trades that would help your team most,
and your playoff odds. It runs for free on GitHub: the data refreshes itself every
morning, and the site works like an app on your phone's home screen.

**Want it for your league?** Follow [Set it up for your own league](#set-it-up-for-your-own-league)
below. It takes about 10 minutes and needs only a free GitHub account.

> **How it was built:** I designed this app and built it with AI-assisted development using [Claude Code](https://claude.com/claude-code). I decided the features and rules, tested it, and directed each change.

## Features

- **Team:** your best legal lineup for the week and your win chance against this week's opponent
- **Waivers:** the best available players at each position, flagged when they'd beat one of your starters, plus who to drop
- **Trades:** trades that help *both* teams, so they're realistic to propose
- **League:** standings, all-play record, luck, and playoff odds from 5,000 simulated seasons
- **Player panel:** tap any name for snap share, consistency, upcoming matchups and expert rankings
- **Refresh button** to pull new data on demand, plus automatic daily updates
- **Score ticker:** every NFL game this week, live from ESPN's public scoreboard, with how many of your starters (and your opponent's) are in each

## How it works

```
ESPN API ──► scripts/fetch.mjs ──► site/data/*.json ──► site/ (the web page)
             (runs on GitHub)       (small snapshots)     analysis runs in your browser
```

1. **Fetch.** `scripts/espn.js` calls the same data API ESPN's own website uses. Private leagues need your two login cookies, `espn_s2` and `SWID`. The response is about 4.5 MB per league, and the script keeps only what the analysis needs, about 50 KB.
2. **Store.** Each league becomes one snapshot file, `site/data/<leagueId>.json`, published with the site. The files aren't saved in the repo; every refresh builds them fresh.
3. **Analyze.** `site/analysis.js` runs in your browser. Everything is built on one idea:
   - `bestLineup()` picks the highest-scoring legal lineup from a roster.
   - A roster's **value** = its best lineup's points, summed over every remaining week (byes count as 0).
   - A waiver add or trade is good if it raises that value. A trade is *realistic* if it raises **both** teams' value.
4. **Show.** `site/app.js` draws the four tabs. `site/style.css` controls the look.

| File | What it does |
|---|---|
| `leagues.json` | Your league IDs and season |
| `scripts/espn.js` | Calls ESPN and slims the data down |
| `scripts/fetch.mjs` | Runs `espn.js` for every league and writes the snapshot files |
| `site/analysis.js` | The math: lineups, waivers, trades, standings, playoff simulation |
| `site/app.js` | Draws the page |
| `scripts/history.js` | Week-by-week points, projections and stats (ESPN) plus snap counts (Sleeper) for the player panel |
| `site/player.js` | The player panel that opens when you tap a name |
| `site/ticker.js` | The score ticker under the header (reads ESPN's public scoreboard straight from your phone) |
| `site/refresh.js` | The Refresh button: starts the workflow through GitHub's API and waits for it |
| `.github/workflows/refresh.yml` | Tells GitHub to refresh the data and republish the site on a schedule |

### The math, briefly
- **Rest-of-season points per game** = 65% ESPN's season projection + 35% what the player has actually averaged, discounted for injury designation.
- **Win chance** treats each team's score as its projection ± about 20% (a normal distribution).
- **Playoff odds** play out the remaining schedule 5,000 times with random scores around each team's projection. Ties go to total points, like your leagues.
- **All-play record**: your record if you'd played every team every week. **Luck** = actual wins minus what all-play says you earned.
- **Available players** (Waivers tab): the top 15 free agents and waiver players at each position, sorted by rest-of-season points per game or this week's projection. *UPGRADE* = he projects better than your weakest starter at that position.
- **Who to drop** uses *value over replacement*: each of your players is compared with the best free agent at his position, so an easily replaced kicker counts as cheap. A negative cost means a free agent is simply better ("Upgrade available").
- **Player panel** (tap any name):
  - *Snap share*: his offensive snaps ÷ his team's, from Sleeper. "Rising" or "falling" means his last 2 games moved 8+ points from his earlier average.
  - *Consistency*: floor and ceiling are his 25th and 75th percentile weeks. A *boom* week is a top-N finish at his position, where N is your league size (half that for QB, TE, K and D/ST). *Startable* means inside the number of players at his position your league starts each week (FLEX split 45% RB, 45% WR, 10% TE). Weeks he didn't play don't count.
  - *Next 4 weeks*: points each defense has allowed per game to his position, from every player in your league's pool, split into thirds: tough, average, easy.
- **Outside signals** shown next to the numbers: ESPN's expert consensus rank for the week, ESPN's analyst write-up, ESPN ownership trend, and Sleeper's most-added list for the last 48 hours (HOT tag = top 25).

## Set it up for your own league

You'll need a free [GitHub account](https://github.com/signup), Chrome on a
computer, and an ESPN fantasy football league.

### 1. Make your own copy
On this repo's GitHub page, click **Use this template → Create a new repository**.
Name it `fantasy-analyzer`. You can make it **Private** if you have GitHub Pro; on a
free account, keep it Public (see [Privacy](#privacy)).

GitHub tries to run the refresh as soon as your copy is created. That first run
fails because the secrets aren't set yet; ignore it.

### 2. Add your league IDs
Open your league on ESPN. The ID is the number after `leagueId=` in the address
bar. In your new repo, open `leagues.json`, click the pencil to edit, and replace
the IDs (and the season, if needed):

```json
{
  "season": 2026,
  "leagues": [123456]
}
```

You can list more than one league. Click **Commit changes**.

### 3. Get your ESPN cookies
In Chrome, sign in to [ESPN Fantasy](https://fantasy.espn.com) and open your league. Then:
**View → Developer → Developer Tools → Application tab → Cookies → https://fantasy.espn.com**.
Copy the values of `espn_s2` (a long string) and `SWID` (looks like `{ABCD-...}`,
braces included).

These work like a password for your ESPN account. Only paste them into GitHub's
**Secrets** page (next step), never into code, issues or chat. They last for months;
if the refresh ever fails with a 401 error, copy fresh ones.

### 4. Add the cookies as secrets
In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add two secrets:
- `ESPN_S2`: your espn_s2 value
- `SWID`: your SWID value

### 5. Turn on GitHub Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 6. Run it
**Actions → Refresh leagues and publish → Run workflow**. In about a minute your
site is live at `https://YOUR-USERNAME.github.io/fantasy-analyzer/`.

On your iPhone, open the site in Safari and choose **Share → Add to Home Screen**.
From then on it refreshes itself every morning, plus Sunday before kickoff.

### 7. (Optional) Turn on the Refresh button
The **Refresh** button starts the same update from your phone. A public site can't
keep a secret, so the first time you tap it, it asks for a GitHub token:

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Repository access:** Only select repositories → your `fantasy-analyzer`.
3. **Permissions → Repository permissions → Actions:** Read and write. Nothing else.
4. Generate, copy, and paste it into the app.

The token is saved only in that browser (`localStorage`) and only sent to
`api.github.com` (see `site/refresh.js`). Do it once per device.

**Automatic updates.** GitHub's schedule often runs late or skips runs when it's
busy, so once a token is saved, the open app also refreshes itself: every 10 minutes
during games (from 90 minutes before a kickoff until the game ends), and any other
time the data is more than 3 hours old. It skips a refresh if one is already running,
and stops when you close the app.

## Privacy

On a free GitHub plan, the repo and the site are public. Anyone with the link can
see your league's team names, rosters and standings. Your ESPN cookies are never
published: they stay in GitHub Secrets. Lineup Lab doesn't save league members'
names, only team names.

## Run it on your computer

```bash
git clone https://github.com/YOUR-USERNAME/fantasy-analyzer.git
cd fantasy-analyzer
ESPN_S2=... SWID=... node scripts/fetch.mjs   # the data isn't in the repo, so fetch it first
python3 -m http.server 8000 -d site
# open http://localhost:8000
```

## Ideas for later
- Tune the model: the numbers at the top of `site/analysis.js` (`INJURY_KEEP`, `SD_SHARE`) and the 65/35 blend in `rosPPG()`.

### Phone alerts (optional)
Lineup Lab can send a push notification to your phone when a starter is ruled out or doubtful before his game, when your lineup is leaving 3+ points on the table close to kickoff, or when a new trade offer arrives (with its grade). It uses [ntfy](https://ntfy.sh), a free notification app.

1. Install the **ntfy** app (iPhone or Android).
2. Make up a long, random topic name, like `lineuplab-7f3k9q2xw8`. Anyone who knows it can read your alerts, so don't use something guessable.
3. In the ntfy app, tap **+** and subscribe to that topic.
4. In your repo: **Settings → Secrets and variables → Actions → New repository secret**, name `NTFY_TOPIC`, value your topic name.

Alerts are checked after every refresh, and each one is sent only once (`state/alerts-sent.json` remembers what was sent). Test the wording without sending anything: `ALERTS_DRY_RUN=1 node scripts/alerts.mjs`.

### League looks
Each league can have its own colors and header logo. In `leagues.json`, `themes` maps a league ID to a look:

```json
"themes": { "144706": "thunder", "934437639": "misfits" }
```

The looks live in `site/style.css` (`:root[data-theme="..."]`, just a set of color variables) and the logos in `site/img/`. Leagues without a theme use the default green look. To add your own, copy a theme block in `style.css`, give it a new name and colors, add the name and logo to `THEMES` in `site/app.js`, and point your league at it in `leagues.json`.
