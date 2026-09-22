// Camera QR capture + decode (F04) using jsQR. Decoding happens on-device; nothing is uploaded.

const FRAME_MS = 110;

export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export class Scanner {
  constructor(video, canvas, { onFound, onHint, onError }) {
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.onFound = onFound; this.onHint = onHint; this.onError = onError;
    this.stream = null; this.running = false; this.last = 0; this.startedAt = 0; this.hintLevel = 0; this.darkStreak = 0;
  }

  async start() {
    if (!cameraSupported()) { this.onError('unsupported'); return false; }
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !this.stream; attempt++) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        lastError = e;
        if (e && e.name === 'NotAllowedError') break; // permission refusals are not transient
        await new Promise((r) => setTimeout(r, 700)); // a just-released camera can be briefly busy
      }
    }
    if (!this.stream) {
      const n = lastError && lastError.name;
      this.onError(n === 'NotAllowedError' ? 'denied' : n === 'NotFoundError' ? 'nocamera' : 'error');
      return false;
    }
    this.video.srcObject = this.stream;
    const track = this.stream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => { if (this.running) { this.running = false; this.onError('ended'); } });
    this.video.setAttribute('playsinline', 'true');
    try { await this.video.play(); } catch { this.onError('error'); return false; }
    this.running = true;
    this.startedAt = performance.now();
    this.hintLevel = 0;
    requestAnimationFrame((t) => this.tick(t));
    return true;
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  tick(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.tick(t));
    if (now - this.last < FRAME_MS || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.last = now;
    const scale = Math.min(1, 640 / this.video.videoWidth);
    const w = Math.round(this.video.videoWidth * scale), h = Math.round(this.video.videoHeight * scale);
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(this.video, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);

    const code = window.jsQR ? window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' }) : null;
    if (code && code.data) {
      this.running = false;
      this.onFound(code.data);
      return;
    }
    this.guide(img, now);
  }

  /** Spoken/visible positioning guidance while no code is decodable yet. */
  guide(img, now) {
    let sum = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 64) { sum += img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11; n++; }
    const lum = sum / n;
    if (lum < 45) this.darkStreak++; else this.darkStreak = 0;
    if (this.darkStreak === 8) { this.onHint('dark'); return; }
    const elapsed = now - this.startedAt;
    if (elapsed > 3500 && this.hintLevel < 1) { this.hintLevel = 1; this.onHint('point'); }
    else if (elapsed > 9000 && this.hintLevel < 2) { this.hintLevel = 2; this.onHint('distance'); }
    else if (elapsed > 16000 && this.hintLevel < 3) { this.hintLevel = 3; this.onHint('alternatives'); }
    else if (elapsed > 30000 && this.hintLevel < 4) { this.hintLevel = 4; this.onHint('alternatives'); }
  }
}

/** Decode a QR from a picked image file (accessible alternative to the live camera). */
export async function decodeImageFile(file) {
  if (!window.jsQR) return null;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const code = window.jsQR(img.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
  return code ? code.data : null;
}
