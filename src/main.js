import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { gsap } from 'gsap';
import './style.css';
import { DAYS, EVENTS, SYMPOSIUM, eventByRegistrationName, isTeamEvent, whenAndWhere } from './schedule.js';

const app = document.querySelector('#app');
const isMobile = matchMedia('(pointer: coarse)').matches;

const kindIcon = { event: '◆', break: '●', ceremony: '★' };
const kindLabel = { event: 'Competition', ceremony: 'Ceremony', break: 'Break' };

// Built from the schedule so the key only ever lists the kinds actually shown.
// Removing every ceremony and break must not leave "★ Ceremony" in the legend.
const legendEntries = ['event', 'ceremony', 'break']
  .filter(kind => DAYS.some(day => day.items.some(item => item.kind === kind)))
  .map(kind => `<span>${kindIcon[kind]} ${kindLabel[kind]}</span>`)
  .join('');

/** Renders one day column: heading with the date, then its timeline rows. */
function dayColumn(day) {
  const rows = day.items.map(item => `
    <li class="slot slot-${item.kind}">
      <time datetime="${day.id}">${item.time}</time>
      <div class="slot-body">
        <h4>${kindIcon[item.kind]} ${item.name}</h4>
        <p class="slot-venue">${item.venue}</p>
        ${item.team ? `<p class="slot-meta">${item.team}${item.rules ? ` · ${item.rules}` : ''}</p>` : ''}
      </div>
    </li>`).join('');
  return `
    <article class="day-card" id="${day.id}">
      <header class="day-head">
        <span class="day-label">${day.label}</span>
        <strong class="day-date">${day.date}</strong>
        <span class="day-weekday">${day.weekday} · ${day.dateLong}</span>
      </header>
      <ol class="day-slots">${rows}</ol>
    </article>`;
}

/** Registration cards, generated from the schedule so times never drift. */
function eventCards(category) {
  return EVENTS.filter(event => event.category === category).map((event, index) => `
    <article data-event="${event.registrationName}">
      <span>0${index + 1}</span>
      <h3>${event.name}</h3>
      <p class="card-when"><b>${event.day}</b> · ${event.date}<br>${event.time}<br>${event.venue}</p>
      <p class="card-rules">${event.team}${event.rules ? ` · ${event.rules}` : ''}</p>
      <a class="register" href="#register">Register now ↗</a>
    </article>`).join('');
}

app.innerHTML = `
  <canvas id="scene" aria-label="Aura 2026 interactive event journey"></canvas>
  <div id="ultrasonic-field" class="ultrasonic-field" aria-hidden="true"><i class="pulse pulse-one"></i><i class="pulse pulse-two"></i><i class="pulse pulse-three"></i></div>
  <div class="grain"></div>
  <main class="ui">
    <header><a class="brand" href="/">AURA <i>2026</i></a><span>SANKARA POLYTECHNIC<br>COLLEGE</span></header>
    <div id="day-badge" class="day-badge" aria-live="polite"></div>
    <div id="event-name" class="event-name" aria-live="polite"></div>
    <div id="event-detail" class="event-detail"></div>
    <a id="creative-register" class="creative-register" href="#registration-hub" aria-label="Open registration hub"><span>REGISTER NOW <b>↗</b></span><i class="wave wave-one"></i><i class="wave wave-two"></i><i class="wave wave-three"></i></a>
    <section id="intro" class="intro"><p class="eyebrow">A cinematic event gallery</p><h1>AURA<br><em>2026</em></h1><p>Sankara Polytechnic College</p><div class="swipe">Swipe to explore <b>↓</b></div></section>
    <aside class="progress"><span id="progress"></span></aside>
    <footer><span id="chapter">READY FOR TAKEOFF</span><span>${SYMPOSIUM.dateRange}</span></footer>
  </main>
  <section id="schedule" class="panel schedule">
    <a href="#" class="back">← Back to journey</a>
    <p class="eyebrow">${SYMPOSIUM.dateRange} · ${SYMPOSIUM.college}</p>
    <h2>Event<br>Schedule</h2>
    <div class="day-grid">${DAYS.map(dayColumn).join('')}</div>
    <p class="legend">${legendEntries}</p>
    <a class="schedule-cta" href="#registration-hub">Go to registration ↗</a>
  </section>
  <section id="registration-hub" class="choice" aria-hidden="true"><p class="eyebrow">Select your frequency</p><h2>Registration<br>Hub</h2><div class="route-grid">
    <a href="#technical" class="route cyan"><small>01 / CYBER CIRCUITRY</small><strong>TECHNICAL</strong><span>Bug Hunt · Debate</span></a>
    <a href="#creative" class="route pink"><small>02 / CREATIVE CURRENT</small><strong>NON-TECHNICAL</strong><span>Three team events</span></a>
    <a href="#schedule" class="route amber"><small>03 / FULL PROGRAMME</small><strong>SCHEDULE</strong><span>Day 1 · 30.07 — Day 2 · 31.07</span></a>
  </div></section>
  <section id="technical" class="panel technical"><a href="#" class="back">← Back to journey</a><p class="eyebrow">Route 01 / Cyber circuitry</p><h2>Technical<br>Registration</h2><div class="cards">${eventCards('technical')}</div></section>
  <section id="creative" class="panel creative"><a href="#" class="back">← Back to journey</a><p class="eyebrow">Route 02 / Abstract art</p><h2>Non-Technical<br>Registration</h2><div class="cards">${eventCards('non-technical')}</div></section>`;

