// Mock PostgREST that mimics the real schema's behaviour, including the
// unique constraints and the capacity/eligibility rules.
import http from 'node:http';

export function startMockSupabase({ failFirst = 0, latency = 0 } = {}) {
  const rows = [];
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x');
    const send = (code, obj, extra = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...extra });
      res.end(JSON.stringify(obj));
    };
    if (latency) await new Promise(r => setTimeout(r, latency));
    calls += 1;
    if (calls <= failFirst) return send(503, { message: 'service unavailable' });

    if (url.pathname === '/rest/v1/rpc/registration_stats') {
      return send(200, {
        total: rows.length,
        teams: rows.filter(r => r.team_name).length,
        byEvent: rows.reduce((acc, r) => ({ ...acc, [r.event]: (acc[r.event] || 0) + 1 }), {}),
      });
    }

    if (url.pathname === '/rest/v1/rpc/create_registration') {
      const { payload: p, total_capacity: cap } = JSON.parse(body);
      if (cap > 0 && rows.length >= cap) {
        return send(400, { message: `Registration is closed. All ${cap} places are filled.` });
      }
      const blocked = ['Flush the Brain', 'Treasure Hunt', 'Murder Mystery'];
      if (blocked.includes(p.event) && (p.year === '3' || p.partnerYear === '3')) {
        return send(400, { message: 'Year 3 students are not eligible for this event.' });
      }
      const ek = p.email.toLowerCase().trim();
      const pk = p.phone.replace(/\D/g, '').slice(-10);
      if (rows.some(r => r.event === p.event
        && (r.email.toLowerCase().trim() === ek || r.phone.replace(/\D/g, '').slice(-10) === pk))) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "uniq_event_email"' });
      }
      const row = {
        id: crypto.randomUUID(), event: p.event, choice: p.choice || null,
        team_name: p.teamName || null, name: p.name, department: p.department, year: p.year,
        partner_name: p.partnerName || null, partner_department: p.partnerDepartment || null,
        partner_year: p.partnerYear || null, phone: p.phone, email: p.email,
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      return send(200, row);
    }

    if (url.pathname === '/rest/v1/registrations') {
      if (req.method === 'DELETE') {
        const match = /email=eq\.(.+)$/.exec(url.search || '');
        if (match) {
          const target = decodeURIComponent(match[1]);
          for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].email === target) rows.splice(i, 1);
        }
        res.writeHead(204); return res.end();
      }
      const limit = Number(url.searchParams.get('limit')) || 1000;
      const offset = Number(url.searchParams.get('offset')) || 0;
      let out = [...rows].reverse();
      const or = url.searchParams.get('or');
      if (or) {
        const m = /ilike\.\*(.+?)\*/.exec(or);
        if (m) {
          const q = m[1].toLowerCase();
          out = out.filter(r => JSON.stringify(r).toLowerCase().includes(q));
        }
      }
      const page = out.slice(offset, offset + limit);
      return send(200, page, { 'Content-Range': `${offset}-${offset + page.length - 1}/${out.length}` });
    }
    send(404, { message: 'not found' });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, rows, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}
