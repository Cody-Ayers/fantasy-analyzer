// Pull fresh snapshots of every league and save them for the website.
//
// Run it:   ESPN_S2=... SWID=... node scripts/fetch.mjs
// (GitHub Actions runs this on a schedule; see .github/workflows/refresh.yml)
//
// ESPN_S2 and SWID are the two ESPN login cookies. They're read from
// environment variables so they never get written into the code or the repo.

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSnapshot, addSleeperTrends } = require('./espn.js');
const { buildHistory } = require('./history.js');
const config = require('../leagues.json');

const { ESPN_S2, SWID } = process.env;
if (!ESPN_S2 || !SWID) {
  console.error('Missing ESPN_S2 or SWID. See README.md, "Get your ESPN cookies".');
  process.exit(1);
}

// Every ESPN request carries your cookies, the same way your browser does.
async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: { ...headers, Cookie: `espn_s2=${ESPN_S2}; SWID=${SWID}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ESPN said ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

// Public sites like Sleeper get a plain request: your ESPN cookies only ever go to ESPN.
// Sleeper's player list is ~5 MB, so fetch each URL once and reuse it for every league.
const publicCache = new Map();
function getPublicJSON(url) {
  if (!publicCache.has(url)) {
    publicCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} for ${url}`);
      return r.json();
    }));
  }
  return publicCache.get(url);
}

mkdirSync('site/data', { recursive: true });
const index = [];
for (const id of config.leagues) {
  const snap = await buildSnapshot(getJSON, id, config.season, SWID);
  await addSleeperTrends(snap, getPublicJSON);
  if (!snap.me) console.warn(`League ${id}: couldn't find your team. Is SWID right?`);
  writeFileSync(`site/data/${id}.json`, JSON.stringify(snap));
  // Week-by-week history for the player panel. Optional: a failure here
  // shouldn't stop the main refresh.
  try {
    const hist = await buildHistory(getJSON, getPublicJSON, snap);
    writeFileSync(`site/data/${id}-players.json`, JSON.stringify(hist));
    console.log(`  history: ${Object.keys(hist.players).length} players, weeks ${hist.weeks.join(',')}`);
  } catch (e) {
    console.warn(`  history skipped: ${e.message}`);
  }
  index.push({ id, name: snap.league.name, week: snap.week, fetchedAt: snap.fetchedAt });
  console.log(`✓ ${snap.league.name}: week ${snap.week}, ${snap.players.length} players`);
}
writeFileSync('site/data/leagues.json', JSON.stringify(index, null, 2));

// Remove snapshots of leagues that are no longer in leagues.json (for example
// the original owner's leagues in a copy made from the template).
const keep = new Set(['leagues.json', ...config.leagues.flatMap((id) => [`${id}.json`, `${id}-players.json`])]);
for (const file of readdirSync('site/data')) {
  if (file.endsWith('.json') && !keep.has(file)) {
    unlinkSync(`site/data/${file}`);
    console.log(`  removed old ${file}`);
  }
}
