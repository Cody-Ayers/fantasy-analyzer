// The page: load a league snapshot, run the analysis, draw the active tab.
import * as A from './analysis.js';

const state = { leagues: [], snap: null, tab: 'team', cache: {} };
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sign = (x) => (x >= 0 ? '+' : '−') + f1(Math.abs(x));
const pct = (x) => `${Math.round(x * 100)}%`;

// Remember the last league and tab you looked at (per device, best effort).
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- small render helpers ----------
const teamName = (id) => state.snap.teams.find((t) => t.id === id)?.name ?? '—';
const record = (t) => `${t.w}-${t.l}${t.t ? `-${t.t}` : ''}`;

function gameInfo(p) {
  const pro = state.snap.proTeams[p.t];
  if (!pro || p.t === 0) return 'Free agent (NFL)';
  if (pro.bye === state.snap.week) return `${pro.ab} · BYE`;
  const opp = state.snap.proTeams[pro.opp];
  return `${pro.ab} ${pro.home ? 'vs' : '@'} ${opp?.ab ?? '?'}`;
}
function tags(p) {
  let h = '';
  if (p.i) h += `<span class="tag ${p.i}">${p.i}</span>`;
  if (state.snap.proTeams[p.t]?.bye === state.snap.week) h += '<span class="tag BYE">BYE</span>';
  if (p.sl && p.sl <= 25) h += `<span class="tag HOT" title="#${p.sl} most-added on Sleeper in the last 48 hours">HOT</span>`;
  return h;
}
// ESPN analysts' consensus rank at his position this week, e.g. "WR12".
const expert = (p) => (p.er ? `ESPN experts: ${p.p}${p.er}` : '');
// Outside-the-numbers signals for a player.
function signals(p) {
  const out = [];
  if (p.er) out.push(expert(p));
  if (p.sl) out.push(`#${p.sl} most-added on Sleeper (48 hrs)`);
  if (p.tr >= 1) out.push(`<span class="good">▲ ${p.tr}%</span> owned on ESPN this week`);
  if (p.tr <= -1) out.push(`<span class="bad">▼ ${Math.abs(p.tr)}%</span> owned on ESPN this week`);
  return out;
}
const outlook = (p) => (p.ol ? `<details class="ol"><summary>ESPN analyst take</summary><p>${esc(p.ol)}${p.ol.length >= 400 ? '…' : ''}</p></details>` : '');
function playerRow(slot, p, value, opts = {}) {
  if (!p) return `<li class="row"><span class="slot">${slot}</span><div class="pname muted">Empty</div><div class="proj">0.0</div></li>`;
  return `<li class="row ${opts.change ? 'change' : ''}">
    <span class="slot">${slot}</span>
    <div><div class="pname">${esc(p.n)} ${tags(p)} ${opts.change ? '<span class="tag NEW">START</span>' : ''}</div>
      <div class="psub">${p.p} · ${gameInfo(p)} · ${f1(p.avg)} avg${p.er ? ` · <span title="ESPN experts' rank this week">${p.p}${p.er}</span>` : ''}</div></div>
    <div class="proj">${f1(value)}<small>proj</small></div></li>`;
}

// ---------- My Team ----------
function renderTeam() {
  const s = state.snap;
  const tw = A.thisWeek(s);
  const me = s.teams.find((t) => t.id === s.me);
  const opp = s.teams.find((t) => t.id === tw.oppId);
  const startIds = new Set(tw.toStart.map((x) => x.p.id));
  const win = tw.winBest;

  const callout = tw.gain > 0.05
    ? `<div class="callout"><b>Set your best lineup: ${sign(tw.gain)} pts.</b> Win chance goes from ${pct(tw.winNow)} to ${pct(tw.winBest)}.
        <div class="psub" style="margin-top:4px">Start ${tw.toStart.map((x) => esc(x.p.n)).join(', ')}. Sit ${tw.toSit.map((p) => esc(p.n)).join(', ')}.</div></div>`
    : '<div class="callout flat">Your lineup in ESPN is already the best one you can set.</div>';

  return `
  <h2>Week ${s.week} matchup</h2>
  <div class="card matchup">
    <div class="sides">
      <div class="side me"><div class="name">${esc(me.name)}</div><div class="rec">${record(me)}</div><div class="pts">${f1(tw.best.total)}</div></div>
      <div class="vs">vs</div>
      <div class="side them"><div class="name">${esc(opp?.name)}</div><div class="rec">${opp ? record(opp) : ''}</div><div class="pts">${f1(tw.opp)}</div></div>
    </div>
    <div class="bar"><i style="width:${Math.round(win * 100)}%"></i></div>
    <div class="bar-label"><span>Win chance <b>${pct(win)}</b></span><span>${pct(1 - win)}</span></div>
    ${callout}
  </div>

  ${tw.alerts.length ? `<h2>Heads up</h2><ul class="alerts">${tw.alerts.map((a) => `<li class="${a.level}">${esc(a.text)}</li>`).join('')}</ul>` : ''}

  <h2>Best lineup</h2>
  <div class="card">
    <ul class="rows">${tw.best.starters.map((x) => playerRow(x.slot, x.p, x.v, { change: x.p && startIds.has(x.p.id) })).join('')}</ul>
    <div class="total"><span>Projected</span><span class="num">${f1(tw.best.total)}</span></div>
  </div>

  <h2>Bench</h2>
  <div class="card"><ul class="rows">
    ${tw.best.bench.sort((a, b) => b.v - a.v).map((x) => playerRow(x.p.s === 'IR' ? 'IR' : 'BE', x.p, x.v)).join('')}
    ${A.rosterOf(s, s.me).filter((p) => p.s === 'IR' && !tw.best.bench.some((x) => x.p.id === p.id) && !tw.best.starters.some((x) => x.p?.id === p.id)).map((p) => playerRow('IR', p, 0)).join('')}
  </ul></div>`;
}

