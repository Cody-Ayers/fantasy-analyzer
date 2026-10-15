// The analysis engine. Every function here is plain math on a league snapshot
// (see scripts/espn.js for the snapshot format), so it runs in the browser and
// can be tested in Node.
//
// Two ideas power almost everything:
//   1. bestLineup(): the highest-scoring legal lineup you could start from a roster.
//   2. "Value" of a roster = points its best lineup scores over the rest of the season.
// A waiver pickup or trade is good if it raises that number.

export const FINAL_WEEK = 17;            // last week of the fantasy playoffs
const FLEX_OK = new Set(['RB', 'WR', 'TE']);
const STARTING_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K'];
// Injury statuses ESPN lets you park in an IR slot.
const IR_ELIGIBLE = new Set(['O', 'IR', 'SUS']);
// How much of a player's rest-of-season value survives his injury designation.
const INJURY_KEEP = { '': 1, Q: 0.97, D: 0.9, O: 0.8, IR: 0.3, SUS: 0.5 };

// ---------- per-player values ----------

// Points per game we expect from here on: mostly ESPN's season projection,
// nudged toward what he's actually averaged once there's a real sample.
export function rosPPG(p) {
  if (p.t === 0) return 0;                       // not on an NFL team
  let base = p.pa;
  if (p.gp >= 2) base = 0.65 * p.pa + 0.35 * p.avg;
  if (!p.pa && p.gp >= 2) base = p.avg * 0.8;    // ESPN has no projection
  return base * (INJURY_KEEP[p.i] ?? 1);
}

// Expected points in a given week (0 on a bye).
export function weekValue(snap, p, week) {
  if (week === snap.week) return p.pw;           // ESPN's projection for this week
  const bye = snap.proTeams[p.t]?.bye;
  return bye === week ? 0 : rosPPG(p);
}

// ---------- lineups ----------

// Fill each position's slots with its best players, then FLEX with the best
// remaining RB/WR/TE. Because FLEX takes any of those three, this greedy order
// always finds the optimal lineup.
export function bestLineup(roster, slots, val) {
  const scored = roster.map((p) => ({ p, v: val(p) })).sort((a, b) => b.v - a.v);
  const used = new Set();
  const starters = [];
  for (const slot of STARTING_SLOTS) {
    if (slot === 'FLEX') continue;
    let need = slots[slot] || 0;
    for (const x of scored) {
      if (!need) break;
      if (x.p.p === slot && !used.has(x.p.id)) { used.add(x.p.id); starters.push({ slot, ...x }); need--; }
    }
    while (need-- > 0) starters.push({ slot, p: null, v: 0 });   // empty slot
  }
  let flex = slots.FLEX || 0;
  for (const x of scored) {
    if (!flex) break;
    if (FLEX_OK.has(x.p.p) && !used.has(x.p.id)) { used.add(x.p.id); starters.push({ slot: 'FLEX', ...x }); flex--; }
  }
  while (flex-- > 0) starters.push({ slot: 'FLEX', p: null, v: 0 });
  starters.sort((a, b) => STARTING_SLOTS.indexOf(a.slot) - STARTING_SLOTS.indexOf(b.slot));
  const total = starters.reduce((s, x) => s + x.v, 0);
  return { total, starters, bench: scored.filter((x) => !used.has(x.p.id)) };
}

// Players who can actually play: everyone except those stuck on IR with a real injury.
const usable = (roster) => roster.filter((p) => !(p.s === 'IR' && IR_ELIGIBLE.has(p.i)));

export const rosterOf = (snap, teamId) => snap.players.filter((p) => p.tm === teamId);
export const remainingWeeks = (snap) => {
  const w = [];
  for (let i = snap.week; i <= FINAL_WEEK; i++) w.push(i);
  return w;
};

// Rest-of-season value: best-lineup points summed over every remaining week.
export function rosValue(snap, roster, weeks = remainingWeeks(snap)) {
  const r = usable(roster);
  let total = 0;
  for (const w of weeks) total += bestLineup(r, snap.league.slots, (p) => weekValue(snap, p, w)).total;
  return total;
}

// ---------- this week ----------

const SD_SHARE = 0.2;   // a team's weekly score typically swings ±20% around its projection
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {      // Abramowitz-Stegun approximation, accurate to ~1e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export function winProb(a, b, remA = a, remB = b) {
  // The uncertainty comes from points not scored yet: a team whose players have
  // all played has a final score. Before kickoff remA = a, so this is ±20%.
  const sd = Math.hypot(remA * SD_SHARE, remB * SD_SHARE);
  if (sd < 0.5) return a > b ? 1 : a < b ? 0 : 0.5;
  return normCdf((a - b) / sd);
}

// ---------- game status: locks and live scoring ----------
const GAME_MS = 3.25 * 3600 * 1000;      // a typical NFL game, kickoff to final whistle
const FINAL_MS = 3.75 * 3600 * 1000;     // after this, treat the game as over

