// The page: load a league snapshot, run the analysis, draw the active tab.
import * as A from './analysis.js';
import * as R from './refresh.js';
import { openPlayer, loadHistory } from './player.js';

const state = { leagues: [], snap: null, tab: 'team', cache: {}, leagueId: null };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sign = (x) => (x >= 0 ? '+' : '−') + f1(Math.abs(x));
const pct = (x) => `${Math.round(x * 100)}%`;
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] || '');

// Remember the last league and tab you looked at (per device, best effort).
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- small render helpers ----------
const record = (t) => `${t.w}-${t.l}${t.t ? `-${t.t}` : ''}`;
const onBye = (p) => state.snap.proTeams[p.t]?.bye === state.snap.week;

function game(p) {
  const pro = state.snap.proTeams[p.t];
  if (!pro || p.t === 0) return 'No NFL team';
  if (onBye(p)) return `${pro.ab}, bye week`;
  const opp = state.snap.proTeams[pro.opp];
  return `${pro.ab} ${pro.home ? 'vs' : 'at'} ${opp?.ab ?? '?'}`;
}
function flags(p, extra = '') {
  let h = '';
  if (p.i) h += `<span class="flag ${p.i}">${p.i}</span>`;
  if (onBye(p)) h += '<span class="flag BYE">BYE</span>';
  if (p.sl && p.sl <= 25) h += `<span class="flag HOT" title="#${p.sl} most-added on Sleeper in the last 48 hours">HOT</span>`;
  return h + extra;
}
// ---------- "Open in ESPN" shortcuts ----------
// The app only reads ESPN, so every move is made in ESPN. These links jump
// straight to the right ESPN page (the ESPN Fantasy app opens them on a phone).
const ESPN = 'https://fantasy.espn.com/football';
const espnUrl = {
  myTeam: () => `${ESPN}/team?leagueId=${state.snap.league.id}&teamId=${state.snap.me}&seasonId=${state.snap.season}`,
  team: (teamId) => `${ESPN}/team?leagueId=${state.snap.league.id}&teamId=${teamId}&seasonId=${state.snap.season}`,
  players: () => `${ESPN}/players/add?leagueId=${state.snap.league.id}&fromTeamId=${state.snap.me}&seasonId=${state.snap.season}`,
  matchup: () => `${ESPN}/boxscore?leagueId=${state.snap.league.id}&matchupPeriodId=${state.snap.week}&scoringPeriodId=${state.snap.week}&seasonId=${state.snap.season}&teamId=${state.snap.me}&view=scoringperiod`,
};
const espnBtn = (url, label) => `<a class="espn-btn" href="${url}" target="_blank" rel="noopener">${label}</a>`;

// Every player name is a button that opens his panel (see player.js).
const nameBtn = (p) => `<button type="button" class="plink" data-pid="${p.id}">${esc(p.n)}</button>`;
const pos = (p) => `<span class="pos ${p.p}">${p.p === 'DST' ? 'D/ST' : p.p}</span>`;
function meta(p, bits, showPos = true) {
  return `<div class="meta">${showPos ? pos(p) : ''}${bits.filter(Boolean).map((b) => `<span>${b}</span>`).join('')}</div>`;
}
const expertRank = (p) => (p.er ? `Experts rank him ${p.p === 'DST' ? 'D/ST' : p.p}${p.er}` : '');

function playerRow(slot, p, value, opts = {}) {
  if (!p) return `<li class="row"><span class="slot">${slot}</span><div class="pname dim">Nobody available</div><div class="pts">0.0</div></li>`;
  // Games that have started: show what he's scored and lock the row.
  const st = opts.state || 'pre';
  const live = st === 'live' ? `<span class="flag LIVE">LIVE ${f1(p.ap ?? 0)}</span>` : st === 'final' ? '<span class="flag FINAL">FINAL</span>' : '';
  if (st !== 'pre' && !opts.label) opts.label = st === 'final' ? 'scored' : 'expected';
  return `<li class="row ${opts.change ? 'change' : ''} ${st !== 'pre' ? 'locked' : ''}">
    <span class="slot">${slot}</span>
    <div><div class="pname">${nameBtn(p)} ${flags(p, (opts.change ? '<span class="flag START">START</span>' : '') + live)}</div>
      ${meta(p, [game(p), `${f1(p.avg)} avg`, p.er ? `exp. ${p.p === 'DST' ? 'D/ST' : p.p}${p.er}` : ''], !(slot === p.p || (slot === 'DST' && p.p === 'DST')))}</div>
    <div class="pts ${opts.up ? 'up' : ''}">${f1(value)}<small>${opts.label || 'proj'}</small></div></li>`;
}

// The field strip: win chance shown as field position. 0% = your goal line, 100% = theirs.
function field(win) {
  const at = Math.round(win * 100);
  const yards = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  return `<div class="field" role="img" aria-label="Win chance ${at}%">
    <div class="play">
      ${yards.map((y, i) => `<span class="yd" style="left:${(i + 1) * 10}%">${y}</span>`).join('')}
      <span class="los" style="left:${at}%"></span><span class="ball" style="left:${at}%"></span>
    </div></div>`;
}
const yardLine = (w) => {
  const at = Math.round(w * 100);
  if (at === 50) return 'at midfield';
  return at < 50 ? `on your own ${at}` : `on their ${100 - at}`;
};

