// Phone alerts, sent through ntfy (https://ntfy.sh, a free push notification app).
// Runs after each refresh (see .github/workflows/refresh.yml). It only sends
// when the NTFY_TOPIC secret is set, and it sends each alert once.
//
//   - A starter is ruled out, doubtful, or projects 0 before his game starts
//   - Your lineup is leaving 3+ points on the table close to kickoff
//   - A new trade offer arrives, with Lineup Lab's grade
//
// Test without sending: ALERTS_DRY_RUN=1 node scripts/alerts.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as A from '../site/analysis.js';

const { NTFY_TOPIC, ALERTS_DRY_RUN, SITE_URL } = process.env;
if (!NTFY_TOPIC && !ALERTS_DRY_RUN) process.exit(0);   // alerts are optional

// Which alerts were already sent. Kept in the repo (not the published site) so
// it survives from one refresh to the next.
const STATE = 'state/alerts-sent.json';
const sent = new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : []);
const index = JSON.parse(readFileSync('site/data/leagues.json', 'utf8'));
const now = Date.now();
const HOUR = 3600e3;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] || '');
const time = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });

const queue = [];
function alert(key, title, message, priority = 'default', tags = 'football') {
  if (sent.has(key)) return;
  sent.add(key);
  queue.push({ title, message, priority, tags });
}

// The first time alerts run, say hello so you know the setup works.
alert('welcome', 'Lineup Lab alerts are on', 'You\'ll get a heads-up here when a starter is ruled out, your lineup needs a fix before kickoff, or a trade offer arrives.', 'default', 'white_check_mark');

for (const { id, name } of index) {
  const snap = JSON.parse(readFileSync(`site/data/${id}.json`, 'utf8'));
  if (!snap.me) continue;
  const roster = A.rosterOf(snap, snap.me);
  const starters = roster.filter((p) => !['BE', 'IR'].includes(p.s));
  const tag = `${id}|w${snap.week}`;

  // 1) Starters who won't play (only before their game starts).
  for (const p of starters) {
    if (A.gameState(snap, p, now) !== 'pre') continue;
    const pro = snap.proTeams[p.t] || {};
    const bye = pro.bye === snap.week;
    const status = { O: 'is ruled OUT', IR: 'is on IR', SUS: 'is suspended', D: 'is listed DOUBTFUL' }[p.i];
    if (!bye && !status && !(p.pw <= 0 && p.t)) continue;
    const why = bye ? 'is on bye' : status || 'projects 0 points';   // reads as "Josh Allen is ruled OUT"
    const kick = pro.kick ? ` before his ${time(pro.kick)} kickoff` : '';
    alert(`${tag}|out|${p.id}|${bye ? 'bye' : p.i || 'zero'}`,
      `${name}: ${p.n} ${why}`,
      `Your starting ${p.p === 'DST' ? 'D/ST' : p.p} ${p.n} ${why}. Swap him out${kick}.`, 'high', 'warning');
  }

  // 2) Lineup leaving points on the table, within 3 hours of a kickoff it affects.
  const tw = A.thisWeek(snap, snap.me, now);
  if (tw.gain >= 3) {
    const affected = [...tw.toStart.map((x) => x.p), ...tw.toSit];
    const soonest = Math.min(...affected.map((p) => snap.proTeams[p.t]?.kick || Infinity));
    if (soonest - now < 3 * HOUR && soonest > now) {
      alert(`${tag}|lineup|${tw.toStart.map((x) => x.p.id).sort().join(',')}`,
        `${name}: fix your lineup (+${f1(tw.gain)} pts)`,
        `Start ${list(tw.toStart.map((x) => x.p.n))}. Sit ${list(tw.toSit.map((p) => p.n))}. Win chance goes from ${Math.round(tw.winNow * 100)}% to ${Math.round(tw.winBest * 100)}%.`,
        'high', 'rotating_light');
    }
  }

  // 3) New trade offers sent to you.
  for (const o of snap.offers || []) {
    if (o.sent) continue;
    const byId = (pid) => snap.players.find((p) => p.id === pid);
    const give = o.give.map(byId).filter(Boolean), get = o.get.map(byId).filter(Boolean);
    const team = snap.teams.find((t) => t.id === o.team);
    if (!team || !give.length || !get.length) continue;
    const e = A.evaluateTrade(snap, o.team, give, get);
    const verdict = e.myGain > 0.3 ? 'Lineup Lab says: helps you' : e.myGain > -0.3 ? 'Lineup Lab says: about even' : 'Lineup Lab says: hurts you';
    alert(`${id}|offer|${o.id}`,
      `${name}: trade offer from ${team.name}`,
      `You give ${list(give.map((p) => p.n))}, you get ${list(get.map((p) => p.n))}. ${verdict} (${e.myGain >= 0 ? '+' : ''}${f1(e.myGain)} pts a week).`,
      'default', 'handshake');
  }
}

for (const a of queue) {
  if (ALERTS_DRY_RUN) { console.log(`[dry run] ${a.title}\n          ${a.message}`); continue; }
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
    method: 'POST',
    body: a.message,
    headers: { Title: a.title, Priority: a.priority, Tags: a.tags, ...(SITE_URL ? { Click: SITE_URL } : {}) },
  });
  console.log(`${res.ok ? 'sent' : `failed (${res.status})`}: ${a.title}`);
}
if (!queue.length) console.log('No new alerts.');
// Remember what was sent (keep the list from growing forever).
if (!ALERTS_DRY_RUN) {
  mkdirSync('state', { recursive: true });
  writeFileSync(STATE, JSON.stringify([...sent].slice(-400)));
}