app.insertAdjacentHTML('beforeend', `
  <section id="register" class="form-panel"><button class="back close-form">← Back</button><p class="eyebrow">Aura 2026 / Registration</p><h2 id="form-event">Select an event</h2><p id="form-when" class="form-when"></p><form id="registration-form"><input id="event" name="event" type="hidden"><div id="team-fields" hidden><label>Team name<input name="teamName" maxlength="80" autocomplete="off"></label><p class="field-group-title">Participant 1 <small>(team leader)</small></p></div><label id="name-label">Full name<input name="name" required minlength="2" autocomplete="name"></label><div id="partner-fields" hidden><p class="field-group-title">Participant 2</p><label>Full name<input name="partnerName" minlength="2" autocomplete="off"></label><label>Department<input name="partnerDepartment" minlength="2" autocomplete="off"></label><label>Year<select name="partnerYear"><option value="">Select year</option><option>1</option><option>2</option><option>3</option></select></label></div><div id="choice-field" hidden><label id="choice-label">Choose<select name="choice"></select></label></div><p class="field-group-title" id="contact-title" hidden>Contact details <small>(participant 1)</small></p><label>Department<input name="department" required minlength="2"></label><label>Year<select name="year" required><option value="">Select year</option><option>1</option><option>2</option><option>3</option></select></label><label>Phone number<input name="phone" type="tel" required pattern="[+0-9 -]{10,18}" autocomplete="tel"></label><label>Email ID<input name="email" type="email" required autocomplete="email"></label><button class="submit-register" type="submit">TRANSMIT REGISTRATION ↗</button><p id="form-status" role="status"></p></form></section>
  <button id="admin-trigger" aria-label="Admin access"></button><section id="admin-gate" class="admin-gate"><div class="admin-window"><button class="close-admin" aria-label="Close">×</button><p class="eyebrow">Restricted terminal</p><h2 id="admin-title">Enter PIN</h2><form id="pin-form"><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="••••" required><button>VERIFY</button></form><form id="login-form" hidden><input name="username" placeholder="Admin account" autocomplete="username" required><input name="password" type="password" placeholder="Password" autocomplete="current-password" required><button>AUTHENTICATE</button></form><p id="admin-status" role="status"></p></div></section>
  <section id="admin-dashboard" class="admin-dashboard">
    <div class="dash-head">
      <div><p class="eyebrow">Authenticated administrator</p><h2>Registrations</h2></div>
      <div class="dash-actions">
        <button id="export-xlsx">DOWNLOAD EXCEL ↗</button>
        <button id="export-csv" class="ghost">CSV</button>
        <button id="delete-all" class="ghost danger">DELETE ALL</button>
        <button id="admin-logout" class="ghost">LOG OUT</button>
        <button class="close-dashboard" aria-label="Close">×</button>
      </div>
    </div>
    <div id="dash-stats" class="dash-stats"></div>
    <div class="dash-tools">
      <input id="dash-search" type="search" placeholder="Search name, email, phone, team, event…" autocomplete="off">
      <label class="dash-live"><input id="dash-autorefresh" type="checkbox" checked> Live</label>
      <span id="dash-count" class="dash-count"></span>
    </div>
    <div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Event</th><th>Option</th><th>Team</th><th>Participant 1</th><th>Dept</th><th>Yr</th>
      <th>Participant 2</th><th>Dept</th><th>Yr</th><th>Phone</th><th>Email</th><th>Registered</th><th>Action</th>
    </tr></thead><tbody id="registration-rows"></tbody></table></div>
    <div class="dash-pager">
      <button id="page-prev" class="ghost">← Prev</button>
      <span id="page-info"></span>
      <button id="page-next" class="ghost">Next →</button>
    </div>
  </section>`);