// ---------- My team ----------
function renderTeam() {
  const s = state.snap;
  const tw = A.thisWeek(s);
  const me = s.teams.find((t) => t.id === s.me);
  const opp = s.teams.find((t) => t.id === tw.oppId);
  const startIds = new Set(tw.toStart.map((x) => x.p.id));
  const win = tw.winBest;

  const started = tw.progress.played + tw.progress.playing > 0;
  const done = tw.progress.total && tw.progress.played === tw.progress.total;
  const fix = done ? '<div class="fix dim">All your starters have played. Final scores update as the last games finish.</div>'
    : tw.gain > 0.05
    ? `<div class="fix"><strong>Set your best lineup for ${sign(tw.gain)} points.</strong> Your win chance goes from ${pct(tw.winNow)} to ${pct(tw.winBest)}.
        <p>Start ${esc(list(tw.toStart.map((x) => x.p.n)))}. Sit ${esc(list(tw.toSit.map((p) => p.n)))}.</p></div>`
    : '<div class="fix dim">The lineup you have set in ESPN is already your best one.</div>';

  return `
  <h2>Week ${s.week}${started && !done ? ' <span class="flag LIVE">LIVE</span>' : ''}</h2>
  <div class="matchup">
    <div class="scoreline">
      <div class="team-l"><div class="tname">${esc(me.name)}</div><div class="trec">${record(me)}</div><div class="score">${f1(tw.best.total)}</div>
        ${started ? `<div class="sofar">${f1(tw.scored)} scored so far</div>` : ''}</div>
      <div class="team-r"><div class="tname">${esc(opp?.name ?? 'No game')}</div><div class="trec">${opp ? record(opp) : ''}</div><div class="score">${f1(tw.opp)}</div>
        ${started ? `<div class="sofar">${f1(tw.oppScored)} scored so far</div>` : ''}</div>
    </div>
    ${started ? `<p class="livenote">Projected finals: points already scored plus what's still to come. ${tw.progress.played} of your starters done, ${tw.progress.playing} playing now.</p>` : ''}
    ${field(win)}
    <div class="fieldnote"><span><b>${pct(win)}</b> to win</span><span>Ball ${yardLine(win)}</span></div>
    ${fix}
    <div class="espn-row">${espnBtn(espnUrl.myTeam(), 'Set lineup in ESPN')}${espnBtn(espnUrl.matchup(), 'Matchup in ESPN')}</div>
  </div>

  ${tw.alerts.length ? `<h2>${started ? 'Heads up' : 'Before kickoff'}</h2><ul class="alerts">${tw.alerts.map((a) => `<li class="lvl-${a.level}">${esc(a.text)}</li>`).join('')}</ul>` : ''}

  <h2>Best lineup</h2>
  <div class="sheetbox">
    <ul class="rows">${tw.best.starters.map((x) => playerRow(x.slot, x.p, x.v, { change: x.p && startIds.has(x.p.id), state: x.state })).join('')}</ul>
    <div class="total"><span>${started ? 'Projected final' : 'Projected total'}</span><span class="n">${f1(tw.best.total)}</span></div>
  </div>

  <h2>Bench</h2>
  <div class="sheetbox"><ul class="rows">
    ${tw.best.bench.filter((x) => x.p.s !== 'IR').sort((a, b) => b.v - a.v).map((x) => playerRow('BN', x.p, x.v, { state: x.state })).join('')}
  </ul></div>

  ${opponentSection(s, tw)}

  ${irSection(s)}

  ${playoffSection(s, tw)}`;
}

// Your opponent this week: their lineup, who's questionable, where they're weak.
function opponentSection(s, tw) {
  const op = A.opponentPreview(s, tw.oppId);
  if (!op) return '';
  const opp = s.teams.find((t) => t.id === tw.oppId);
  const slotName = (k) => ({ DST: 'D/ST' }[k] || k);
  const notes = [];
  if (op.weak.length) notes.push(`Weak at <b>${op.weak.map((c) => slotName(c.slot)).join(' and ')}</b> (${op.weak.map((c) => `${f1(-c.diff)} below a typical team`).join(', ')}).`);
  if (op.strong.length) notes.push(`Strong at <b>${op.strong.map((c) => slotName(c.slot)).join(' and ')}</b>.`);
  if (op.iffy.length) notes.push(`<b>${op.iffy.length} questionable</b> starter${op.iffy.length > 1 ? 's' : ''}: ${esc(list(op.iffy.map((p) => p.n)))}.`);
  return `
  <h2 class="h-espn">Your opponent ${espnBtn(espnUrl.team(tw.oppId), 'Their team in ESPN')}</h2>
  <details class="sheetbox opp">
    <summary><b>${esc(opp.name)}</b> <span class="dim">${record(opp)}, ${f1(tw.opp)} projected</span></summary>
    ${notes.length ? `<p class="ps-sum" style="margin-top:8px">${notes.join(' ')}</p>` : ''}
    <ul class="rows">${op.lineup.starters.map((x) => playerRow(x.slot, x.p, x.v, { state: x.state })).join('')}</ul>
  </details>`;
}

// Fantasy playoffs: your starters' matchups in the playoff weeks.
function playoffSection(s, tw) {
  if (!state.hist) return '';
  const weeks = A.playoffWeeks(s);
  if (!weeks.length) return '';
  const typical = A.bestLineup(A.rosterOf(s, s.me).filter((p) => p.s !== 'IR'), s.league.slots, A.rosPPG).starters.filter((x) => x.p).map((x) => x.p);
  const rows = A.playoffSchedule(s, state.hist, typical);
  const cell = (g) => (g.bye ? '<td class="ease bye">BYE</td>' : `<td class="ease ${g.ease || ''}">${esc(s.proTeams[g.opp]?.ab)}</td>`);
  const worst = rows.filter((r) => r.score <= -2).map((r) => r.p.n);
  return `
  <h2>Fantasy playoffs</h2>
  <p class="explain">Your usual starters' opponents in weeks ${weeks[0]}–${weeks.at(-1)}. Green is an easy matchup for that position, red is tough.${worst.length ? ` Worth planning around: <b>${esc(list(worst))}</b>.` : ''}</p>
  <div class="sheetbox"><table class="tbl po-tbl">
    <tr><th>Pos</th><th>Player</th>${weeks.map((w) => `<th>W${w}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr><td><span class="pos ${r.p.p}">${r.p.p === 'DST' ? 'D/ST' : r.p.p}</span></td><td class="team">${nameBtn(r.p)}</td>${r.games.map(cell).join('')}</tr>`).join('')}
  </table></div>`;
}

// Injured reserve: every IR spot, filled or open, plus moves worth making.
function irSection(s) {
  const ir = A.irStatus(s);
  if (!ir.slots) return '';
  const rows = ir.inIR.map(({ p, eligible }) => `<li class="row ${eligible ? '' : 'ir-bad'}">
      <span class="slot">IR</span>
      <div><div class="pname">${nameBtn(p)} ${flags(p)}</div>
        ${meta(p, [game(p), eligible ? 'IR-eligible' : '<span class="bad">No longer IR-eligible</span>'])}</div>
      <div class="pts">${f1(A.rosPPG(p))}<small>ROS per game</small></div></li>`).join('');
  const empty = Array.from({ length: ir.open }, () => `<li class="row"><span class="slot">IR</span>
      <div><div class="pname dim">Open spot</div><div class="meta"><span>${ir.candidates.length ? 'See below' : 'Nobody on your roster qualifies right now'}</span></div></div><div></div></li>`).join('');
  const notes = [];
  for (const { p, eligible } of ir.inIR) {
    if (!eligible) notes.push(`<li class="lvl-bad">${esc(p.n)} is listed ${p.i ? ({ Q: 'questionable', D: 'doubtful' }[p.i] || p.i) : 'healthy'}, so ESPN won't let you add or trade anyone until he moves back to your roster. You'll need an open bench spot for him.</li>`);
  }
  if (ir.candidates.length) {
    const fits = ir.candidates.slice(0, ir.open);
    if (fits.length) notes.push(`<li class="lvl-info">Move ${esc(list(fits.map((p) => p.n)))} to IR. ${fits.length > 1 ? 'They\'re' : 'He\'s'} eligible, and it frees ${fits.length > 1 ? `${fits.length} bench spots` : 'a bench spot'} at no cost.</li>`);
    const rest = ir.candidates.slice(ir.open);
    if (rest.length) notes.push(`<li class="lvl-warn">${esc(list(rest.map((p) => p.n)))} ${rest.length > 1 ? 'are' : 'is'} IR-eligible too, but your IR spots are full.</li>`);
  }
  return `
  <h2 class="h-espn">Injured reserve ${espnBtn(espnUrl.myTeam(), 'Manage in ESPN')}</h2>
  <p class="explain">${ir.inIR.length} of ${ir.slots} spots used. Players on IR don't count against your roster, but only players listed out, on IR or suspended can stay there.</p>
  ${notes.length ? `<ul class="alerts" style="margin-bottom:10px">${notes.join('')}</ul>` : ''}
  <div class="sheetbox"><ul class="rows">${rows}${empty}</ul></div>`;
}

// ---------- Waivers ----------
function signals(p) {
  const out = [];
  // Kept short so they fit on one line: expert rank this week, Sleeper's
  // most-added rank (48 hours), and the change in ESPN ownership this week.
  if (p.er) out.push(`Experts <b>${p.p === 'DST' ? 'D/ST' : p.p}${p.er}</b>`);
  if (p.sl) out.push(`Sleeper adds <b>#${p.sl}</b>`);
  if (p.tr >= 1) out.push(`Owned <b class="good">+${p.tr}%</b>`);
  if (p.tr <= -1) out.push(`Owned <b class="bad">−${Math.abs(p.tr)}%</b>`);
  return out.length ? `<div class="signals">${out.map((x) => `<span class="signal">${x}</span>`).join('')}</div>` : '';
}
const take = (p) => (p.ol ? `<details class="take"><summary>ESPN analyst take</summary><p>${esc(p.ol)}${p.ol.length >= 400 ? '…' : ''}</p></details>` : '');