// ---------- Waivers ----------
function renderWaivers() {
  const s = state.snap;
  const list = state.cache.waivers ??= A.waiverTargets(s);
  const weeksLeft = A.remainingWeeks(s).length;
  const cards = list.map((x) => {
    const sig = signals(x.p);
    return `
    <div class="card move">
      <div><div class="pname">${esc(x.p.n)} ${tags(x.p)}</div>
        <div class="psub">${x.p.p} · ${gameInfo(x.p)} · ${f1(x.p.avg)} avg · ${x.p.own}% owned</div></div>
      <div class="gain">${sign(x.perWeek)}<small>pts/week</small></div>
      <div class="detail">${esc(x.why)} · This week ${sign(x.weekGain)}
        <div class="dropline">${x.drop
          ? `Drop <b>${esc(x.drop.n)}</b>${x.alternatives.length ? ` <span class="muted">· next best: ${x.alternatives.map((a) => `${esc(a.drop.n)} (${sign(a.perWeek)})`).join(', ')}</span>` : ''}`
          : 'No drop needed: uses your open roster spot'}</div>
        ${sig.length ? `<div class="sig">${sig.join(' · ')}</div>` : ''}
        ${outlook(x.p)}
        <span class="pill">${x.p.fa === 'W' ? 'On waivers: needs a claim' : 'Free agent: add anytime'}</span></div>
    </div>`;
  }).join('');

  const VERDICT = { swap: ['Upgrade available', 'good'], safe: ['Safe to drop', 'good'], depth: ['Small loss', 'warn'], keep: ['Keep', 'muted'] };
  const drops = state.cache.drops ??= A.dropCosts(s);
  const dropRows = drops.map((d) => {
    const [label, cls] = VERDICT[d.verdict];
    const sub = d.verdict === 'swap'
      ? `Swap for <b>${esc(d.replacement.n)}</b>: ${sign(-d.cost)}/wk`
      : `Losing him costs ${f1(Math.max(0, d.cost))}/wk${d.replacement ? ` (vs. ${esc(d.replacement.n)})` : ''} · this week ${f1(Math.max(0, d.weekCost))}`;
    return `<li class="row drow">
      <span class="vchip ${cls}">${label}</span>
      <div><div class="pname">${esc(d.p.n)} ${tags(d.p)}</div>
        <div class="psub">${d.p.p} · ${sub}</div>
        ${d.signals.length ? `<div class="psub sig">${d.signals.map(esc).join(' · ')}</div>` : ''}</div>
      <div class="proj">${f1(A.rosPPG(d.p))}<small>pts/g</small></div></li>`;
  }).join('');

  const stream = (pos) => {
    const { mine, list: opts } = A.streamers(s, pos);
    const mineP = mine ? mine.pw : 0;
    return `<div class="card"><ul class="rows">
      ${mine ? playerRow('YOU', mine, mine.pw) : ''}
      ${opts.map((p) => `<li class="row"><span class="slot">${pos}</span>
        <div><div class="pname">${esc(p.n)} ${tags(p)}</div><div class="psub">${gameInfo(p)} · ${p.own}% owned</div></div>
        <div class="proj ${p.pw > mineP ? 'good' : ''}">${f1(p.pw)}<small>${p.pw > mineP ? sign(p.pw - mineP) : 'proj'}</small></div></li>`).join('')}
    </ul></div>`;
  };

  return `
  <h2>Best pickups</h2>
  <p class="explain">Each player is tested on your roster: we add him, drop whoever hurts least, and re-run your best lineup for all ${weeksLeft} remaining weeks (through the fantasy playoffs).</p>
  ${cards || '<div class="card empty">No free agent improves your team right now.</div>'}

  <h2>Who to drop</h2>
  <p class="explain">Your roster, safest drop first. Each player is compared with the best free agent at his position (<i>value over replacement</i>), so a kicker you can replace from waivers counts as cheap even if he starts.</p>
  <div class="card"><ul class="rows">${dropRows}</ul></div>

  <h2>Stream a defense this week</h2>${stream('DST')}
  <h2>Stream a kicker this week</h2>${stream('K')}`;
}

