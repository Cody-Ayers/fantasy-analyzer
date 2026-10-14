// The page: load a league snapshot, run the analysis, draw the active tab.
import * as A from './analysis.js';
import * as R from './refresh.js';

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
const pos = (p) => `<span class="pos ${p.p}">${p.p === 'DST' ? 'D/ST' : p.p}</span>`;
function meta(p, bits) {
  return `<div class="meta">${pos(p)}${bits.filter(Boolean).map((b) => `<span>${b}</span>`).join('')}</div>`;
}
const expertRank = (p) => (p.er ? `Experts rank him ${p.p === 'DST' ? 'D/ST' : p.p}${p.er}` : '');

function playerRow(slot, p, value, opts = {}) {
  if (!p) return `<li class="row"><span class="slot">${slot}</span><div class="pname dim">Nobody available</div><div class="pts">0.0</div></li>`;
  return `<li class="row ${opts.change ? 'change' : ''}">
    <span class="slot">${slot}</span>
    <div><div class="pname">${esc(p.n)} ${flags(p, opts.change ? '<span class="flag START">START</span>' : '')}</div>
      ${meta(p, [game(p), `${f1(p.avg)} avg`, p.er ? `${p.p === 'DST' ? 'D/ST' : p.p}${p.er} by experts` : ''])}</div>
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

  const fix = tw.gain > 0.05
    ? `<div class="fix"><strong>Set your best lineup for ${sign(tw.gain)} points.</strong> Your win chance goes from ${pct(tw.winNow)} to ${pct(tw.winBest)}.
        <p>Start ${esc(list(tw.toStart.map((x) => x.p.n)))}. Sit ${esc(list(tw.toSit.map((p) => p.n)))}.</p></div>`
    : '<div class="fix dim">The lineup you have set in ESPN is already your best one.</div>';

  return `
  <h2>Week ${s.week}</h2>
  <div class="matchup">
    <div class="scoreline">
      <div class="team-l"><div class="tname">${esc(me.name)}</div><div class="trec">${record(me)}</div><div class="score">${f1(tw.best.total)}</div></div>
      <div class="team-r"><div class="tname">${esc(opp?.name ?? 'No game')}</div><div class="trec">${opp ? record(opp) : ''}</div><div class="score">${f1(tw.opp)}</div></div>
    </div>
    ${field(win)}
    <div class="fieldnote"><span><b>${pct(win)}</b> to win</span><span>Ball ${yardLine(win)}</span></div>
    ${fix}
  </div>

  ${tw.alerts.length ? `<h2>Before kickoff</h2><ul class="alerts">${tw.alerts.map((a) => `<li class="lvl-${a.level}">${esc(a.text)}</li>`).join('')}</ul>` : ''}

  <h2>Best lineup</h2>
  <div class="sheetbox">
    <ul class="rows">${tw.best.starters.map((x) => playerRow(x.slot, x.p, x.v, { change: x.p && startIds.has(x.p.id) })).join('')}</ul>
    <div class="total"><span>Projected total</span><span class="n">${f1(tw.best.total)}</span></div>
  </div>

  <h2>Bench</h2>
  <div class="sheetbox"><ul class="rows">
    ${tw.best.bench.sort((a, b) => b.v - a.v).map((x) => playerRow(x.p.s === 'IR' ? 'IR' : 'BN', x.p, x.v)).join('')}
    ${A.rosterOf(s, s.me).filter((p) => p.s === 'IR' && !tw.best.bench.some((x) => x.p.id === p.id) && !tw.best.starters.some((x) => x.p?.id === p.id)).map((p) => playerRow('IR', p, 0)).join('')}
  </ul></div>`;
}

// ---------- Waivers ----------
function signals(p) {
  const out = [];
  if (p.er) out.push(`Experts: <b>${p.p === 'DST' ? 'D/ST' : p.p}${p.er}</b> this week`);
  if (p.sl) out.push(`Sleeper: <b>#${p.sl}</b> most added`);
  if (p.tr >= 1) out.push(`ESPN ownership <b class="good">up ${p.tr}%</b>`);
  if (p.tr <= -1) out.push(`ESPN ownership <b class="bad">down ${Math.abs(p.tr)}%</b>`);
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

function renderWaivers() {
  const s = state.snap;
  const picks = state.cache.waivers ??= A.waiverTargets(s);
  const weeksLeft = A.remainingWeeks(s).length;
  const cards = picks.map((x) => `
    <div class="move">
      <div class="move-head">
        <div><div class="pname">${esc(x.p.n)} ${flags(x.p)}</div>
          ${meta(x.p, [game(x.p), `${f1(x.p.avg)} avg`, `${Math.round(x.p.own)}% owned`])}</div>
        <div class="gain">${sign(x.perWeek)}<small>per week</small></div>
      </div>
      <p class="why">${esc(x.why)}. <span class="dim">This week ${sign(x.weekGain)}.</span></p>
      <div class="drop">${x.drop
        ? `Drop <b>${esc(x.drop.n)}</b>${altLine(x)}`
        : 'No drop needed. He goes in your open roster spot.'}</div>
      ${signals(x.p)}
      ${take(x.p)}
      <span class="status">${x.p.fa === 'W' ? 'On waivers, so you need to put in a claim.' : 'Free agent, so you can add him now.'}</span>
    </div>`).join('');

  const VERDICT = { swap: 'Upgrade', safe: 'Safe drop', depth: 'Small loss', keep: 'Keep' };
  const drops = state.cache.drops ??= A.dropCosts(s);
  const dropRows = drops.map((d) => {
    const sub = d.verdict === 'swap'
      ? `Swap for ${esc(d.replacement.n)}, ${sign(-d.cost)} a week`
      : `Costs ${f1(Math.max(0, d.cost))} a week${d.replacement ? ` vs ${esc(d.replacement.n)}` : ''}`;
    return `<li class="row drow">
      <span class="verdict ${d.verdict}">${VERDICT[d.verdict]}</span>
      <div><div class="pname">${esc(d.p.n)} ${flags(d.p)}</div>
        ${meta(d.p, [sub, ...d.signals.map(esc)])}</div>
      <div class="pts">${f1(A.rosPPG(d.p))}<small>per game</small></div></li>`;
  }).join('');

  const stream = (position) => {
    const { mine, list: opts } = A.streamers(s, position);
    const base = mine ? mine.pw : 0;
    return `<div class="sheetbox"><ul class="rows">
      ${mine ? playerRow('You', mine, mine.pw) : ''}
      ${opts.map((p) => playerRow('', p, p.pw, { up: p.pw > base, label: p.pw > base ? sign(p.pw - base) : 'proj' })).join('')}
    </ul></div>`;
  };

  return `
  <h2>Best pickups</h2>
  <p class="explain">Each free agent is tried on your roster. We add him, drop whoever hurts least, and re-run your best lineup for all ${weeksLeft} remaining weeks, playoffs included.</p>
  ${cards || '<div class="sheetbox empty">No free agent makes your team better right now.</div>'}

  <h2>Who to drop</h2>
  <p class="explain">Safest drop first. Each player is measured against the best free agent at his position, so a kicker you can replace off waivers counts as cheap even if he starts.</p>
  <div class="sheetbox"><ul class="rows">${dropRows}</ul></div>

  <h2>Stream a defense</h2>${stream('DST')}
  <h2>Stream a kicker</h2>${stream('K')}`;
}

// ---------- Trades ----------
function tradeCard(x) {
  const pl = (p) => `<div class="pl">${esc(p.n)}${meta(p, [`${f1(A.rosPPG(p))} per game`])}</div>`;
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
    ${x.rosterChange > 0 ? '<span class="status">You\'d need to drop a bench player to fit them.</span>' : ''}
  </div>`;
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
  </div>`;
}

// ---------- League ----------
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

async function refresh() {
  if (!repo) { toast('Refresh works on the published site, not a local copy.'); return; }
  const tok = R.token.get();
  if (!tok) { openSetup(); return; }
  setButton('busy', 'Starting');
  try {
    await R.runRefresh(repo, tok, (step) => setButton('busy', step));
    setButton('busy', 'Loading');
    await loadIndex(true);
    await loadLeague(state.leagueId, true);
    setButton('done', 'Updated');
    toast('Fresh data from ESPN is loaded.');
    setTimeout(() => setButton('', 'Refresh'), 4000);
  } catch (e) {
    setButton('', 'Refresh');
    if (e.badToken) R.token.clear();
    toast(`${esc(e.message)}${e.url ? ` <a href="${e.url}" target="_blank" rel="noopener">Open GitHub</a>` : ''}`, 9000);
  }
}

// ---------- wiring ----------
const RENDER = { team: renderTeam, waivers: renderWaivers, trades: renderTrades, league: renderLeague };

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const s = state.snap;
  const ago = Math.max(0, Math.round((Date.now() - new Date(s.fetchedAt)) / 60000));
  const when = ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} hr ago` : `${Math.round(ago / 1440)} days ago`;
  const scoring = s.league.ppr === 1 ? 'PPR' : s.league.ppr ? `${s.league.ppr} PPR` : 'standard';
  $('#updated').textContent = `Week ${s.week}, ${scoring}, updated ${when}`;
  $('#view').innerHTML = RENDER[state.tab]() + '<p class="foot">Projections, rankings and analyst notes from ESPN. Trending adds from Sleeper.</p>';
}

// "?t=" makes the browser and GitHub's cache fetch the newest file after a refresh.
const bust = (fresh) => (fresh ? `?t=${Date.now()}` : '');
async function loadIndex(fresh = false) {
  state.leagues = await fetch(`data/leagues.json${bust(fresh)}`, { cache: 'no-cache' }).then((r) => r.json());
}
async function loadLeague(id, fresh = false) {
  if (!fresh) $('#view').innerHTML = '<div class="empty">Loading league</div>';
  state.snap = await fetch(`data/${id}.json${bust(fresh)}`, { cache: 'no-cache' }).then((r) => r.json());
  state.leagueId = id;
  state.cache = {};
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
    const c = e.target.closest('.chip'); if (!c) return;
    const set = state.builder[c.dataset.side]; const id = +c.dataset.id;
    set.has(id) ? set.delete(id) : set.add(id);
    const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  $('#refresh').addEventListener('click', refresh);
  $('#setup').addEventListener('close', () => {
    const d = $('#setup');
    const v = $('#tokenInput').value.trim();
    if (d.returnValue === 'save' && v) { R.token.set(v); refresh(); }
  });
  state.tab = store.get('tab') || 'team';
  const saved = store.get('league');
  await loadLeague(state.leagues.some((l) => String(l.id) === saved) ? saved : state.leagues[0].id);
}
init();