// The runner-up drops: "just as good" when they tie the best one.
function altLine(x) {
  if (!x.alternatives.length) return '';
  const tied = x.alternatives.every((a) => Math.abs(a.perWeek - x.perWeek) < 0.05);
  return `<span class="dim">${tied ? `Dropping ${esc(list(x.alternatives.map((a) => a.drop.n)))} works just as well.`
    : `Next best: ${x.alternatives.map((a) => `${esc(a.drop.n)} (${sign(a.perWeek)})`).join(', ')}`}</span>`;
}

// ---------- Available players by position ----------
const AV_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
function availableSection(s) {
  const av = state.avail ??= { pos: store.get('availPos') || 'RB', sort: store.get('availSort') || 'ros' };
  const value = av.sort === 'week' ? (p) => p.pw : A.rosPPG;
  const other = av.sort === 'week' ? A.rosPPG : (p) => p.pw;
  const list = s.players.filter((p) => p.tm === 0 && p.p === av.pos)
    .sort((a, b) => value(b) - value(a) || b.own - a.own).slice(0, 15);

  // Your weakest starter at this position (rest-of-season), to flag real upgrades.
  const mine = A.bestLineup(A.rosterOf(s, s.me).filter((p) => p.s !== 'IR'), s.league.slots, A.rosPPG)
    .starters.filter((x) => x.p && x.p.p === av.pos);
  const weakest = mine.length ? mine.reduce((a, b) => (a.v < b.v ? a : b)) : null;

  // Kickers and defenses are usually streamed week to week, so compare this week too.
  const myStream = ['K', 'DST'].includes(av.pos) ? A.streamers(s, av.pos).mine : null;
  const streamNote = myStream ? ` Streaming? Yours this week: <b>${esc(myStream.n)}</b>, ${f1(myStream.pw)} projected. Switch to <b>This week</b> to sort by it.` : '';
  const posBtn = (k) => `<button type="button" data-apos="${k}" class="${av.pos === k ? 'on' : ''}" aria-pressed="${av.pos === k}">${k === 'DST' ? 'D/ST' : k}</button>`;
  const sortBtn = (k, label) => `<button type="button" data-asort="${k}" class="${av.sort === k ? 'on' : ''}" aria-pressed="${av.sort === k}">${label}</button>`;
  const rows = list.map((p, i) => {
    const upgrade = weakest && A.rosPPG(p) > weakest.v + 0.3;
    const trend = p.tr >= 1 ? `<span class="good">up ${p.tr}%</span>` : p.tr <= -1 ? `<span class="bad">down ${Math.abs(p.tr)}%</span>` : '';
    return `<li class="row arow">
      <span class="slot">${i + 1}</span>
      <div><div class="pname">${nameBtn(p)} ${flags(p, upgrade ? '<span class="flag START">UPGRADE</span>' : '')}</div>
        ${meta(p, [game(p), `${Math.round(p.own)}% owned`, trend, p.er ? `exp. ${p.p === 'DST' ? 'D/ST' : p.p}${p.er}` : '', p.fa === 'W' ? 'waivers' : 'free agent'], false)}</div>
      <div class="pts">${f1(value(p))}<small>${av.sort === 'week' ? 'this week' : 'per game'}</small><small class="sub">${f1(other(p))} ${av.sort === 'week' ? 'ROS' : 'this wk'}</small></div></li>`;
  }).join('');

  return `
  <h2 class="h-espn">Available players ${espnBtn(espnUrl.players(), 'ESPN players')}</h2>
  <p class="explain">The top 15 free agents and waiver players at each position. <b>UPGRADE</b> means he projects better the rest of the season than your weakest starter there${weakest ? ` (${esc(weakest.p.n)}, ${f1(weakest.v)} a game)` : ''}.${streamNote}</p>
  <div class="avail-controls">
    <div class="seg pos-seg" role="group" aria-label="Position">${AV_POS.map(posBtn).join('')}</div>
    <div class="seg sort-seg" role="group" aria-label="Sort by">${sortBtn('ros', 'Rest of season')}${sortBtn('week', 'This week')}</div>
  </div>
  <div class="sheetbox"><ul class="rows">${rows || '<li class="empty">Nobody available at this position.</li>'}</ul></div>`;
}