// ---------- Trades ----------
function tradeCard(x) {
  const pl = (p) => `<div class="pl">${esc(p.n)} <small>${p.p} · ${f1(A.rosPPG(p))}/g</small></div>`;
  return `<div class="card">
    <div class="split"><span><b style="font-family:Inter">${esc(x.team.name)}</b> · ${record(x.team)}</span></div>
    <div class="trade">
      <div><div class="lbl give">You give</div>${x.give.map(pl).join('')}</div>
      <div><div class="lbl get">You get</div>${x.get.map(pl).join('')}</div>
    </div>
    <div class="split">
      <span>You <b class="good">${sign(x.myGain)}</b>/wk</span>
      <span>Them <b class="${x.theirGain >= 0 ? 'good' : 'bad'}">${sign(x.theirGain)}</b>/wk</span>
      <span>This week <b>${sign(x.myWeek)}</b></span>
    </div>
    ${x.rosterChange > 0 ? '<span class="pill">You\'ll need to drop a bench player</span>' : ''}
  </div>`;
}

function renderTrades() {
  const s = state.snap;
  const ideas = state.cache.trades ??= A.findTrades(s);
  const others = s.teams.filter((t) => t.id !== s.me);
  const b = state.builder ??= { team: others[0].id, give: new Set(), get: new Set() };

  const chip = (p, set, side) => `<button class="chip ${set.has(p.id) ? 'on' : ''}" data-side="${side}" data-id="${p.id}">
      <span>${esc(p.n)} <span class="muted">${p.p}</span></span><span>${f1(A.rosPPG(p))}</span></button>`;
  const sortRos = (r) => r.filter((p) => !['K', 'DST'].includes(p.p)).sort((x, y) => A.rosPPG(y) - A.rosPPG(x));
  const mine = sortRos(A.rosterOf(s, s.me));
  const theirs = sortRos(A.rosterOf(s, b.team));

  let verdict = '<p class="explain" style="margin:10px 0 0">Tap players on both sides to see how the trade changes each lineup.</p>';
  if (b.give.size || b.get.size) {
    const give = mine.filter((p) => b.give.has(p.id));
    const get = theirs.filter((p) => b.get.has(p.id));
    const e = A.evaluateTrade(s, b.team, give, get);
    const call = e.myGain > 0.3 && e.theirGain > 0 ? ['good', 'Good for both sides. Worth sending.']
      : e.myGain > 0.3 ? ['warn', 'Helps you, but hurts them. Expect a no.']
        : e.myGain > -0.3 ? ['muted', 'About even for you.'] : ['bad', 'This makes your team worse.'];
    verdict = `<div class="verdict callout ${call[0] === 'good' ? '' : 'flat'}">
      <b class="${call[0]}">${call[1]}</b>
      <div class="split" style="margin-top:6px"><span>You <b>${sign(e.myGain)}</b>/wk</span><span>Them <b>${sign(e.theirGain)}</b>/wk</span><span>This week <b>${sign(e.myWeek)}</b></span></div>
      ${e.rosterChange > 0 ? `<div class="psub" style="margin-top:4px">You'd need to drop ${e.rosterChange} player${e.rosterChange > 1 ? 's' : ''}.</div>` : ''}</div>`;
  }

  return `
  <h2>Trades that help both teams</h2>
  <p class="explain">We tried every 1-for-1 and 2-for-1 deal with every team and kept the ones where <i>both</i> starting lineups score more over the rest of the season. Those are the trades people actually accept. Numbers are points per week.</p>
  ${ideas.map(tradeCard).join('') || '<div class="card empty">No win-win trades found.</div>'}

  <h2>Check a trade</h2>
  <div class="card" id="builder">
    <select id="tradeTeam">${others.map((t) => `<option value="${t.id}" ${t.id === b.team ? 'selected' : ''}>${esc(t.name)} (${record(t)})</option>`).join('')}</select>
    <div class="pick">
      <div><h3>You give</h3>${mine.map((p) => chip(p, b.give, 'give')).join('')}</div>
      <div><h3>You get</h3>${theirs.map((p) => chip(p, b.get, 'get')).join('')}</div>
    </div>
    ${verdict}
  </div>`;
}