// Cards are generated from schedule.js, so no post-render clean-up is needed.

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setClearColor(0x060817); renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x060817, isMobile ? 0.018 : 0.014);
const camera = new THREE.PerspectiveCamera(62, 1, .1, 150);
const group = new THREE.Group(); scene.add(group);
scene.add(new THREE.AmbientLight(0x5968ff, 1));
const glow = new THREE.PointLight(0x00e5ff, 18, 38); scene.add(glow);
const pink = new THREE.PointLight(0xff2e9f, 14, 30); scene.add(pink);

// Cinematic flight path: the camera follows this Catmull-Rom spline as virtual scroll progresses.
const path = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 13), new THREE.Vector3(-2, 1, 5), new THREE.Vector3(2, -1, -4),
  new THREE.Vector3(-3, 1, -14), new THREE.Vector3(2, 0, -25), new THREE.Vector3(-2, -1, -36),
  new THREE.Vector3(0, 0, -49),
]);

const starsGeo = new THREE.BufferGeometry(), stars = new Float32Array((isMobile ? 300 : 1400) * 3);
for (let i = 0; i < stars.length; i += 3) { stars[i] = (Math.random()-.5)*60; stars[i+1] = (Math.random()-.5)*35; stars[i+2] = -Math.random()*70+15; }
starsGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xbcdcff, size: .055, transparent: true, opacity: .8 })));

function ring(t, color) { const m = new THREE.Mesh(new THREE.TorusGeometry(2.2, .025, 6, 48), new THREE.MeshBasicMaterial({color, transparent:true, opacity:.38})); m.position.copy(path.getPointAt(t)); m.rotation.set(Math.random(), Math.random(), 0); group.add(m); return m; }
const rings = [ring(.17, 0x00e5ff), ring(.34, 0xff2e9f), ring(.56, 0x00e5ff), ring(.75, 0xffd66b)];