// Where you are in the waiver line, and what a claim costs you.
function waiverPriority(s) {
  const me = s.teams.find((t) => t.id === s.me);
  if (!me?.wr) return '';
  const w = s.league.waivers || {};
  const cost = w.reset == null ? ''
    : w.reset
    ? 'The order resets every week, so a claim only costs you your spot until the reset. Use it on anyone who helps.'
    : 'A claim sends you to the back of the line, so save it for a pickup that really matters. Small upgrades can wait until the player clears waivers.';
  return `<div class="wpri"><span class="n">#${me.wr}</span><div><b>Your waiver priority</b> of ${s.teams.length}${me.wr === 1 ? ': first in line' : ''}.
    <p>${cost}${w.hours ? ` Dropped players stay on waivers for ${w.hours} hours.` : ''}</p></div></div>`;
}

function renderWaivers() {
  const s = state.snap;
  const picks = state.cache.waivers ??= A.waiverTargets(s);
  const weeksLeft = A.remainingWeeks(s).length;
  // When every pickup assumes the same drop, say it once instead of on every card.
  const drops0 = picks.map((x) => x.drop?.id ?? 0);
  const sameDrop = picks.length > 1 && picks[0].drop && drops0.every((d) => d === drops0[0]) ? picks[0] : null;
  const dropBox = (x) => (sameDrop ? '' : `<div class="drop">${x.drop
    ? `Drop <b>${esc(x.drop.n)}</b>${altLine(x)}`
    : 'No drop needed. He goes in your open roster spot.'}</div>`);
  const head = (x) => `
      <div class="move-head">
        <div><div class="pname">${nameBtn(x.p)} ${flags(x.p)}</div>
          ${meta(x.p, [game(x.p), `${f1(x.p.avg)} avg`, `${Math.round(x.p.own)}% owned`])}</div>
        <div class="gain">${sign(x.perWeek)}<small>per week</small></div>
      </div>`;
  const body = (x) => `
      <p class="why">${esc(x.why)}. <span class="dim">This week ${sign(x.weekGain)}.</span></p>
      ${dropBox(x)}
      ${signals(x.p)}
      ${take(x.p)}
      <div class="espn-row"><span class="status">${x.p.fa === 'W' ? 'On waivers: put in a claim.' : 'Free agent: add him now.'}</span>
        ${espnBtn(espnUrl.players(), x.p.fa === 'W' ? 'Claim in ESPN' : 'Add in ESPN')}</div>`;
  // The top 3 in full; the rest as one-line rows you can tap open.
  const TOP = 3;
  const cards = picks.slice(0, TOP).map((x) => `<div class="move">${head(x)}${body(x)}</div>`).join('')
    + picks.slice(TOP).map((x) => `<details class="move more"><summary>${head(x)}</summary>${body(x)}</details>`).join('');
  const sharedDrop = sameDrop ? `<div class="drop shared">Each pickup assumes you drop <b>${esc(sameDrop.drop.n)}</b>${altLine(sameDrop)}</div>` : '';

  const VERDICT = { swap: 'Upgrade', safe: 'Safe drop', depth: 'Small loss', keep: 'Keep' };
  const drops = state.cache.drops ??= A.dropCosts(s);
  const dropRows = drops.map((d) => {
    const sub = d.verdict === 'swap'
      ? `Swap for ${esc(d.replacement.n)}, ${sign(-d.cost)} a week`
      : `Costs ${f1(Math.max(0, d.cost))} a week${d.replacement ? ` vs ${esc(d.replacement.n)}` : ''}`;
    return `<li class="row drow">
      <span class="verdict ${d.verdict}">${VERDICT[d.verdict]}</span>
      <div><div class="pname">${nameBtn(d.p)} ${flags(d.p)}</div>
        ${meta(d.p, [sub, ...d.signals.map(esc)])}</div>
      <div class="pts">${f1(A.rosPPG(d.p))}<small>per game</small></div></li>`;
  });

  return `
  ${waiverPriority(s)}
  <h2>Best pickups</h2>
  <p class="explain">Each free agent is tried on your roster. We add him, drop whoever hurts least, and re-run your best lineup for all ${weeksLeft} remaining weeks, playoffs included.</p>
  ${sharedDrop}
  ${cards || '<div class="sheetbox empty">No free agent makes your team better right now.</div>'}

  ${availableSection(s)}

  <h2>Who to drop</h2>
  <p class="explain">Safest drop first. Each player is measured against the best free agent at his position, so a kicker you can replace off waivers counts as cheap even if he starts.</p>
  <div class="sheetbox"><ul class="rows">${dropRows.slice(0, 5).join('')}</ul>${dropRows.length > 5
    ? `<details class="more-rows"><summary>Show all ${dropRows.length}</summary><ul class="rows">${dropRows.slice(5).join('')}</ul></details>` : ''}</div>`;
}

