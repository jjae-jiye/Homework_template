/* 손자국 — 만질수록 지문이 쌓이는 점토 메모 (중간 과제 프로토타입)
 *
 * 화면
 *  - 작업 화면: 점토 하나. 누르면 지문, 두 손가락으로 벌리면 펼쳐짐, 펼친 점토 위에서 손가락/마우스로 그으면 새겨짐
 *    (노트북은 키보드로 쓰기도 선택 가능). 15초 동안 안 만지면 서서히 하얗게 마르다가 굳고(얇게 편 점토는 갈라짐),
 *    굳으면 새긴 글이 하얗게 묻혀 안 보인다. 문질러 물을 묻힌 자리만 잠깐 드러났다가 마르면 다시 숨는다.
 *    여러 손가락으로 감싸거나(폰) 꾹 누르고 있으면(노트북) 체온으로 다시 말랑해진다.
 *    말랑할 때 왔다 갔다 문지르면 그 자리가 평평하게 메워진다(지우기).
 *  - 홈: 지금까지 만든 점토가 놓인 선반. 새긴 글은 숨겨져 있고, 문질러 물을 묻혀야 보인다.
 *    아래 반죽을 위로 끌면 새 점토. 3초 꾹 누르면 납작해지며 지워짐.
 *
 * 점토 그리기
 *  - 모양(덩어리 → 판)과 빛·그림자는 WebGL 셰이더가 계산한다.
 *  - 지문·손자국·흙의 결은 '표면 디테일 맵'(높이 지도)에 찍고, 셰이더가 그 기울기를 빛으로 읽는다.
 *  - 직접 찍은 점토 표면 사진이 생기면 CONFIG.photo 에 경로를 넣으면 흙의 색과 얼룩이 사진으로 바뀐다.
 */
(() => {
'use strict';

/* ───────── 설정 ───────── */
const CONFIG = {
  dryMs: 15000,   // 안 만지고 이 시간이 지나면 굳는다
  photo: null,    // 예: 'assets/clay-surface.jpg'
};
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const STORE = 'sonjaguk.clays.v2';
const LEARN = 'sonjaguk.learned.v2';
const INPUT = 'sonjaguk.input.v1';
const N = 768, L = 1.3, TEX = 2 * L / N;          // 디테일 맵: 768×768, 점토 로컬 좌표 -1.3 ~ 1.3
const KS = [2, 3, 4, 5, 7, 9, 11, 13, 17, 21, 27, 33]; // 가장자리 굴곡을 만드는 주파수들
const MAX_MARKS = 360;   // 지문·자국 개수 상한 (새긴 획은 지우지 않음)

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const now = () => Date.now();
const r4 = v => Math.round(v * 1e4) / 1e4;
const rint = () => (Math.random() * 2147483647) | 0;
const byte = v => v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + .5) | 0;
const def = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* 진동 미지원 */ } };
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ───────── 흙의 결: 이어 붙여도 티 안 나는 노이즈 ───────── */
function tileNoise(P, seed) {
  const M = N / P, r = rng(seed), v = new Float32Array(M * M), out = new Float32Array(N * N);
  for (let i = 0; i < v.length; i++) v[i] = r() * 2 - 1;
  for (let y = 0; y < N; y++) {
    const gy = y / P, j = Math.floor(gy); let fy = gy - j; fy = fy * fy * (3 - 2 * fy);
    const j0 = (j % M) * M, j1 = ((j + 1) % M) * M;
    for (let x = 0; x < N; x++) {
      const gx = x / P, i = Math.floor(gx); let fx = gx - i; fx = fx * fx * (3 - 2 * fx);
      const i0 = i % M, i1 = (i + 1) % M, a = v[j0 + i0], b = v[j0 + i1], c = v[j1 + i0], d = v[j1 + i1];
      out[y * N + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}
const GRAIN = new Float32Array(N * N), MOT = new Float32Array(N * N);
function buildNoise() {
  const a = tileNoise(4, 11), b = tileNoise(16, 23), c = tileNoise(96, 37), m = tileNoise(48, 51);
  for (let i = 0; i < N * N; i++) { GRAIN[i] = a[i] * .07 + b[i] * .26 + c[i] * .8; MOT[i] = m[i]; }
}

/* ───────── 점토 모양 ───────── */
function shapeOf(c) {
  if (c._shape) return c._shape;
  const r = rng(c.seed * 7 + 3);
  const amp = [.045 + r() * .05, .022 + r() * .028, .01 + r() * .016, .006 + r() * .01,
    .01, .008, .006, .0045, .0035, .0028, .002, .0016].map((a, i) => i < 4 ? a : a * (.6 + r() * .9));
  const ph = KS.map(() => r() * Math.PI * 2);
  def(c, '_shape', { amp, ph: new Float32Array(ph) });
  return c._shape;
}
const areaOf = c => c.sx * c.sy;
const flatOf = c => clamp((areaOf(c) - 1) / 2.2, 0, 1);              // 0 동그란 덩어리 → 1 납작한 판
const heightOf = (c, R) => R * .62 / Math.pow(areaOf(c), .85);       // 펼칠수록 얇아진다(부피 보존)
const gainOf = c => Math.pow(areaOf(c), -.35);                       // 늘어난 자국은 얕아진다
function ampsOf(c, out) { const s = shapeOf(c), f = flatOf(c); for (let i = 0; i < 12; i++) out[i] = s.amp[i] * (i < 4 ? 1 : f); return out; }
function edgeAt(c, th, amps) { const ph = shapeOf(c).ph; let e = 1; for (let i = 0; i < 12; i++) e += amps[i] * Math.cos(KS[i] * th + ph[i]); return e; }
function rLocal(c, u, v, amps) { const d = Math.hypot(u, v); return d < 1e-6 ? 0 : d / edgeAt(c, Math.atan2(v, u), amps); }
const tmpAmps = new Float32Array(12);
const moist = (c, t = now()) => clamp(1 - (t - c.lt) / CONFIG.dryMs, 0, 1); // 1 촉촉 → 0 굳음
const wetOf = m => Math.pow(m, .9);                                          // 보이는 젖은 정도: 만진 순간부터 조금씩 하얗게 마른다
const WRITE_AREA = 1.4;                                         // 이만큼만 펼쳐도 새길 수 있다 (어느 방향이든)
const writable = c => areaOf(c) >= WRITE_AREA - 1e-3;

/* ───────── 자국 찍기 (높이 지도에) ───────── */
const tx = u => (u + L) / TEX - .5;
function bbox(u0, v0, u1, v1) {
  return [clamp(Math.floor(tx(u0)), 0, N - 1), clamp(Math.floor(tx(v0)), 0, N - 1), clamp(Math.ceil(tx(u1)), 0, N - 1), clamp(Math.ceil(tx(v1)), 0, N - 1)];
}
function sampleH(H, u, v) { return H[clamp(Math.round(tx(v)), 0, N - 1) * N + clamp(Math.round(tx(u)), 0, N - 1)]; }

// 지문: 손가락 끝으로 누른 타원형 홈 + 그 안의 융선 + 밀려난 가장자리
function stampPrint(H, m) {
  const r = rng(m.s), type = r() < .62 ? 0 : 1, ph = r() * 6.283, ccx = (r() - .5) * 3, ccy = -1.5 - r() * 3, per = 2.45 + r() * .3;
  const A = m.A, B = m.B, D = m.D, cs = Math.cos(m.r), sn = Math.sin(m.r), g = m.g || 1;
  const ridgeAmp = .16 * g * Math.min(1, D / (1.8 * g)), ext = Math.max(A, B) * 1.32;
  let ref = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, X = Math.cos(a) * A * 1.3, Y = Math.sin(a) * B * 1.3;
    ref += sampleH(H, m.u + (X * cs - Y * sn) / m.kx, m.v + (X * sn + Y * cs) / m.ky);
  }
  ref /= 8;
  const [x0, y0, x1, y1] = bbox(m.u - ext / m.kx, m.v - ext / m.ky, m.u + ext / m.kx, m.v + ext / m.ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - m.v) * m.ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - m.u) * m.kx;
      const xr = X * cs + Y * sn, yr = -X * sn + Y * cs;
      const rho = Math.sqrt((xr / A) * (xr / A) + (yr / B) * (yr / B));
      if (rho > 1.32) continue;
      const i = y * N + x;
      let lip = 0;
      if (rho > .8) { const t = (rho - 1.07) / .13; lip = D * .3 * Math.exp(-t * t); }
      if (rho < 1.02) {
        const bowl = -D * (.82 + .18 * (1 - rho * rho)) * (1 - smooth(.6, 1, rho));
        const dx = xr - ccx, dy = yr - ccy;
        const q = type === 0 ? Math.sqrt(dx * dx * .9 + dy * dy) + .8 * Math.sin(2 * Math.atan2(dy, dx) + ph) : dy + .065 * dx * dx;
        const ridge = Math.cos(6.2832 * q / per) * (.8 + .2 * Math.cos(xr * .7 + yr * .45 + ph));
        const target = ref + bowl + ridgeAmp * ridge * (1 - smooth(.5, .93, rho));
        const w = 1 - smooth(.72, 1.02, rho);
        H[i] += (target - H[i]) * w + lip;
      } else H[i] += lip;
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// 엄지로 민 자국: 미는 방향으로 깊어지고, 끝에 흙이 쌓인다. 결은 미는 방향으로 난다
function stampSmear(H, m) {
  const Sx = (m.u1 - m.u0) * m.kx, Sy = (m.v1 - m.v0) * m.ky, len = Math.hypot(Sx, Sy) || .001, dx = Sx / len, dy = Sy / len, W = m.W, D = m.D, ex = W * 1.5;
  let ref = 0;
  for (const s of [1, -1]) {
    ref += sampleH(H, m.u0 - s * dy * W * 1.35 / m.kx, m.v0 + s * dx * W * 1.35 / m.ky);
    ref += sampleH(H, m.u1 - s * dy * W * 1.35 / m.kx, m.v1 + s * dx * W * 1.35 / m.ky);
  }
  ref /= 4;
  const streakAmp = .07 * (m.st == null ? 1 : m.st) * Math.min(1.4, D / 1.3);
  const [x0, y0, x1, y1] = bbox(Math.min(m.u0, m.u1) - ex / m.kx, Math.min(m.v0, m.v1) - ex / m.ky, Math.max(m.u0, m.u1) + ex / m.kx, Math.max(m.v0, m.v1) + ex / m.ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - m.v0) * m.ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - m.u0) * m.kx;
      const along = X * dx + Y * dy, t = clamp(along / len, 0, 1);
      const d = Math.hypot(X - Sx * t, Y - Sy * t) / W;
      if (d > 1.45) continue;
      const i = y * N + x;
      let lip = 0;
      if (d > .8) { const front = along > len - W * .2 ? 1 : .15, tt = (d - 1.08) / .16; lip = D * .42 * front * Math.exp(-tt * tt); }
      if (d < 1.02) {
        const perp = -X * dy + Y * dx;
        const bowl = -D * (.55 + .45 * t) * (1 - smooth(.55, 1, d));
        const streak = Math.cos(6.2832 * perp / 2.3) * streakAmp * (1 - smooth(.4, .95, d));
        const w = 1 - smooth(.7, 1.02, d);
        H[i] += (ref + bowl + streak - H[i]) * w + lip;
      } else H[i] += lip;
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// 작은 기공
function stampPore(H, m) {
  const ext = m.R * 2.2, [x0, y0, x1, y1] = bbox(m.u - ext / m.kx, m.v - ext / m.ky, m.u + ext / m.kx, m.v + ext / m.ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - m.v) * m.ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - m.u) * m.kx, d = Math.hypot(X, Y) / m.R;
      if (d > 2.2) continue;
      const t = (d - 1.4) / .35;
      H[y * N + x] += -m.D * Math.exp(-d * d * 1.6) + m.D * .25 * Math.exp(-t * t);
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
// 새긴 획: 꼬챙이로 긁은 듯한 둥근 홈 + 양옆으로 밀려난 흙 턱. 굵기·깊이는 속도와 상관없이 일정
function grooveSeg(H, a, b, kx, ky, W, D) {
  const Sx = (b[0] - a[0]) * kx, Sy = (b[1] - a[1]) * ky, len2 = Sx * Sx + Sy * Sy, len = Math.sqrt(len2) || 1e-3, ex = W * 2.1;
  const nx = -Sy / len, ny = Sx / len;
  const ref = (sampleH(H, a[0] + nx * W * 3.4 / kx, a[1] + ny * W * 3.4 / ky) + sampleH(H, a[0] - nx * W * 3.4 / kx, a[1] - ny * W * 3.4 / ky)) / 2;
  const [x0, y0, x1, y1] = bbox(Math.min(a[0], b[0]) - ex / kx, Math.min(a[1], b[1]) - ex / ky, Math.max(a[0], b[0]) + ex / kx, Math.max(a[1], b[1]) + ex / ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - a[1]) * ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - a[0]) * kx;
      const traw = len2 > 1e-6 ? (X * Sx + Y * Sy) / len2 : 0, t = clamp(traw, 0, 1);
      const d = Math.hypot(X - Sx * t, Y - Sy * t) / W;
      if (d > 2.1) continue;
      const i = y * N + x;
      if (d < 1.05) { const w = 1 - smooth(.8, 1.05, d), v = H[i] + (ref - D * Math.sqrt(Math.max(0, 1 - d * d)) - H[i]) * w; if (v < H[i]) H[i] = v; }  // 이미 판 곳은 더 파지 않는다
      if (d > .85 && traw > 0 && traw <= 1) { const tt = (d - 1.3) / .28; H[i] += D * .32 * Math.exp(-tt * tt); }
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
const unite = (a, b) => { if (!a) return b; const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]); return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0]; };
function stampGroove(H, m) {
  let rect = null; const P = m.pts;
  if (P.length === 1) return grooveSeg(H, P[0], P[0], m.kx, m.ky, m.W, m.D);
  for (let i = 1; i < P.length; i++) rect = unite(rect, grooveSeg(H, P[i - 1], P[i], m.kx, m.ky, m.W, m.D));
  return rect;
}
// 키보드로 쓴 글: 도장처럼 눌러 찍힌 글자
const textCv = document.createElement('canvas'), tctx = textCv.getContext('2d', { willReadFrequently: true });
const TEXT_FONT = fs => `800 ${fs}px "Nanum Myeongjo", "AppleMyungjo", "Batang", serif`;
function textLayout(m) {
  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.font = TEXT_FONT(m.fs);
  const lines = m.text.split('\n'), lh = m.fs * 1.3, widths = lines.map(t => tctx.measureText(t).width);
  return { lines, lh, widths, w: Math.max(1, ...widths), h: lines.length * lh, top: -m.fs * .65 };
}
function stampText(H, m) {
  if (!m.text) return null;
  const lay = textLayout(m), sx = 1 / (m.kx * TEX), sy = 1 / (m.ky * TEX), pad = 3;
  const tw = Math.ceil(lay.w * sx) + pad * 2, th = Math.ceil(lay.h * sy) + pad * 2;
  const gx0 = Math.round(tx(m.u)) - pad, gy0 = Math.round(tx(m.v) + lay.top * sy) - pad;
  textCv.width = tw; textCv.height = th;
  tctx.setTransform(sx, 0, 0, sy, pad, pad);
  tctx.filter = 'blur(0.6px)'; tctx.font = TEXT_FONT(m.fs); tctx.textBaseline = 'top'; tctx.fillStyle = '#000';
  lay.lines.forEach((t, i) => tctx.fillText(t, 0, i * lay.lh));
  tctx.filter = 'none';
  const img = tctx.getImageData(0, 0, tw, th).data, ref = sampleH(H, m.u, m.v);
  for (let j = 0; j < th; j++) {
    const y = gy0 + j; if (y < 0 || y >= N) continue;
    for (let i = 0; i < tw; i++) {
      const x = gx0 + i; if (x < 0 || x >= N) continue;
      const a = img[(j * tw + i) * 4 + 3] / 255; if (a < .02) continue;
      const k = y * N + x, v = ref - m.D * a;
      if (v < H[k]) H[k] = v;
    }
  }
  const x0 = clamp(gx0, 0, N - 1), y0 = clamp(gy0, 0, N - 1);
  return [x0, y0, clamp(gx0 + tw, 0, N) - x0, clamp(gy0 + th, 0, N) - y0];
}
// 문질러 메우기: 홈과 자국을 흙의 원래 결로 되돌린다 (여러 번 문지를수록 더 평평해진다)
let GOFF = [0, 0];
function eraseSeg(H, a, b, kx, ky, W) {
  const Sx = (b[0] - a[0]) * kx, Sy = (b[1] - a[1]) * ky, len2 = Sx * Sx + Sy * Sy, len = Math.sqrt(len2) || 1e-3, ex = W * 1.2;
  const nx = -Sy / len, ny = Sx / len, [ox, oy] = GOFF;
  const [x0, y0, x1, y1] = bbox(Math.min(a[0], b[0]) - ex / kx, Math.min(a[1], b[1]) - ex / ky, Math.max(a[0], b[0]) + ex / kx, Math.max(a[1], b[1]) + ex / ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - a[1]) * ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - a[0]) * kx;
      const t = len2 > 1e-6 ? clamp((X * Sx + Y * Sy) / len2, 0, 1) : 0, d = Math.hypot(X - Sx * t, Y - Sy * t) / W;
      if (d > 1.15) continue;
      const i = y * N + x, base = GRAIN[((y + oy) % N) * N + (x + ox) % N] * .7 + Math.cos((X * nx + Y * ny) / 2.2) * .05;
      H[i] += (base - H[i]) * (1 - smooth(.55, 1.15, d)) * .6;
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function stampErase(H, m) {
  let rect = null; const P = m.pts;
  for (let i = 0; i < P.length; i++) rect = unite(rect, eraseSeg(H, P[Math.max(0, i - 1)], P[i], m.kx, m.ky, m.W));
  return rect;
}
const isWriting = m => m.t === 'g' || m.t === 'k';
const stamp = (H, m) => m.t === 'p' ? stampPrint(H, m) : m.t === 's' ? stampSmear(H, m) : m.t === 'g' ? stampGroove(H, m) : m.t === 'k' ? stampText(H, m) : m.t === 'e' ? stampErase(H, m) : stampPore(H, m);