// The journey opens as a title sequence: the college, then the department,
// then the festival name, before the schedule begins.
const milestones = [
  [.045, 'SANKARA', 'POLYTECHNIC COLLEGE', 0x9fe8ff, 1.15],
  [.085, 'DEPARTMENT OF CSE', 'PRESENTS', 0xffd66b, .62],
  [.125, 'AURA 2026', SYMPOSIUM.dateRange, 0x00e5ff, 1.35],
  [.215, 'DAY 1', `${DAYS[0].date}\n${DAYS[0].weekday.toUpperCase()}`, 0x00e5ff, 1.5], [.33, 'FLUSH THE BRAIN', '11:30 AM — 12:30 PM', 0xff2e9f, .85],
  [.45, 'TREASURE HUNT', '11:30 AM — 12:30 PM', 0xff2e9f, .85],
  [.57, 'BUG HUNT', '2:30 PM — 3:15 PM', 0x00e5ff, .85],
  [.70, 'DAY 2', `${DAYS[1].date}\n${DAYS[1].weekday.toUpperCase()}`, 0x00e5ff, 1.5], [.78, 'MURDER MYSTERY', '11:30 AM — 12:45 PM', 0xff2e9f, .85],
  [.85, 'DEBATE', '2:30 PM — 3:30 PM', 0x00e5ff, .9], [.94, 'REGISTRATION HUB', 'CHOOSE YOUR PATH', 0xffd66b, .9]
];
// Path positions of the two day markers, reused by the HUD badge.
const DAY_MARKS = [ { t: .215, label: DAYS[0].label, date: DAYS[0].date }, { t: .70, label: DAYS[1].label, date: DAYS[1].date } ];
const textItems = [];
function text3d(label, detail, color, scale) {
  const g = new THREE.Group(); const title = new Text(); title.text = label; title.fontSize = scale; title.color = 0xffffff; title.anchorX = 'center'; title.anchorY = 'middle'; title.font = 'https://fonts.gstatic.com/s/syncopate/v22/pe0pMIuPIYBCpEV5eFdC4B2Z.ttf'; title.outlineWidth = .012; title.outlineColor = color; g.add(title);
  const sub = new Text(); sub.text = label === 'FLUSH THE BRAIN' ? `${detail}\nMONITOR: BHAVAV, AARABHI` : detail; sub.fontSize = scale * .25; sub.color = 0xdce7ff; sub.anchorX = 'center'; sub.position.y = -scale*.7; sub.letterSpacing = .1; g.add(sub); title.sync(); sub.sync(); return g;
}
// Titles and day markers sit dead ahead on the flight path; smaller notes are
// offset to either side so the corridor does not feel like a single column.
const TITLE_CARDS = ['SANKARA', 'DEPARTMENT OF CSE', 'AURA 2026'];
// Cards shown through the big glowing heads-up display rather than as 3D text.
const HUD_CARDS = {
  'SANKARA':           { title: 'SANKARA',           detail: 'POLYTECHNIC COLLEGE',            tone: 'ice'   },
  'DEPARTMENT OF CSE': { title: 'DEPARTMENT OF CSE', detail: 'PRESENTS',                       tone: 'amber' },
  'AURA 2026':         { title: 'AURA 2026',         detail: SYMPOSIUM.dateRange.toUpperCase(), tone: 'cyan'  },
};
milestones.forEach(([t, a, b, c, s], i) => {
  const eventNames = ['FLUSH THE BRAIN', 'TREASURE HUNT', 'BUG HUNT', 'MURDER MYSTERY', 'DEBATE'];
  const isEvent = eventNames.includes(a);
  const isDayMarker = a === 'DAY 1' || a === 'DAY 2';
  const isTitle = TITLE_CARDS.includes(a);
  if (isTitle) return;   // rendered by the HUD overlay instead
  const item = text3d(a, b, c, isEvent ? 1.2 : s);
  item.position.copy(path.getPointAt(t));
  item.position.add(isEvent || isDayMarker || isTitle
    ? new THREE.Vector3(0, 0, 0)
    : new THREE.Vector3(i % 2 ? 2.6 : -2.6, i % 3 - 1, 0));
  item.userData = { t, label: a };
  group.add(item);
  textItems.push(item);
});

let target = 0, progress = 0, touchY = 0, touching = false, velocity = 0;
const clamp = THREE.MathUtils.clamp;
function advance(delta) { target = clamp(target + delta, 0, 1); if (target > .012) document.querySelector('#intro').classList.add('is-hidden'); }
window.addEventListener('wheel', e => { e.preventDefault(); advance(e.deltaY * .00016); velocity = e.deltaY * .000006; }, {passive:false});
canvas.addEventListener('touchstart', e => { touching=true; touchY=e.touches[0].clientY; velocity=0; }, {passive:true});
canvas.addEventListener('touchmove', e => { e.preventDefault(); const y=e.touches[0].clientY; const dy=touchY-y; touchY=y; velocity=dy*.00032; advance(velocity); }, {passive:false});
canvas.addEventListener('touchend', () => touching=false, {passive:true});

// The footer chapter is taken from whichever milestone the camera has last
// passed, so the caption always matches what is on screen.
const CHAPTERS = milestones
  .map(([t, label]) => ({ t, label }))
  .sort((a, b) => a.t - b.t);