// ---------- Trades ----------
function tradeCard(x) {
  const pl = (p) => `<div class="pl">${nameBtn(p)}${meta(p, [`${f1(A.rosPPG(p))} per game`])}</div>`;
  return `<div class="move">
    <div class="deal-team"><b>${esc(x.team.name)}</b><span class="dim">${record(x.team)}</span></div>
    <div class="deal">
      <div class="give"><div class="side-label">You give</div>${x.give.map(pl).join('')}</div>
      <div class="get"><div class="side-label">You get</div>${x.get.map(pl).join('')}</div>
    </div>
    <div class="tally">
      <span>You <b class="good">${sign(x.myGain)}</b> a week</span>
      <span>Them <b class="${x.theirGain >= 0 ? 'good' : 'bad'}">${sign(x.theirGain)}</b></span>
      <span>This week <b>${sign(x.myWeek)}</b></span>
    </div>
    <div class="espn-row">${x.rosterChange > 0 ? '<span class="status">You\'d need to drop a bench player to fit them.</span>' : '<span></span>'}
      ${espnBtn(espnUrl.team(x.team.id), 'Propose in ESPN')}</div>
  </div>`;
}

// Trade offers waiting on an answer, graded the same way as the trade checker.
function offersSection(s) {
  const now = Date.now();
  const offers = (s.offers || []).filter((o) => !o.expires || o.expires > now);
  if (!offers.length) return '';
  const byId = (id) => s.players.find((p) => p.id === id);
  const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const cards = offers.map((o) => {
    const team = s.teams.find((t) => t.id === o.team);
    const give = o.give.map(byId).filter(Boolean);
    const get = o.get.map(byId).filter(Boolean);
    if (!team || give.length !== o.give.length || get.length !== o.get.length) return '';
    const e = A.evaluateTrade(s, o.team, give, get);
    const call = e.myGain > 0.3 && e.theirGain > 0 ? ['good', o.sent ? 'Good for both teams. Decent chance they say yes.' : 'Good for both teams. Worth accepting.']
      : e.myGain > 0.3 ? ['good', o.sent ? 'Helps you, but it hurts them, so they may say no.' : 'Helps you more than them. Accept.']
        : e.myGain > -0.3 ? ['dim', 'About even for you.']
          : ['bad', o.sent ? 'This makes your team worse. Consider cancelling it.' : 'This makes your team worse. Decline or counter.'];
    const pl = (p) => `<div class="pl">${nameBtn(p)}${meta(p, [`${f1(A.rosPPG(p))} per game`])}</div>`;
    return `<div class="move offer">
      <div class="deal-team"><b>${o.sent ? 'You offered' : 'Offer from'} ${esc(team.name)}</b><span class="dim">${o.expires ? `expires ${when(o.expires)}` : ''}</span></div>
      <div class="deal">
        <div class="give"><div class="side-label">You give</div>${give.map(pl).join('')}</div>
        <div class="get"><div class="side-label">You get</div>${get.map(pl).join('')}</div>
      </div>
      <h3 class="${call[0]}" style="margin:2px 0 6px;font:600 18px/1.2 var(--cond)">${call[1]}</h3>
      <div class="tally"><span>You <b class="${e.myGain >= 0 ? 'good' : 'bad'}">${sign(e.myGain)}</b> a week</span><span>Them <b class="${e.theirGain >= 0 ? 'good' : 'bad'}">${sign(e.theirGain)}</b></span><span>This week <b>${sign(e.myWeek)}</b></span></div>
      <div class="espn-row">${e.rosterChange > 0 ? `<span class="status">You'd need to drop ${e.rosterChange} player${e.rosterChange > 1 ? 's' : ''}.</span>` : '<span></span>'}${espnBtn(espnUrl.myTeam(), o.sent ? 'View in ESPN' : 'Answer in ESPN')}</div>
    </div>`;
  }).join('');
  if (!cards) return '';
  const recv = offers.filter((o) => !o.sent).length;
  return `<h2>Pending offers</h2>
  <p class="explain">${recv ? `${recv} offer${recv > 1 ? 's' : ''} waiting on you` : 'Offers you sent that are waiting on the other team'}, graded on what each one does to both starting lineups over the rest of the season.</p>
  ${cards}`;
}

function renderTrades() {
  const s = state.snap;
  const ideas = state.cache.trades ??= A.findTrades(s);
  const others = s.teams.filter((t) => t.id !== s.me);
  const b = state.builder ??= { team: others[0].id, give: new Set(), get: new Set() };

  const chip = (p, set, side) => `<button class="chip ${set.has(p.id) ? 'on' : ''}" data-side="${side}" data-id="${p.id}" aria-pressed="${set.has(p.id)}">
      <span>${esc(p.n)} ${pos(p)}</span><span class="n">${f1(A.rosPPG(p))}</span></button>`;
  const sortRos = (r) => r.filter((p) => !['K', 'DST'].includes(p.p)).sort((x, y) => A.rosPPG(y) - A.rosPPG(x));
  const mine = sortRos(A.rosterOf(s, s.me));
  const theirs = sortRos(A.rosterOf(s, b.team));

  let result = '<p class="explain" style="margin:12px 0 0">Tap players on both sides to see how the trade changes each lineup.</p>';
  if (b.give.size || b.get.size) {
    const give = mine.filter((p) => b.give.has(p.id));
    const get = theirs.filter((p) => b.get.has(p.id));
    const e = A.evaluateTrade(s, b.team, give, get);
    const call = e.myGain > 0.3 && e.theirGain > 0 ? ['good', 'Good for both teams. Worth sending.']
      : e.myGain > 0.3 ? ['warn', 'Helps you but hurts them, so expect a no.']
        : e.myGain > -0.3 ? ['dim', 'About even for you.'] : ['bad', 'This makes your team worse.'];
    result = `<div class="result">
      <h3 class="${call[0]}">${call[1]}</h3>
      <div class="tally"><span>You <b class="${e.myGain >= 0 ? 'good' : 'bad'}">${sign(e.myGain)}</b> a week</span><span>Them <b class="${e.theirGain >= 0 ? 'good' : 'bad'}">${sign(e.theirGain)}</b></span><span>This week <b>${sign(e.myWeek)}</b></span></div>
      ${e.rosterChange > 0 ? `<span class="status">You'd need to drop ${e.rosterChange} player${e.rosterChange > 1 ? 's' : ''}.</span>` : ''}</div>`;
  }

  return `
  ${offersSection(s)}

  <h2>Trades that help both teams</h2>
  <p class="explain">Every 1-for-1 and 2-for-1 deal with every team, kept only when both starting lineups score more over the rest of the season. Those are the trades people say yes to.</p>
  ${ideas.map(tradeCard).join('') || '<div class="sheetbox empty">No trades help both sides right now.</div>'}

  <h2>Check a trade</h2>
  <div class="move" id="builder">
    <select id="tradeTeam" aria-label="Trade partner">${others.map((t) => `<option value="${t.id}" ${t.id === b.team ? 'selected' : ''}>${esc(t.name)} (${record(t)})</option>`).join('')}</select>
    <div class="pick">
      <div><h3 class="give-h">You give</h3>${mine.map((p) => chip(p, b.give, 'give')).join('')}</div>
      <div><h3 class="get-h">You get</h3>${theirs.map((p) => chip(p, b.get, 'get')).join('')}</div>
    </div>
    ${result}
    <div class="espn-row"><span class="status">ESPN's Propose Trade button is on their team page.</span>${espnBtn(espnUrl.team(b.team), 'Their team in ESPN')}</div>
  </div>`;
}

// ---------- League ----------
// Points left on the bench: who sets their lineup well.
function benchSection(s) {
  if (!state.hist) return '<h2>Points left on the bench</h2><div class="sheetbox empty">Loading weekly lineups</div>';
  const rows = A.benchPoints(s, state.hist);
  if (!rows.length) return '';
  const me = rows.find((r) => r.teamId === s.me);
  const rank = rows.indexOf(me) + 1;
  return `
  <h2>Points left on the bench</h2>
  <p class="explain">How close each manager's lineup came to the best one they could have set, using the points everyone actually scored. ${me ? `You're <b>${rank}${['st', 'nd', 'rd'][rank - 1] || 'th'}</b> of ${rows.length}: ${f1(me.left)} points left on your bench${me.worst && me.worst.left > 0.5 ? `, most in week ${me.worst.w} (${f1(me.worst.left)})` : ''}.` : ''}</p>
  <div class="sheetbox" style="overflow-x:auto"><table class="tbl">
    <tr><th>#</th><th>Team</th><th>Lineup</th><th>Left</th><th>Worst wk</th></tr>
    ${rows.map((r, i) => `<tr class="${r.teamId === s.me ? 'me' : ''}"><td class="rank">${i + 1}</td><td class="team">${esc(r.team.name)}</td>
      <td>${Math.round(r.eff * 100)}%</td><td>${f1(r.left)}</td><td>${r.worst && r.worst.left > 0.5 ? `W${r.worst.w}: ${f1(r.worst.left)}` : '–'}</td></tr>`).join('')}
  </table></div>`;
}

function renderLeague() {
  const s = state.snap;
  const rows = state.cache.standings ??= A.standings(s);
  const odds = state.cache.odds ??= A.playoffOdds(s, 5000);
  const myOdds = odds.teams.find((r) => r.team.id === s.me);
  const myRow = rows.find((r) => r.team.id === s.me);
  const cutPct = 50; // the dashed line on each bar marks a coin flip

  return `
  <h2>Your season</h2>
  <div class="outlook">
    <div><span class="n">${pct(myOdds.playoffs)}</span><span>to make the playoffs</span></div>
    <div><span class="n">${myRow.powerRank}<span class="dim" style="font-size:20px"> of ${rows.length}</span></span><span>in power rank</span></div>
    <div><span class="n ${myRow.luck >= 0 ? 'good' : 'bad'}">${sign(myRow.luck)}</span><span>wins of luck</span></div>
  </div>
  ${odds.ifWin != null ? `<p class="ifs">Win this week and your odds go to <b class="good">${pct(odds.ifWin)}</b>. Lose and they drop to <b class="bad">${pct(odds.ifLose)}</b>.</p>` : ''}

  ${benchSection(s)}

  <h2>Power rankings</h2>
  <p class="explain">All-play is your record if you played every team every week. Luck is actual wins minus what all-play says you earned. Strength is your best lineup in a normal week.</p>
  <div class="sheetbox" style="overflow-x:auto"><table class="tbl">
    <tr><th>#</th><th>Team</th><th>Record</th><th>Avg</th><th>All-play</th><th>Luck</th><th>Strength</th></tr>
    ${rows.map((r) => `<tr class="${r.team.id === s.me ? 'me' : ''}">
      <td class="rank">${r.powerRank}</td><td class="team">${esc(r.team.name)}</td><td>${record(r.team)}</td>
      <td>${f1(r.ppg)}</td><td>${r.allPlayRec}</td>
      <td class="${r.luck > 0.5 ? 'good' : r.luck < -0.5 ? 'bad' : ''}">${sign(r.luck)}</td><td>${Math.round(r.strength)}</td></tr>`).join('')}
  </table></div>

  <h2>Playoff odds</h2>
  <p class="explain">The rest of the schedule played out 5,000 times. The top ${s.league.playoffTeams} get in, and ties go to total points. The faint line on each bar is 50%.</p>
  <div class="sheetbox odds">
    ${odds.teams.map((r) => `<div class="odd ${r.team.id === s.me ? 'me' : ''}">
      <span class="t">${esc(r.team.name)} <span class="dim">${record(r.team)}</span></span>
      <span class="track"><i style="width:${Math.round(r.playoffs * 100)}%"></i><span class="cut" style="left:${cutPct}%"></span></span>
      <span class="p">${pct(r.playoffs)}</span></div>`).join('')}
  </div>`;
}

// ---------- refresh button ----------
const repo = R.repoFromLocation();
let toastTimer;
function toast(html, ms = 5000) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.innerHTML = html;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.remove(), ms);
}
function setButton(mode, text) {
  const b = $('#refresh');
  b.classList.toggle('busy', mode === 'busy');
  b.classList.toggle('done', mode === 'done');
  b.disabled = mode === 'busy';
  b.querySelector('span').textContent = text;
}