// 'pre' (not started), 'live' (in progress) or 'final' for a player's game this week.
export function gameState(snap, p, now = snap.now ?? Date.now()) {
  const pro = snap.proTeams[p.t];
  if (!pro || !pro.kick || pro.bye === snap.week) return p.lk ? 'final' : 'pre';
  if (pro.final || now >= pro.kick + FINAL_MS) return 'final';
  if (now >= pro.kick || p.lk) return 'live';
  return 'pre';
}
// Expected points this week, counting what he's already scored.
export function liveValue(snap, p, now = snap.now ?? Date.now()) {
  const st = gameState(snap, p, now);
  if (st === 'pre') return p.pw;
  if (st === 'final') return p.ap ?? 0;
  const left = Math.max(0, 1 - (now - snap.proTeams[p.t].kick) / GAME_MS);
  return (p.ap ?? 0) + p.pw * left;
}
// Projected points he still has to score.
function stillToScore(snap, p, now) {
  const st = gameState(snap, p, now);
  if (st === 'pre') return p.pw;
  if (st === 'final') return 0;
  return p.pw * Math.max(0, 1 - (now - snap.proTeams[p.t].kick) / GAME_MS);
}

const isStarter = (p) => !['BE', 'IR'].includes(p.s);

// Best lineup you can still set: players whose games have started are locked
// where they are, and only the open slots get re-filled from unlocked players.
export function bestLineupNow(snap, roster, now = snap.now ?? Date.now()) {
  const r = usable(roster);
  const locked = (p) => gameState(snap, p, now) !== 'pre';
  const fixed = r.filter((p) => locked(p) && isStarter(p));
  const left = { ...snap.league.slots };
  for (const p of fixed) if (left[p.s]) left[p.s]--;
  const open = bestLineup(r.filter((p) => !locked(p)), left, (p) => p.pw);
  const starters = [
    ...fixed.map((p) => ({ slot: p.s, p, v: liveValue(snap, p, now), state: gameState(snap, p, now), locked: true })),
    ...open.starters.map((x) => ({ ...x, state: 'pre', locked: false })),
  ].sort((a, b) => STARTING_SLOTS.indexOf(a.slot) - STARTING_SLOTS.indexOf(b.slot));
  const used = new Set(starters.filter((x) => x.p).map((x) => x.p.id));
  const bench = r.filter((p) => !used.has(p.id)).map((p) => ({ p, v: liveValue(snap, p, now), state: gameState(snap, p, now), locked: locked(p) }));
  return {
    total: starters.reduce((a, x) => a + x.v, 0),
    remaining: starters.reduce((a, x) => a + (x.p ? stillToScore(snap, x.p, now) : 0), 0),
    starters, bench,
  };
}

// The lineup you have set right now in ESPN, scored live.
export function currentLineupPoints(roster, snap, now) {
  const starters = roster.filter(isStarter);
  if (!snap) return starters.reduce((a, p) => a + p.pw, 0);
  return starters.reduce((a, p) => a + liveValue(snap, p, now), 0);
}
function currentRemaining(roster, snap, now) {
  return roster.filter(isStarter).reduce((a, p) => a + stillToScore(snap, p, now), 0);
}