function chapterAt(progress) {
  if (progress < .02) return 'READY FOR TAKEOFF';
  let current = CHAPTERS[0].label;
  for (const chapter of CHAPTERS) {
    if (progress >= chapter.t - .03) current = chapter.label;
  }
  return current;
}
const mainEvents = ['FLUSH THE BRAIN', 'TREASURE HUNT', 'BUG HUNT', 'MURDER MYSTERY', 'DEBATE'];
// Built from schedule.js so the HUD always matches the printed programme.
const eventInfo = Object.fromEntries(EVENTS.map(event => [
  event.name.toUpperCase().replace('DEBATE: ANDROID VS IOS', 'DEBATE'),
  `${event.day.toUpperCase()} · ${event.dateLong.toUpperCase()} · ${event.venue.toUpperCase()}\n${event.time} · ${event.team}${event.rules ? `\n${event.rules.toUpperCase()}` : ''}`,
]));
function resize() { const w=innerWidth,h=innerHeight; camera.aspect=w/h; camera.fov=w<500?72:62; camera.updateProjectionMatrix(); renderer.setSize(w,h,false); renderer.setPixelRatio(Math.min(devicePixelRatio, w<768?1:2)); }
addEventListener('resize', resize, {passive:true}); resize();
let last=performance.now(), lastMobileRender=0;
// The nearest-milestone lookup always returns something, so the HUD is gated on
// the intro having cleared and the camera being close to the card. Without this
// SANKARA is painted over the landing screen at progress 0.
function render(now) { requestAnimationFrame(render); if (isMobile && now - lastMobileRender < 22) return; lastMobileRender = now; const dt=Math.min(.05,(now-last)/1000); last=now; if(!touching) { advance(velocity); velocity*=.86; } progress += (target-progress)*(isMobile?.055:.045); const point = path.getPointAt(progress); const lookPoint = path.getPointAt(Math.min(.999, progress + .025)); camera.position.copy(point); camera.position.y += Math.sin(now*.0007)*.08; camera.lookAt(lookPoint); glow.position.copy(point).add(new THREE.Vector3(2,3,2)); pink.position.copy(point).add(new THREE.Vector3(-3,-2,-2)); rings.forEach((r,i)=>r.rotation.z+=dt*(.13+i*.04)); textItems.forEach(item=>{const distance=Math.abs(progress-item.userData.t); const introClear=progress>.02||item.userData.t>.06; item.visible=distance<.11 && introClear && !mainEvents.includes(item.userData.label); if(item.visible){item.lookAt(camera.position); item.children.forEach(c=>c.material.opacity=clamp(1-distance/.11,0,1)*clamp((progress-.008)/.02,0,1));}}); document.querySelector('#progress').style.height=`${progress*100}%`; document.querySelector('#chapter').textContent=chapterAt(progress); const nearest = milestones.reduce((best, item) => Math.abs(item[0] - progress) < Math.abs(best[0] - progress) ? item : best, milestones[0]); const nearestDistance = Math.abs(nearest[0] - progress); const hudCard = (progress > .022 && nearestDistance < .055) ? HUD_CARDS[nearest[1]] : undefined; const isHudTitle = Boolean(hudCard); const eventName = isHudTitle ? hudCard.title : ((mainEvents.includes(nearest[1]) && nearestDistance < .075) ? nearest[1] : ''); const eventDetail = isHudTitle ? hudCard.detail : (eventInfo[eventName] || ''); const nameEl = document.querySelector('#event-name'); nameEl.textContent = eventName; nameEl.classList.toggle('visible', Boolean(eventName)); nameEl.dataset.tone = hudCard ? hudCard.tone : 'cyan'; nameEl.classList.toggle('is-title', isHudTitle); const detailEl = document.querySelector('#event-detail'); detailEl.dataset.tone = hudCard ? hudCard.tone : 'cyan'; detailEl.classList.toggle('is-title', isHudTitle); document.querySelector('#event-detail').textContent = eventDetail; document.querySelector('#event-detail').classList.toggle('visible', Boolean(eventDetail)); const activeDay = progress >= DAY_MARKS[1].t ? DAY_MARKS[1] : progress >= DAY_MARKS[0].t ? DAY_MARKS[0] : null; const badge = document.querySelector('#day-badge'); badge.textContent = activeDay ? `${activeDay.label.toUpperCase()} · ${activeDay.date}` : ''; badge.classList.toggle('visible', Boolean(activeDay) && progress < .93); document.querySelector('#creative-register').classList.toggle('visible', progress > .90); renderer.render(scene,camera); }
document.querySelector('#creative-register').addEventListener('click', event => {
  event.preventDefault();
  const button = event.currentTarget;
  if (button.classList.contains('launching')) return;
  button.classList.add('launching');
  document.querySelector('#ultrasonic-field').classList.add('launching');
  setTimeout(() => { window.location.hash = 'registration-hub'; button.classList.remove('launching'); document.querySelector('#ultrasonic-field').classList.remove('launching'); }, 900);
});
const registerPanel = document.querySelector('#register');
// Year 3 is not eligible for the non-technical events (mirrors the server rule).
const nonTechnicalEvents = EVENTS.filter(e => e.category === 'non-technical').map(e => e.registrationName);
function refreshYearThree(eventName) {
  const blocked = nonTechnicalEvents.includes(eventName);
  // Applies to both participants' year dropdowns.
  document.querySelectorAll('#registration-form select[name="year"], #registration-form select[name="partnerYear"]').forEach(select => {
    const thirdYear = [...select.options].find(option => option.value === '3');
    if (!thirdYear) return;
    thirdYear.disabled = blocked;
    thirdYear.textContent = blocked ? '3 (not eligible)' : '3';
    if (blocked && select.value === '3') select.value = '';
  });
}
/** Shows team / partner / choice fields according to the selected event. */
function configureForm(details) {
  const teamEvent = isTeamEvent(details);
  const teamFields = document.querySelector('#team-fields');
  const partnerFields = document.querySelector('#partner-fields');
  const contactTitle = document.querySelector('#contact-title');
  const choiceField = document.querySelector('#choice-field');

  teamFields.hidden = partnerFields.hidden = contactTitle.hidden = !teamEvent;
  document.querySelector('#name-label').firstChild.textContent = teamEvent ? 'Full name' : 'Full name';
  // Partner details are required only when the event is a team event.
  partnerFields.querySelectorAll('input, select').forEach(field => { field.required = teamEvent; if (!teamEvent) field.value = ''; });
  const teamNameInput = teamFields.querySelector('input[name="teamName"]');
  teamNameInput.required = teamEvent;
  if (!teamEvent) teamNameInput.value = '';

  // Per-event dropdown, e.g. Android vs iOS for the debate.
  const choice = details?.choice;
  choiceField.hidden = !choice;
  const select = choiceField.querySelector('select');
  select.required = Boolean(choice);
  if (choice) {
    document.querySelector('#choice-label').firstChild.textContent = choice.label;
    select.innerHTML = `<option value="">Select an option</option>${choice.options.map(option => `<option>${option}</option>`).join('')}`;
  } else {
    select.innerHTML = '';
  }
}