function openSetup() {
  const d = $('#setup');
  $('#tokenLink').href = R.tokenPage;
  $('#manualRun').href = repo ? R.actionsPage(repo) : '#';
  $('#repoName').textContent = repo ? repo.repo : 'this repo';
  $('#tokenInput').value = '';
  d.showModal();
}

// quiet = started automatically on game day: no toasts unless the token stops working.
async function refresh({ quiet = false } = {}) {
  if (!repo) { toast('Refresh works on the published site, not a local copy.'); return; }
  const tok = R.token.get();
  if (!tok) { if (!quiet) openSetup(); return; }
  const label = (step) => (quiet ? 'Updating' : step);
  setButton('busy', label('Starting'));
  try {
    await R.runRefresh(repo, tok, (step) => setButton('busy', label(step)));
    setButton('busy', 'Loading');
    const y = window.scrollY;
    await loadIndex(true);
    await loadLeague(state.leagueId, true);
    if (quiet) window.scrollTo(0, y);
    setButton('done', 'Updated');
    if (!quiet) toast('Fresh data from ESPN is loaded.');
    setTimeout(() => setButton('', 'Refresh'), 4000);
  } catch (e) {
    setButton('', 'Refresh');
    if (e.badToken) {
      R.token.clear();
      toast(`${quiet ? 'Live updates paused: ' : ''}${esc(e.message)}`, 9000);
    } else if (!quiet) {
      toast(`${esc(e.message)}${e.url ? ` <a href="${e.url}" target="_blank" rel="noopener">Open GitHub</a>` : ''}`, 9000);
    }
  }
}