// ---------- League ----------
function renderLeague() {
  const s = state.snap;
  const rows = state.cache.standings ??= A.standings(s);
  const odds = state.cache.odds ??= A.playoffOdds(s, 5000);
  const myOdds = odds.teams.find((r) => r.team.id === s.me);
  const myRow = rows.find((r) => r.team.id === s.me);

  return `
  <h2>Your outlook</h2>
  <div class="kpis">
    <div class="kpi"><div class="v">${pct(myOdds.playoffs)}</div><div class="l">Playoff odds</div></div>
    <div class="kpi"><div class="v">#${myRow.powerRank}</div><div class="l">Power rank</div></div>
    <div class="kpi"><div class="v ${myRow.luck >= 0 ? 'good' : 'bad'}">${sign(myRow.luck)}</div><div class="l">Luck (wins)</div></div>
  </div>
  ${odds.ifWin != null ? `<p class="explain" style="margin-top:10px">Win this week → <b class="good">${pct(odds.ifWin)}</b> playoff odds. Lose → <b class="bad">${pct(odds.ifLose)}</b>.</p>` : ''}

  <h2>Power rankings</h2>
  <p class="explain"><b>All-play</b> is your record if you played every team every week. <b>Luck</b> is actual wins minus what all-play says you earned. <b>Str</b> is your best lineup's projection in a normal week.</p>
  <div class="card"><div class="scroll"><table class="tbl">
    <tr><th>#</th><th>Team</th><th>W-L</th><th>PPG</th><th>All-play</th><th>Luck</th><th>Str</th></tr>
    ${rows.map((r) => `<tr class="${r.team.id === s.me ? 'me' : ''}">
      <td class="rank">${r.powerRank}</td><td class="team">${esc(r.team.name)}</td><td>${record(r.team)}</td>
      <td>${f1(r.ppg)}</td><td>${r.allPlayRec}</td>
      <td class="${r.luck > 0.5 ? 'good' : r.luck < -0.5 ? 'bad' : ''}">${sign(r.luck)}</td><td>${Math.round(r.strength)}</td></tr>`).join('')}
  </table></div></div>

  <h2>Playoff odds</h2>
  <p class="explain">The remaining schedule simulated 5,000 times. Top ${s.league.playoffTeams} make it; ties go to total points.</p>
  <div class="card odds">
    ${odds.teams.map((r) => `<div class="odd ${r.team.id === s.me ? 'me' : ''}">
      <span class="t">${esc(r.team.name)} <span class="muted">${record(r.team)}</span></span>
      <span class="track"><i style="width:${Math.round(r.playoffs * 100)}%"></i></span>
      <span class="pct">${pct(r.playoffs)}</span></div>`).join('')}
  </div>`;
}

// ---------- wiring ----------
const RENDER = { team: renderTeam, waivers: renderWaivers, trades: renderTrades, league: renderLeague };

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const s = state.snap;
  const ago = Math.round((Date.now() - new Date(s.fetchedAt)) / 60000);
  const when = ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} hr ago` : `${Math.round(ago / 1440)} days ago`;
  $('#updated').textContent = `Week ${s.week} · ${s.league.ppr === 1 ? 'PPR' : s.league.ppr ? `${s.league.ppr} PPR` : 'Standard'} · updated ${when}`;
  $('#view').innerHTML = RENDER[state.tab]() + '<p class="foot">Projections from ESPN. Analysis by Lineup Lab.</p>';
}

async function loadLeague(id) {
  $('#view').innerHTML = '<div class="empty">Loading league…</div>';
  state.snap = await fetch(`data/${id}.json`, { cache: 'no-cache' }).then((r) => r.json());
  state.cache = {};
  state.builder = null;
  store.set('league', id);
  document.querySelectorAll('#leagues button').forEach((b) => b.classList.toggle('on', b.dataset.id === String(id)));
  render();
}

async function init() {
  try {
    state.leagues = await fetch('data/leagues.json', { cache: 'no-cache' }).then((r) => r.json());
  } catch {
    $('#view').innerHTML = '<div class="card empty">No league data yet. Run the refresh workflow (see README).</div>';
    return;
  }
  $('#leagues').innerHTML = state.leagues.map((l) => `<button data-id="${l.id}">${esc(l.name)}</button>`).join('');
  $('#leagues').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) loadLeague(b.dataset.id); });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; store.set('tab', state.tab); render(); window.scrollTo(0, 0);
  });
  $('#view').addEventListener('change', (e) => {
    if (e.target.id === 'tradeTeam') { state.builder = { team: +e.target.value, give: new Set(), get: new Set() }; render(); }
  });
  $('#view').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const set = state.builder[c.dataset.side]; const id = +c.dataset.id;
    set.has(id) ? set.delete(id) : set.add(id);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  state.tab = store.get('tab') || 'team';
  const saved = store.get('league');
  await loadLeague(state.leagues.some((l) => String(l.id) === saved) ? saved : state.leagues[0].id);
}
init();