document.querySelectorAll('.register').forEach(button => button.addEventListener('click', clickEvent => {
  clickEvent.preventDefault();
  // data-event holds the exact name the API expects, so no string guessing.
  const eventName = button.closest('article')?.dataset.event || '';
  const details = eventByRegistrationName[eventName];
  document.querySelector('#event').value = eventName;
  document.querySelector('#form-event').textContent = details ? details.name : eventName;
  document.querySelector('#form-when').textContent = details ? whenAndWhere(details) : '';
  document.querySelector('#form-status').textContent = '';
  document.querySelector('#registration-form').reset();
  configureForm(details);
  refreshYearThree(eventName);
  registerPanel.classList.add('open');
}));
document.querySelector('.close-form').addEventListener('click', () => registerPanel.classList.remove('open'));
document.querySelector('#registration-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#form-status');
  const submit = form.querySelector('.submit-register');
  if (submit.disabled) return;                    // guard against double submit
  submit.disabled = true;
  status.className = '';
  status.textContent = 'Transmitting…';

  const data = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Registration failed. Please try again.');
    status.className = 'ok';
    status.textContent = `Registration confirmed. ${result.dashboard.total} participant${result.dashboard.total === 1 ? '' : 's'} registered.`;
    form.reset();
    configureForm(eventByRegistrationName[document.querySelector('#event').value]);
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message === 'Failed to fetch'
      ? 'Cannot reach the server. Check your connection and try again.'
      : error.message;
  } finally {
    submit.disabled = false;
  }
});