// ---------- player panel ----------
function ownerName(p) {
  if (p.tm === state.snap.me) return 'Your team';
  if (p.tm) return state.snap.teams.find((t) => t.id === p.tm)?.name || '';
  return p.fa === 'W' ? 'On waivers' : 'Free agent';
}
function showPlayer(id) {
  const s = state.snap;
  const p = s.players.find((x) => x.id === id);
  if (!p) return;
  // What he means to your roster, plus the expert and crowd signals.
  let extras = '';
  if (p.tm === s.me) {
    const d = (state.cache.drops ??= A.dropCosts(s)).find((x) => x.p.id === p.id);
    if (d) {
      extras += `<section class="ps"><h3>On your roster</h3><p class="ps-sum">${d.verdict === 'swap'
        ? `A free agent is better: swap him for <b>${esc(d.replacement.n)}</b> for ${sign(-d.cost)} a week.`
        : `Dropping him would cost about <b>${f1(Math.max(0, d.cost))}</b> points a week${d.replacement ? `, compared with picking up ${esc(d.replacement.n)}` : ''}.`}</p></section>`;
    }
  }
  const sig = signals(p) + take(p);
  if (sig) extras += `<section class="ps"><h3>What others say</h3>${sig}</section>`;
  state.reportCache ||= {};
  openPlayer(p, { snap: s, leagueId: state.leagueId, dialog: $('#player'), flags, game, ownerName, extras, reportCache: state.reportCache });
}

// ---------- old data warning ----------
// The data refreshes every morning (and every 15 minutes during games). If it's
// more than a day old, the automatic refresh is probably failing, almost
// always because the ESPN cookies expired.
function staleBanner(minutesOld) {
  if (minutesOld < 26 * 60) return '';
  const days = Math.floor(minutesOld / 1440);
  const age = days >= 1 ? `${days} day${days > 1 ? 's' : ''}` : `${Math.round(minutesOld / 60)} hours`;
  const fixUrl = repo ? `https://github.com/${repo.owner}/${repo.repo}/settings/secrets/actions` : null;
  const runsUrl = repo ? R.actionsPage(repo) : null;
  return `<div class="stale" role="alert"><b>This data is ${age} old.</b> The automatic refresh has probably stopped working.
    <p>The usual cause is expired ESPN cookies. Copy new <i>espn_s2</i> and <i>SWID</i> values from Chrome${fixUrl ? ` into <a href="${fixUrl}" target="_blank" rel="noopener">your GitHub secrets</a>` : ' into your GitHub secrets'}, then tap Refresh.${runsUrl ? ` <a href="${runsUrl}" target="_blank" rel="noopener">See the failed runs</a>.` : ''}</p></div>`;
}

// ---------- automatic updates ----------
// GitHub's schedule often runs late or skips runs when GitHub is busy. So while
// Lineup Lab is open, it starts a refresh itself (using your Refresh token) when
// the data is getting old:
//   - during games (from 90 minutes before a kickoff, when inactives come out,
//     until the game ends): every 10 minutes
//   - any other time: when the data is more than 3 hours old
// It stops when you close or leave the app, and does nothing if no token is
// saved on this device.
const LIVE_EVERY = 10 * 60e3;
const QUIET_EVERY = 3 * 3600e3;
let lastLive = 0;

