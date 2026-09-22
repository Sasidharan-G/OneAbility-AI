// End-to-end + accessibility audit in a real Chrome. Run: npm run e2e (backend on :8000 must be running).
import puppeteer from 'puppeteer-core';
import QRCode from 'qrcode';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE_URL || 'http://localhost:8000';
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

let pass = 0; const failures = []; const consoleProblems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  try { await fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const has = (hay, needle, m) => ok(hay.includes(needle), `${m || 'expected'} to contain "${needle}", got: ${hay.slice(0, 300).replace(/\n/g, ' | ')}`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['camera', 'microphone']);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) { const t = m.text(); if (!/favicon|Failed to load resource: the server responded with a status of 404/.test(t)) consoleProblems.push(`[${m.type()}] ${t}`); } });
page.on('pageerror', (e) => consoleProblems.push(`[pageerror] ${e.message}`));

const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(350); };
const txt = (sel = '#app') => page.$eval(sel, (e) => e.innerText);
const clickText = async (sel, needle) => {
  const done = await page.evaluate((s, n) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.innerText.trim().toLowerCase().includes(n.toLowerCase()) && !e.disabled);
    if (!el) return false; el.click(); return true;
  }, sel, needle);
  if (!done) throw new Error(`no clickable ${sel} with text "${needle}"`);
  await sleep(350);
};
const balanceOnHome = async () => { await go('#/home'); return (await txt('.balance-amount')).trim(); };
const say = async (utterance) => { await go('#/voice'); await page.type('#say-input', utterance); await page.keyboard.press('Enter'); await sleep(900); };
const axe = async (label) => {
  await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 7000 }).catch(() => {}); // transient toasts overlap content by design
  const vp = page.viewport();
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full > vp.height) { await page.setViewport({ ...vp, height: Math.min(full + 40, 8000) }); await sleep(350); } // so sticky bars cannot cover content at the fold
  await page.evaluate(AXE);
  const r = await page.evaluate(async () => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, rules: { 'color-contrast-enhanced': { enabled: false } } }));
  const bad = r.violations.filter((v) => v.impact !== 'minor' || v.id === 'label');
  await page.setViewport(vp);
  ok(!bad.length, `axe ${label}: ${bad.map((v) => `${v.id}(${v.impact}) x${v.nodes.length} e.g. ${v.nodes[0].html.slice(0, 110)} :: ${(v.nodes[0].any[0]?.message || '').slice(0, 160)} :: by ${(v.nodes[0].any[0]?.relatedNodes || []).map((x) => x.html.slice(0, 90)).join(' / ')}`).join(' ; ')}`);
};

console.log(`Chrome: ${CHROME}\nBase: ${BASE}\n`);
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await sleep(400);

console.log('Onboarding');
await step('first run redirects to welcome and focuses the heading', async () => {
  has(page.url(), '#/welcome');
  ok(await page.evaluate(() => document.activeElement.tagName === 'H1'), 'focus not on h1');
});
await step('welcome has no serious a11y violations', () => axe('welcome'));
await step('empty name is rejected with an error', async () => {
  await clickText('button', 'Start');
  has(await txt(), 'at least 2 letters');
});
await step('complete onboarding', async () => {
  await page.type('#w-name', 'Tester');
  await clickText('button', 'Start');
  has(page.url(), '#/home');
  has(await txt('h1'), 'Vanakkam, Tester');
});

console.log('Home');
await step('home shows simulation banner, balance and six actions', async () => {
  const t = await txt();
  has(t, 'SIMULATION'); has(t, '₹25,000'); has(t, 'Voice Pay'); has(t, 'Scan & Pay'); has(t, 'Pay Contact'); has(t, 'Bills & Recharge');
});
await step('home passes axe (light)', () => axe('home'));