const adminTrigger = document.querySelector('#admin-trigger'); let moves = 0, dragStart = null;
adminTrigger.addEventListener('pointerdown', event => { dragStart = { x:event.clientX, y:event.clientY }; adminTrigger.setPointerCapture(event.pointerId); });
adminTrigger.addEventListener('pointermove', event => { if (!dragStart) return; const x = Math.max(8, Math.min(innerWidth - 34, event.clientX)); const y = Math.max(8, Math.min(innerHeight - 34, event.clientY)); adminTrigger.style.left = `${x}px`; adminTrigger.style.top = `${y}px`; adminTrigger.style.right = 'auto'; adminTrigger.style.bottom = 'auto'; });
adminTrigger.addEventListener('pointerup', event => { if (!dragStart) return; const distance = Math.hypot(event.clientX-dragStart.x, event.clientY-dragStart.y); dragStart = null; if (distance > 24 && ++moves === 5) document.querySelector('#admin-gate').classList.add('open'); });
document.querySelector('.close-admin').addEventListener('click', () => document.querySelector('#admin-gate').classList.remove('open'));
document.querySelector('#pin-form').addEventListener('submit', async event => { event.preventDefault(); const response = await fetch('/api/admin/pin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); const result = await response.json(); document.querySelector('#admin-status').textContent = response.ok ? 'PIN accepted.' : result.error; if(response.ok){document.querySelector('#pin-form').hidden=true;document.querySelector('#login-form').hidden=false;document.querySelector('#admin-title').textContent='Administrator login';} });
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dashboard = { page: 1, pageSize: 50, query: '', pages: 1, total: 0, timer: null };

function renderStats(summary) {
  const cards = [`<b>${summary.total}</b><span>Total</span>`, `<b>${summary.teams}</b><span>Teams</span>`]
    .concat(Object.entries(summary.byEvent).map(([event, count]) => `<b>${count}</b><span>${esc(event)}</span>`));
  document.querySelector('#dash-stats').innerHTML = cards.map(card => `<div class="stat">${card}</div>`).join('');
}

async function loadDashboard() {
  const params = new URLSearchParams({ page: dashboard.page, pageSize: dashboard.pageSize, q: dashboard.query });
  let result;
  try {
    const response = await fetch(`/api/admin/registrations?${params}`);
    if (response.status === 401) { closeDashboard(); document.querySelector('#admin-gate').classList.add('open'); return; }
    if (!response.ok) return;
    result = await response.json();
  } catch { return; }   // offline: keep showing the last good data

  dashboard.pages = result.pages; dashboard.total = result.total;
  const offset = (result.page - 1) * result.pageSize;
  document.querySelector('#registration-rows').innerHTML = result.rows.map((row, index) => `<tr data-id="${esc(row.id)}">
    <td>${offset + index + 1}</td><td>${esc(row.event)}</td><td>${esc(row.choice)}</td><td>${esc(row.teamName)}</td>
    <td>${esc(row.name)}</td><td>${esc(row.department)}</td><td>${esc(row.year)}</td>
    <td>${esc(row.partnerName)}</td><td>${esc(row.partnerDepartment)}</td><td>${esc(row.partnerYear)}</td>
    <td>${esc(row.phone)}</td><td>${esc(row.email)}</td>
    <td>${new Date(row.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
    <td><button class="row-delete ghost" data-id="${esc(row.id)}" type="button" aria-label="Remove this registration">REMOVE</button></td></tr>`).join('')
    || '<tr><td colspan="14" class="empty">No registrations found.</td></tr>';

  renderStats(result.dashboard);
  document.querySelector('#dash-count').textContent = `${result.total} record${result.total === 1 ? '' : 's'}`;
  document.querySelector('#page-info').textContent = `Page ${result.page} of ${result.pages}`;
  document.querySelector('#page-prev').disabled = result.page <= 1;
  document.querySelector('#page-next').disabled = result.page >= result.pages;
}

function setAutoRefresh(on) {
  clearInterval(dashboard.timer);
  dashboard.timer = on ? setInterval(loadDashboard, 5000) : null;
}
function closeDashboard() {
  clearInterval(dashboard.timer); dashboard.timer = null;
  document.querySelector('#admin-dashboard').classList.remove('open');
}
async function openDashboard() {
  dashboard.page = 1; dashboard.query = '';
  document.querySelector('#dash-search').value = '';
  await loadDashboard();
  document.querySelector('#admin-gate').classList.remove('open');
  document.querySelector('#admin-dashboard').classList.add('open');
  setAutoRefresh(document.querySelector('#dash-autorefresh').checked);
}

let searchTimer;
document.querySelector('#dash-search').addEventListener('input', event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { dashboard.query = event.target.value.trim(); dashboard.page = 1; loadDashboard(); }, 250);
});
document.querySelector('#dash-autorefresh').addEventListener('change', event => setAutoRefresh(event.target.checked));
document.querySelector('#page-prev').addEventListener('click', () => { if (dashboard.page > 1) { dashboard.page -= 1; loadDashboard(); } });
document.querySelector('#page-next').addEventListener('click', () => { if (dashboard.page < dashboard.pages) { dashboard.page += 1; loadDashboard(); } });
document.querySelector('#export-xlsx').addEventListener('click', () => window.location.assign('/api/admin/export?format=xlsx'));
document.querySelector('#export-csv').addEventListener('click', () => window.location.assign('/api/admin/export?format=csv'));

// Removes a single registration row. Confirmed first: this cannot be undone.
document.querySelector('#registration-rows').addEventListener('click', async event => {
  const button = event.target.closest('.row-delete');
  if (!button || button.disabled) return;
  const row = button.closest('tr');
  const name = row?.children?.[4]?.textContent?.trim() || 'this registration';
  if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
  button.disabled = true;
  button.textContent = '…';
  try {
    const response = await fetch(`/api/admin/registrations/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { closeDashboard(); document.querySelector('#admin-gate').classList.add('open'); return; }
    if (!response.ok) throw new Error(result.error || 'Could not remove that registration.');
    await loadDashboard();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'REMOVE';
  }
});

// Wipes every registration. Double-confirmed: there is no undo for this.
document.querySelector('#delete-all').addEventListener('click', async () => {
  if (!confirm(`Delete ALL ${dashboard.total} registration(s)? This cannot be undone.`)) return;
  if (!confirm('Really delete the entire table? Type OK to confirm one last time.')) return;
  const button = document.querySelector('#delete-all');
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/registrations', { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { closeDashboard(); document.querySelector('#admin-gate').classList.add('open'); return; }
    if (!response.ok) throw new Error(result.error || 'Could not clear the registrations table.');
    dashboard.page = 1;
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#admin-logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
  closeDashboard();
});

// Step 2 of the admin gate: username + password, then open the dashboard.
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const status = document.querySelector('#admin-status');
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = 'Authenticating…';
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Login failed.');
    status.textContent = '';
    form.reset();
    await openDashboard();
  } catch (error) {
    status.textContent = error.message === 'Failed to fetch'
      ? 'Cannot reach the server. Is the API running?'
      : error.message;
  } finally {
    button.disabled = false;
  }
});

// Close the admin gate with Escape.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelector('#admin-gate').classList.remove('open');
  if (document.querySelector('#admin-dashboard').classList.contains('open')) closeDashboard();
});

gsap.from('.brand, header span', {opacity:0, y:-16, duration:1.1, stagger:.12, ease:'power3.out'}); requestAnimationFrame(render);
