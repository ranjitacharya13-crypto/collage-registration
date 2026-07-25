import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { gsap } from 'gsap';
import './style.css';

const app = document.querySelector('#app');
const isMobile = matchMedia('(pointer: coarse)').matches;

app.innerHTML = `
  <canvas id="scene" aria-label="Aura 2026 interactive event journey"></canvas>
  <div id="ultrasonic-field" class="ultrasonic-field" aria-hidden="true"><i class="pulse pulse-one"></i><i class="pulse pulse-two"></i><i class="pulse pulse-three"></i></div>
  <div class="grain"></div>
  <main class="ui">
    <header><a class="brand" href="/">AURA <i>2026</i></a><span>SANKARA POLYTECHNIC<br>COLLEGE</span></header>
    <div id="event-name" class="event-name" aria-live="polite"></div>
    <div id="event-detail" class="event-detail"></div>
    <a id="creative-register" class="creative-register" href="#registration-hub" aria-label="Open registration hub"><span>REGISTER NOW <b>↗</b></span><i class="wave wave-one"></i><i class="wave wave-two"></i><i class="wave wave-three"></i></a>
    <section id="intro" class="intro"><p class="eyebrow">A cinematic event gallery</p><h1>AURA<br><em>2026</em></h1><p>Sankara Polytechnic College</p><div class="swipe">Swipe to explore <b>↓</b></div></section>
    <aside class="progress"><span id="progress"></span></aside>
    <footer><span id="chapter">READY FOR TAKEOFF</span><span>11—12 AUG / 2026</span></footer>
  </main>
  <section id="registration-hub" class="choice" aria-hidden="true"><p class="eyebrow">Select your frequency</p><h2>Registration<br>Hub</h2><div class="route-grid">
    <a href="#technical" class="route cyan"><small>01 / CYBER CIRCUITRY</small><strong>TECHNICAL</strong><span>Bug Hunter · Debate</span></a>
    <a href="#creative" class="route pink"><small>02 / CREATIVE CURRENT</small><strong>NON-TECHNICAL</strong><span>Three team events</span></a>
  </div></section>
  <section id="technical" class="panel technical"><a href="#" class="back">← Back to journey</a><p class="eyebrow">Route 01 / Cyber circuitry</p><h2>Technical<br>Registration</h2><div class="cards"><article><span>01</span><h3>Bug Hunt</h3><p>Written C / Python + programming round · Main Lab</p><a class="register" href="#register">Register now ↗</a></article><article><span>02</span><h3>Debate:<br>Android vs iOS</h3><p>Team of 2 · 3rd Classroom</p><a class="register" href="#register">Register now ↗</a></article></div></section>
  <section id="creative" class="panel creative"><a href="#" class="back">← Back to journey</a><p class="eyebrow">Route 02 / Abstract art</p><h2>Non-Technical<br>Registration</h2><div class="cards">${['Fuzzy Brain','Treasure Hunt','Murder Mystery'].map((name, i) => `<article><span>0${i + 1}</span><h3>${name}</h3><p>Team event · view rules in the event journey</p><a class="register" href="#register">Register now ↗</a></article>`).join('')}</div></section>`;

app.insertAdjacentHTML('beforeend', `
  <section id="register" class="form-panel"><button class="back close-form">← Back</button><p class="eyebrow">Aura 2026 / Registration</p><h2 id="form-event">Select an event</h2><form id="registration-form"><input id="event" name="event" type="hidden"><label>Full name<input name="name" required minlength="2" autocomplete="name"></label><label>Team name <small>(team events only)</small><input name="teamName" maxlength="80"></label><label>Department<input name="department" required minlength="2"></label><label>Year<select name="year" required><option value="">Select year</option><option>1</option><option>2</option><option>3</option></select></label><label>Phone number<input name="phone" type="tel" required pattern="[+0-9 -]{10,18}" autocomplete="tel"></label><label>Email ID<input name="email" type="email" required autocomplete="email"></label><button class="submit-register" type="submit">TRANSMIT REGISTRATION ↗</button><p id="form-status" role="status"></p></form></section>
  <button id="admin-trigger" aria-label="Admin access"></button><section id="admin-gate" class="admin-gate"><div class="admin-window"><button class="close-admin" aria-label="Close">×</button><p class="eyebrow">Restricted terminal</p><h2 id="admin-title">Enter PIN</h2><form id="pin-form"><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="••••" required><button>VERIFY</button></form><form id="login-form" hidden><input name="username" placeholder="Admin account" autocomplete="username" required><input name="password" type="password" placeholder="Password" autocomplete="current-password" required><button>AUTHENTICATE</button></form><p id="admin-status" role="status"></p></div></section>
  <section id="admin-dashboard" class="admin-dashboard"><button class="close-dashboard">×</button><p class="eyebrow">Authenticated administrator</p><h2>Registrations</h2><button id="export-data">DOWNLOAD EXCEL CSV ↗</button><div class="table-wrap"><table><thead><tr><th>Event</th><th>Name</th><th>Department</th><th>Year</th><th>Phone</th><th>Email</th></tr></thead><tbody id="registration-rows"></tbody></table></div></section>`);