console.log('Voice payment (Tanglish) + confirmation gate + exactly-once debit');
await step('Kumar-ku 500 rooba anuppu opens review with correct fields', async () => {
  await say('Kumar-ku 500 rooba anuppu');
  has(page.url(), '#/review');
  const t = await txt();
  has(t, 'Kumar'); has(t, 'kumar@okbank'); has(t, '₹500'); has(t, 'State Bank of India'); has(t, 'SIMULATION');
  ok(!(await page.$eval('#btn-yes', (b) => b.disabled)), 'Yes should be enabled');
});
await step('review passes axe', () => axe('review'));
await step('nothing is debited before authorization', async () => { ok((await balanceOnHome()) === '₹25,000', 'balance changed early'); });
await step('Yes moves to authorization, not to success', async () => {
  await say('Kumar-ku 500 rooba anuppu');
  await clickText('button', 'Yes, continue');
  has(page.url(), '#/auth');
  ok((await balanceOnHome()) === '₹25,000', 'debited on Yes alone'); // navigating away leaves flow unfinished
});
await step('demo authorization completes the payment once', async () => {
  await say('Kumar-ku 500 rooba anuppu');
  await clickText('button', 'Yes, continue');
  has(await txt(), 'Demo authorization'); has(await txt(), 'does not check any biometric');
  await clickText('button', 'Use demo authorization');
  await sleep(500);
  has(page.url(), '#/result');
  const t = await txt();
  has(t, 'MOCK-'); has(t, '₹24,500'); has(t, 'No real money');
  ok((await balanceOnHome()) === '₹24,500', 'balance not exactly 24,500');
});
await step('history and receipt show the payment', async () => {
  await go('#/history');
  has(await txt(), 'Kumar'); has(await txt(), '− ₹500');
  await clickText('a.list-row', 'Kumar');
  has(page.url(), '#/txn/');
  has(await txt(), 'Successful (simulated)'); has(await txt(), 'Receipt ID');
});
await step('history search filters', async () => {
  await go('#/history');
  await page.type('#h-search', 'priya');
  await sleep(400);
  const t = await txt();
  has(t, 'Priya Sharma'); ok(!t.includes('TNEB'), 'filter did not hide other rows');
});

console.log('Safety guards');
await step('duplicate payment warns and needs acknowledgement', async () => {
  await say('Kumar-ku 500 rooba anuppu');
  has(await txt(), 'same amount'); has(await txt(), 'Caution');
  await clickText('button', 'Yes, continue');
  has(page.url(), '#/review'); // blocked until the box is ticked
  has(await txt(), 'tick the box');
  await page.click('#ack');
  await clickText('button', 'Yes, continue');
  has(page.url(), '#/auth');
});
await step('cancel leaves no debit', async () => {
  await say('Meena ku 300 anuppu');
  await clickText('button', 'No, cancel');
  has(page.url(), '#/home');
  ok((await balanceOnHome()) === '₹24,500', 'cancel changed balance');
});
await step('over-limit payment is blocked and Yes is disabled', async () => {
  await say('send 200000 to Kumar');
  has(page.url(), '#/review');
  ok(await page.$eval('#btn-yes', (b) => b.disabled), 'Yes must be disabled');
  has(await txt(), 'Blocked');
});
await step('insufficient balance is blocked', async () => {
  await say('send 30000 to Kumar');
  ok(await page.$eval('#btn-yes', (b) => b.disabled), 'Yes must be disabled');
  has(await txt(), 'Balance is not enough');
});
await step('unknown receiver is sent to the UPI screen, not guessed', async () => {
  await say('send 300 to Suresh');
  has(page.url(), '#/upi');
  has(await page.$eval('#upi-name', (e) => e.value), 'suresh');
});
await step('invalid UPI ID is rejected inline', async () => {
  await page.type('#upi-id', 'not a upi');
  await clickText('button', 'Continue');
  has(await txt(), 'valid UPI ID');
});
await step('ambiguous name asks, then resolves by name', async () => {
  await say('pay Arun 200');
  has(await txt('.chat'), 'Arun Prakash'); has(await txt('.chat'), 'Arun Kumar');
  ok(page.url().includes('#/voice'), 'should still be on voice screen');
  await page.type('#say-input', 'Arun Kumar'); await page.keyboard.press('Enter'); await sleep(900);
  has(page.url(), '#/review'); has(await txt(), 'arun.kumar@okhdfcbank');
});
await step('missing amount is asked for', async () => {
  await clickText('button', 'No, cancel');
  await say('pay kumar');
  has(await txt('.chat'), 'How much');
  await page.type('#say-input', 'ainooru'); await page.keyboard.press('Enter'); await sleep(900);
  has(page.url(), '#/review'); has(await txt(), '₹500');
  await clickText('button', 'No, cancel');
});
await step('spoken PIN is refused locally', async () => {
  await say('my pin is 1234');
  has(await txt('.chat'), 'never say or type your PIN');
});
await step('unverified contact needs acknowledgement', async () => {
  await say('send 100 to Ravi');
  has(await txt(), 'not been verified');
  await clickText('button', 'No, cancel');
});

