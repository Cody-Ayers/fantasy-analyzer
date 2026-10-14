// Week-by-week history for every player in a league snapshot, for the player panel.
//
//   ESPN    → fantasy points each week (your league's scoring), what ESPN
//             projected each week, and the raw stats (targets, carries, yards…)
//   Sleeper → snap counts, so we can show snap share: the % of his team's
//             offensive plays he was on the field for
//
// Saved separately from the main snapshot (site/data/<league>-players.json)
// so the app only downloads it when you open a player.

const { espnKey, sleeperPlayerKey } = require('./espn.js');

const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';
const r1 = (x) => Math.round(x * 10) / 10;
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ESPN stat IDs → short names we keep. (ESPN numbers every stat.)
const STAT = { 3: 'py', 4: 'ptd', 20: 'int', 23: 'ca', 24: 'ru', 25: 'rtd', 58: 'tg', 53: 'rc', 42: 'ry', 43: 'ytd' };
function slimStats(stats = {}) {
  const out = {};
  for (const [id, k] of Object.entries(STAT)) if (stats[id]) out[k] = Math.round(stats[id]);
  return out;
}

async function buildHistory(getJSON, getPublicJSON, snap) {
  const { season, week } = snap;
  const L = `${API}${season}/segments/0/leagues/${snap.league.id}`;
  const weeks = [];
  for (let w = 1; w < week; w++) weeks.push(w);
  const ids = snap.players.map((p) => p.id);
  const hist = {};   // id → { [week]: { pts, proj, snap, s } }
  const at = (id, w) => ((hist[id] ||= {})[w] ||= {});

  // 1) Actual points and stats for every past week (200 players per request; ESPN rejects a "limit" here).
  for (const group of chunks(ids, 200)) {
    const filter = { players: { filterIds: { value: group },
      filterStatsForTopScoringPeriodIds: { value: 17, additionalValue: [`00${season}`] } } };
    const res = await getJSON(`${L}?view=kona_playercard&scoringPeriodId=${week}`, { 'x-fantasy-filter': JSON.stringify(filter) });
    for (const { player } of res.players || []) {
      for (const s of player.stats || []) {
        if (s.seasonId !== season || s.statSourceId !== 0 || s.statSplitTypeId !== 1 || s.scoringPeriodId >= week) continue;
        const h = at(player.id, s.scoringPeriodId);
        h.pts = r1(s.appliedTotal || 0);
        h.s = slimStats(s.stats);
      }
    }
  }

  // 2) What ESPN projected for each past week (one request per week).
  for (const w of weeks) {
    for (const group of chunks(ids, 200)) {
      const filter = { players: { filterIds: { value: group },
        filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [`11${season}${w}`] } } };
      const res = await getJSON(`${L}?view=kona_player_info&scoringPeriodId=${w}`, { 'x-fantasy-filter': JSON.stringify(filter) });
      for (const { player } of res.players || []) {
        const s = (player.stats || []).find((x) => x.statSourceId === 1 && x.statSplitTypeId === 1 && x.scoringPeriodId === w);
        if (s) at(player.id, w).proj = r1(s.appliedTotal || 0);
      }
    }
  }

  // 3) Snap counts from Sleeper (optional: the panel works without them).
  try {
    const all = await getPublicJSON('https://api.sleeper.app/v1/players/nfl');
    const byKey = {};
    for (const p of snap.players) byKey[espnKey(snap, p)] = p.id;
    for (const w of weeks) {
      const stats = await getPublicJSON(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${w}`);
      for (const [sid, st] of Object.entries(stats)) {
        const sp = all[sid];
        if (!sp || !st.tm_off_snp || st.off_snp == null) continue;
        const id = byKey[sleeperPlayerKey(sp, sid)];
        if (id != null && sp.position !== 'DEF') at(id, w).snap = Math.round((100 * st.off_snp) / st.tm_off_snp);
      }
    }
  } catch (e) { /* no snap data this run */ }

  // Compact output: players[id] = [[week, pts, proj, snap%, stats], ...]
  const players = {};
  for (const [id, byWeek] of Object.entries(hist)) {
    players[id] = weeks.filter((w) => byWeek[w]).map((w) => {
      const h = byWeek[w];
      return [w, h.pts ?? null, h.proj ?? null, h.snap ?? null, h.s || {}];
    });
  }
  return { season, week, weeks, fetchedAt: new Date().toISOString(), players };
}

module.exports = { buildHistory };