export function thisWeek(snap, teamId = snap.me, now = snap.now ?? Date.now()) {
  const roster = rosterOf(snap, teamId);
  const best = bestLineupNow(snap, roster, now);
  const current = currentLineupPoints(roster, snap, now);
  const curRem = currentRemaining(roster, snap, now);
  const m = snap.sched.find((g) => g[0] === snap.week && (g[1] === teamId || g[2] === teamId));
  const oppId = m ? (m[1] === teamId ? m[2] : m[1]) : null;
  const oppRoster = oppId ? rosterOf(snap, oppId) : [];
  const oppSet = currentLineupPoints(oppRoster, snap, now);
  const oppBest = bestLineupNow(snap, oppRoster, now);
  // Assume they'll fix obvious holes in whatever they can still change.
  const oppFix = oppBest.total * 0.97 > oppSet;
  const opp = oppFix ? oppBest.total * 0.97 : oppSet;
  const oppRem = oppFix ? oppBest.remaining : currentRemaining(oppRoster, snap, now);

  // Changes you can still make: only players whose games haven't started.
  const startIds = new Set(best.starters.filter((x) => x.p).map((x) => x.p.id));
  const toStart = best.starters.filter((x) => x.p && !x.locked && x.v > 0 && ['BE', 'IR'].includes(x.p.s));
  const toSit = roster.filter((p) => isStarter(p) && !startIds.has(p.id) && gameState(snap, p, now) === 'pre');

  // Where the week stands.
  const states = roster.filter(isStarter).map((p) => gameState(snap, p, now));
  const progress = { played: states.filter((x) => x === 'final').length, playing: states.filter((x) => x === 'live').length, total: states.length };

  // Warnings worth acting on.
  const alerts = [];
  const names = (list) => list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const iffy = [];
  for (const x of best.starters) {
    if (x.locked) continue;
    if (!x.p) alerts.push({ level: 'bad', text: `Empty ${x.slot} slot: you have nobody left who can play there this week.` });
    else if (x.v <= 0) alerts.push({ level: 'bad', text: `Your ${x.slot}, ${x.p.n}, projects 0 (${snap.proTeams[x.p.t]?.bye === snap.week ? 'bye week' : 'not expected to play'}). Pick up a replacement; see Waivers.` });
    else if (x.p.i === 'Q' || x.p.i === 'D') iffy.push(x.p.n);
  }
  if (iffy.length) alerts.push({ level: 'warn', text: `${names(iffy)} ${iffy.length > 1 ? 'are' : 'is'} questionable. Check news before kickoff and have a backup ready.` });
  if (progress.played + progress.playing > 0) {
    alerts.push({ level: 'info', text: `${progress.played + progress.playing} of your ${progress.total} starters ${progress.played + progress.playing > 1 ? 'have' : 'has'} already kicked off and ${progress.played + progress.playing > 1 ? 'are' : 'is'} locked. The lineup advice only moves players whose games haven't started.` });
  }
  const stuck = roster.filter((p) => p.s === 'IR' && !IR_ELIGIBLE.has(p.i)).map((p) => p.n);
  if (stuck.length) {
    alerts.push({ level: 'bad', text: `${names(stuck)} ${stuck.length > 1 ? 'are' : 'is'} in an IR slot but no longer IR-eligible. ESPN blocks adds and trades until ${stuck.length > 1 ? 'they move' : 'he moves'} back to your roster.` });
  }
  const open = openSpots(snap, roster);
  if (open < 0) {
    alerts.push({ level: 'warn', text: `Once ${stuck.length > 1 ? 'they come' : 'he comes'} off IR you're ${-open} over the roster limit. Drop ${-open} player${open < -1 ? 's' : ''} first (see Who to drop on the Waivers tab), plus one more for each pickup.` });
  } else if (open > 0) {
    alerts.push({ level: 'info', text: `You have ${open} open roster spot${open > 1 ? 's' : ''}. Free points: pick someone up.` });
  }

  // Live scoreboard numbers (actual points so far) for the matchup card.
  const scoreNow = (r) => r.filter(isStarter).reduce((a, p) => a + (gameState(snap, p, now) === 'pre' ? 0 : (p.ap ?? 0)), 0);

  return {
    oppId, best, current, opp, oppSet, progress,
    scored: scoreNow(roster), oppScored: scoreNow(oppRoster),
    gain: best.total - current,
    winNow: winProb(current, opp, curRem, oppRem),
    winBest: winProb(best.total, opp, best.remaining, oppRem),
    toStart, toSit, alerts,
  };
}

// Open roster spots. Players stuck in IR who are no longer IR-eligible must
// come back to the roster before ESPN allows any add, so they count as filled.
// Can be negative: you're over the limit once they come back.
// Your injured reserve: who's in each IR spot, whether ESPN still allows him
// there, how many spots are open, and bench players who could move in.
export function irStatus(snap, teamId = snap.me) {
  const roster = rosterOf(snap, teamId);
  const slots = snap.league.slots.IR || 0;
  const inIR = roster.filter((p) => p.s === 'IR').map((p) => ({ p, eligible: IR_ELIGIBLE.has(p.i) }));
  const open = Math.max(0, slots - inIR.length);
  // Bench players hurt badly enough for IR: moving them frees a bench spot for free.
  const candidates = roster.filter((p) => p.s !== 'IR' && IR_ELIGIBLE.has(p.i));
  return { slots, inIR, open, candidates };
}

export function openSpots(snap, roster) {
  const s = snap.league.slots;
  const cap = STARTING_SLOTS.reduce((n, k) => n + (s[k] || 0), 0) + (s.BE || 0);
  return cap - roster.filter((p) => p.s !== 'IR' || !IR_ELIGIBLE.has(p.i)).length;
}

// ---------- waivers ----------

// Points per remaining week for a roster (used to explain WHEN a move helps).
function weeklyValues(snap, roster, weeks) {
  const r = usable(roster);
  return weeks.map((w) => bestLineup(r, snap.league.slots, (p) => weekValue(snap, p, w)).total);
}