console.log('Insights');
await step('voice opens monthly insights with totals, categories and comparison', async () => {
  await say('show my monthly expenses');
  has(page.url(), '#/insights');
  const t = await txt();
  has(t, 'Spent this month'); has(t, 'Where the money went'); has(t, 'Top payees'); has(t, 'This month and last month'); has(t, 'Read summary');
  ok(/₹[\d,]+/.test(t), 'no amounts shown');
});
await step('Tamil expense phrase reaches insights', async () => {
  await say('selavu evlo');
  has(page.url(), '#/insights');
});

console.log('Other payment routes');
await step('contact route: search, amount, review', async () => {
  await go('#/contacts');
  await page.type('#c-search', 'lak'); await sleep(400);
  await clickText('a.list-row', 'Lakshmi');
  has(page.url(), '#/amount');
  await page.type('#amt', '0');
  await clickText('button', 'Review payment');
  has(await txt(), 'greater than zero');
  await page.$eval('#amt', (e) => { e.value = ''; });
  await page.type('#amt', '150.50');
  await clickText('button', 'Review payment');
  has(page.url(), '#/review'); has(await txt(), '₹150.50');
  await clickText('button', 'No, cancel');
});
await step('UPI route to a known contact', async () => {
  await go('#/upi');
  await page.type('#upi-id', 'meena@paytm');
  await clickText('button', 'Continue');
  has(await txt(), 'Meena');
  await page.type('#amt', '75');
  await clickText('button', 'Review payment');
  has(page.url(), '#/review');
  await clickText('button', 'No, cancel');
});
await step('bill flow validates and reaches review', async () => {
  await go('#/bills');
  await clickText('button.tile', 'Mobile recharge');
  await page.type('#bill-id', '12345');
  await clickText('button', 'Review payment');
  has(await txt(), 'valid 10 digit');
  await page.$eval('#bill-id', (e) => { e.value = ''; });
  await page.type('#bill-id', '9876543210');
  await clickText('.chip', '199');
  await clickText('button', 'Review payment');
  has(page.url(), '#/review'); has(await txt(), '₹199'); has(await txt(), 'Jio');
  await clickText('button', 'No, cancel');
});