// 반죽을 떼어낼 때부터 있던 손자국들 (점토마다 다르게, 저장하지 않고 seed로 다시 만든다)
function baseMarks(c) {
  const r = rng(c.seed * 13 + 5), out = [], K = 95;
  for (let i = 0; i < 14; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * .78, cu = Math.cos(a) * d, cv = Math.sin(a) * d, dir = r() * 6.283, len = (8 + r() * 20) / K;
    out.push({ t: 's', u0: cu - Math.cos(dir) * len / 2, v0: cv - Math.sin(dir) * len / 2, u1: cu + Math.cos(dir) * len / 2, v1: cv + Math.sin(dir) * len / 2, kx: K, ky: K, W: 8 + r() * 7, D: .35 + r() * .8, st: .2 });
  }
  for (let i = 0; i < 3; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * .7;
    out.push({ t: 'p', u: Math.cos(a) * d, v: Math.sin(a) * d, kx: K, ky: K, A: 14 + r() * 2, B: 18 + r() * 2.4, r: (r() - .5) * 1.4, D: .7 + r() * .6, g: 1, s: (r() * 1e9) | 0 });
  }
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * .88;
    out.push({ t: 'o', u: Math.cos(a) * d, v: Math.sin(a) * d, kx: K, ky: K, R: .6 + r(), D: .35 + r() * .45 });
  }
  return out;
}

/* 높이 지도 → 텍스처(R,G: 기울기 / B: 깊이 / A: 흙 얼룩) */
class ClayMap {
  constructor() { this.H = new Float32Array(N * N); this.rgba = new Uint8Array(N * N * 4); this.mx = 0; this.my = 0; }
  build(c, keep = () => true) {   // keep: 어떤 자국까지 찍을지 (글을 뺀 '숨김용' 지도도 만든다)
    const r = rng(c.seed * 31 + 17), ox = (r() * N) | 0, oy = (r() * N) | 0, H = this.H;
    this.ox = ox; this.oy = oy; GOFF = [ox, oy];
    this.mx = (r() * N) | 0; this.my = (r() * N) | 0;
    for (let y = 0; y < N; y++) { const sy = ((y + oy) % N) * N, row = y * N; for (let x = 0; x < N; x++) H[row + x] = GRAIN[sy + (x + ox) % N]; }
    for (const m of baseMarks(c)) stamp(H, m);
    for (const m of c.marks) if (keep(m)) stamp(H, m);
    return this.encode([0, 0, N, N]);
  }
  add(m) { GOFF = [this.ox, this.oy]; const r = stamp(this.H, m); return r ? this.encode(r) : null; }
  erase(a, b, m) { GOFF = [this.ox, this.oy]; return this.encode(eraseSeg(this.H, a, b, m.kx, m.ky, m.W)); }
  encode([x, y, w, h]) {
    const xa = Math.max(0, x - 1), ya = Math.max(0, y - 1), xb = Math.min(N - 1, x + w), yb = Math.min(N - 1, y + h);
    const H = this.H, o = this.rgba, inv = 1 / (2 * TEX) / 512, mx = this.mx, my = this.my;
    for (let yy = ya; yy <= yb; yy++) {
      const row = yy * N, mrow = ((yy + my) % N) * N;
      for (let xx = xa; xx <= xb; xx++) {
        const i = row + xx, k = i * 4;
        const l = xx > 0 ? H[i - 1] : H[i], rr = xx < N - 1 ? H[i + 1] : H[i], u = yy > 0 ? H[i - N] : H[i], d = yy < N - 1 ? H[i + N] : H[i];
        o[k] = byte((rr - l) * inv + .5);
        o[k + 1] = byte((d - u) * inv + .5);
        o[k + 2] = byte(.5 + H[i] / 8);
        o[k + 3] = byte(.5 + MOT[mrow + (xx + mx) % N] * .5);
      }
    }
    return [xa, ya, xb - xa + 1, yb - ya + 1];
  }
}