// For each free agent: add him, drop whoever hurts least, and measure the gain.
export function waiverTargets(snap, teamId = snap.me, limit = 12, perPosition = 3) {
  const roster = rosterOf(snap, teamId);
  const weeks = remainingWeeks(snap);
  const base = weeklyValues(snap, roster, weeks);
  const baseROS = base.reduce((a, b) => a + b, 0);
  const open = openSpots(snap, roster);
  const droppable = roster.filter((p) => p.s !== 'IR' || !IR_ELIGIBLE.has(p.i));

  const out = [];
  for (const fa of snap.players.filter((p) => p.tm === 0 && (rosPPG(p) > 3 || p.pw > 3))) {
    // Try every possible drop (or the open spot) and keep them all, best first.
    const options = (open > 0 ? [null] : droppable).map((drop) => {
      const r = roster.filter((p) => p !== drop).concat({ ...fa, s: 'BE' });
      const vals = weeklyValues(snap, r, weeks);
      return { drop, ros: vals.reduce((a, b) => a + b, 0), vals };
    }).sort((a, b) => (b.ros - a.ros) || (a.drop && b.drop ? rosPPG(a.drop) - rosPPG(b.drop) : 0));
    const best = options[0];
    const gains = best.vals.map((v, i) => v - base[i]);
    // Explain the gain: a steady upgrade, or mostly covering specific weeks?
    const bigWeeks = weeks.filter((w, i) => gains[i] > 3);
    const steady = gains.slice(1).filter((g) => g > 0.5).length >= (weeks.length - 1) * 0.6;
    const why = steady ? 'Starts for you most weeks'
      : bigWeeks.length ? `Fills in week${bigWeeks.length > 1 ? 's' : ''} ${bigWeeks.join(', ')}`
        : 'Small depth upgrade';
    out.push({
      p: fa, drop: best.drop, why,
      weekGain: gains[0],
      rosGain: best.ros - baseROS,
      perWeek: (best.ros - baseROS) / weeks.length,
      // Runner-up drops, so you can see how close the call is.
      alternatives: options.slice(1, 3).filter((o) => o.drop)
        .map((o) => ({ drop: o.drop, perWeek: (o.ros - baseROS) / weeks.length })),
    });
  }
  // Rank by rest-of-season gain, but keep the list varied (max 3 per position).
  const count = {};
  return out.filter((x) => x.rosGain > 0.5 || x.weekGain > 0.5)
    .sort((a, b) => b.rosGain - a.rosGain)
    .filter((x) => (count[x.p.p] = (count[x.p.p] || 0) + 1) <= perPosition)
    .slice(0, limit);
}

// How much each of your players is worth to YOUR lineup: the points per week
// you'd lose if he were gone. Low cost = safe to drop. Bench depth that only
// matters in bye weeks shows up here as a small number, not zero.
//
// "Value over replacement": if you dropped him you could pick up the best free
// agent at his position, so his real cost is the drop-off to that guy.
export function dropCosts(snap, teamId = snap.me) {
  const roster = rosterOf(snap, teamId);
  const weeks = remainingWeeks(snap);
  const base = rosValue(snap, roster, weeks);
  const wk = (r) => bestLineup(usable(r), snap.league.slots, (p) => p.pw).total;
  const baseWeek = wk(roster);
  const freeAgents = snap.players.filter((p) => p.tm === 0);
  return roster.filter((p) => p.s !== 'IR').map((p) => {
    const without = roster.filter((x) => x !== p);
    const replacements = freeAgents.filter((f) => f.p === p.p)
      .sort((a, b) => rosPPG(b) - rosPPG(a)).slice(0, 3);
    let after = rosValue(snap, without, weeks);
    let replacement = null;
    for (const f of replacements) {
      const v = rosValue(snap, without.concat({ ...f, s: 'BE' }), weeks);
      if (v > after) { after = v; replacement = f; }
    }
    const cost = (base - after) / weeks.length;
    const weekCost = baseWeek - wk(replacement ? without.concat({ ...replacement, s: 'BE' }) : without);
    // Signals from outside the projections: is the market moving on him?
    const signals = [];
    if (p.tr <= -3) signals.push(`Being dropped across ESPN (${p.tr}% this week)`);
    if (p.tr >= 3) signals.push(`Being added across ESPN (+${p.tr}% this week)`);
    if (p.sl && p.sl <= 50) signals.push(`#${p.sl} most-added on Sleeper`);
    if (p.i === 'IR' || p.i === 'O') signals.push(p.i === 'IR' ? 'On injured reserve' : 'Out this week');
    // Negative cost means a free agent at his position is simply better: swap them.
    const verdict = cost < -0.25 ? 'swap' : cost < 0.25 ? 'safe' : cost < 1.5 ? 'depth' : 'keep';
    return { p, cost, weekCost, replacement, verdict, signals };
  }).sort((a, b) => a.cost - b.cost || rosPPG(a.p) - rosPPG(b.p));
}

// Best free agent at a position for THIS week (D/ST and K streaming).
export function streamers(snap, pos, teamId = snap.me, limit = 5) {
  const mine = rosterOf(snap, teamId).filter((p) => p.p === pos).sort((a, b) => b.pw - a.pw)[0];
  const list = snap.players.filter((p) => p.tm === 0 && p.p === pos && p.pw > 0)
    .sort((a, b) => b.pw - a.pw).slice(0, limit);
  return { mine, list };
}