document.querySelectorAll('#creative article').forEach(card => { if (card.querySelector('h3')?.textContent.trim() === 'Debate') card.remove(); });
document.querySelectorAll('#creative article span').forEach((number, index) => { number.textContent = `0${index + 1}`; });

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

const milestones = [
  [.05, 'AURA 2026', 'SANKARA POLYTECHNIC COLLEGE', 0x00e5ff, 1.25], [.15, 'SPEECH ENDS', '10:50 AM', 0x92a1bd, .55],
  [.12, 'DAY 1', '11.08.2026', 0x00e5ff, 1.5], [.33, 'FLUSH THE BRAIN', '11:30 AM — 12:30 PM', 0xff2e9f, .85],
  [.41, 'TREASURE HUNT', '11:30 AM — 12:30 PM', 0xff2e9f, .85], [.49, 'LUNCH BREAK', '1:20 PM — 1:50 PM', 0x92a1bd, .55],
  [.56, 'BUG HUNT', '2:30 PM — 3:15 PM', 0x00e5ff, .85], [.62, 'SINGING & DANCE', '2:15 PM — 4:00 PM', 0xffd66b, .6],
  [.70, 'DAY 2', '12.08.2026', 0x00e5ff, 1.5], [.78, 'MURDER MYSTERY', '11:30 AM — 12:45 PM', 0xff2e9f, .85],
  [.85, 'DEBATE', '2:30 PM — 3:30 PM', 0x00e5ff, .9], [.94, 'REGISTRATION HUB', 'CHOOSE YOUR PATH', 0xffd66b, .9]
];
const textItems = [];
function text3d(label, detail, color, scale) {
  const g = new THREE.Group(); const title = new Text(); title.text = label; title.fontSize = scale; title.color = 0xffffff; title.anchorX = 'center'; title.anchorY = 'middle'; title.font = 'https://fonts.gstatic.com/s/syncopate/v22/pe0pMIuPIYBCpEV5eFdC4B2Z.ttf'; title.outlineWidth = .012; title.outlineColor = color; g.add(title);
  const sub = new Text(); sub.text = label === 'FLUSH THE BRAIN' ? `${detail}\nMONITOR: BHAVAV, AARABHI` : detail; sub.fontSize = scale * .25; sub.color = 0xdce7ff; sub.anchorX = 'center'; sub.position.y = -scale*.7; sub.letterSpacing = .1; g.add(sub); title.sync(); sub.sync(); return g;
}
milestones.forEach(([t, a, b, c, s], i) => { const eventNames = ['FLUSH THE BRAIN', 'TREASURE HUNT', 'BUG HUNT', 'MURDER MYSTERY', 'DEBATE']; const isEvent = eventNames.includes(a); const isDayMarker = a === 'DAY 1' || a === 'DAY 2'; const item = text3d(a,b,c,isEvent ? 1.2 : s); item.position.copy(path.getPointAt(t)); item.position.add(isEvent || isDayMarker ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(i%2 ? 2.6 : -2.6, i%3-1, 0)); item.userData = {t, label:a}; group.add(item); textItems.push(item); });

let target = 0, progress = 0, touchY = 0, touching = false, velocity = 0;
const clamp = THREE.MathUtils.clamp;
function advance(delta) { target = clamp(target + delta, 0, 1); if (target > .018) document.querySelector('#intro').classList.add('is-hidden'); }
window.addEventListener('wheel', e => { e.preventDefault(); advance(e.deltaY * .00016); velocity = e.deltaY * .000006; }, {passive:false});
canvas.addEventListener('touchstart', e => { touching=true; touchY=e.touches[0].clientY; velocity=0; }, {passive:true});
canvas.addEventListener('touchmove', e => { e.preventDefault(); const y=e.touches[0].clientY; const dy=touchY-y; touchY=y; velocity=dy*.00032; advance(velocity); }, {passive:false});
canvas.addEventListener('touchend', () => touching=false, {passive:true});

