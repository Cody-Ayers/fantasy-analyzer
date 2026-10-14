// ESPN Fantasy Football → slim "snapshot" of one league.
//
// ESPN's website is powered by a JSON API at lm-api-reads.fantasy.espn.com.
// A private league answers only if the request carries your login cookies
// (espn_s2 and SWID). The full response is ~4.5 MB, mostly news and rankings,
// so buildSnapshot() keeps just what the analysis needs (~40 KB).
//
// This file has no Node-specific code, so the same function runs in Node
// (scripts/fetch.mjs, used by GitHub Actions) and in a browser.

const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';

// ESPN uses numbers for positions and lineup slots.
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
const SLOT = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'DST', 17: 'K', 20: 'BE', 21: 'IR', 23: 'FLEX' };
const INJ = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'O', INJURY_RESERVE: 'IR', SUSPENSION: 'SUS' };

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// ESPN analysts' consensus rank at his position this week (rankSourceId 0 = average).
function expertRank(p, week, ppr) {
  const list = (p.rankings || {})[week] || [];
  const type = ppr ? 'PPR' : 'STANDARD';
  const avg = list.find((r) => r.rankSourceId === 0 && r.rankType === type) ||
    list.find((r) => r.rankSourceId === 0);
  return avg && avg.averageRank ? Math.round(avg.averageRank) : null;
}

// Turn one ESPN player object into a small record.
function slimPlayer(p, week, season, extra, opts = {}) {
  const stats = p.stats || [];
  // statSourceId: 0 = actual, 1 = ESPN projection
  // statSplitTypeId: 0 = whole season, 1 = single week
  const find = (src, split, per) =>
    stats.find((s) => s.statSourceId === src && s.statSplitTypeId === split &&
      (s.seasonId == null || s.seasonId === season) &&
      (per == null ? String(s.id).endsWith(String(season)) : s.scoringPeriodId === per));
  const projWeek = find(1, 1, week);
  const lastWeek = find(0, 1, week - 1);
  const seasonAct = find(0, 0);
  const seasonProj = find(1, 0);
  const avg = seasonAct && seasonAct.appliedAverage;
  return {
    id: p.id,
    n: p.fullName,
    p: POS[p.defaultPositionId] || '?',
    t: p.proTeamId,
    i: INJ[p.injuryStatus] || '',
    pw: r1(projWeek ? projWeek.appliedTotal : 0),          // projected points this week
    avg: r1(avg || 0),                                      // actual points per game this season
    gp: avg ? Math.round(seasonAct.appliedTotal / avg) : 0, // games played
    pa: r1(seasonProj ? seasonProj.appliedAverage : 0),     // ESPN's projected points per game
    lw: lastWeek ? r1(lastWeek.appliedTotal) : null,        // last week's actual points
    own: r1(p.ownership ? p.ownership.percentOwned : 0),    // % of ESPN leagues rostering him
    tr: r1(p.ownership ? p.ownership.percentChange : 0),    // change in that % this week (trend)
    er: expertRank(p, week, opts.ppr),                       // ESPN experts' rank at his position
    // ESPN analyst write-up for this week (only kept for your players and free agents).
    ...(opts.outlook && p.outlooks && p.outlooks.outlooksByWeek && p.outlooks.outlooksByWeek[week]
      ? { ol: p.outlooks.outlooksByWeek[week].slice(0, 400) } : {}),
    ...extra,
  };
}

// Matching players between ESPN and Sleeper: same name (letters only, no Jr/Sr/II)
// on the same NFL team. Defenses match by team.
const sleeperKey = (name, team) =>
  `${String(name).toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv|v)$/, '')}|${team}`;
const TEAM_FIX = { WSH: 'WAS' };   // Sleeper uses a few different abbreviations
function espnKey(snap, p) {
  const team = snap.proTeams[p.t] ? snap.proTeams[p.t].ab : '';
  const st = TEAM_FIX[team] || team;
  return p.p === 'DST' ? `dst|${st}` : sleeperKey(p.n, st);
}
const sleeperPlayerKey = (sp, id) => (sp.position === 'DEF'
  ? `dst|${sp.team || id}` : sleeperKey(sp.full_name || `${sp.first_name} ${sp.last_name}`, sp.team));

// Sleeper (another fantasy app) publishes its most-added players of the last
// 48 hours: a crowd signal for breakouts. Free, no login needed.
// Adds `sl` to matching players: their rank on that list (1 = most added).
async function addSleeperTrends(snap, getPublicJSON) {
  try {
    const trending = await getPublicJSON('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=200');
    const all = await getPublicJSON('https://api.sleeper.app/v1/players/nfl');
    // Store each player's spot on the list: 1 = most-added player in the last 48 hours.
    const counts = {};
    trending.forEach((t, i) => {
      const sp = all[t.player_id];
      if (!sp) return;
      counts[sleeperPlayerKey(sp, t.player_id)] = i + 1;
    });
    for (const p of snap.players) {
      const c = counts[espnKey(snap, p)];
      if (c) p.sl = c;
    }
    snap.sleeperAt = new Date().toISOString();
  } catch (e) {
    // Optional extra: the app works without it.
  }
  return snap;
}