/* ───────── WebGL: 점토의 빛과 그림자 ───────── */
const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
const FS = prec => `precision ${prec} float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uC; uniform float uR0; uniform vec2 uS;
uniform float uH; uniform float uFlat; uniform float uK[12]; uniform float uA[12]; uniform float uP[12];
uniform sampler2D uTex; uniform sampler2D uTexB; uniform sampler2D uWater; uniform sampler2D uPhoto; uniform float uPhotoMix;
uniform float uHide; uniform float uWaterOn; uniform float uWaterAll;
uniform float uL; uniform float uGain; uniform float uWet; uniform float uWarm; uniform float uAlpha;
float edgeF(float th){ float e = 1.0; for (int i = 0; i < 12; i++) e += uA[i] * cos(uK[i] * th + uP[i]); return e; }
float rOf(vec2 p){ vec2 l = p / (uR0 * uS); float d = length(l); if (d < 1e-4) return 0.0; return d / edgeF(atan(l.y, l.x)); }
float prof(float r){ float rr = min(r, 1.0); float dome = sqrt(max(0.0, 1.0 - rr * rr)); float slab = pow(max(0.0, 1.0 - pow(rr, 9.0)), 0.32); return mix(dome, slab, uFlat); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr - uC;
  float r = rOf(p);
  float aaw = 1.1 / (uR0 * min(uS.x, uS.y));
  float a = 1.0 - smoothstep(1.0 - aaw, 1.0 + aaw, r);
  vec2 off = vec2(0.5, 0.78) * (uH * 0.5 + 1.5);
  float blur = 0.07 + 0.35 * uH / (uR0 * max(uS.x, uS.y));
  float sh = (1.0 - smoothstep(1.0 - blur, 1.0 + blur * 1.6, rOf(p - off))) * 0.24;
  sh = max(sh, (1.0 - smoothstep(0.99, 1.0 + 5.0 * aaw, rOf(p - vec2(0.5, 1.2)))) * 0.3);
  vec3 shc = vec3(0.31, 0.26, 0.2);
  if (a < 0.002) { gl_FragColor = vec4(shc * sh, sh) * uAlpha; return; }
  float h0 = uH * prof(r);
  vec2 g = vec2(uH * prof(rOf(p + vec2(0.75, 0.0))) - h0, uH * prof(rOf(p + vec2(0.0, 0.75))) - h0) / 0.75;
  g = clamp(g, -4.0, 4.0);
  vec2 l = p / (uR0 * uS), uv = l / (2.0 * uL) + 0.5;
  float water = uWaterAll;
  if (uWaterOn > 0.5) water = max(water, texture2D(uWater, vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y)).a);
  float hide = uHide * (1.0 - smoothstep(0.12, 0.6, water));       // 굳으면 글이 숨고, 물 묻은 곳만 드러난다
  vec4 d = texture2D(uTex, uv);
  if (hide > 0.001) d = mix(d, texture2D(uTexB, uv), hide);
  g += (d.rg * 2.0 - 1.0) * 256.0 / (uR0 * uS) * uGain;
  vec3 n = normalize(vec3(-g, 1.0));
  vec3 ld = normalize(vec3(-0.52, -0.62, 0.66));
  float diff = pow(clamp(dot(n, ld) * 0.5 + 0.5, 0.0, 1.0), 1.7);
  vec3 alb = mix(vec3(0.905, 0.885, 0.85), vec3(0.705, 0.655, 0.585), uWet);
  alb *= 1.0 + (d.a - 0.5) * 0.07;
  if (uPhotoMix > 0.0) { vec3 ph = texture2D(uPhoto, fract(l * 0.5 + 0.5)).rgb; alb *= mix(1.0, dot(ph, vec3(0.3, 0.59, 0.11)) / 0.62, uPhotoMix); }
  alb = mix(alb, vec3(0.6, 0.555, 0.49), water * 0.8);              // 물 묻은 흙은 짙어진다
  alb = mix(alb, alb * vec3(1.07, 0.95, 0.85), uWarm * 0.5);
  float ao = clamp(1.0 + (d.b - 0.5) * 8.0 * 0.055 * uGain, 0.8, 1.04);
  vec3 col = alb * (0.36 + 0.82 * diff) * ao;
  col += pow(max(dot(n, normalize(ld + vec3(0.0, 0.0, 1.0))), 0.0), 30.0) * (0.09 * uWet + 0.16 * water);
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * a + shc * sh * (1.0 - a), a + sh * (1.0 - a)) * uAlpha;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
class Renderer {
  constructor(canvas, preserve) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: !!preserve });
    if (!gl) throw new Error('webgl');
    this.cv = canvas; this.gl = gl; this.amps = new Float32Array(12);
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS(hp && hp.precision > 0 ? 'highp' : 'mediump')));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uDpr', 'uC', 'uR0', 'uS', 'uH', 'uFlat', 'uK', 'uA', 'uP', 'uTex', 'uTexB', 'uWater', 'uHide', 'uWaterOn', 'uWaterAll', 'uPhoto', 'uPhotoMix', 'uL', 'uGain', 'uWet', 'uWarm', 'uAlpha']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1fv(this.u.uK, new Float32Array(KS)); gl.uniform1f(this.u.uL, L); gl.uniform1f(this.u.uPhotoMix, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const mkTex = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t; };
    this.photo = mkTex(1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([158, 158, 158, 255])); gl.uniform1i(this.u.uPhoto, 1);
    this.water = mkTex(3); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); gl.uniform1i(this.u.uWater, 3);
    this.texB = mkTex(2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.uniform1i(this.u.uTexB, 2);
    this.tex = mkTex(0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.uniform1i(this.u.uTex, 0);
  }
  setPhoto(img) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.photo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.uniform1f(this.u.uPhotoMix, 1); gl.activeTexture(gl.TEXTURE0);
  }
  size(w, h) { const W = Math.round(w * DPR), H = Math.round(h * DPR); if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; } }
  setWater(canvas) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.water);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.activeTexture(gl.TEXTURE0);
  }
  upload(rgba, [x, y, w, h], unit = 0) {   // unit 0: 전체 지도, unit 2: 글을 뺀 지도
    const gl = this.gl; gl.activeTexture(unit ? gl.TEXTURE2 : gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, unit ? this.texB : this.tex);
    if (w === N && h === N) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, rgba); gl.activeTexture(gl.TEXTURE0); return; }
    const sub = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) sub.set(rgba.subarray(((y + j) * N + x) * 4, ((y + j) * N + x + w) * 4), j * w * 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, sub);
    gl.activeTexture(gl.TEXTURE0);
  }
  draw(c, o) {
    const gl = this.gl, u = this.u, W = this.cv.width, H = this.cv.height, R = o.R0;
    gl.viewport(0, 0, W, H); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const ex = R * c.sx * 1.45 + 40, ey = R * c.sy * 1.45 + 48;
    const x0 = Math.max(0, Math.floor((o.cx - ex) * DPR)), x1 = Math.min(W, Math.ceil((o.cx + ex) * DPR));
    const yt = Math.max(0, Math.floor((o.cy - ey) * DPR)), yb = Math.min(H, Math.ceil((o.cy + ey) * DPR));
    if (x1 <= x0 || yb <= yt) return;
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, H - yb, x1 - x0, yb - yt);
    gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uDpr, DPR); gl.uniform2f(u.uC, o.cx, o.cy); gl.uniform1f(u.uR0, R); gl.uniform2f(u.uS, c.sx, c.sy);
    gl.uniform1f(u.uH, heightOf(c, R)); gl.uniform1f(u.uFlat, flatOf(c)); gl.uniform1fv(u.uA, ampsOf(c, this.amps)); gl.uniform1fv(u.uP, shapeOf(c).ph);
    gl.uniform1f(u.uGain, gainOf(c)); gl.uniform1f(u.uWet, o.wet); gl.uniform1f(u.uWarm, o.warm || 0); gl.uniform1f(u.uAlpha, o.alpha == null ? 1 : o.alpha);
    gl.uniform1f(u.uHide, o.hide || 0); gl.uniform1f(u.uWaterOn, o.waterTex ? 1 : 0); gl.uniform1f(u.uWaterAll, o.waterAll || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/* ───────── 갈라짐 · 잔금 ───────── */
function ensureCrack(c) {
  if (moist(c) > 0 || c.crack) return false;
  c.crack = { type: areaOf(c) >= 2.6 ? 'split' : 'craze', seed: ((c.seed + (c.dryN || 0) * 7919) >>> 0) };
  c.dryN = (c.dryN || 0) + 1;
  return true;
}
function genCracks(c) {
  const key = `${c.crack.seed}|${c.crack.type}|${c.sx.toFixed(3)}|${c.sy.toFixed(3)}`;
  if (c._ck && c._ckKey === key) return c._ck;
  const r = rng(c.crack.seed), amps = ampsOf(c, new Float32Array(12)), out = [];
  const walk = (x, y, dir, len, w, d, jit, st0) => {
    const pts = [[x, y]]; let s = 0;
    while (s < len) { const st = st0 * (.7 + r() * .6); dir += (r() - .5) * jit; x += Math.cos(dir) * st; y += Math.sin(dir) * st; s += st; pts.push([x, y]); }
    const cr = { pts, w, d }; out.push(cr); return cr;
  };
  if (c.crack.type === 'split') {   // 얇게 편 점토: 가장자리에서 안쪽으로 크게 갈라짐
    const n = 3 + ((r() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const th = r() * 6.283, e = edgeAt(c, th, amps);
      const cr = walk(Math.cos(th) * e, Math.sin(th) * e, th + Math.PI + (r() - .5) * .7, .45 + r() * .5, 1.8, k * .12, .55, .03);
      const nb = 1 + ((r() * 2) | 0);
      for (let b = 0; b < nb; b++) { const at = cr.pts[1 + ((r() * (cr.pts.length - 2)) | 0)]; walk(at[0], at[1], r() * 6.283, .1 + r() * .18, .9, k * .12 + .25, .8, .025); }
    }
    for (let k = 0; k < 6; k++) { const a = r() * 6.283, d = Math.sqrt(r()) * .8; walk(Math.cos(a) * d, Math.sin(a) * d, r() * 6.283, .05 + r() * .08, .55, .35 + r() * .3, 1.2, .018); }
  } else {                          // 두꺼운 점토: 그냥 굳고 잔금만
    for (let k = 0; k < 11; k++) { const a = r() * 6.283, d = Math.sqrt(r()) * .8; walk(Math.cos(a) * d, Math.sin(a) * d, r() * 6.283, .05 + r() * .1, .6, r() * .4, 1.3, .018); }
    for (let k = 0; k < 3; k++) { const th = r() * 6.283, e = edgeAt(c, th, amps); walk(Math.cos(th) * e, Math.sin(th) * e, th + Math.PI + (r() - .5) * .6, .08 + r() * .1, .95, .1 + k * .1, .6, .02); }
  }
  def(c, '_ck', out); def(c, '_ckKey', key);
  return out;
}
function outline(ctx, c, x0, y0, R) {
  const amps = ampsOf(c, tmpAmps);
  ctx.beginPath();
  for (let i = 0; i <= 240; i++) {
    const th = i / 240 * Math.PI * 2, e = edgeAt(c, th, amps), x = x0 + Math.cos(th) * e * R * c.sx, y = y0 + Math.sin(th) * e * R * c.sy;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function drawCracks(ctx, c, x0, y0, R, p, alpha, s = 1) {
  const list = genCracks(c);
  ctx.save(); outline(ctx, c, x0, y0, R * .995); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const cr of list) {
    const f = clamp(p * 1.6 - cr.d, 0, 1); if (f <= 0) continue;
    const n = Math.max(2, Math.ceil(cr.pts.length * f)), path = new Path2D();
    for (let i = 0; i < n; i++) { const X = x0 + cr.pts[i][0] * R * c.sx, Y = y0 + cr.pts[i][1] * R * c.sy; i ? path.lineTo(X, Y) : path.moveTo(X, Y); }
    const w = cr.w * s;
    ctx.save(); ctx.translate(.8 * s, .8 * s); ctx.strokeStyle = `rgba(255,251,244,${.7 * alpha})`; ctx.lineWidth = w * .9; ctx.stroke(path); ctx.restore();
    ctx.strokeStyle = `rgba(96,80,62,${.82 * alpha})`; ctx.lineWidth = w; ctx.stroke(path);
    if (cr.w > 1.2) { ctx.strokeStyle = `rgba(56,45,34,${.55 * alpha})`; ctx.lineWidth = w * .45; ctx.stroke(path); }
  }
  ctx.restore();
}

/* ───────── 상태 ───────── */
let clays = [], learned = {}, cur = null, view = 'work';
let W = 0, Hs = 0, maxH = 0, R0 = 90, cx = 0, cy = 0;
let workR = null, thumbR = null;
const mapFull = new ClayMap(), mapBase = new ClayMap();   // 작업 화면용(홈에서는 썸네일 만들 때 빌려 쓴다)
const NOWRITE = m => !isWriting(m);
let dirtyGL = true, fxDirty = true, lastWet = -1, warm = 0, rubbing = false, lastHide = -1;
let spawnT = 1, spawnStart = 0, spawnK = 1, crackAnim = null, particles = [];
let inputMode = 'draw';   // 노트북: 'draw' 마우스로 그리기 / 'type' 키보드로 쓰기
const glCv = $('#gl'), fx = $('#fx'), fctx = fx.getContext('2d');
const hintEl = $('#hint'), labelEl = $('#label'), typer = $('#typer');
const countOf = (c, t) => c.marks.reduce((s, x) => s + (x.t === t ? 1 : 0), 0);
const charsOf = c => c.marks.reduce((s, x) => s + (x.t === 'k' ? x.text.replace(/\s/g, '').length : 0), 0);
const hasWriting = c => c.marks.some(isWriting);
function writeSummary(c) {
  const g = countOf(c, 'g'), k = charsOf(c), parts = [];
  if (g) parts.push(`새김 ${g}획`); if (k) parts.push(`글자 ${k}자`);
  return parts.join(' · ');
}

/* ───────── 저장 ───────── */
const ser = c => ({ id: c.id, no: c.no, created: c.created, lt: c.lt, sx: r4(c.sx), sy: r4(c.sy), seed: c.seed, marks: c.marks, dryN: c.dryN, crack: c.crack, example: !!c.example });
function save() { try { localStorage.setItem(STORE, JSON.stringify(clays.map(ser))); } catch (e) { /* 저장 공간 없음 */ } }
let saveT = 0;
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };
function load() {
  try {
    const raw = localStorage.getItem(STORE); if (!raw) return null;
    const arr = JSON.parse(raw); if (!Array.isArray(arr)) return null;
    return arr.filter(c => c && c.id && Array.isArray(c.marks) && c.sx && c.sy).map(c => ({ ...c, v: 1 }));
  } catch (e) { return null; }
}
function loadLearned() { try { learned = JSON.parse(localStorage.getItem(LEARN) || '{}') || {}; } catch (e) { learned = {}; } }
function learn(k) { if (learned[k]) return; learned[k] = true; try { localStorage.setItem(LEARN, JSON.stringify(learned)); } catch (e) { /* 무시 */ } }

/* ───────── 점토 만들기 ───────── */
function printMark(u, v, kx, ky, D, rot, g) {
  return { t: 'p', u: r4(u), v: r4(v), kx: r4(kx), ky: r4(ky), A: r4(15 + Math.random() * 2), B: r4(19 + Math.random() * 2.4), r: r4(rot), D: r4(D), g: r4(g), s: rint() };
}
function newClay() {
  const no = clays.reduce((m, c) => Math.max(m, c.no || 0), 0) + 1, t = now();
  const c = { id: 'c' + t.toString(36) + rint().toString(36), no, created: t, lt: t, sx: 1, sy: 1, seed: rint(), marks: [], dryN: 0, crack: null, example: false, v: 1 };
  const a = Math.random() * 6.283;  // 반죽에서 떼어낸 자리의 엄지 자국
  c.marks.push(printMark(Math.cos(a) * .5, Math.sin(a) * .5, R0, R0, 1.7, a + Math.PI / 2, 1));
  return c;
}

// 예시 점토에 새길 손글씨 (글자 칸 0~1 좌표로 그린 획)
const GLYPHS = {
  '통': [[[.26, .07], [.74, .06]], [[.27, .07], [.27, .33], [.75, .34]], [[.28, .2], [.68, .2]], [[.5, .41], [.5, .53]], [[.13, .55], [.87, .54]], 'o.5,.79,.15'],
  '영': ['o.32,.3,.17', [[.72, .04], [.72, .6]], [[.54, .22], [.72, .22]], [[.54, .4], [.72, .4]], 'o.52,.8,.15'],
};
function glyphStrokes(ch, bx, by, size, r) {
  const out = [];
  for (const s of GLYPHS[ch]) {
    let pts;
    if (typeof s === 'string') {
      const [gx, gy, gr] = s.slice(1).split(',').map(Number), a0 = -1.9 + r() * .3;
      pts = Array.from({ length: 19 }, (_, i) => { const a = a0 + i / 17 * 6.283 * 1.04; return [gx + Math.cos(a) * gr * (1 + (r() - .5) * .08), gy + Math.sin(a) * gr * .95]; });
    } else pts = s;
    out.push(pts.map(([x, y]) => [bx + (x - .5) * size + (r() - .5) * 1.4, by + (y - .5) * size + (r() - .5) * 1.4]));
  }
  return out;
}
function scribble(x0, x1, y, r) {   // 흘려 쓴 글씨처럼 보이는 줄
  const pts = []; for (let x = x0; x <= x1; x += 3) pts.push([x, y + Math.sin(x * .42 + r() * .4) * 3.2 + Math.sin(x * .13) * 1.5 + (r() - .5) * .8]);
  return pts;
}
function makeExamples() {
  const day = 864e5, t = now();
  const spec = [
    { no: 1, seed: 1201, sx: 1.9, sy: 1.3, prints: 7, smears: 3, ago: 3.2 * day },
    { no: 2, seed: 2402, sx: 1, sy: 1, prints: 11, smears: 2, ago: 1.6 * day },
    { no: 3, seed: 3603, sx: 1.8, sy: 1.7, prints: 5, smears: 4, ago: .4 * day },
  ];
  return spec.map(s => {
    const r = rng(s.seed), area = s.sx * s.sy, gA = Math.pow(area, .35), kx = R0 * s.sx, ky = R0 * s.sy;
    const c = { id: 'ex' + s.no, no: s.no, created: t - s.ago, lt: t - s.ago + 6e4, sx: s.sx, sy: s.sy, seed: s.seed, marks: [], dryN: 0, crack: null, example: true, v: 1 };
    for (let i = 0; i < s.prints; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * .74, early = r() < .5, g = early ? 1 : gA;
      c.marks.push({ t: 'p', u: r4(Math.cos(a) * d), v: r4(Math.sin(a) * d), kx: R0 * (early ? 1 : s.sx), ky: R0 * (early ? 1 : s.sy), A: 15 + r() * 2, B: 19 + r() * 2.4, r: (r() - .5) * 1.2 - .2, D: (1.2 + r() * .8) * g, g, s: (r() * 1e9) | 0 });
    }
    for (let i = 0; i < s.smears; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * .6, dir = r() * 6.283, len = (20 + r() * 30) / kx, u = Math.cos(a) * d, v = Math.sin(a) * d;
      c.marks.push({ t: 's', u0: u, v0: v, u1: u + Math.cos(dir) * len, v1: v + Math.sin(dir) * len, kx, ky, W: 9.5, D: 1.2 * gA });
    }
    let strokes = [];
    if (s.no === 1) {            // 장보기 체크리스트
      [-30, 0, 30].forEach((y, i) => {
        const bx = -R0 * s.sx * .52;
        strokes.push([[bx, y - 6], [bx + 12, y - 6.5], [bx + 12.5, y + 6], [bx - .5, y + 6.5], [bx, y - 6]]);
        if (i < 2) strokes.push([[bx + 2, y], [bx + 6, y + 5], [bx + 15, y - 9]]);
        strokes.push(scribble(bx + 24, bx + 24 + 70 + r() * 50, y, r));
      });
    } else if (s.no === 3) {     // '통영' + 물결
      strokes = [...glyphStrokes('통', -25, -18, 46, r), ...glyphStrokes('영', 25, -18, 46, r)];
      const w = []; for (let x = -62; x <= 62; x += 3) w.push([x, 30 + Math.sin(x * .16) * 5]);
      strokes.push(w);
    }
    for (const st of strokes) c.marks.push({ t: 'g', pts: st.map(([x, y]) => [r4(x / kx), r4(y / ky)]), kx, ky, W: 2.5, D: 1.9 * gA });
    ensureCrack(c);
    return c;
  });
}

/* ───────── 화면 크기 ───────── */
const sxMax = () => Math.max(1, Math.min(2.6, (W - 32) / (2 * R0 * 1.08)));
const syMax = () => Math.max(1, Math.min(3, (maxH * .62) / (2 * R0 * 1.08)));
let waterCv = document.createElement('canvas'), wctx = waterCv.getContext('2d'), waterUntil = 0;
const WS = 1 / 3;   // 물 자국 지도는 화면의 1/3 해상도
function layout() {
  W = innerWidth; Hs = innerHeight; maxH = Math.max(maxH, Hs);
  R0 = clamp(Math.min(W, maxH) * .22, 72, 112);
  cx = W / 2; cy = Hs * .46;
  workR.size(W, Hs);
  fx.width = Math.round(W * DPR); fx.height = Math.round(Hs * DPR);
  waterCv.width = Math.max(1, Math.round(W * WS)); waterCv.height = Math.max(1, Math.round(Hs * WS)); waterUntil = 0;
  if (cur) setSpread(cur, cur.sx, cur.sy);
  dirtyGL = true; fxDirty = true;
}
function setSpread(c, sx, sy) {
  const was = writable(c);
  sx = clamp(sx, 1, Math.max(1, sxMax())); sy = clamp(sy, 1, Math.max(1, syMax()));
  if (hasWriting(c) && sx * sy < WRITE_AREA) return;               // 새긴 뒤에는 다시 덩어리로 못 오므린다
  c.sx = sx; c.sy = sy;
  if (!was && writable(c)) { buzz(12); learn('spread'); if (view === 'work') toast('이제 새길 수 있어요'); }
  c.v++; dirtyGL = true;
}

/* ───────── 작업 화면: 만지기 ───────── */
function toLocal(x, y) { const k = R0 * spawnK; return [(x - cx) / (k * cur.sx), (y - cy) / (k * cur.sy)]; }
function rAt(x, y) { const [u, v] = toLocal(x, y); return rLocal(cur, u, v, ampsOf(cur, tmpAmps)); }
const depthFactor = c => .45 + .55 * smooth(0, .35, moist(c));   // 꾸덕해질수록 얕게 찍힌다

function trimMarks(c) {
  while (c.marks.length > MAX_MARKS) { const i = c.marks.findIndex(m => !isWriting(m)); if (i < 0) break; c.marks.splice(i, 1); }
}
const upFull = rect => { if (rect) { workR.upload(mapFull.rgba, rect, 0); dirtyGL = true; } };
const upBase = rect => { if (rect) { workR.upload(mapBase.rgba, rect, 2); dirtyGL = true; } };
function stampLive(m) { upFull(mapFull.add(m)); if (!isWriting(m)) upBase(mapBase.add(m)); }
function addMark(m) {
  const c = cur; c.marks.push(m); trimMarks(c);
  stampLive(m);
  c.lt = now(); c.v++; saveSoon();
}
function pressAt(x, y, D) {
  const c = cur, [u, v] = toLocal(x, y), g = Math.pow(areaOf(c), .35);
  const m = printMark(u, v, R0 * c.sx, R0 * c.sy, D * g * depthFactor(c), (Math.random() - .5) - .2, g);
  addMark(m); learn('print');
  return m;
}
function deepen(m, D) { m.D = r4(Math.max(m.D, D * m.g * depthFactor(cur))); stampLive(m); saveSoon(); }
function smearSeg(x0, y0, x1, y1) {
  const c = cur, [u0, v0] = toLocal(x0, y0), [u1, v1] = toLocal(x1, y1), amps = ampsOf(c, tmpAmps);
  if (rLocal(c, u0, v0, amps) > 1 || rLocal(c, u1, v1, amps) > 1) return;
  const g = Math.pow(areaOf(c), .35);
  addMark({ t: 's', u0: r4(u0), v0: r4(v0), u1: r4(u1), v1: r4(v1), kx: r4(R0 * c.sx), ky: r4(R0 * c.sy), W: r4(9 + Math.random() * 2), D: r4(1.15 * g * depthFactor(c)) });
}

// 그려서 새기기: 손떨림을 걸러낸 점을 따라 홈을 판다
function strokeBegin(x, y) {
  const c = cur, g = Math.pow(areaOf(c), .35), [u, v] = toLocal(x, y);
  const m = { t: 'g', pts: [[r4(u), r4(v)]], kx: r4(R0 * c.sx), ky: r4(R0 * c.sy), W: 2.5, D: r4(1.9 * g * depthFactor(c)) };
  c.marks.push(m); c.lt = now(); c.v++;
  upFull(mapFull.encode(grooveSeg(mapFull.H, m.pts[0], m.pts[0], m.kx, m.ky, m.W, m.D)));
  return { m, sx: x, sy: y, ex: x, ey: y };
}
function strokePoint(st, x, y) {
  const [u, v] = toLocal(x, y);
  if (rLocal(cur, u, v, ampsOf(cur, tmpAmps)) > .97) return false;    // 점토 밖으로 나가면 획을 끊는다
  const P = st.m.pts, a = P[P.length - 1], b = [r4(u), r4(v)];
  P.push(b); st.ex = x; st.ey = y;
  upFull(mapFull.encode(grooveSeg(mapFull.H, a, b, st.m.kx, st.m.ky, st.m.W, st.m.D)));
  cur.lt = now(); cur.v++;
  return true;
}
function strokeMove(st, x, y, final) {
  const k = final ? 1 : .3;                                 // 보정: 손가락 위치를 부드럽게 따라간다
  st.sx += (x - st.sx) * k; st.sy += (y - st.sy) * k;
  if (Math.hypot(st.sx - st.ex, st.sy - st.ey) >= (final ? .5 : 3)) {
    if (!strokePoint(st, st.sx, st.sy)) return null;
  }
  return st;
}

// 키보드로 쓰기 (노트북): 클릭한 자리에 글자가 도장처럼 찍힌다
let typing = null;
function startTyping(x, y) {
  const c = cur, [u, v] = toLocal(x, y), g = Math.pow(areaOf(c), .35);
  const m = { t: 'k', text: '', u: r4(u), v: r4(v), kx: r4(R0 * c.sx), ky: r4(R0 * c.sy), fs: 22, D: r4(1.8 * g * depthFactor(c)) };
  c.marks.push(m);
  typing = { m, snap: mapFull.H.slice(), rect: null };
  typer.value = ''; placeTyper();
  try { typer.focus({ preventScroll: true }); } catch (_) { typer.focus(); }
  learn('write'); fxDirty = true;
}
function restoreRect(H, snap, [x, y, w, h]) { for (let j = y; j < y + h; j++) H.set(snap.subarray(j * N + x, j * N + x + w), j * N + x); }
function typeUpdate() {
  const t = typing; if (!t || !cur) return;
  t.m.text = typer.value.slice(0, 120);
  if (t.rect) restoreRect(mapFull.H, t.snap, t.rect);
  const r = stampText(mapFull.H, t.m), all = r ? unite(t.rect, r) : t.rect;
  t.rect = r ? unite(t.rect, r) : t.rect;
  if (all) upFull(mapFull.encode(all));
  cur.lt = now(); cur.v++; fxDirty = true; placeTyper(); saveSoon();
}
function endTyping() {
  const t = typing; if (!t) return;
  typing = null; typer.blur();
  if (!t.m.text.trim()) {
    const i = cur.marks.indexOf(t.m); if (i >= 0) cur.marks.splice(i, 1);
    if (t.rect) { restoreRect(mapFull.H, t.snap, t.rect); upFull(mapFull.encode(t.rect)); }
  }
  fxDirty = true; saveSoon();
}
function caretPos() {
  const t = typing; if (!t) return null;
  const lay = textLayout(t.m), kx = (R0 * cur.sx) / t.m.kx, ky = (R0 * cur.sy) / t.m.ky;
  const x0 = cx + t.m.u * R0 * cur.sx, y0 = cy + t.m.v * R0 * cur.sy;
  const last = lay.lines.length - 1;
  return { x: x0 + lay.widths[last] * kx + 2, y: y0 + (lay.top + last * lay.lh) * ky, h: t.m.fs * ky };
}
function placeTyper() { const p = caretPos(); if (p) { typer.style.left = p.x + 'px'; typer.style.top = p.y + 'px'; } }
typer.addEventListener('input', typeUpdate);
typer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); endTyping(); } });
typer.addEventListener('blur', () => { if (typing) endTyping(); });

// 물 묻히기: 문지른 자리만 젖어서 숨은 글이 드러나고, 몇 초 뒤 다시 마른다
function paintWater(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(0,0,0,.42)'); g.addColorStop(.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function wetStroke(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i <= n; i++) paintWater(wctx, lerp(x0, x1, i / n) * WS, lerp(y0, y1, i / n) * WS, 30 * WS);
  waterUntil = performance.now() + 7000; dirtyGL = true;
  if (!learned.water && moist(cur) === 0) { learn('water'); }
}
function dryWater(ctx, w, h, a) {
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
}

function startErase(g) {
  const c = cur;
  if (c.marks.length > g.m0) {                                     // 문지르기 전에 생긴 획·자국은 없던 일로
    c.marks.splice(g.m0);
    workR.upload(mapFull.rgba, mapFull.build(c), 0);
    workR.upload(mapBase.rgba, mapBase.build(c, NOWRITE), 2);
  }
  g.stroke = null; g.ended = true;
  const m = { t: 'e', pts: g.trail.map(([x, y]) => toLocal(x, y).map(r4)), kx: r4(R0 * c.sx), ky: r4(R0 * c.sy), W: 15 };
  c.marks.push(m); stampLive(m);
  g.erase = m; g.ex = g.trail[g.trail.length - 1][0]; g.ey = g.trail[g.trail.length - 1][1];
  c.lt = now(); c.v++; buzz(8);
}
function eraseTo(g, x, y) {
  if (Math.hypot(x - g.ex, y - g.ey) < 4) return;
  const m = g.erase, P = m.pts, a = P[P.length - 1], b = toLocal(x, y).map(r4);
  P.push(b); g.ex = x; g.ey = y;
  upFull(mapFull.erase(a, b, m)); upBase(mapBase.erase(a, b, m));
  if (Math.random() < .2) dust(x, y, 1, '170,158,140');
  cur.lt = now(); cur.v++;
}
function finishErase(g) {
  const c = cur, m = g.erase, rx = R0 * c.sx, ry = R0 * c.sy;
  // 완전히 메워진 획은 목록에서도 뺀다
  const covered = ([u, v]) => m.pts.some(([eu, ev]) => Math.hypot((u - eu) * rx, (v - ev) * ry) < m.W * .85);
  c.marks = c.marks.filter(k => !(k.t === 'g' && k.pts.every(covered)));
  if (!learned.erase) toast('문질러서 메웠어요');
  learn('erase'); saveSoon();
}
function dust(x, y, n, rgb) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - .5) * 130, vy: -Math.random() * 90 - 10, life: 1, s: .8 + Math.random() * 1.6, rgb });
  fxDirty = true;
}
function warmBy(gain) {
  const m0 = moist(cur), m1 = Math.min(1, m0 + gain);
  cur.lt = now() - (1 - m1) * CONFIG.dryMs;
  warm = Math.min(1, warm + gain * 5); rubbing = true; dirtyGL = true;
  if (m0 < .35 && m1 >= .35) { toast('다시 말랑해졌어요'); learn('rub'); buzz(15); }
}
function endWarm() {
  rubbing = false;
  if (moist(cur) > .25 && cur.crack) { cur.crack = null; cur.v++; }
  saveSoon();
}

/* 제스처
   폰   — 한 손가락: 톡/꾹 = 지문, 펼친 점토 위에서 긋기 = 새기기, 덩어리 위에서 긋기 = 엄지 자국
          두 손가락: 벌려서 펼치기
          굳은 점토: 한 손가락으로 문지르기 = 물 묻혀 글 보기, 여러 손가락으로 감싸기 = 데워서 말랑하게
   노트북 — 클릭 = 지문, 가장자리 끌기 = 늘리기, 안쪽 드래그 = 새기기(또는 클릭 후 타이핑)
          굳은 점토: 문지르기 = 물 묻혀 글 보기, 꾹 누르고 있기 = 데워서 말랑하게 */
const stage = $('#stage'), pts = new Map();
let gest = null;
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('pointerdown', e => {
  if (view !== 'work' || !cur) return;
  if (typing) { e.preventDefault(); endTyping(); }
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  const p = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), touch: e.pointerType === 'touch' };
  pts.set(e.pointerId, p);
  const dry = moist(cur) === 0;
  if (pts.size === 1) {
    const r = rAt(p.x, p.y);
    if (!p.touch && r > .88 && r < 1.2 && !dry) { gest = { type: 'edge', id: e.pointerId, sx0: cur.sx, sy0: cur.sy, moved: 0, inside: r <= 1 }; return; }
    if (r > 1) { gest = { type: 'none', id: e.pointerId }; return; }
    if (dry) {
      gest = { type: 'wet', id: e.pointerId, moved: 0, lx: p.x, ly: p.y, hold: false };
      gest.timer = setTimeout(() => { if (gest && gest.type === 'wet' && gest.moved < 6) gest.hold = true; }, 450);
      return;
    }
    gest = { type: 'press', id: e.pointerId, moved: 0, lx: p.x, ly: p.y, mark: null,      // 지문은 손을 뗄 때 찍힌다(움직이면 새기기)
      ax: p.x, ay: p.y, revs: [], trail: [[p.x, p.y]], m0: cur.marks.length };
    return;
  }
  // 두 손가락 이상
  if (gest && gest.timer) clearTimeout(gest.timer);
  if (gest && gest.type === 'wet' && gest.hold) endWarm();
  const list = [...pts.values()], anyOn = list.some(q => rAt(q.x, q.y) <= 1.05);
  if (!anyOn) { gest = { type: 'none' }; return; }
  if (dry) { gest = { type: 'warm' }; return; }                 // 굳은 점토: 여러 손가락으로 감싸 데우기
  if (pts.size === 2) {
    const ids = [...pts.keys()], a = pts.get(ids[0]), b = pts.get(ids[1]);
    gest = { type: 'pinch', ids, ux0: Math.abs(b.x - a.x), uy0: Math.abs(b.y - a.y), d0: Math.hypot(b.x - a.x, b.y - a.y), sx0: cur.sx, sy0: cur.sy };
  }
});
stage.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) { hoverCursor(e); return; }
  p.x = e.clientX; p.y = e.clientY;
  if (!gest) return;
  if (gest.type === 'pinch') {                             // 두 손가락으로 벌리면 그 방향으로 펴진다
    const a = pts.get(gest.ids[0]), b = pts.get(gest.ids[1]); if (!a || !b) return;
    const k = 2 * R0, iso = .45 * (Math.hypot(b.x - a.x, b.y - a.y) - gest.d0) / k;
    setSpread(cur, gest.sx0 + (Math.abs(b.x - a.x) - gest.ux0) / k + iso, gest.sy0 + (Math.abs(b.y - a.y) - gest.uy0) / k + iso);
    cur.lt = now();
    return;
  }
  if (e.pointerId !== gest.id) return;
  gest.moved = Math.max(gest.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
  if (gest.type === 'edge') {                              // 마우스: 가장자리를 잡고 바깥으로 끌면 늘어난다
    if (gest.moved < 4) return;
    const ox = p.x0 - cx, oy = p.y0 - cy, ol = Math.hypot(ox, oy) || 1, dx = ox / ol, dy = oy / ol;
    const amt = (p.x - p.x0) * dx + (p.y - p.y0) * dy, iso = .2 * amt / R0;
    setSpread(cur, gest.sx0 + amt * Math.abs(dx) / R0 + iso, gest.sy0 + amt * Math.abs(dy) / R0 + iso);
    cur.lt = now(); gest.stretched = true;
    return;
  }
  if (gest.type === 'press') {
    if (gest.moved < 6) return;
    clearTimeout(gest.timer);
    // 왔다 갔다 문지르면 → 메우기(지우기)로 바뀐다
    const sd = Math.hypot(p.x - gest.ax, p.y - gest.ay), tnow = performance.now();
    if (sd >= 6) {
      const dx = (p.x - gest.ax) / sd, dy = (p.y - gest.ay) / sd;
      if (gest.pdx !== undefined && dx * gest.pdx + dy * gest.pdy < -.3) gest.revs.push(tnow);
      gest.pdx = dx; gest.pdy = dy; gest.ax = p.x; gest.ay = p.y; gest.trail.push([p.x, p.y]);
    }
    gest.revs = gest.revs.filter(t => tnow - t < 650);
    if (!gest.erase && gest.revs.length >= 3) startErase(gest);
    if (gest.erase) { eraseTo(gest, p.x, p.y); return; }
    const drawMode = p.touch || inputMode === 'draw';
    if (drawMode && !writable(cur)) {                      // 덜 펼친 덩어리: 엄지로 민 자국만 남는다
      if (Math.hypot(p.x - gest.lx, p.y - gest.ly) >= 7) { smearSeg(gest.lx, gest.ly, p.x, p.y); gest.lx = p.x; gest.ly = p.y; }
      if (!gest.told && gest.moved > 40) { gest.told = true; toast(COARSE ? '두 손가락으로 조금만 펼치면 새길 수 있어요' : '가장자리를 끌어 조금만 펼치면 새길 수 있어요'); }
    } else if (drawMode) {                                 // 펼친 점토: 긋는 대로 새겨진다
      if (!gest.stroke && !gest.ended) { gest.stroke = strokeBegin(p.x0, p.y0); learn('write'); }
      if (gest.stroke) { gest.stroke = strokeMove(gest.stroke, p.x, p.y, false); if (!gest.stroke) gest.ended = true; }
    } else if (Math.hypot(p.x - gest.lx, p.y - gest.ly) >= 7) { // 그 밖에는 엄지로 민 자국
      smearSeg(gest.lx, gest.ly, p.x, p.y); gest.lx = p.x; gest.ly = p.y;
    }
    return;
  }
  if (gest.type === 'wet' && !gest.hold) {                 // 굳은 점토 문지르기 → 물이 묻는다
    if (Math.hypot(p.x - gest.lx, p.y - gest.ly) < 2) return;
    clearTimeout(gest.timer);
    wetStroke(gest.lx, gest.ly, p.x, p.y); gest.lx = p.x; gest.ly = p.y;
  }
});
function endPtr(e, cancel) {
  const p = pts.get(e.pointerId); if (!p) return;
  pts.delete(e.pointerId);
  if (!gest) return;
  const g = gest;
  if (g.type === 'pinch' || g.type === 'warm') {
    if (g.type === 'warm' && pts.size < 2) endWarm();
    gest = pts.size ? { type: 'none' } : null; saveSoon(); return;
  }
  if (e.pointerId !== g.id) { if (!pts.size) gest = null; return; }
  gest = pts.size ? { type: 'none' } : null;
  clearTimeout(g.timer);
  const dur = performance.now() - p.t0;
  if (g.type === 'wet' && g.hold) endWarm();
  if (cancel) return;
  if (g.type === 'press') {
    if (g.erase) { finishErase(g); return; }
    if (g.stroke) { strokeMove(g.stroke, p.x, p.y, true); saveSoon(); return; }
    if (g.moved < 6) {
      if (!p.touch && inputMode === 'type' && dur < 350) {                                                    // 클릭한 자리에 쓰기 시작
        if (writable(cur)) { startTyping(p.x0, p.y0); return; }
        toast('가장자리를 끌어 조금만 펼치면 새길 수 있어요');
      }               // 클릭한 자리에 쓰기 시작 (꾹 누르면 지문)
      if (!g.mark) g.mark = pressAt(p.x0, p.y0, 1.25);                                                         // 톡 = 지문
      if (dur > 230) deepen(g.mark, 1.25 + Math.min(dur, 900) / 900 * 1.1);                                    // 오래 누를수록 깊게
    }
    saveSoon();
  } else if (g.type === 'edge') {
    if (!g.stretched && g.inside) { const m = pressAt(p.x0, p.y0, 1.25); if (dur > 230) deepen(m, 1.25 + Math.min(dur, 900) / 900 * 1.1); }
    saveSoon();
  } else if (g.type === 'wet' && !g.hold && g.moved < 6 && dur < 300) {
    dust(p.x, p.y, 7, '232,227,218');
    toast('굳었어요 · 문지르면 물이 묻어 글이 보여요');
  }
}
stage.addEventListener('pointerup', e => endPtr(e, false));
stage.addEventListener('pointercancel', e => endPtr(e, true));
function hoverCursor(e) {
  if (e.pointerType !== 'mouse' || !cur || view !== 'work') return;
  const r = rAt(e.clientX, e.clientY), dry = moist(cur) === 0;
  stage.style.cursor = r > 1.2 ? 'default' : dry ? 'grab' : r > .88 ? 'move' : inputMode === 'type' ? 'text' : 'crosshair';
}

// 트랙패드 벌리기·휠로도 펼칠 수 있다
stage.addEventListener('wheel', e => {
  if (view !== 'work' || !cur || typing) return;
  e.preventDefault();
  if (moist(cur) === 0) { toast('굳어서 펴지지 않아요 · 꾹 누르고 있으면 말랑해져요'); return; }
  const d = -e.deltaY * (e.ctrlKey ? .01 : .0022);
  setSpread(cur, cur.sx + d, cur.sy + d * .8); cur.lt = now(); saveSoon();
}, { passive: false });

// 노트북: 새기는 방법 고르기
const modeEl = $('#mode');
function setInputMode(m) {
  inputMode = m === 'type' ? 'type' : 'draw';
  modeEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === inputMode)));
  try { localStorage.setItem(INPUT, inputMode); } catch (_) { /* 무시 */ }
  hintNow = null;
}
modeEl.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (typing) endTyping();
  setInputMode(b.dataset.mode);
  toast(inputMode === 'type' ? '새길 곳을 클릭하고 타이핑하세요 · 꾹 누르면 지문' : '드래그하면 그려서 새겨져요 · 클릭하면 지문');
});

/* ───────── 안내 문구 · 라벨 ───────── */
function hintText() {
  const c = cur; if (!c || typing) return '';
  const m = moist(c);
  if (m === 0) {
    if (hasWriting(c) && !learned.water) return '문질러서 물을 묻히면 숨은 글이 보여요';
    if (!learned.rub) return COARSE ? '여러 손가락으로 감싸고 있으면 다시 말랑해져요' : '꾹 누르고 있으면 체온으로 다시 말랑해져요';
    return '';
  }
  if (!learned.print) return '만져보세요';
  if (!writable(c)) return learned.write ? '' : COARSE ? '두 손가락으로 벌려 조금 펼치면 새길 수 있어요' : '가장자리를 잡고 끌어 조금 펼치면 새길 수 있어요';
  if (!learned.write) return COARSE ? '손가락으로 그으면 새겨져요' : inputMode === 'type' ? '새길 곳을 클릭하고 타이핑하세요' : '드래그하면 새겨져요';
  if (hasWriting(c) && !learned.erase) return '잘못 새긴 곳은 왔다 갔다 문지르면 메워져요';
  if (hasWriting(c) && !learned.dry) return `그대로 두면 ${CONFIG.dryMs / 1000}초 뒤에 굳고 글이 숨어요`;
  return '';
}
function labelText() {
  const c = cur, m = moist(c), n = countOf(c, 'p'), w = writeSummary(c);
  let st;
  if (typing) st = '쓰는 중';
  else if (rubbing) st = '데우는 중';
  else if (m === 0) st = c.crack && c.crack.type === 'split' ? '갈라짐' : '굳음';
  else if (m >= .55) st = '말랑함';
  else st = '꾸덕해지는 중';
  const left = m > 0 && !typing ? ` · 굳기까지 ${Math.ceil(m * CONFIG.dryMs / 1000)}초` : '';
  return `No.${String(c.no).padStart(2, '0')} · 지문 ${n}${w ? ` · ${w}` : ''} · ${st}${left}`;
}
let hintNow = null, hintT = 0;
function setHint(t) {
  if (t === hintNow) return; hintNow = t;
  hintEl.classList.add('fade'); clearTimeout(hintT);
  hintT = setTimeout(() => { hintEl.textContent = t; hintEl.classList.remove('fade'); }, RM ? 0 : 300);
}
const setLabel = t => { if (labelEl.textContent !== t) labelEl.textContent = t; };

/* ───────── 작업 화면 그리기 ───────── */
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
let lastLabel = 0, lastT = 0, waterOn = false;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (t - lastT) / 1000 || 0); lastT = t;
  if (view === 'home') { tickCards(dt); return; }
  if (!cur) return;
  const c = cur;
  if (typing) c.lt = now();
  if (gest && gest.type === 'warm' && pts.size >= 2) warmBy(dt * .05 * pts.size);   // 손가락이 많을수록 빨리 데워진다
  if (gest && gest.type === 'wet' && gest.hold) warmBy(dt * .2);                     // 꾹 누르고 있으면 체온이 전해진다
  const m = moist(c);
  if (m === 0 && ensureCrack(c)) {                           // 방금 굳었다
    crackAnim = RM ? null : { t0: t }; learn('dry'); buzz(20); c.v++; saveSoon(); fxDirty = true;
  }
  if (spawnT < 1) { spawnT = clamp((t - spawnStart) / 520, 0, 1); spawnK = Math.max(.02, easeOutBack(spawnT)); dirtyGL = true; } else spawnK = 1;
  if (warm > 0 && !(gest && (gest.type === 'warm' || gest.hold))) { warm = Math.max(0, warm - .02); dirtyGL = true; }
  // 물 자국: 천천히 마른다
  if (performance.now() < waterUntil) {
    dryWater(wctx, waterCv.width, waterCv.height, .012);
    workR.setWater(waterCv); waterOn = true; dirtyGL = true;
  } else if (waterOn) { wctx.clearRect(0, 0, waterCv.width, waterCv.height); waterOn = false; dirtyGL = true; }
  const wet = wetOf(m), hide = 1 - smooth(0, .3, m);          // 마를수록 글이 하얗게 묻힌다
  if (Math.abs(wet - lastWet) > .006 || Math.abs(hide - lastHide) > .01) dirtyGL = true;
  if (dirtyGL) {
    workR.draw(c, { cx, cy, R0: R0 * spawnK, wet, warm, hide, waterTex: waterOn });
    lastWet = wet; lastHide = hide; dirtyGL = false; fxDirty = true;
  }
  drawFx(t, m);
  if (t - lastLabel > 200) { lastLabel = t; setLabel(labelText()); setHint(hintText()); }
}
function drawFx(t, m) {
  const blink = !!typing;
  if (!fxDirty && !crackAnim && !particles.length && !blink) return;
  fxDirty = false;
  fctx.setTransform(DPR, 0, 0, DPR, 0, 0); fctx.clearRect(0, 0, W, Hs);
  const c = cur;
  if (c.crack) {
    let p = 1;
    if (crackAnim) { p = clamp((t - crackAnim.t0) / 1700, 0, 1); if (p >= 1) crackAnim = null; }
    const alpha = 1 - smooth(0, .25, m);
    if (alpha > 0) drawCracks(fctx, c, cx, cy, R0 * spawnK, p, alpha, 1);
  }
  if (blink && Math.floor(t / 530) % 2 === 0) {            // 키보드로 쓸 때 깜빡이는 커서
    const q = caretPos();
    if (q) { fctx.fillStyle = 'rgba(70,56,42,.75)'; fctx.fillRect(q.x, q.y + q.h * .08, 1.6, q.h * .9); }
  }
  if (particles.length) {
    particles = particles.filter(q => (q.life -= 1 / 45) > 0);
    for (const q of particles) {
      q.vy += 400 / 60; q.x += q.vx / 60; q.y += q.vy / 60;
      fctx.fillStyle = `rgba(${q.rgb},${q.life.toFixed(3)})`; fctx.beginPath(); fctx.arc(q.x, q.y, q.s, 0, Math.PI * 2); fctx.fill();
    }
  }
}

/* ───────── 화면 전환 ───────── */
function showView(v) {
  view = v;
  $('#work').classList.toggle('off', v !== 'work');
  $('#home').classList.toggle('off', v !== 'home');
  document.body.classList.toggle('at-home', v === 'home');
  if (v === 'work') { dirtyGL = true; fxDirty = true; } else if (!thumbBusy) pumpThumbs();
}
function openClay(c, { spawn = false } = {}) {
  cur = c;
  ensureCrack(c);
  workR.upload(mapFull.rgba, mapFull.build(c), 0);
  workR.upload(mapBase.rgba, mapBase.build(c, NOWRITE), 2);
  crackAnim = null; particles = []; warm = 0; rubbing = false; gest = null; pts.clear(); typing = null;
  wctx.clearRect(0, 0, waterCv.width, waterCv.height); waterUntil = 0; waterOn = false;
  spawnT = spawn && !RM ? 0 : 1; spawnStart = performance.now(); spawnK = spawnT < 1 ? .02 : 1;
  lastWet = -1; lastHide = -1; hintNow = null;
  showView('work');
  setLabel(labelText());
}
function goHome() {
  if (typing) endTyping();
  if (cur) cur.v++;
  save(); showView('home'); refreshHome();
}
$('#home-btn').addEventListener('click', goHome);

/* ───────── 홈: 점토 선반 ─────────
   새긴 글은 숨긴 채로 보여주고, 카드를 문질러 물을 묻힌 자리만 드러난다 */
const shelf = $('#shelf'), cards = new Map(), activeCards = new Set();
let cardW = 0, thumbQ = [], thumbBusy = false, homeT = 0, lastRemoved = null;
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = ms => { const d = new Date(ms); return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; };
const compCv = document.createElement('canvas'), compCtx = compCv.getContext('2d');

function refreshHome(force) {
  const list = [...clays].sort((a, b) => b.created - a.created);
  $('#count').textContent = `점토 ${list.length}개`;
  $('#empty').hidden = list.length > 0;
  for (const [id, el] of cards) if (!clays.some(c => c.id === id)) { el.remove(); cards.delete(id); }
  for (const c of list) shelf.appendChild(cardFor(c));
  const plate = shelf.querySelector('.plate');
  const w = plate ? Math.round(plate.clientWidth) : 160;
  if (w !== cardW) { cardW = w; force = true; }
  for (const c of list) {
    ensureCrack(c); updateCap(c);
    const el = cards.get(c.id), m = moist(c);
    const key = `${c.v}|${cardW}|${m > 0 ? Math.round(wetOf(m) * 8) : 'd'}`;
    if (force || el.dataset.key !== key) { el.dataset.key = key; queueThumb(c); }
  }
  clearTimeout(homeT);
  if (list.some(c => moist(c) > 0)) homeT = setTimeout(() => { if (view === 'home') refreshHome(); }, 2500);
}
function cardFor(c) {
  let el = cards.get(c.id);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'card'; el.tabIndex = 0; el.setAttribute('role', 'button'); el.dataset.id = c.id;
  el.innerHTML = '<div class="plate"><div class="squash"><canvas></canvas></div></div><div class="cap"><span class="no"></span><span class="first"></span></div>';
  el._hid = document.createElement('canvas'); el._rev = document.createElement('canvas'); el._mask = document.createElement('canvas');
  attachCard(el); cards.set(c.id, el);
  return el;
}
function updateCap(c) {
  const el = cards.get(c.id); if (!el) return;
  const m = moist(c), st = m > 0 ? '말랑' : (c.crack && c.crack.type === 'split' ? '갈라짐' : '굳음');
  const n = countOf(c, 'p'), w = writeSummary(c);
  el.querySelector('.no').textContent = `No.${pad2(c.no)} · ${fmtDate(c.created)} · ${st}`;
  const f = el.querySelector('.first');
  f.textContent = `${w || '새김 없음'} · 지문 ${n}${c.example ? ' (예시)' : ''}`;
  f.classList.toggle('none', !w);
  el.setAttribute('aria-label', `점토 No.${c.no}, ${w || '새김 없음'}, 지문 ${n}개. 문지르면 숨은 글이 보이고, 누르면 열기, 3초 길게 누르면 지우기`);
}
function queueThumb(c) { if (!thumbQ.includes(c)) thumbQ.push(c); if (!thumbBusy) pumpThumbs(); }
function pumpThumbs() {
  if (view !== 'home') { thumbBusy = false; return; }   // 작업 화면에서는 지도를 빌려 쓰지 않는다
  const c = thumbQ.shift();
  if (!c) { thumbBusy = false; return; }
  thumbBusy = true;
  try { renderThumb(c); } catch (e) { console.error(e); }
  setTimeout(pumpThumbs, 16);
}
function renderThumb(c) {
  const el = cards.get(c.id); if (!el || !clays.includes(c)) return;
  const w = cardW, px = Math.round(w * DPR);
  const k = Math.min((w * .43) / (R0 * 2.1), (w * .42) / (R0 * Math.max(c.sx, c.sy) * 1.1));
  const R = R0 * k, ccx = w / 2, ccy = w * .47, m = moist(c), wet = wetOf(m);
  thumbR.size(w, w);
  thumbR.upload(mapFull.rgba, mapFull.build(c), 0);
  thumbR.upload(mapBase.rgba, mapBase.build(c, NOWRITE), 2);
  const snap = (target, o) => {
    thumbR.draw(c, { cx: ccx, cy: ccy, R0: R, wet, warm: 0, ...o });
    target.width = px; target.height = px;
    const ctx = target.getContext('2d'); ctx.drawImage(thumbR.cv, 0, 0);
    if (c.crack && m === 0) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawCracks(ctx, c, ccx, ccy, R, 1, o.waterAll ? .55 : 1, Math.max(.5, k * 1.4)); }
  };
  snap(el._hid, { hide: 1 });                     // 평소: 글이 숨은 모습
  snap(el._rev, { hide: 0, waterAll: 1 });        // 물 묻은 모습: 글이 드러남
  el._mask.width = Math.round(w / 2); el._mask.height = Math.round(w / 2);
  el._w = w;
  composeCard(el);
}
function composeCard(el) {
  const cv = el.querySelector('canvas'), px = el._hid.width;
  if (!px) return;
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, px, px); ctx.drawImage(el._hid, 0, 0);
  if (!activeCards.has(el)) return;
  if (compCv.width !== px) { compCv.width = px; compCv.height = px; }
  compCtx.globalCompositeOperation = 'source-over'; compCtx.clearRect(0, 0, px, px); compCtx.drawImage(el._rev, 0, 0);
  compCtx.globalCompositeOperation = 'destination-in'; compCtx.drawImage(el._mask, 0, 0, px, px);
  compCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(compCv, 0, 0);
}
function wetCard(el, x0, y0, x1, y1) {
  if (!el._w) return;
  const mctx = el._mask.getContext('2d'), s = el._mask.width / el._w, d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 5));
  for (let i = 1; i <= n; i++) paintWater(mctx, lerp(x0, x1, i / n) * s, lerp(y0, y1, i / n) * s, el._w * .11 * s);
  el._until = performance.now() + 7000; activeCards.add(el); learn('water');
}
function tickCards() {
  if (!activeCards.size) return;
  const t = performance.now();
  for (const el of activeCards) {
    dryWater(el._mask.getContext('2d'), el._mask.width, el._mask.height, .012);
    if (t > el._until || !el.isConnected) { activeCards.delete(el); el._mask.getContext('2d').clearRect(0, 0, el._mask.width, el._mask.height); }
    composeCard(el);
  }
}
function attachCard(el) {
  let st = null;
  const sq = () => el.querySelector('.squash');
  const local = e => { const r = el.querySelector('.plate').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const stopHold = () => { if (!st || !st.raf) return; cancelAnimationFrame(st.raf); st.raf = 0; const s = sq(); s.style.transition = ''; s.style.transform = ''; };
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const [lx, ly] = local(e);
    st = { x: e.clientX, y: e.clientY, lx, ly, t0: performance.now(), raf: 0, buzzed: false, moved: false };
    const loop = () => {                                     // 3초 꾹 누르면 납작해지며 지워진다
      if (!st || !st.raf) return;
      const p = clamp((performance.now() - st.t0 - 250) / 2750, 0, 1), s = sq();
      s.style.transition = 'none'; s.style.transform = `scale(${1 + .5 * p}, ${1 - .78 * p})`;
      if (p > 0 && !st.buzzed) { st.buzzed = true; buzz(10); }
      if (p >= 1) { st = null; removeClay(el.dataset.id, el); return; }
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  });
  el.addEventListener('pointermove', e => {
    if (!st) return;
    if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) { st.moved = true; stopHold(); }
    if (st.moved) { const [lx, ly] = local(e); wetCard(el, st.lx, st.ly, lx, ly); st.lx = lx; st.ly = ly; composeCard(el); }   // 문지르면 물이 묻는다
  });
  el.addEventListener('pointerup', () => { if (!st) return; const s = st; stopHold(); st = null; if (!s.moved && performance.now() - s.t0 < 400) openById(el.dataset.id); });
  el.addEventListener('pointercancel', () => { stopHold(); st = null; });
  el.addEventListener('pointerleave', () => { stopHold(); st = null; });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openById(el.dataset.id); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeClay(el.dataset.id, el); }
  });
}
function openById(id) { const c = clays.find(x => x.id === id); if (c) openClay(c); }
function removeClay(id, el) {
  const i = clays.findIndex(c => c.id === id); if (i < 0) return;
  const c = clays[i];
  clays.splice(i, 1); cards.delete(id); activeCards.delete(el); save(); buzz(30);
  el.classList.add('dying');
  setTimeout(() => { el.remove(); refreshHome(); }, RM ? 0 : 420);
  lastRemoved = c;
  toast('납작하게 눌러 지웠어요', '되돌리기', () => {
    if (!lastRemoved) return;
    clays.push(lastRemoved); lastRemoved = null; save(); refreshHome();
  });
}

/* ───────── 홈: 반죽에서 떼어내기 ───────── */
const dough = $('#dough'), doughCv = $('#dough-cv'), piece = $('#piece');
function renderBlob(target, size, R, cyRatio, c) {
  thumbR.size(size, size);
  thumbR.upload(mapFull.rgba, mapFull.build(c), 0);
  thumbR.draw(c, { cx: size / 2, cy: size * cyRatio, R0: R, wet: 1, warm: 0 });
  target.width = Math.round(size * DPR); target.height = Math.round(size * DPR);
  target.getContext('2d').drawImage(thumbR.cv, 0, 0);
}
function renderDough() {
  renderBlob(doughCv, 280, 98, .56, { seed: 777, sx: 1.18, sy: 1, marks: [] });
  renderBlob(piece, 96, 30, .48, { seed: 4242, sx: 1, sy: 1, marks: [] });
}
const placePiece = (x, y, s) => { piece.style.transform = `translate(${x - 48}px, ${y - 46}px) scale(${s})`; };
let pull = null;
dough.addEventListener('pointerdown', e => {
  try { dough.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  pull = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false };
  dough.classList.add('pull'); piece.classList.remove('fly');
});
dough.addEventListener('pointermove', e => {
  if (!pull || e.pointerId !== pull.id) return;
  pull.x = e.clientX; pull.y = e.clientY;
  const dy = pull.y0 - pull.y, s = clamp(dy / 120, 0, 1);
  doughCv.style.transform = `translate(${(pull.x - pull.x0) * .08}px, ${-s * 10}px) scale(${1 - s * .04}, ${1 + s * .06})`;
  if (dy > 26 && !pull.on) { pull.on = true; piece.classList.add('on'); buzz(8); }
  if (pull.on) placePiece(pull.x, pull.y, clamp(.55 + dy / 220, .55, 1));
});
function endPull(e, cancel) {
  if (!pull || e.pointerId !== pull.id) return;
  const p = pull; pull = null;
  dough.classList.remove('pull'); doughCv.style.transform = '';
  const dy = p.y0 - p.y;
  if (!cancel && p.on && dy > 80) { tearOff(); return; }
  piece.classList.remove('on');
  if (!cancel && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) toast('반죽을 위로 끌어 떼어내세요');
}
dough.addEventListener('pointerup', e => endPull(e, false));
dough.addEventListener('pointercancel', e => endPull(e, true));
dough.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tearOff(); } });
function tearOff() {
  const c = newClay(); clays.push(c); save(); buzz(14);
  piece.classList.add('on'); void piece.offsetWidth;
  piece.classList.add('fly'); placePiece(W / 2, cy, R0 / 30);
  setTimeout(() => { openClay(c, { spawn: true }); piece.classList.remove('fly', 'on'); }, RM ? 0 : 300);
}

/* ───────── 알림 ───────── */
const toastEl = $('#toast'), toastMsg = $('#toast-msg'), toastAct = $('#toast-act');
let toastT = 0, toastFn = null, lastToast = '', lastToastAt = 0;
function toast(msg, act, fn) {
  if (!act && msg === lastToast && performance.now() - lastToastAt < 1800) return;
  lastToast = msg; lastToastAt = performance.now();
  toastMsg.textContent = msg; toastFn = fn || null;
  toastAct.hidden = !act; toastAct.textContent = act || '';
  toastEl.classList.add('on'); clearTimeout(toastT);
  toastT = setTimeout(() => { toastEl.classList.remove('on'); toastFn = null; }, act ? 4500 : 2400);
}
toastAct.addEventListener('click', () => { const f = toastFn; toastEl.classList.remove('on'); toastFn = null; if (f) f(); });

/* ───────── 시작 ───────── */
function boot() {
  try { workR = new Renderer(glCv, false); thumbR = new Renderer(document.createElement('canvas'), true); }
  catch (e) { console.error(e); $('#fallback').hidden = false; return; }
  buildNoise(); loadLearned();
  if (!COARSE) { modeEl.hidden = false; let m = 'draw'; try { m = localStorage.getItem(INPUT) || 'draw'; } catch (_) { /* 무시 */ } setInputMode(m); }
  layout();
  renderDough();
  const saved = load();
  if (saved) {
    clays = saved; clays.forEach(ensureCrack);
    showView('home'); refreshHome(true);
  } else {                                           // 처음 열면: 흰 화면에 점토 한 덩이
    clays = makeExamples();
    const c = newClay(); clays.push(c); save();
    openClay(c);
  }
  if (CONFIG.photo) {
    const img = new Image();
    img.onload = () => { workR.setPhoto(img); thumbR.setPhoto(img); if (cur && view === 'work') openClay(cur); if (view === 'home') refreshHome(true); };
    img.src = CONFIG.photo;
  }
  // 글자 도장용 글꼴이 늦게 오면 다시 찍는다
  if (document.fonts && document.fonts.load) {
    document.fonts.load(TEXT_FONT(22)).then(() => {
      if (cur && view === 'work' && hasWriting(cur) && !typing) { workR.upload(mapFull.rgba, mapFull.build(cur), 0); dirtyGL = true; }
      if (view === 'home') refreshHome(true);
    }).catch(() => { /* 글꼴 없이도 동작 */ });
  }
  requestAnimationFrame(frame);
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (view === 'home') refreshHome(true); }, 120); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
}
boot();
})();