// ---------- trades ----------

// Score a proposed trade for both sides. give/get are arrays of players.
export function evaluateTrade(snap, otherId, give, get, cache = {}) {
  const weeks = remainingWeeks(snap);
  const mine = rosterOf(snap, snap.me);
  const theirs = rosterOf(snap, otherId);
  const myBase = cache.my ?? rosValue(snap, mine, weeks);
  const thBase = cache.th ?? rosValue(snap, theirs, weeks);
  const gIds = new Set(give.map((p) => p.id));
  const rIds = new Set(get.map((p) => p.id));
  const myNew = mine.filter((p) => !gIds.has(p.id)).concat(get.map((p) => ({ ...p, s: 'BE', tm: snap.me })));
  const thNew = theirs.filter((p) => !rIds.has(p.id)).concat(give.map((p) => ({ ...p, s: 'BE', tm: otherId })));
  const wk = (r) => bestLineup(usable(r), snap.league.slots, (p) => p.pw).total;
  return {
    myGain: (rosValue(snap, myNew, weeks) - myBase) / weeks.length,
    theirGain: (rosValue(snap, thNew, weeks) - thBase) / weeks.length,
    myWeek: wk(myNew) - wk(mine),
    rosterChange: get.length - give.length,   // +1 means you'd need to drop someone
  };
}

// Scan every team for trades where BOTH sides' lineups get better. Those are
// the ones a reasonable manager might actually accept.
export function findTrades(snap, limit = 12) {
  const weeks = remainingWeeks(snap);
  const mine = rosterOf(snap, snap.me);
  const myBase = rosValue(snap, mine, weeks);
  // Kickers and defenses are easy to stream, so nobody trades for them.
  const relevant = (r) => r.filter((p) => rosPPG(p) >= 6 && !['K', 'DST'].includes(p.p) &&
    !(p.s === 'IR' && IR_ELIGIBLE.has(p.i)));
  const myPieces = relevant(mine);
  const ideas = [];

  for (const t of snap.teams) {
    if (t.id === snap.me) continue;
    const theirs = rosterOf(snap, t.id);
    const cache = { my: myBase, th: rosValue(snap, theirs, weeks) };
    const theirPieces = relevant(theirs);
    const packages = [];
    for (const a of myPieces) for (const b of theirPieces) packages.push([[a], [b]]);
    // 2-for-1 consolidation both ways (pairs of non-QB skill players keep this fast).
    for (let i = 0; i < myPieces.length; i++) for (let j = i + 1; j < myPieces.length; j++) {
      for (const b of theirPieces) packages.push([[myPieces[i], myPieces[j]], [b]]);
    }
    for (let i = 0; i < theirPieces.length; i++) for (let j = i + 1; j < theirPieces.length; j++) {
      for (const a of myPieces) packages.push([[a], [theirPieces[i], theirPieces[j]]]);
    }
    for (const [give, get] of packages) {
      // Quick filter: skip lopsided junk before the expensive evaluation.
      const gv = give.reduce((s, p) => s + rosPPG(p), 0);
      const tv = get.reduce((s, p) => s + rosPPG(p), 0);
      if (tv < gv * 0.6 || tv > gv * 1.6) continue;
      const e = evaluateTrade(snap, t.id, give, get, cache);
      if (e.myGain > 0.4 && e.theirGain > 0.2) ideas.push({ team: t, give, get, ...e });
    }
  }
  // Rank by your gain, but favor deals that are balanced enough to get accepted.
  ideas.forEach((x) => { x.score = x.myGain + 0.5 * Math.min(x.theirGain, x.myGain); });
  ideas.sort((a, b) => b.score - a.score);
  // Keep it varied: each player you'd receive or give shows up at most twice.
  const seen = new Map();
  const bump = (p) => { const n = (seen.get(p.id) || 0) + 1; seen.set(p.id, n); return n; };
  return ideas.filter((x) => {
    const over = [...x.get, ...x.give].some((p) => (seen.get(p.id) || 0) >= 2);
    if (over) return false;
    [...x.get, ...x.give].forEach(bump);
    return true;
  }).slice(0, limit);
}

// ---------- standings, power rankings, playoff odds ----------