// getJSON(url, headers) → parsed JSON. Passed in so this works with any login method.
async function buildSnapshot(getJSON, leagueId, season, swid) {
  const L = `${API}${season}/segments/0/leagues/${leagueId}`;

  // 1) Settings, teams and current week.
  const meta = await getJSON(`${L}?view=mSettings&view=mTeam&view=mStatus`);
  const week = meta.scoringPeriodId;
  const s = meta.settings;

  // 2) Rosters (with this week's projections) and the full schedule.
  const ros = await getJSON(`${L}?view=mRoster&view=mMatchupScore&scoringPeriodId=${week}`);

  // 3) Free agents and waiver players: top 25 by ownership at each position.
  const free = [];
  for (const slot of [0, 2, 4, 6, 16, 17]) {
    const filter = { players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      filterSlotIds: { value: [slot] },
      limit: 25,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    } };
    const fa = await getJSON(`${L}?view=kona_player_info&scoringPeriodId=${week}`,
      { 'x-fantasy-filter': JSON.stringify(filter) });
    free.push(...(fa.players || []));
  }
  // Plus the 40 free agents whose ESPN ownership is rising fastest (breakouts).
  const hot = await getJSON(`${L}?view=kona_player_info&scoringPeriodId=${week}`,
    { 'x-fantasy-filter': JSON.stringify({ players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17] },
      limit: 40,
      sortPercChanged: { sortPriority: 1, sortAsc: false },
    } }) });
  free.push(...(hot.players || []));

  // 4) NFL team abbreviations, bye weeks and this week's opponents.
  const pro = await getJSON(`${API}${season}?view=proTeamSchedules_wl`);

  const slotCount = {};
  for (const [id, n] of Object.entries(s.rosterSettings.lineupSlotCounts)) {
    if (n && SLOT[id]) slotCount[SLOT[id]] = n;
  }
  const ppr = (s.scoringSettings.scoringItems || []).find((i) => i.statId === 53);

  const memberName = {};
  for (const m of meta.members || []) memberName[m.id] = m.displayName;

  const teams = meta.teams.map((t) => {
    const o = (t.record && t.record.overall) || {};
    return {
      id: t.id,
      ab: t.abbrev,
      name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim().replace(/\s+/g, ' '),
      owner: memberName[(t.owners || [])[0]] || '',
      w: o.wins || 0, l: o.losses || 0, t: o.ties || 0,
      pf: r1(o.pointsFor || 0), pa: r1(o.pointsAgainst || 0),
    };
  });
  const me = (meta.teams.find((t) => (t.owners || []).includes(swid)) || {}).id || null;

  const pprPts = ppr ? ppr.points : 0;
  const players = [];
  for (const t of ros.teams) {
    for (const e of t.roster.entries) {
      players.push(slimPlayer(e.playerPoolEntry.player, week, season,
        { tm: t.id, s: SLOT[e.lineupSlotId] || 'BE' }, { ppr: pprPts, outlook: t.id === me }));
    }
  }
  for (const f of free) {
    if (players.some((p) => p.id === f.player.id)) continue;
    players.push(slimPlayer(f.player, week, season,
      { tm: 0, fa: f.status === 'WAIVERS' ? 'W' : 'FA' }, { ppr: pprPts, outlook: true }));
  }

  const proTeams = {};
  for (const t of pro.settings.proTeams) {
    const g = ((t.proGamesByScoringPeriod || {})[week] || [])[0];
    const opp = g ? (g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId) : null;
    // Opponent for every week of the season (index = week; null on the bye).
    const opps = [null];
    for (let w = 1; w <= 18; w++) {
      const gw = ((t.proGamesByScoringPeriod || {})[w] || [])[0];
      opps.push(gw ? (gw.homeProTeamId === t.id ? gw.awayProTeamId : gw.homeProTeamId) : null);
    }
    proTeams[t.id] = { ab: t.abbrev, bye: t.byeWeek, opp, home: g ? g.homeProTeamId === t.id : null, opps };
  }

  const regWeeks = s.scheduleSettings.matchupPeriodCount;
  const sched = ros.schedule
    .filter((m) => m.matchupPeriodId <= regWeeks && m.away)
    .map((m) => [m.matchupPeriodId, m.home.teamId, m.away.teamId,
      r1(m.home.totalPoints), r1(m.away.totalPoints)]);

  return {
    season, week, fetchedAt: new Date().toISOString(),
    league: {
      id: leagueId, name: s.name, size: s.size,
      ppr: pprPts,
      slots: slotCount,
      playoffTeams: s.scheduleSettings.playoffTeamCount,
      regWeeks,
    },
    me, teams, sched, proTeams, players,
  };
}

if (typeof module !== 'undefined') module.exports = { buildSnapshot, addSleeperTrends, espnKey, sleeperPlayerKey };
