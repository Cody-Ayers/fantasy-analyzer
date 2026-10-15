// The player panel: tap any player's name to see how he's actually been used
// and how steady his scoring is. Data comes from site/data/<league>-players.json,
// which is only downloaded the first time you open a player in that league.
import * as A from './analysis.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toFixed(1));
const posName = (p) => (p.p === 'DST' ? 'D/ST' : p.p);

const histCache = {};   // league id → Promise of history file
export function loadHistory(leagueId, fresh = false) {
  if (fresh || !histCache[leagueId]) {
    histCache[leagueId] = fetch(`data/${leagueId}-players.json${fresh ? `?t=${Date.now()}` : ''}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return histCache[leagueId];
}

// ---------- small SVG bar charts ----------
// One series per chart, so no legend: the section title names it. Every bar is
// a hit target; tapping or hovering it shows that week's numbers in the readout.
function bars({ data, max, cls, tick, label, readout, value }) {
  const W = 320, H = 132, padB = 18, padT = 20;
  const n = data.length || 1;
  const slot = W / n, bw = Math.min(34, slot * 0.6);
  const y = (v) => H - padB - ((H - padB - padT) * Math.max(0, v)) / (max || 1);
  const items = data.map((d, i) => {
    const cx = slot * i + slot / 2;
    const v = d.v ?? 0;
    const top = y(v), h = H - padB - top;
    const r = Math.min(4, bw / 2, h);
    // 4px rounded data end, square at the baseline
    const path = h > 0
      ? `M${cx - bw / 2},${H - padB} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${H - padB} Z`
      : '';
    const t = tick && d.t != null ? `<line class="tick" x1="${cx - bw / 2 - 3}" x2="${cx + bw / 2 + 3}" y1="${y(d.t)}" y2="${y(d.t)}"/>` : '';
    const missing = d.v == null ? `<text class="na" x="${cx}" y="${H - padB - 6}">–</text>` : '';
    // Print each bar's value on top when there are few enough bars to stay readable.
    const labelY = Math.min(top, tick && d.t != null ? y(d.t) : top) - 5;   // sit above the bar and the projection line
    const val = value && d.v != null && n <= 10 ? `<text class="val" x="${cx}" y="${labelY}">${esc(value(d.v))}</text>` : '';
    return `<g class="bar" tabindex="0" data-read="${esc(readout(d))}">
      <rect class="hit" x="${slot * i}" y="0" width="${slot}" height="${H}"/>
      ${path ? `<path class="${cls}" d="${path}"/>` : ''}${t}${missing}${val}
      <text class="wk" x="${cx}" y="${H - 4}">${esc(label(d))}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${items}</svg>`;
}

// ---------- panel sections ----------
const avgSnap = (r) => {
  const s = r.weeks.filter((x) => x.snap != null);
  return s.reduce((a, x) => a + x.snap, 0) / (s.length || 1);
};

function snapSection(r) {
  const has = r.weeks.some((x) => x.snap != null);
  if (!has) return '';
  const t = r.snapTrend;
  const summary = !t ? 'Not enough games yet to call a trend.'
    : t.dir === 'up' ? `Rising: <b class="good">${Math.round(t.recent)}%</b> over his last 2 games, up from ${Math.round(t.before)}%.`
      : t.dir === 'down' ? `Falling: <b class="bad">${Math.round(t.recent)}%</b> over his last 2 games, down from ${Math.round(t.before)}%.`
        : `Steady at about <b>${Math.round(avgSnap(r))}%</b>.`;
  return `<section class="ps">
    <h3>Snap share</h3>
    <p class="ps-sum">${summary} <span class="dim">Share of his team's offensive plays he was on the field for.</span></p>
    ${bars({
      data: r.weeks.map((x) => ({ w: x.w, v: x.snap })), max: 100, cls: 'b-snap', value: (v) => `${v}%`,
      label: (d) => `W${d.w}`, readout: (d) => `Week ${d.w}: ${d.v == null ? 'no snap data' : `${d.v}% of snaps`}`,
    })}
    <p class="readout" aria-live="polite">Tap a bar for that week.</p>
  </section>`;
}

function consistencySection(r, p, snap) {
  if (!r.games) return '<section class="ps"><h3>Consistency</h3><p class="ps-sum dim">No games played yet this season.</p></section>';
  const pos = posName(p);
  const few = r.games < 4 ? ` <span class="dim">Only ${r.games} game${r.games > 1 ? 's' : ''}, so treat this as a rough read.</span>` : '';
  return `<section class="ps">
    <h3>Consistency</h3>
    <div class="range">
      <div><span class="n">${f1(r.floor)}</span><span>Floor</span></div>
      <div class="mid"><span class="n">${f1(r.median)}</span><span>Typical week</span></div>
      <div><span class="n">${f1(r.ceiling)}</span><span>Ceiling</span></div>
    </div>
    <p class="ps-note">Floor and ceiling are his 25th and 75th percentile weeks; his full range is ${f1(r.low)} to ${f1(r.high)}.${few}</p>
    <ul class="rates">
      <li><b>${r.booms} of ${r.games}</b> boom weeks <span class="dim">(top ${r.boomLine} ${pos})</span></li>
      <li><b>${r.startable} of ${r.games}</b> startable <span class="dim">(top ${r.startLine} ${pos}, what your league starts)</span></li>
      <li><b>${r.busts} of ${r.games}</b> busts <span class="dim">(outside top ${r.startLine})</span></li>
      ${r.withProj ? `<li><b>${r.beatProj} of ${r.withProj}</b> beat ESPN's projection</li>` : ''}
    </ul>
  </section>`;
}

function weeklySection(r, snap, p) {
  if (!r.weeks.length && !r.missed.length) return '';
  const max = Math.max(5, ...r.weeks.map((x) => Math.max(x.pts, x.proj || 0)));
  const statLine = (x) => {
    const s = x.stats || {};
    if (p.p === 'QB') return [s.py && `${s.py} pass yds`, s.ptd && `${s.ptd} TD`, s.int && `${s.int} INT`, s.ru && `${s.ru} rush yds`].filter(Boolean).join(', ');
    if (['RB', 'WR', 'TE'].includes(p.p)) {
      const td = (s.rtd || 0) + (s.ytd || 0);
      return [s.ca && `${s.ca} car, ${s.ru || 0} yds`, s.tg && `${s.rc || 0}/${s.tg} rec, ${s.ry || 0} yds`, td && `${td} TD`].filter(Boolean).join(' · ');
    }
    return '';
  };
  const opp = (w) => { const o = snap.proTeams[p.t]?.opps?.[w]; return o != null ? snap.proTeams[o]?.ab : 'bye'; };
  const rows = [...r.weeks.map((x) => ({ ...x, played: true })), ...r.missed.map((w) => ({ w, played: false }))]
    .sort((a, b) => a.w - b.w);
  return `<section class="ps">
    <h3>Week by week</h3>
    <p class="ps-sum dim">Bars are points scored; the white line is what ESPN projected.</p>
    ${bars({
      data: rows.map((x) => ({ w: x.w, v: x.played ? x.pts : null, t: x.proj })), max, cls: 'b-pts', tick: true, value: (v) => f1(v),
      label: (d) => `W${d.w}`,
      readout: (d) => (d.v == null ? `Week ${d.w}: didn't play` : `Week ${d.w}: ${f1(d.v)} pts${d.t != null ? `, projected ${f1(d.t)}` : ''}`),
    })}
    <p class="readout" aria-live="polite">Tap a bar for that week.</p>
    <table class="wk-tbl">
      <tr><th>Wk</th><th>Opp</th><th>Pts</th><th>Proj</th>${r.weeks.some((x) => x.snap != null) ? '<th>Snaps</th>' : ''}<th class="rk">Rank</th></tr>
      ${rows.map((x) => x.played ? `<tr>
        <td>${x.w}</td><td>${esc(opp(x.w))}</td>
        <td class="${x.proj != null && x.pts > x.proj ? 'good' : ''}">${f1(x.pts)}</td><td class="dim">${f1(x.proj)}</td>
        ${r.weeks.some((y) => y.snap != null) ? `<td>${x.snap != null ? `${x.snap}%` : '–'}</td>` : ''}
        <td class="rk">${x.rank ? `${posName(p)}${x.rank}` : '–'}</td></tr>
        ${statLine(x) ? `<tr class="stat"><td></td><td colspan="5">${esc(statLine(x))}</td></tr>` : ''}`
        : `<tr class="dnp"><td>${x.w}</td><td>${esc(opp(x.w))}</td><td colspan="4">Didn't play</td></tr>`).join('')}
    </table>
  </section>`;
}

function usageSection(r) {
  if (!r.usage.length || r.usage.every((u) => !u.n)) return '';
  const label = r.usage[0].label;
  const max = Math.max(...r.usage.map((u) => u.n), 1);
  return `<section class="ps">
    <h3>Usage</h3>
    <p class="ps-sum dim">His ${label} each week. A growing role shows up here before the points do.</p>
    ${bars({ data: r.usage.map((u) => ({ w: u.w, v: u.n })), max, cls: 'b-use', value: (v) => String(v), label: (d) => `W${d.w}`, readout: (d) => `Week ${d.w}: ${d.v} ${label}` })}
    <p class="readout" aria-live="polite">Tap a bar for that week.</p>
  </section>`;
}

function playoffRows(snap, hist, p, cache) {
  const dvp = (cache.dvp ??= A.defenseVsPosition(snap, hist));
  return A.playoffWeeks(snap).map((w) => A.matchupEase(snap, dvp, p, w));
}

function upcomingSection(r, snap, p, playoffs = []) {
  const label = { easy: 'Easy', average: 'Average', tough: 'Tough' };
  return `<section class="ps">
    <h3>Next ${r.upcoming.length} weeks</h3>
    <p class="ps-sum dim">How many points each defense has allowed to ${posName(p)}s per game, ranked across the league.</p>
    <ul class="sched">
      ${r.upcoming.map((u) => u.bye
        ? `<li><span class="wkn">W${u.w}</span><span>Bye</span><span></span></li>`
        : `<li><span class="wkn">W${u.w}</span><span>${esc(snap.proTeams[u.opp]?.ab)}</span>
            <span class="ease ${u.ease || ''}">${u.dvp ? `${label[u.ease]} <span class="dim">${f1(u.dvp.perGame)} pts a game to ${posName(p)}s</span>` : ''}</span></li>`).join('')}
    </ul>
    ${playoffs.length ? `<h3 style="margin-top:14px">Fantasy playoffs</h3>
    <ul class="sched">${playoffs.map((u) => u.bye
      ? `<li><span class="wkn">W${u.w}</span><span>Bye</span><span class="ease tough">Bye in the playoffs</span></li>`
      : `<li><span class="wkn">W${u.w}</span><span>${esc(snap.proTeams[u.opp]?.ab)}</span>
          <span class="ease ${u.ease || ''}">${u.dvp ? `${label[u.ease]} <span class="dim">${f1(u.dvp.perGame)} pts a game to ${posName(p)}s</span>` : ''}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

// ---------- the panel ----------
export async function openPlayer(p, ctx) {
  const { snap, leagueId, dialog, flags, game, ownerName, extras } = ctx;
  dialog.innerHTML = `<div class="pp">
    <div class="pp-head">
      <div><h2>${esc(p.n)} ${flags(p)}</h2>
        <div class="meta"><span class="pos ${p.p}">${posName(p)}</span><span>${esc(game(p))}</span><span>${esc(ownerName(p))}</span></div></div>
      <button class="close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="pp-keys">
      <div><span class="n">${f1(p.pw)}</span><span>This week</span></div>
      <div><span class="n">${f1(p.avg)}</span><span>Season avg</span></div>
      <div><span class="n">${f1(A.rosPPG(p))}</span><span>Rest of season</span></div>
    </div>
    ${p.id > 0 ? `<div class="espn-row" style="margin-top:10px"><span></span><a class="espn-btn" href="https://www.espn.com/nfl/player/_/id/${p.id}" target="_blank" rel="noopener">News and stats on ESPN</a></div>` : ''}
    <div class="pp-body"><p class="dim" style="padding:12px 0">Loading his weekly history</p></div>
  </div>`;
  dialog.querySelector('.close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();

  const hist = await loadHistory(leagueId);
  const body = dialog.querySelector('.pp-body');
  if (!body) return;
  if (!hist) {
    body.innerHTML = '<p class="dim" style="padding:12px 0">Weekly history isn\'t available yet. It\'s added the next time the data refreshes.</p>' + (extras || '');
    return;
  }
  const r = A.playerReport(snap, hist, p, ctx.reportCache);
  body.innerHTML = snapSection(r) + consistencySection(r, p, snap) + weeklySection(r, snap, p) +
    usageSection(r) + upcomingSection(r, snap, p, playoffRows(snap, hist, p, ctx.reportCache || {})) + (extras || '');

  // Tap or hover a bar to read that week's numbers.
  body.querySelectorAll('.chart').forEach((svg) => {
    const out = svg.nextElementSibling;
    const show = (g) => {
      svg.querySelectorAll('.bar.on').forEach((x) => x.classList.remove('on'));
      g.classList.add('on'); out.textContent = g.dataset.read;
    };
    svg.querySelectorAll('.bar').forEach((g) => {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('click', () => show(g));
      g.addEventListener('focus', () => show(g));
    });
  });
}