export function standings(snap) {
  const n = snap.teams.length;
  const played = snap.sched.filter((g) => g[0] < snap.week && (g[3] || g[4]));
  const weeks = [...new Set(played.map((g) => g[0]))];
  const score = {}; // score[teamId][week]
  for (const g of played) {
    (score[g[1]] ||= {})[g[0]] = g[3];
    (score[g[2]] ||= {})[g[0]] = g[4];
  }
  const rows = snap.teams.map((t) => {
    let apW = 0, apG = 0;
    for (const w of weeks) {
      const mine = score[t.id]?.[w];
      if (mine == null) continue;
      for (const o of snap.teams) {
        if (o.id === t.id) continue;
        const theirs = score[o.id]?.[w];
        if (theirs == null) continue;
        apG++; apW += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      }
    }
    const gp = t.w + t.l + t.t || 1;
    const allPlay = apG ? apW / apG : 0;
    // Roster strength: best lineup in a typical week (no byes), rest-of-season values.
    const strength = bestLineup(usable(rosterOf(snap, t.id)), snap.league.slots, rosPPG).total;
    return {
      team: t, gp, ppg: t.pf / gp, papg: t.pa / gp, allPlay,
      allPlayRec: `${Math.round(apW)}-${Math.round(apG - apW)}`,
      luck: t.w - allPlay * gp,          // wins above what your scoring "deserved"
      strength,
    };
  });
  // Power score: blend of scoring so far, all-play win rate and roster strength now.
  const z = (k) => {
    const v = rows.map((r) => r[k]);
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
    return (x) => (x - mean) / sd;
  };
  const zp = z('ppg'), za = z('allPlay'), zs = z('strength');
  rows.forEach((r) => { r.power = 0.35 * zp(r.ppg) + 0.25 * za(r.allPlay) + 0.4 * zs(r.strength); });
  rows.sort((a, b) => b.power - a.power).forEach((r, i) => { r.powerRank = i + 1; });
  return rows;
}

// Simulate the rest of the regular season thousands of times.
export function playoffOdds(snap, sims = 5000) {
  const reg = snap.league.regWeeks;
  const P = snap.league.playoffTeams;
  const left = snap.sched.filter((g) => g[0] >= snap.week && g[0] <= reg);
  const ids = snap.teams.map((t) => t.id);

  // Expected score for each team in each remaining week: 60% roster projection,
  // 40% how they've actually scored so far (scaled down in weeks with byes).
  const mean = {};
  for (const t of snap.teams) {
    const roster = usable(rosterOf(snap, t.id));
    const ppg = t.pf / (t.w + t.l + t.t || 1);
    const typical = bestLineup(roster, snap.league.slots, rosPPG).total || 1;
    mean[t.id] = {};
    for (let w = snap.week; w <= reg; w++) {
      const proj = bestLineup(roster, snap.league.slots, (p) => weekValue(snap, p, w)).total;
      mean[t.id][w] = 0.6 * proj + 0.4 * ppg * Math.min(1, proj / typical);
    }
  }

  // Box-Muller normal random numbers.
  const randn = () => {
    let u = 0; while (!u) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  };

  const tally = Object.fromEntries(ids.map((id) => [id, { playoffs: 0, bye: 0, first: 0, seedSum: 0, wins: 0 }]));
  const me = snap.me;
  const cond = { winNow: [0, 0], loseNow: [0, 0] };  // [made playoffs, sims] given this week's result

  for (let s = 0; s < sims; s++) {
    const W = {}, PF = {};
    for (const t of snap.teams) { W[t.id] = t.w + t.t * 0.5; PF[t.id] = t.pf; }
    let myResult = null;
    for (const [w, h, a] of left) {
      const hs = mean[h][w] * (1 + SD_SHARE * randn());
      const as = mean[a][w] * (1 + SD_SHARE * randn());
      PF[h] += hs; PF[a] += as;
      if (hs > as) W[h]++; else W[a]++;
      if (w === snap.week && (h === me || a === me)) myResult = (h === me) === (hs > as);
    }
    const order = [...ids].sort((x, y) => W[y] - W[x] || PF[y] - PF[x]);
    order.forEach((id, i) => {
      const r = tally[id];
      r.seedSum += i + 1; r.wins += W[id];
      if (i < P) r.playoffs++;
      if (i < 2) r.bye++;
      if (i === 0) r.first++;
    });
    if (myResult !== null) {
      const c = myResult ? cond.winNow : cond.loseNow;
      c[1]++; if (order.indexOf(me) < P) c[0]++;
    }
  }
  const teams = snap.teams.map((t) => {
    const r = tally[t.id];
    return { team: t, playoffs: r.playoffs / sims, bye: r.bye / sims, first: r.first / sims,
      avgSeed: r.seedSum / sims, projWins: r.wins / sims };
  }).sort((a, b) => b.playoffs - a.playoffs || a.avgSeed - b.avgSeed);
  return {
    teams,
    ifWin: cond.winNow[1] ? cond.winNow[0] / cond.winNow[1] : null,
    ifLose: cond.loseNow[1] ? cond.loseNow[0] / cond.loseNow[1] : null,
  };
}

// ---------- player history (the player panel) ----------
// hist = site/data/<league>-players.json: players[id] = [[week, pts, proj, snap%, stats], ...]

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

// How many players at a position your league starts each week. FLEX spots are
// split roughly the way leagues fill them: about 45% RB, 45% WR, 10% TE.
function startersAt(snap, pos) {
  const s = snap.league.slots, size = snap.league.size;
  const flex = (s.FLEX || 0) * ({ RB: 0.45, WR: 0.45, TE: 0.1 }[pos] || 0);
  return Math.round(size * ((s[pos] || 0) + flex));
}