console.log('QR');
const dir = mkdtempSync(join(tmpdir(), 'qr-'));
const qrFile = async (payload, name) => {
  const buf = await QRCode.toBuffer(payload, { width: 480, margin: 4 });
  const p = join(dir, name); writeFileSync(p, buf); return p;
};
const upload = async (file) => { const input = await page.$('#qr-file'); await input.uploadFile(file); await sleep(1200); };
await step('scanner page loads with camera fallbacks', async () => {
  await go('#/scan');
  const t = await txt();
  has(t, 'Pick a QR image'); has(t, 'Enter UPI ID instead');
});
await step('valid known QR is read from an image', async () => {
  await upload(await qrFile('upi://pay?pa=kumar@okbank&pn=Kumar&am=250&cu=INR&tn=Lunch', 'ok.png'));
  const t = await txt();
  has(t, 'Kumar'); has(t, 'kumar@okbank'); has(t, '₹250');
  await clickText('button', 'Continue');
  has(page.url(), '#/review'); has(await txt(), '₹250'); has(await txt(), 'Lunch');
  await clickText('button', 'No, cancel');
});
await step('unknown-payee QR (no amount) goes via amount step with a warning', async () => {
  await go('#/scan');
  await upload(await qrFile('upi://pay?pa=cornershop@ybl&pn=Corner%20Shop&url=https://shop.example/x', 'unk.png'));
  has(await txt(), 'Corner Shop');
  await clickText('button', 'Continue');
  has(page.url(), '#/amount');
  await page.type('#amt', '40');
  await clickText('button', 'Review payment');
  const t = await txt();
  has(t, 'not in your saved contacts'); has(t, 'web link');
  await clickText('button', 'No, cancel');
});
await step('malicious QR links are blocked', async () => {
  for (const [payload, name] of [['https://evil.example/pay?x=1', 'a.png'], ['javascript:alert(1)', 'b.png']]) {
    await go('#/scan');
    await upload(await qrFile(payload, name));
    const t = await txt();
    has(t, 'QR code blocked');
    ok(!(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^continue/i.test(b.innerText.trim())))), 'Continue must not be offered');
  }
});
await step('real camera path is resilient: stream attached, or a clear message with alternatives', async () => {
  await go('#/home');
  await go('#/scan');
  await sleep(2200);
  const s = await page.evaluate(() => ({ playing: !!document.querySelector('video')?.srcObject, status: document.querySelector('.scan-status')?.innerText || '', buttons: [...document.querySelectorAll('#app button')].map((b) => b.innerText.trim()) }));
  ok(s.playing || /No camera|camera stopped|could not start|blocked/.test(s.status), `neither a stream nor a clear message: ${s.status}`);
  ok(s.buttons.some((b) => /Pick a QR image/.test(b)) && s.buttons.some((b) => /Restart camera/.test(b)), 'fallback buttons missing');
  await go('#/home');
});
await step('live camera decodes a QR from a video stream (synthetic camera)', async () => {
  const dataUrl = await QRCode.toDataURL('upi://pay?pa=kumar@okbank&pn=Kumar&am=120&cu=INR', { width: 480, margin: 4 });
  await page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const draw = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 80, 0, 480, 480); requestAnimationFrame(draw); };
    draw();
    const stream = c.captureStream(15);
    navigator.mediaDevices.getUserMedia = async () => stream;
  }, dataUrl);
  await go('#/scan');
  await sleep(2500);
  const t = await txt();
  has(t, 'Kumar'); has(t, '₹120'); has(t, 'kumar@okbank');
  ok(await page.evaluate(() => !document.querySelector('video')?.srcObject), 'scanner should release the camera after a hit');
  await go('#/home');
});

