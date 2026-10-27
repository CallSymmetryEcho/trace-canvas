import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/trace-canvas.mjs', import.meta.url));
const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const { qrMatrix } = new Function(`${page.slice(page.indexOf('// <qr>'), page.indexOf('// </qr>'))}; return { qrMatrix };`)();

function request(port, p, { method = 'GET', host = 'phone.test', cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', 'X-Trace-Canvas': '1' } : {}) } }, res => {
      let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, cookie: res.headers['set-cookie'], body: data }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('the phone listener wants its key, then a cookie; strange hosts and computer-only actions are refused', async () => {
  process.env.TRACE_CANVAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-phone-'));
  const token = 'k3y-for-the-phone_0123456789';
  fs.writeFileSync(path.join(process.env.TRACE_CANVAS_HOME, 'config.json'), JSON.stringify({ phone: { host: 'phone.test', ip: '', bind: '127.0.0.1', port: 0, token } }));
  const { startServer } = await import('../src/server.mjs');
  const { server, phoneServer, phone } = await startServer({ port: 0 });
  try {
    const pp = phoneServer.address().port, lp = server.address().port;
    assert.equal(phone, `http://phone.test:${pp}/?k=${token}`);
    assert.equal((await request(pp, '/api/data')).status, 403);
    assert.equal((await request(pp, '/?k=wrong')).status, 403);
    const first = await request(pp, `/?k=${token}`);
    assert.equal(first.status, 200);
    assert.match(first.cookie[0], new RegExp(`^tc_k=${token}; HttpOnly; SameSite=Strict`));
    const cookie = `tc_k=${token}`;
    assert.equal((await request(pp, '/api/data', { cookie })).status, 200);
    assert.equal((await request(pp, '/api/data', { cookie, host: 'evil.example' })).status, 403);
    assert.match((await request(pp, '/api/sync', { method: 'POST', cookie, body: '{}' })).body, /Only on the computer itself/);
    // ▶ Start opens a Terminal window here, so the phone needs trace-canvas phone --allow-start first.
    assert.match((await request(pp, '/api/start', { method: 'POST', cookie, body: '{"thread":"x"}' })).body, /--allow-start/);
    assert.deepEqual((({ remote, start }) => ({ remote, start }))(JSON.parse((await request(pp, '/api/data', { cookie })).body)), { remote: true, start: false });
    // Only this computer is told the address with its key.
    assert.equal(JSON.parse((await request(pp, '/api/health', { cookie })).body).phone, undefined);
    assert.equal(JSON.parse((await request(lp, '/api/health', { host: 'localhost' })).body).phone, `http://phone.test:${lp}/?k=${token}`);
    assert.equal((await request(lp, '/api/data', { host: 'localhost' })).status, 200);
  } finally {
    server.close(); phoneServer.close();
    fs.unwatchFile(path.join(process.env.TRACE_CANVAS_HOME, 'data.json'));
  }
});

test('the QR code picks the smallest version and carries valid format bits', () => {
  assert.deepEqual(['HELLO', 'https://example.com', 'x'.repeat(106)].map(s => qrMatrix(s).length), [21, 25, 41]);
  assert.throws(() => qrMatrix('x'.repeat(107)), /106 bytes at most/);
  const q = qrMatrix('http://your-macbook-pro.tail0a1b2c.ts.net:4777/?k=abc');
  // Finder pattern in the top left corner: a dark ring, a light ring, a dark 3x3 centre.
  assert.deepEqual(q[0].slice(0, 7), [true, true, true, true, true, true, true]);
  assert.deepEqual(q[1].slice(0, 7), [true, false, false, false, false, false, true]);
  assert.deepEqual(q[3].slice(0, 7), [true, false, true, true, true, false, true]);
  // Format bits (row 8 and column 8 around the corner): level M, a mask, and a valid BCH remainder.
  const bits = [0, 1, 2, 3, 4, 5].map(i => q[i][8]).concat([q[7][8], q[8][8], q[8][7]], [5, 4, 3, 2, 1, 0].map(c => q[8][c]));
  const f = bits.reduce((x, b, i) => x | (b ? 1 << i : 0), 0) ^ 0x5412, data = f >> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(data >> 3, 0); // error correction M
  assert.equal(f & 0x3ff, rem & 0x3ff);
  assert.deepEqual(qrMatrix('same'), qrMatrix('same'));
});

test('trace-canvas phone sets up the address and key, makes a new key on --rotate, and turns off', () => {
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-phone-cli-')) };
  const run = (...a) => execFileSync(process.execPath, [CLI, 'phone', ...a], { encoding: 'utf8', env });
  const cfg = () => JSON.parse(fs.readFileSync(path.join(env.TRACE_CANVAS_HOME, 'config.json'), 'utf8')).phone;
  const out = run('--host', 'phone.test', '--bind', '127.0.0.1');
  assert.match(out, /▀/); // the QR code
  assert.match(out, /On your phone: http:\/\/phone\.test:4777\/\?k=[\w-]{24}/);
  assert.match(out, /plain HTTP/);
  const key = cfg().token;
  run('--host', 'phone.test', '--bind', '127.0.0.1');
  assert.equal(cfg().token, key);
  run('--host', 'phone.test', '--bind', '127.0.0.1', '--rotate');
  assert.notEqual(cfg().token, key);
  run('--off');
  assert.equal(cfg(), null);
  assert.throws(() => run('--host', 'phone.test'), /also pass --bind/);
});