// Each player's finish at his position for every past week (1 = top scorer).
export function weeklyRanks(snap, hist) {
  const pos = Object.fromEntries(snap.players.map((p) => [p.id, p.p]));
  const byWeekPos = {};
  for (const [id, rows] of Object.entries(hist.players)) {
    for (const [w, pts] of rows) {
      if (pts == null || !pos[id]) continue;
      ((byWeekPos[w] ||= {})[pos[id]] ||= []).push([+id, pts]);
    }
  }
  const rank = {};   // rank[id][week]
  for (const [w, groups] of Object.entries(byWeekPos)) {
    for (const list of Object.values(groups)) {
      list.sort((a, b) => b[1] - a[1]).forEach(([id], i) => { (rank[id] ||= {})[w] = i + 1; });
    }
  }
  return rank;
}

// Points each NFL defense gives up to each position per game, ranked
// 1 (stingiest) to 32 (most generous). Built from every player in your league's pool.
export function defenseVsPosition(snap, hist) {
  const allowed = {};   // allowed[pos][defTeam] = { pts, games:Set }
  for (const p of snap.players) {
    const opps = snap.proTeams[p.t]?.opps;
    if (!opps) continue;
    for (const [w, pts] of hist.players[p.id] || []) {
      const d = opps[w];
      if (d == null || pts == null) continue;
      const a = ((allowed[p.p] ||= {})[d] ||= { pts: 0, games: new Set() });
      a.pts += pts; a.games.add(w);
    }
  }
  const out = {};
  for (const [pos, teams] of Object.entries(allowed)) {
    const per = Object.entries(teams).map(([d, a]) => [+d, a.pts / a.games.size]).sort((a, b) => a[1] - b[1]);
    out[pos] = {};
    per.forEach(([d, v], i) => { out[pos][d] = { perGame: v, rank: i + 1, of: per.length }; });
  }
  return out;
}

// A week with no points, no stats, no snaps and no projection means he didn't
// play (injured, inactive or before he joined a team), not a 0-point game.
const didNotPlay = ([, pts, proj, snp, st]) =>
  !pts && snp == null && !Object.keys(st || {}).length && !proj;

export function playerReport(snap, hist, p, cache = {}) {
  const all = (hist.players[p.id] || []).filter((r) => r[1] != null);
  const missed = all.filter(didNotPlay).map((r) => r[0]);
  const rows = all.filter((r) => !didNotPlay(r));
  const ranks = (cache.ranks ??= weeklyRanks(snap, hist))[p.id] || {};
  const dvp = (cache.dvp ??= defenseVsPosition(snap, hist))[p.p] || {};
  const pts = rows.map((r) => r[1]);
  const sorted = [...pts].sort((a, b) => a - b);
  const startLine = startersAt(snap, p.p);
  const boomLine = ['QB', 'TE', 'K', 'DST'].includes(p.p) ? Math.max(3, Math.round(snap.league.size / 2)) : snap.league.size;

  const weeks = rows.map(([w, pt, proj, snp, st]) => ({
    w, pts: pt, proj, snap: snp, stats: st, rank: ranks[w] ?? null,
    opp: snap.proTeams[p.t]?.opps?.[w] ?? null,
  }));
  const games = weeks.length;
  const mean = games ? pts.reduce((a, b) => a + b, 0) / games : 0;
  const sd = games > 1 ? Math.sqrt(pts.reduce((a, b) => a + (b - mean) ** 2, 0) / (games - 1)) : 0;

  // Snap share trend: last two games against the ones before.
  const snaps = weeks.filter((x) => x.snap != null);
  let snapTrend = null;
  if (snaps.length >= 3) {
    const recent = snaps.slice(-2).reduce((a, x) => a + x.snap, 0) / 2;
    const before = snaps.slice(0, -2).reduce((a, x) => a + x.snap, 0) / (snaps.length - 2);
    const diff = recent - before;
    snapTrend = { recent, before, diff, dir: diff >= 8 ? 'up' : diff <= -8 ? 'down' : 'flat' };
  }

  // Usage: the opportunities that drive his points.
  const usage = weeks.map((x) => {
    const s = x.stats || {};
    if (p.p === 'QB') return { w: x.w, n: s.py || 0, label: 'pass yds' };
    if (p.p === 'RB') return { w: x.w, n: (s.ca || 0) + (s.tg || 0), label: 'touches + targets' };
    if (p.p === 'WR' || p.p === 'TE') return { w: x.w, n: s.tg || 0, label: 'targets' };
    return null;
  }).filter(Boolean);

  // Next four weeks: opponent and how generous that defense is to his position.
  const upcoming = [];
  for (let w = snap.week; w < snap.week + 4 && w <= FINAL_WEEK; w++) {
    const opp = snap.proTeams[p.t]?.opps?.[w];
    const d = opp != null ? dvp[opp] : null;
    upcoming.push({ w, opp, bye: opp == null, dvp: d,
      ease: d ? (d.rank > d.of * 2 / 3 ? 'easy' : d.rank <= d.of / 3 ? 'tough' : 'average') : null });
  }

  return {
    weeks, games, mean, sd, missed,
    floor: quantile(sorted, 0.25), median: quantile(sorted, 0.5), ceiling: quantile(sorted, 0.75),
    low: sorted[0] ?? null, high: sorted.at(-1) ?? null,
    boomLine, startLine,
    booms: weeks.filter((x) => x.rank && x.rank <= boomLine).length,
    startable: weeks.filter((x) => x.rank && x.rank <= startLine).length,
    busts: weeks.filter((x) => !x.rank || x.rank > startLine).length,
    beatProj: weeks.filter((x) => x.proj != null && x.pts > x.proj).length,
    withProj: weeks.filter((x) => x.proj != null).length,
    snapTrend, usage, upcoming,
  };
}