console.log('Language, settings, accessibility modes');
await step('Tamil UI and Tamil voice command', async () => {
  await page.click('#lang-btn'); await sleep(500);
  has(await txt('h1'), 'வணக்கம்');
  has(await page.evaluate(() => document.documentElement.lang), 'ta');
  await say('குமாருக்கு ஐநூறு ரூபாய் அனுப்பு');
  has(page.url(), '#/review');
  const t = await txt();
  has(t, 'Kumar'); has(t, '₹500'); has(t, 'ஆம், தொடர்'); has(t, 'உருவகப்படுத்தல்');
  await clickText('button', 'இல்லை, ரத்து');
});
await step('Tamil pages pass axe', async () => { await go('#/home'); await axe('home-ta'); await go('#/settings'); await axe('settings-ta'); });
await step('back to English', async () => { await page.click('#lang-btn'); await sleep(400); has(await txt('h1'), 'Settings'); });
await step('settings persist across reload (high contrast, large text, simple mode)', async () => {
  await page.evaluate(() => {
    const sw = [...document.querySelectorAll('input[role="switch"]')];
    const by = (label) => sw.find((s) => document.querySelector(`label[for="${s.id}"]`)?.innerText.includes(label));
    by('High contrast').click();
    by('Simple mode').click();
    document.getElementById('textScale-1.75').click();
  });
  await sleep(300);
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
  const st = await page.evaluate(() => ({ c: document.documentElement.dataset.contrast, s: document.documentElement.dataset.simple, sc: getComputedStyle(document.documentElement).getPropertyValue('--scale').trim() }));
  ok(st.c === 'high' && st.s === 'on' && st.sc === '1.75', JSON.stringify(st));
});
await step('no horizontal overflow at 320px, 175% text, high contrast on every screen', async () => {
  await page.setViewport({ width: 320, height: 640 });
  const routes = ['#/home', '#/voice', '#/scan', '#/contacts', '#/upi', '#/history', '#/people', '#/person?id=new', '#/banks', '#/bank-link', '#/bills', '#/settings', '#/help', '#/balance', '#/insights'];
  const bad = [];
  for (const r of routes) {
    await go(r); await sleep(200);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (o.sw > o.iw + 1) bad.push(`${r}: ${o.sw}>${o.iw}`);
  }
  ok(!bad.length, bad.join(', '));
});
await step('high-contrast + simple mode pass axe (incl. color contrast)', async () => {
  await go('#/home'); await axe('home-hc'); await go('#/settings'); await axe('settings-hc');
});
await step('dark + high contrast passes axe', async () => {
  await go('#/settings');
  await page.click('#theme-dark'); await sleep(300);
  await go('#/home'); await axe('home-dark-hc'); await go('#/voice'); await axe('voice-dark-hc');
});
await step('restore normal appearance', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/#/welcome', { waitUntil: 'networkidle0' });
  await page.type('#w-name', 'Tester');
  await clickText('button', 'Start');
  has(page.url(), '#/home');
});
await step('every main screen passes axe (light, 390px)', async () => {
  for (const r of ['#/voice', '#/scan', '#/contacts', '#/upi', '#/history', '#/people', '#/person?id=new', '#/banks', '#/bank-link', '#/bills', '#/settings', '#/help', '#/balance', '#/insights']) {
    await go(r); await sleep(200); await axe(r);
  }
});
await step('keyboard: focus lands on heading after navigation; Tab reaches Yes/No', async () => {
  await say('send 100 to Kumar');
  ok(await page.evaluate(() => document.activeElement.tagName === 'H1'), 'focus not on h1');
  const seen = new Set();
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => document.activeElement.id || document.activeElement.innerText.slice(0, 20))); }
  ok(seen.has('btn-yes') && seen.has('btn-no'), `Tab order missed Yes/No: ${[...seen].join('|')}`);
  await page.keyboard.press('Escape'); await sleep(400);
  has(page.url(), '#/home');
});
await step('emergency Stop cancels an in-progress payment', async () => {
  await say('send 100 to Kumar');
  await page.click('#stop-btn'); await sleep(500);
  has(page.url(), '#/home');
  has(await page.$eval('#captions', (e) => e.innerText), 'Stopped');
});
await step('captions appear for Dex speech', async () => {
  await say('help');
  ok(await page.$eval('#captions', (e) => !e.hidden), 'captions hidden');
});