const labels = ['READY FOR TAKEOFF','OPENING ADDRESS','DAY ONE','FLUSH THE BRAIN','TREASURE HUNT','LUNCH BREAK','BUG HUNT','DAY TWO','MURDER MYSTERY','DEBATE','REGISTRATION HUB'];
const mainEvents = ['FLUSH THE BRAIN', 'TREASURE HUNT', 'BUG HUNT', 'MURDER MYSTERY', 'DEBATE'];
const eventInfo = {
  'FLUSH THE BRAIN': 'VISA HALL · 11:30 AM – 12:30 PM\n15 TEAMS OF 2 · 3-IMAGE CLUES · NO PHONES',
  'TREASURE HUNT': '11:30 AM – 12:30 PM · 2 ROUNDS\nR1: FIND 5 PAPERS · R2: IDENTIFY ARTICLE NUMBERS / NAMES',
  'BUG HUNT': 'MAIN LAB · 2:30 PM – 3:15 PM · SINGLE PARTICIPANT\nYEARS 1, 2 & 3 · THEORY (C/PYTHON) + PRACTICAL DEBUGGING',
  'MURDER MYSTERY': 'VISA HALL · 11:30 AM – 12:45 PM · 15 TEAMS\nPROJECTOR SCENARIO CLUES · FIND THE MURDERER',
  'DEBATE': '3RD CLASS ROOM · 2:30 PM – 3:30 PM\nANDROID VS iOS · TEAM OF 2',
};
function resize() { const w=innerWidth,h=innerHeight; camera.aspect=w/h; camera.fov=w<500?72:62; camera.updateProjectionMatrix(); renderer.setSize(w,h,false); renderer.setPixelRatio(Math.min(devicePixelRatio, w<768?1:2)); }
addEventListener('resize', resize, {passive:true}); resize();
let last=performance.now(), lastMobileRender=0;
function render(now) { requestAnimationFrame(render); if (isMobile && now - lastMobileRender < 22) return; lastMobileRender = now; const dt=Math.min(.05,(now-last)/1000); last=now; if(!touching) { advance(velocity); velocity*=.86; } progress += (target-progress)*(isMobile?.055:.045); const point = path.getPointAt(progress); const lookPoint = path.getPointAt(Math.min(.999, progress + .025)); camera.position.copy(point); camera.position.y += Math.sin(now*.0007)*.08; camera.lookAt(lookPoint); glow.position.copy(point).add(new THREE.Vector3(2,3,2)); pink.position.copy(point).add(new THREE.Vector3(-3,-2,-2)); rings.forEach((r,i)=>r.rotation.z+=dt*(.13+i*.04)); textItems.forEach(item=>{const distance=Math.abs(progress-item.userData.t); item.visible=distance<.11 && !mainEvents.includes(item.userData.label); if(item.visible){item.lookAt(camera.position); item.children.forEach(c=>c.material.opacity=clamp(1-distance/.11,0,1));}}); document.querySelector('#progress').style.height=`${progress*100}%`; document.querySelector('#chapter').textContent=labels[Math.min(labels.length-1,Math.floor(progress*labels.length))]; const nearest = milestones.reduce((best, item) => Math.abs(item[0] - progress) < Math.abs(best[0] - progress) ? item : best, milestones[0]); const eventName = mainEvents.includes(nearest[1]) ? nearest[1] : ''; const eventDetail = eventInfo[eventName] || ''; document.querySelector('#event-name').textContent = eventName; document.querySelector('#event-name').classList.toggle('visible', Boolean(eventName)); document.querySelector('#event-detail').textContent = eventDetail; document.querySelector('#event-detail').classList.toggle('visible', Boolean(eventDetail)); document.querySelector('#creative-register').classList.toggle('visible', progress > .90); renderer.render(scene,camera); }
document.querySelector('#creative-register').addEventListener('click', event => {
  event.preventDefault();
  const button = event.currentTarget;
  if (button.classList.contains('launching')) return;
  button.classList.add('launching');
  document.querySelector('#ultrasonic-field').classList.add('launching');
  setTimeout(() => { window.location.hash = 'registration-hub'; button.classList.remove('launching'); document.querySelector('#ultrasonic-field').classList.remove('launching'); }, 900);
});
const registerPanel = document.querySelector('#register');
const nonTechnicalEvents = ['Fuzzy Brain', 'Treasure Hunt', 'Murder Mystery'];
function refreshYearThree(eventName) {
  const select = document.querySelector('#registration-form select[name="year"]'); const thirdYear = [...select.options].find(option => option.value === '3');
  thirdYear.disabled = nonTechnicalEvents.includes(eventName);
  thirdYear.textContent = thirdYear.disabled ? '3 (not eligible)' : '3';
  if (thirdYear.disabled && select.value === '3') select.value = '';
}
document.querySelectorAll('.register').forEach(button => button.addEventListener('click', event => {
  event.preventDefault(); const rawName = button.closest('article')?.querySelector('h3')?.textContent.replace(/\s+/g, ' ').trim() || ''; const eventName = rawName.startsWith('Bug') ? 'Bug Hunt' : rawName.startsWith('Debate') ? 'Debate' : rawName;
  document.querySelector('#event').value = eventName; document.querySelector('#form-event').textContent = eventName; document.querySelector('#form-status').textContent = ''; refreshYearThree(eventName); registerPanel.classList.add('open');
}));
document.querySelector('.close-form').addEventListener('click', () => registerPanel.classList.remove('open'));
document.querySelector('#registration-form').addEventListener('submit', async event => {
  event.preventDefault(); const status = document.querySelector('#form-status'); status.textContent = 'Transmitting…';
  const data = Object.fromEntries(new FormData(event.currentTarget)); data.year = Number(data.year);
  try { const response = await fetch('/api/registrations', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); status.textContent = `Registration received. ${result.dashboard.total} participants registered.`; event.currentTarget.reset(); } catch (error) { status.textContent = error.message; }
});

