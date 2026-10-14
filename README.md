# Lineup Lab

A phone-first analyzer for ESPN fantasy football leagues. It finds your best lineup each week, the waiver pickups and trades that would help your team most, and your playoff odds.

## How it works

```
ESPN API ──► scripts/fetch.mjs ──► site/data/*.json ──► site/ (the web page)
             (runs on GitHub)       (small snapshots)     analysis runs in your browser
```

1. **Fetch.** `scripts/espn.js` calls the same data API ESPN's own website uses. Private leagues need your two login cookies, `espn_s2` and `SWID`. The response is about 4.5 MB per league, and the script keeps only what the analysis needs, about 50 KB.
2. **Store.** Each league becomes one snapshot file: `site/data/<leagueId>.json`.
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
| `site/refresh.js` | The Refresh button: starts the workflow through GitHub's API and waits for it |
| `.github/workflows/refresh.yml` | Tells GitHub to refresh the data and republish the site on a schedule |

### The math, briefly
- **Rest-of-season points per game** = 65% ESPN's season projection + 35% what the player has actually averaged, discounted for injury designation.
- **Win chance** treats each team's score as its projection ± about 20% (a normal distribution).
- **Playoff odds** play out the remaining schedule 5,000 times with random scores around each team's projection. Ties go to total points, like your leagues.
- **All-play record**: your record if you'd played every team every week. **Luck** = actual wins minus what all-play says you earned.
- **Who to drop** uses *value over replacement*: each of your players is compared with the best free agent at his position, so an easily replaced kicker counts as cheap. A negative cost means a free agent is simply better ("Upgrade available").
- **Outside signals** shown next to the numbers: ESPN's expert consensus rank for the week, ESPN's analyst write-up, ESPN ownership trend, and Sleeper's most-added list for the last 48 hours (HOT tag = top 25).

## Run it on your Mac

```bash
cd ~/Projects/fantasy-analyzer
python3 -m http.server 8000 -d site
# open http://localhost:8000
```

## Put it on GitHub Pages

### 1. Get your ESPN cookies
In Chrome, sign in to ESPN Fantasy and open your league. Then:
**View → Developer → Developer Tools → Application tab → Cookies → https://fantasy.espn.com**.
Copy the values of `espn_s2` (a long string) and `SWID` (looks like `{ABCD-...}`, braces included).

These work like a password for your ESPN account. Only paste them into GitHub's **Secrets** page, never into code or chat. They last for months; if the refresh starts failing with a 401 error, grab fresh ones.

### 2. Create the repo and push
Create an empty repo on github.com (for example `fantasy-analyzer`), then:

```bash
cd ~/Projects/fantasy-analyzer
git init
git add .
git commit -m "First version of Lineup Lab"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/fantasy-analyzer.git
git push -u origin main
```

### 3. Add the secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add two secrets:
- `ESPN_S2`: your espn_s2 value
- `SWID`: your SWID value

### 4. Turn on Pages
Repo → **Settings → Pages → Source: GitHub Actions**.

### 5. Run it
Repo → **Actions → Refresh leagues and publish → Run workflow**. In about a minute your site is live at
`https://YOUR-USERNAME.github.io/fantasy-analyzer/`. On your iPhone, open it in Safari and choose **Share → Add to Home Screen**.

After that it refreshes on its own every morning, plus Sunday before kickoff.

### The Refresh button
The **Refresh** button in the app starts the same workflow from your phone. A public site can't keep a secret, so the first time you tap it, it asks for a GitHub token:

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Repository access:** Only select repositories → `fantasy-analyzer`.
3. **Permissions → Repository permissions → Actions:** Read and write. Nothing else.
4. Generate, copy, and paste it into the app.

The token is saved only in that browser (`localStorage`) and only sent to `api.github.com` (see `site/refresh.js`). Do it once per device. If the token expires or is deleted, the app asks again.

> **Privacy:** on a free GitHub plan, the repo and the site are public. Anyone with the link could see your league's rosters and standings, but never your cookies, which stay in Secrets.

## Ideas for later
- Add a league: put its ID in `leagues.json`.
- Tune the model: the numbers at the top of `site/analysis.js` (`INJURY_KEEP`, `SD_SHARE`) and the 65/35 blend in `rosPPG()`.