console.log('WebAuthn (virtual platform authenticator)');
const cdp = await page.createCDPSession();
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await step('device verification offered and completes a payment as WebAuthn', async () => {
  const before = await balanceOnHome();
  await say('Meena ku 100 rooba anuppu');
  await clickText('button', 'Yes, continue');
  await sleep(500);
  has(await txt(), 'Verify with this device');
  await clickText('button', 'Verify with this device');
  await sleep(1500);
  has(page.url(), '#/result');
  has(await txt(), 'Device authenticator (WebAuthn)');
  ok((await balanceOnHome()) !== before, 'balance unchanged after WebAuthn payment');
  const raw = await page.evaluate(() => localStorage.getItem('oneability.v1'));
  ok(/"credentialId":"[A-Za-z0-9_-]{16,}"/.test(raw), 'credential id (not a secret) should be stored');
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  ok(credentials.length === 1, 'exactly one credential enrolled');
});
await step('second payment reuses the credential (no re-enrol)', async () => {
  await say('Meena ku 50 rooba anuppu');
  await clickText('button', 'Yes, continue'); await sleep(400);
  await clickText('button', 'Verify with this device'); await sleep(1500);
  has(page.url(), '#/result');
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  ok(credentials.length === 1, `credentials: ${credentials.length}`);
});
await step('failed device verification pays nothing and offers the demo fallback', async () => {
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  const before = await balanceOnHome();
  await say('Meena ku 30 rooba anuppu');
  await clickText('button', 'Yes, continue'); await sleep(400);
  await clickText('button', 'Verify with this device'); await sleep(1800);
  has(page.url(), '#/auth');
  const t = await txt();
  ok(/cancelled|failed/.test(t), `expected an error message, got ${t.slice(0, 200)}`);
  has(t, 'Use demo authorization');
  ok((await balanceOnHome()) === before, 'balance changed on failed verification');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
});
await step('balance protection asks for authorization when enabled', async () => {
  await go('#/settings');
  await page.evaluate(() => { const sw = [...document.querySelectorAll('input[role="switch"]')]; sw.find((s) => document.querySelector(`label[for="${s.id}"]`)?.innerText.includes('Ask to authorize before showing balance')).click(); });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(400); // session grace period is memory-only
  await go('#/balance'); await sleep(600);
  has(page.url(), '#/auth?purpose=balance');
  await clickText('button', 'Verify with this device'); await sleep(1500);
  has(page.url(), '#/balance'); has(await txt(), 'State Bank of India');
  await go('#/settings');
  await page.evaluate(() => { const sw = [...document.querySelectorAll('input[role="switch"]')]; sw.find((s) => document.querySelector(`label[for="${s.id}"]`)?.innerText.includes('Ask to authorize before showing balance')).click(); });
});

console.log('Bank linking and contacts CRUD');
await step('six-step bank linking flow adds a masked demo account', async () => {
  await go('#/bank-link');
  await clickText('label.choice', 'HDFC Bank'); await clickText('button', 'Continue');
  await page.type('#mob', '9876543210'); await clickText('button', 'Continue');
  has(await txt(), 'No SMS is sent'); has(await txt(), '••••••3210');
  await clickText('button', 'Simulate verification'); await sleep(2400);
  has(await txt(), 'Step 4 of 6');
  await clickText('label.choice', 'Savings'); await clickText('button', 'Continue');
  await clickText('button', 'Continue');
  await clickText('button', 'Link this account'); await sleep(400);
  has(page.url(), '#/banks');
  const t = await txt(); has(t, 'HDFC Bank'); ok(!t.includes('9876543210'), 'full mobile number must not be stored/shown');
  ok(!(await page.evaluate(() => localStorage.getItem('oneability.v1'))).includes('9876543210'), 'mobile stored in clear');
});
await step('add, favourite and delete a contact; duplicates rejected', async () => {
  await go('#/person?id=new');
  await page.type('#pn', 'Deepa'); await page.type('#pu', 'deepa@okaxis');
  await clickText('button', 'Save'); await sleep(300);
  has(await txt(), 'Deepa'); has(await txt(), 'Unverified');
  await go('#/person?id=new');
  await page.type('#pn', 'Deepa Two'); await page.type('#pu', 'deepa@okaxis');
  await clickText('button', 'Save');
  has(await txt(), 'already saved as Deepa');
  await go('#/people');
  await page.evaluate(() => [...document.querySelectorAll('.person')].find((p) => p.innerText.includes('Deepa')).querySelector('a.list-row').click());
  await sleep(300);
  await clickText('button', 'Delete contact');
  await sleep(200);
  await page.evaluate(() => document.querySelectorAll('dialog[open] button')[1].click());
  await sleep(400);
  ok(!(await txt()).includes('Deepa'), 'contact not deleted');
});
await step('storage never contains PIN/OTP-like keys after all flows', async () => {
  const raw = await page.evaluate(() => localStorage.getItem('oneability.v1'));
  ok(!/"(pin|otp|upi_pin|cvv|password|biometric)"/i.test(raw), 'secret-like key found');
});