const adminTrigger = document.querySelector('#admin-trigger'); let moves = 0, dragStart = null;
adminTrigger.addEventListener('pointerdown', event => { dragStart = { x:event.clientX, y:event.clientY }; adminTrigger.setPointerCapture(event.pointerId); });
adminTrigger.addEventListener('pointermove', event => { if (!dragStart) return; const x = Math.max(8, Math.min(innerWidth - 34, event.clientX)); const y = Math.max(8, Math.min(innerHeight - 34, event.clientY)); adminTrigger.style.left = `${x}px`; adminTrigger.style.top = `${y}px`; adminTrigger.style.right = 'auto'; adminTrigger.style.bottom = 'auto'; });
adminTrigger.addEventListener('pointerup', event => { if (!dragStart) return; const distance = Math.hypot(event.clientX-dragStart.x, event.clientY-dragStart.y); dragStart = null; if (distance > 24 && ++moves === 5) document.querySelector('#admin-gate').classList.add('open'); });
document.querySelector('.close-admin').addEventListener('click', () => document.querySelector('#admin-gate').classList.remove('open'));
document.querySelector('#pin-form').addEventListener('submit', async event => { event.preventDefault(); const response = await fetch('/api/admin/pin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); const result = await response.json(); document.querySelector('#admin-status').textContent = response.ok ? 'PIN accepted.' : result.error; if(response.ok){document.querySelector('#pin-form').hidden=true;document.querySelector('#login-form').hidden=false;document.querySelector('#admin-title').textContent='Administrator login';} });
async function openDashboard(){ const response = await fetch('/api/admin/registrations'); const result = await response.json(); if(!response.ok) return; document.querySelector('#registration-rows').innerHTML = result.registrations.map(r => `<tr><td>${r.event}</td><td>${r.name}</td><td>${r.department}</td><td>${r.year}</td><td>${r.phone}</td><td>${r.email}</td></tr>`).join(''); document.querySelector('#admin-gate').classList.remove('open'); document.querySelector('#admin-dashboard').classList.add('open'); }
document.querySelector('#login-form').addEventListener('submit', async event => { event.preventDefault(); const response = await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); const result = await response.json(); document.querySelector('#admin-status').textContent = response.ok ? '' : result.error; if(response.ok) openDashboard(); });
document.querySelector('.close-dashboard').addEventListener('click', () => document.querySelector('#admin-dashboard').classList.remove('open'));
document.querySelector('#export-data').addEventListener('click', () => window.location.assign('/api/admin/export'));

gsap.from('.brand, header span', {opacity:0, y:-16, duration:1.1, stagger:.12, ease:'power3.out'}); requestAnimationFrame(render);