function gamesInProgress(before = 0) {
  const now = Date.now();
  return Object.values(state.snap?.proTeams || {}).some((t) => t.kick && now >= t.kick - before && now < t.kick + 4 * 3600e3 && !t.final);
}
async function liveRefresh() {
  if (!repo || document.hidden || !state.snap || $('#refresh').disabled) return;
  const tok = R.token.get();
  if (!tok) return;
  const now = Date.now();
  const every = gamesInProgress(90 * 60e3) ? LIVE_EVERY : QUIET_EVERY;
  if (now - new Date(state.snap.fetchedAt) < every || now - lastLive < LIVE_EVERY) return;
  lastLive = now;
  try { if (await R.refreshRunning(repo, tok)) return; } catch { return; }   // one is already on the way
  await refresh({ quiet: true });
}
// Between refreshes, pick up new data from any source (the schedule, another
// device) and reload quietly, keeping your tab and scroll position.
async function checkForNewData() {
  if (document.hidden || !state.snap || $('#refresh').disabled) return;
  try {
    const idx = await fetch(`data/leagues.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
    const mine = idx.find((l) => String(l.id) === String(state.leagueId));
    if (mine && mine.fetchedAt !== state.snap.fetchedAt) {
      state.leagues = idx;
      const y = window.scrollY;
      await loadLeague(state.leagueId, true);
      window.scrollTo(0, y);
    } else if (!$('#player').open) {
      render();   // at least update "updated X min ago" and live estimates
    }
  } catch { /* offline; try again next time */ }
}
function startGameDayUpdates() {
  setInterval(() => { if (gamesInProgress()) checkForNewData(); }, 3 * 60 * 1000);
  setInterval(liveRefresh, 60 * 1000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    await checkForNewData();
    liveRefresh();
  });
  liveRefresh();
}

// ---------- wiring ----------
const RENDER = { team: renderTeam, waivers: renderWaivers, trades: renderTrades, league: renderLeague };

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const s = state.snap;
  const ago = Math.max(0, Math.round((Date.now() - new Date(s.fetchedAt)) / 60000));
  const when = ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} hr ago` : `${Math.round(ago / 1440)} days ago`;
  const scoring = s.league.ppr === 1 ? 'PPR' : s.league.ppr ? `${s.league.ppr} PPR` : 'standard';
  $('#updated').textContent = `Week ${s.week} · ${scoring} · ${when === 'just now' ? 'updated just now' : when}`;
  $('#view').innerHTML = staleBanner(ago) + RENDER[state.tab]() + '<p class="foot">Projections, rankings and analyst notes from ESPN. Trending adds from Sleeper.</p>';
}

// ---------- league looks ----------
// Each theme is a set of colors in style.css (:root[data-theme="..."]) plus a
// logo for the header. leagues.json picks one per league; others get the default.
const THEMES = {
  thunder: { logo: 'img/thunder.png', bar: '#0e0718' },
  misfits: { logo: 'img/misfits-mark.svg', bar: '#0a1a12' },
};
function applyTheme(leagueId) {
  const name = state.leagues.find((l) => String(l.id) === String(leagueId))?.theme;
  const t = THEMES[name];
  if (t) document.documentElement.dataset.theme = name; else delete document.documentElement.dataset.theme;
  const img = $('.mark-img');
  img.hidden = !t; $('.mark').toggleAttribute('hidden', !!t);
  if (t) img.src = t.logo;
  document.querySelector('meta[name="theme-color"]').content = t ? t.bar : '#0c1712';
}

// "?t=" makes the browser and GitHub's cache fetch the newest file after a refresh.
const bust = (fresh) => (fresh ? `?t=${Date.now()}` : '');
async function loadIndex(fresh = false) {
  state.leagues = await fetch(`data/leagues.json${bust(fresh)}`, { cache: 'no-cache' }).then((r) => r.json());
}
// Weekly history (site/data/<league>-players.json) powers the player panel,
// bench points and playoff schedules. It loads in the background.
function loadLeagueHistory(id, fresh) {
  state.hist = null;
  loadHistory(id, fresh).then((h) => {
    if (String(state.leagueId) !== String(id)) return;
    state.hist = h;
    if (!$('#player').open) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  });
}

async function loadLeague(id, fresh = false) {
  if (!fresh) $('#view').innerHTML = '<div class="empty">Loading league</div>';
  state.snap = await fetch(`data/${id}.json${bust(fresh)}`, { cache: 'no-cache' }).then((r) => r.json());
  state.leagueId = id;
  applyTheme(id);
  state.cache = {};
  state.reportCache = {};
  loadLeagueHistory(id, fresh);
  state.builder = null;
  store.set('league', id);
  document.querySelectorAll('#leagues button').forEach((b) => b.classList.toggle('on', b.dataset.id === String(id)));
  render();
}

async function init() {
  try {
    await loadIndex();
  } catch {
    $('#view').innerHTML = '<div class="sheetbox empty">No league data yet. Tap Refresh to pull it from ESPN.</div>';
    return;
  }
  $('#leagues').innerHTML = state.leagues.map((l) => `<button data-id="${l.id}" role="tab">${esc(l.name)}</button>`).join('');
  $('#leagues').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) loadLeague(b.dataset.id); });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; store.set('tab', state.tab); render(); window.scrollTo(0, 0);
  });
  $('#view').addEventListener('change', (e) => {
    if (e.target.id === 'tradeTeam') { state.builder = { team: +e.target.value, give: new Set(), get: new Set() }; render(); }
  });
  $('#view').addEventListener('click', (e) => {
    const link = e.target.closest('.plink');
    if (link) { e.preventDefault(); showPlayer(+link.dataset.pid); return; }
    const ap = e.target.closest('[data-apos], [data-asort]');
    if (ap) {
      if (ap.dataset.apos) { state.avail.pos = ap.dataset.apos; store.set('availPos', ap.dataset.apos); }
      if (ap.dataset.asort) { state.avail.sort = ap.dataset.asort; store.set('availSort', ap.dataset.asort); }
      const y = window.scrollY; render(); window.scrollTo(0, y);
      return;
    }
    const c = e.target.closest('.chip'); if (!c) return;
    const set = state.builder[c.dataset.side]; const id = +c.dataset.id;
    set.has(id) ? set.delete(id) : set.add(id);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  $('#refresh').addEventListener('click', () => refresh());
  $('#setup').addEventListener('close', () => {
    const d = $('#setup');
    const v = $('#tokenInput').value.trim();
    if (d.returnValue === 'save' && v) { R.token.set(v); refresh(); }
  });
  state.tab = store.get('tab') || 'team';
  const saved = store.get('league');
  await loadLeague(state.leagues.some((l) => String(l.id) === saved) ? saved : state.leagues[0].id);
}
init().then(startGameDayUpdates);