console.log('Offline / PWA');
await step('service worker installs and caches the shell', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  ok(reg, 'no active service worker');
  const cached = await page.evaluate(async () => (await (await caches.keys())[0] && (await (await caches.open((await caches.keys())[0])).keys()).length));
  ok(cached > 25, `only ${cached} cached`);
});
await step('manifest is valid and linked', async () => {
  const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  ok(m.name === 'OneAbility AI' && m.display === 'standalone' && m.icons.length >= 3, 'bad manifest');
});
await step('offline banner reacts to the browser going offline', async () => {
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  ok(await page.$eval('#net-status', (e) => !e.hidden), 'offline banner hidden');
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
  ok(await page.$eval('#net-status', (e) => e.hidden), 'offline banner still visible when online');
});
await step('truly offline: Node server.js dies, cached shell still runs and pays locally', async () => {
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3100', HOST: '127.0.0.1', BACKEND_URL: 'http://127.0.0.1:8000' }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) { try { up = (await fetch('http://127.0.0.1:3100/health')).ok; } catch { await sleep(200); } }
    ok(up, 'server.js did not start or cannot proxy /health');
    const proxied = await (await fetch('http://127.0.0.1:3100/api/auth/challenge')).json();
    ok(proxied.challenge, 'proxy did not reach the API');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 390, height: 844 });
    await page2.goto('http://localhost:3100/', { waitUntil: 'networkidle0' });
    await page2.type('#w-name', 'Offline'); await page2.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Start/.test(b.innerText)).click());
    await sleep(500);
    await page2.evaluate(async () => { await navigator.serviceWorker.ready; });
    await sleep(1500);
    srv.kill(); await sleep(800);
    let reachable = true; try { await fetch('http://127.0.0.1:3100/health'); } catch { reachable = false; }
    ok(!reachable, 'server should be down');
    await page2.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
    ok((await page2.$eval('h1', (e) => e.innerText)).includes('Vanakkam, Offline'), 'shell did not load from cache');
    const health = await page2.evaluate(() => fetch('/health').then((r) => r.status, () => 0));
    ok(health === 503, `API while offline should be a clean 503, got ${health}`);
    await page2.evaluate(() => { location.hash = '#/voice'; }); await sleep(500);
    await page2.type('#say-input', 'Kumar-ku 90 rooba anuppu'); await page2.keyboard.press('Enter'); await sleep(1200);
    ok(page2.url().includes('#/review'), 'no review offline: ' + page2.url());
    ok((await page2.$eval('#app', (e) => e.innerText)).includes('₹90'), 'amount missing');
    await page2.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Yes, continue/.test(b.innerText)).click()); await sleep(500);
    await page2.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Use demo authorization/.test(b.innerText)).click()); await sleep(800);
    const t = await page2.$eval('#app', (e) => e.innerText);
    ok(page2.url().includes('#/result') && t.includes('MOCK-') && t.includes('₹24,910'), 'offline payment failed: ' + t.slice(0, 200));
    await page2.close();
  } finally { srv.kill(); }
});

console.log('Security headers');
await step('CSP, nosniff and no inline script/style needed', async () => {
  const r = await fetch(BASE + '/');
  const csp = r.headers.get('content-security-policy');
  has(csp, "script-src 'self'"); has(csp, "object-src 'none'");
  ok(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
});
await step('API rejects PIN/OTP fields and never echoes secrets', async () => {
  const r = await fetch(BASE + '/api/voice/confirm-payment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flow_id: 'flow_x12345', decision: 'yes', auth: { method: 'demo', pin: '1234' } }) });
  ok(r.status === 422, `status ${r.status}`);
  const j = await r.json(); ok(!JSON.stringify(j).includes('1234'), 'secret echoed');
});

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
const noise = consoleProblems.filter((m) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Server unreachable|ERR_FAILED/.test(m));
if (noise.length) { console.log(`\nConsole problems (${noise.length}):`); [...new Set(noise)].slice(0, 20).forEach((m) => console.log('  ' + m)); }
if (failures.length || noise.length) { console.log('\nFAILURES:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
