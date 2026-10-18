// The score ticker under the header: every NFL game this week, live from ESPN's
// public scoreboard (the same feed espn.com uses). It talks to ESPN directly
// from your phone, so it doesn't wait on the GitHub refresh: scores update every
// 30 seconds while a game is on, every 5 minutes otherwise.
//
// Each game shows how many of your starters (gold) and your opponent's starters
// (their color) are playing in it. Live games come first, then upcoming, then final.

const FEED = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const LIVE_MS = 30e3;
const IDLE_MS = 5 * 60e3;

let games = [];
let timer = null;
let el = null;
let getContext = () => null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parse(feed) {
  return (feed.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    const side = (ha) => {
      const t = (c.competitors || []).find((x) => x.homeAway === ha) || {};
      return { id: Number(t.team?.id), ab: t.team?.abbreviation || '?', score: t.score ?? '', winner: !!t.winner };
    };
    const st = e.status?.type || {};
    const sit = c.situation || {};
    return {
      id: e.id,
      kick: Date.parse(e.date),
      state: st.state,                         // 'pre' | 'in' | 'post'
      detail: st.shortDetail || '',            // "14:45 - 2nd", "Final", "Sun 1:05 PM EDT"
      away: side('away'),
      home: side('home'),
      poss: sit.possession ? Number(sit.possession) : null,
      redZone: !!sit.isRedZone,
      down: sit.shortDownDistanceText || '',
    };
  });
}

// How many starters each fantasy team has in this game.
function counts(g, ctx) {
  if (!ctx) return { mine: 0, theirs: 0 };
  const inGame = (p) => p.t === g.away.id || p.t === g.home.id;
  return { mine: ctx.mine.filter(inGame).length, theirs: ctx.theirs.filter(inGame).length };
}

function when(g) {
  if (g.state === 'post') return g.detail.replace(/\/OT/, ' OT');
  if (g.state === 'in') return g.detail.replace(' - ', ' ');
  return new Date(g.kick).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function chip(g, ctx) {
  const { mine, theirs } = counts(g, ctx);
  const showScore = g.state !== 'pre';
  const team = (t) => `<span class="tk-team ${g.state === 'post' && t.winner ? 'won' : ''}">
      <span class="tk-ab">${esc(t.ab)}${g.state === 'in' && g.poss === t.id ? '<i class="tk-ball" aria-label="has the ball"></i>' : ''}</span>
      ${showScore ? `<b>${esc(t.score)}</b>` : ''}</span>`;
  const dots = (mine ? `<span class="tk-me" title="Your starters">${mine}</span>` : '')
    + (theirs ? `<span class="tk-opp" title="Opponent's starters">${theirs}</span>` : '');
  return `<li class="tk ${g.state} ${g.redZone ? 'rz' : ''} ${mine ? 'has-me' : ''}">
    <div class="tk-teams">${team(g.away)}${team(g.home)}</div>
    <div class="tk-foot"><span class="tk-when">${esc(when(g))}${g.state === 'in' && g.redZone ? ' · <em>RZ</em>' : ''}</span>${dots ? `<span class="tk-dots">${dots}</span>` : ''}</div>
  </li>`;
}

function draw() {
  if (!el) return;
  if (!games.length) { el.hidden = true; return; }
  const ctx = getContext();
  const order = { in: 0, pre: 1, post: 2 };
  const sorted = [...games].sort((a, b) =>
    order[a.state] - order[b.state]
    || (a.state === 'post' ? b.kick - a.kick : a.kick - b.kick)
    || counts(b, ctx).mine - counts(a, ctx).mine);
  const scroll = el.querySelector('ul')?.scrollLeft || 0;
  el.innerHTML = `<ul aria-label="NFL scores">${sorted.map((g) => chip(g, ctx)).join('')}</ul>`;
  el.querySelector('ul').scrollLeft = scroll;
  el.hidden = false;
}

async function tick() {
  clearTimeout(timer);
  if (!document.hidden) {
    try {
      games = parse(await fetch(FEED, { cache: 'no-store' }).then((r) => r.json()));
      draw();
    } catch { /* offline or ESPN hiccup: keep the last scores */ }
  }
  const live = games.some((g) => g.state === 'in' || (g.state === 'pre' && g.kick - Date.now() < 10 * 60e3));
  timer = setTimeout(tick, live ? LIVE_MS : IDLE_MS);
}

// el: the ticker element. context(): { mine: [players], theirs: [players] }, your
// starters and your opponent's, so each game can show who you have in it.
export function startTicker(element, context) {
  el = element;
  getContext = context;
  tick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

// Redraw without fetching (after switching leagues, so the counts change).
export const redrawTicker = draw;