// ---------- opponent preview ----------
// Their lineup this week and where it's weaker or stronger than a typical team.
export function opponentPreview(snap, oppId, now = snap.now ?? Date.now()) {
  if (!oppId) return null;
  const lineup = bestLineupNow(snap, rosterOf(snap, oppId), now);
  // League-typical points at each slot type: average over every team's best lineup.
  const bySlot = (starters) => starters.reduce((m, x) => ((m[x.slot] = (m[x.slot] || 0) + x.v), m), {});
  const all = snap.teams.map((t) => bySlot(bestLineupNow(snap, rosterOf(snap, t.id), now).starters));
  const avg = {};
  for (const m of all) for (const [k, v] of Object.entries(m)) avg[k] = (avg[k] || 0) + v / all.length;
  const theirs = bySlot(lineup.starters);
  const compare = Object.keys(avg).map((slot) => ({ slot, diff: (theirs[slot] || 0) - avg[slot] }))
    .sort((a, b) => a.diff - b.diff);
  return {
    lineup,
    iffy: lineup.starters.filter((x) => x.p && !x.locked && (x.p.i === 'Q' || x.p.i === 'D')).map((x) => x.p),
    weak: compare.filter((c) => c.diff < -1.5).slice(0, 2),
    strong: compare.filter((c) => c.diff > 1.5).reverse().slice(0, 2),
  };
}

// ---------- points left on the bench ----------
// For every team and past week: what their lineup scored vs. the best lineup
// they could have set from the same roster.
export function benchPoints(snap, hist) {
  const out = {};
  for (const [w, teams] of Object.entries(hist.lineups || {})) {
    for (const [tid, entries] of Object.entries(teams)) {
      const actual = entries.filter((e) => !['BE', 'IR'].includes(e[1])).reduce((a, e) => a + e[2], 0);
      const pool = entries.filter((e) => e[1] !== 'IR').map(([id, , pts, pos]) => ({ id, p: pos, pts }));
      const optimal = bestLineup(pool, snap.league.slots, (x) => x.pts).total;
      const r = (out[tid] ||= { teamId: +tid, actual: 0, optimal: 0, weeks: [] });
      r.actual += actual; r.optimal += optimal;
      r.weeks.push({ w: +w, actual, optimal, left: optimal - actual });
    }
  }
  return Object.values(out).map((r) => ({
    ...r,
    left: r.optimal - r.actual,
    eff: r.optimal ? r.actual / r.optimal : 1,
    worst: r.weeks.reduce((a, b) => (b.left > (a?.left ?? -1) ? b : a), null),
    team: snap.teams.find((t) => t.id === r.teamId),
  })).filter((r) => r.team).sort((a, b) => b.eff - a.eff);
}

// ---------- fantasy playoff schedule ----------
// Each player's opponents in the fantasy playoff weeks and how easy they are.
export function matchupEase(snap, dvp, p, w) {
  const opp = snap.proTeams[p.t]?.opps?.[w];
  if (opp == null) return { w, bye: true };
  const d = (dvp[p.p] || {})[opp];
  return { w, opp, dvp: d, ease: d ? (d.rank > d.of * 2 / 3 ? 'easy' : d.rank <= d.of / 3 ? 'tough' : 'average') : null };
}
export function playoffWeeks(snap) {
  const out = [];
  for (let w = snap.league.regWeeks + 1; w <= FINAL_WEEK; w++) out.push(w);
  return out;
}
export function playoffSchedule(snap, hist, players) {
  const dvp = defenseVsPosition(snap, hist);
  const weeks = playoffWeeks(snap);
  const score = { easy: 1, average: 0, tough: -1 };
  return players.map((p) => {
    const games = weeks.map((w) => matchupEase(snap, dvp, p, w));
    return { p, games, score: games.reduce((a, g) => a + (g.bye ? -2 : score[g.ease] || 0), 0) };
  });
}
