/* 손자국 — 만질수록 지문이 쌓이는 점토 메모 (중간 과제 프로토타입)
 *
 * 화면
 *  - 작업 화면: 점토 하나. 누르면 지문, 두 손가락으로 벌리면 펼쳐짐, 펼친 점토 위에서 손가락/마우스로 그으면 새겨짐
 *    (노트북은 키보드로 쓰기도 선택 가능). 15초 동안 안 만지면 서서히 하얗게 마르다가 굳고(얇게 편 점토는 갈라짐),
 *    굳으면 새긴 글이 하얗게 묻혀 안 보인다. 문질러 물을 묻힌 자리만 잠깐 드러났다가 마르면 다시 숨는다.
 *    굳은 점토는 물만 묻는다. 방금 새로 만든 점토만 가장자리를 동글동글 문지르면 다시 말랑해진다.
 *    물레에 올린 점토는 바로 굳고, 다시는 말랑해지지 않는다(깨져도 물에 불려 반죽되지 않는다).
 *    빠르게 톡톡 여러 번 두드리면 두께 있는 조각으로 금이 가다가 와르르 갈라져 가루로 사라진다(지우기).
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
  dryMs: 10000,   // 안 만지고 이 시간이 지나면 굳는다 (화면 아래에 카운트다운)
  breakMs: 864e5, // 굳은 뒤 이 시간 동안 한 번도 안 보면 깨진다 (하루). 주소 끝에 #demo 를 붙이면 1분
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
  for (let i = 0; i < N * N; i++) { GRAIN[i] = a[i] * .04 + b[i] * .18 + c[i] * .8; MOT[i] = m[i]; }
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
function grooveSeg(H, a, b, kx, ky, W0, D0) {
  const f = ((a[2] == null ? 1 : a[2]) + (b[2] == null ? 1 : b[2])) / 2;   // 누른 힘: 세게 누를수록 굵고 깊게
  const W = W0 * (.25 + 1.0 * f), D = D0 * (.2 + 1.0 * f);          // 살살 = 머리카락처럼 가늘고 얕게, 세게 = 굵고 깊게
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
      if (d > .85 && traw > 0 && traw <= 1) { const tt = (d - 1.3) / .28; H[i] += D * .38 * Math.exp(-tt * tt); }
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
// 손가락으로 새긴 길: 손가락 폭의 둥근 U자 홈, 양옆으로 밀려 올라온 흙 둑, 바닥에 쓸린 지문 결, 끝에 밀려 쌓인 흙
function fingerSeg(H, a, b, kx, ky, W0, D0) {
  const f = ((a[2] == null ? 1 : a[2]) + (b[2] == null ? 1 : b[2])) / 2;
  const W = W0 * (.75 + .35 * f), D = D0 * (.5 + .7 * f);
  const Sx = (b[0] - a[0]) * kx, Sy = (b[1] - a[1]) * ky, len2 = Sx * Sx + Sy * Sy, len = Math.sqrt(len2) || 1e-3, ex = W * 1.9;
  const nx = -Sy / len, ny = Sx / len;
  const ref = (sampleH(H, a[0] + nx * W * 2.4 / kx, a[1] + ny * W * 2.4 / ky) + sampleH(H, a[0] - nx * W * 2.4 / kx, a[1] - ny * W * 2.4 / ky)) / 2;
  const streakAmp = .16 * Math.min(1.3, D / 1.6);
  const [x0, y0, x1, y1] = bbox(Math.min(a[0], b[0]) - ex / kx, Math.min(a[1], b[1]) - ex / ky, Math.max(a[0], b[0]) + ex / kx, Math.max(a[1], b[1]) + ex / ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - a[1]) * ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - a[0]) * kx;
      const traw = len2 > 1e-6 ? (X * Sx + Y * Sy) / len2 : 0, t = clamp(traw, 0, 1);
      const d = Math.hypot(X - Sx * t, Y - Sy * t) / W;
      if (d > 1.9) continue;
      const i = y * N + x;
      if (d < 1) {
        const perp = X * nx + Y * ny;
        const target = ref - D * Math.pow(1 - d * d, .8) + Math.cos(perp / 2.3) * streakAmp * (1 - smooth(.5, .95, d));
        const v = H[i] + (target - H[i]) * (1 - smooth(.75, 1, d));
        if (v < H[i]) H[i] = v;
      }
      if (d > .8 && H[i] > ref - D * .25) { const tt = (d - 1.3) / .32, bank = ref + D * .55 * Math.exp(-tt * tt); if (bank > H[i]) H[i] += (bank - H[i]) * .85; }   // 밀려 올라온 둑 (이미 파인 홈은 다시 메우지 않음)
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function pileAt(H, a, b, kx, ky, W0, D0) {                      // 획 끝: 손가락에 밀린 흙이 쌓인다
  const f = b[2] == null ? 1 : b[2], W = W0 * (.75 + .35 * f), D = D0 * (.5 + .7 * f);
  let dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const cu = b[0] + dx * W * .95 / kx, cv = b[1] + dy * W * .95 / ky, ex = W * 1.6;
  const [x0, y0, x1, y1] = bbox(cu - ex / kx, cv - ex / ky, cu + ex / kx, cv + ex / ky);
  for (let y = y0; y <= y1; y++) {
    const Y = (-L + (y + .5) * TEX - cv) * ky;
    for (let x = x0; x <= x1; x++) {
      const X = (-L + (x + .5) * TEX - cu) * kx, al = X * dx + Y * dy, pe = -X * dy + Y * dx;
      H[y * N + x] += D * .95 * Math.exp(-(al * al) / (W * W * .25) - (pe * pe) / (W * W * .8));
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function stampFinger(H, m) {
  let rect = null; const P = m.pts;
  if (P.length === 1) return fingerSeg(H, P[0], P[0], m.kx, m.ky, m.W, m.D);
  for (let i = 1; i < P.length; i++) rect = unite(rect, fingerSeg(H, P[i - 1], P[i], m.kx, m.ky, m.W, m.D));
  return unite(rect, pileAt(H, P[P.length - 2], P[P.length - 1], m.kx, m.ky, m.W, m.D));
}
const isWriting = m => m.t === 'g' || m.t === 'k' || m.t === 'f';
const stamp = (H, m) => m.t === 'p' ? stampPrint(H, m) : m.t === 's' ? stampSmear(H, m) : m.t === 'g' ? stampGroove(H, m) : m.t === 'f' ? stampFinger(H, m) : m.t === 'k' ? stampText(H, m) : m.t === 'e' ? stampErase(H, m) : stampPore(H, m);

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
  for (let i = 0; i < 12; i++) {
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
  vec3 shc = vec3(0.36, 0.29, 0.22);
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
  vec3 alb = mix(vec3(0.915, 0.88, 0.83), vec3(0.725, 0.665, 0.585), uWet);   // 마른 슬립 크림 ↔ 젖은 클레이
  alb *= 1.0 + (d.a - 0.5) * 0.07;
  if (uPhotoMix > 0.0) { vec3 ph = texture2D(uPhoto, fract(l * 0.5 + 0.5)).rgb; alb *= mix(1.0, dot(ph, vec3(0.3, 0.59, 0.11)) / 0.62, uPhotoMix); }
  alb = mix(alb, vec3(0.6, 0.555, 0.49), water * 0.8);              // 물 묻은 흙은 짙어진다
  alb = mix(alb, alb * vec3(1.07, 0.95, 0.85), uWarm * 0.5);
  float ao = clamp(1.0 + (d.b - 0.5) * 8.0 * 0.055 * uGain, 0.8, 1.04);
  vec3 col = alb * (0.36 + 0.82 * diff) * ao;
  vec3 hv = normalize(ld + vec3(0.0, 0.0, 1.0)); float nh = max(dot(n, hv), 0.0);
  float wetGloss = max(uWet, water);                                   // 젖으면 번들, 마르면 무광
  col += (pow(nh, 9.0) * 0.07 + pow(nh, 55.0) * 0.22) * wetGloss;
  col *= mix(1.03, 1.0, uWet);
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
const DEMO = /demo/.test(location.hash);
const BREAK_MS = DEMO ? 60000 : CONFIG.breakMs;
const PEN = 'sonjaguk.pen.v1';
let clays = [], learned = {}, cur = null, view = 'work';
let W = 0, Hs = 0, maxH = 0, R0 = 90;
let baseCx = 0, baseCy = 0, cx = 0, cy = 0, Z = 1, zoomAnim = null;   // 점토 중심(화면), 확대 배율
let workR = null, thumbR = null;
const mapFull = new ClayMap(), mapBase = new ClayMap();
const NOWRITE = m => !isWriting(m);
let dirtyGL = true, fxDirty = true, lastWet = -1, warm = 0, rubbing = false, lastHide = -1, lastShrink = -1;
let spawnT = 1, spawnStart = 0, spawnK = 1, crackAnim = null, particles = [];
let penSeen = false;
const glCv = $('#gl'), fx = $('#fx'), fctx = fx.getContext('2d');
const hintEl = $('#hint'), labelEl = $('#label');
const countOf = (c, t) => c.marks.reduce((s, x) => s + (x.t === t ? 1 : 0), 0);
const hasWriting = c => c.marks.some(isWriting);
const shrinkOf = m => 1 - .07 * (1 - m);                         // 마르면 7% 정도 줄어든다
function writeSummary(c) { const g = countOf(c, 'g') + countOf(c, 'f') + countOf(c, 'k'); return g ? `새김 ${g}획` : ''; }

/* ───────── 오래 안 보면 깨진다 ───────── */
const dryAt = c => c.lt + CONFIG.dryMs;
const unseenFor = c => moist(c) > 0 ? 0 : Math.max(0, now() - Math.max(c.seen || 0, dryAt(c)));
const decayOf = c => c.broken ? 1 : clamp(unseenFor(c) / BREAK_MS, 0, 1);
function ensureBroken(c) {
  if (c.broken || moist(c) > 0 || unseenFor(c) < BREAK_MS) return false;
  ensureCrack(c);
  c.broken = { seed: (c.seed * 3 + (c.dryN || 0) * 131) >>> 0 }; c.v++;
  return true;
}
function genBreak(c) {
  const key = c.broken.seed + '|' + c.sx.toFixed(3) + '|' + c.sy.toFixed(3);
  if (c._bk && c._bkKey === key) return c._bk;
  const r = rng(c.broken.seed), amps = ampsOf(c, new Float32Array(12)), lines = [], chips = [];
  const n = 2 + ((r() * 2) | 0);
  for (let k = 0; k < n; k++) {                                  // 가장자리에서 가장자리로 가로지르는 금
    const a = r() * 6.283, b = a + Math.PI + (r() - .5) * 1.1;
    const p0 = [Math.cos(a) * edgeAt(c, a, amps) * 1.04, Math.sin(a) * edgeAt(c, a, amps) * 1.04];
    const p1 = [Math.cos(b) * edgeAt(c, b, amps) * 1.04, Math.sin(b) * edgeAt(c, b, amps) * 1.04];
    const pts = [], steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, j = i && i < steps ? (r() - .5) * .07 : 0;
      pts.push([lerp(p0[0], p1[0], t) + j + Math.sin(t * 3.14) * (r() - .5) * .12, lerp(p0[1], p1[1], t) + j]);
    }
    lines.push(pts);
  }
  for (let k = 0; k < 4; k++) {                                  // 떨어져 나간 귀퉁이
    const a = r() * 6.283, e = edgeAt(c, a, amps), w = .12 + r() * .14, d = .1 + r() * .14;
    chips.push([[Math.cos(a - w) * e * 1.05, Math.sin(a - w) * e * 1.05], [Math.cos(a) * (e - d), Math.sin(a) * (e - d)], [Math.cos(a + w) * e * 1.05, Math.sin(a + w) * e * 1.05]]);
  }
  def(c, '_bk', { lines, chips }); def(c, '_bkKey', key);
  return c._bk;
}
function drawBreak(ctx, c, x0, y0, R, s, bg) {
  const { lines, chips } = genBreak(c), P = ([u, v]) => [x0 + u * R * c.sx, y0 + v * R * c.sy];
  ctx.save(); outline(ctx, c, x0, y0, R * 1.01); ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const pts of lines) {
    const path = new Path2D(); pts.forEach((q, i) => { const [x, y] = P(q); i ? path.lineTo(x, y) : path.moveTo(x, y); });
    ctx.strokeStyle = bg; ctx.lineWidth = 4.2 * s; ctx.stroke(path);                         // 조각 사이 틈
    ctx.save(); ctx.translate(1.4 * s, 1.6 * s); ctx.strokeStyle = 'rgba(92,74,56,.32)'; ctx.lineWidth = 1.6 * s; ctx.stroke(path); ctx.restore();
    ctx.save(); ctx.translate(-1.9 * s, -1.9 * s); ctx.strokeStyle = 'rgba(255,252,246,.8)'; ctx.lineWidth = .9 * s; ctx.stroke(path); ctx.restore();
  }
  for (const ch of chips) {
    ctx.beginPath(); ch.forEach((q, i) => { const [x, y] = P(q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
    ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = 'rgba(92,74,56,.28)'; ctx.lineWidth = 1 * s; ctx.stroke();
  }
  ctx.restore();
}

/* ───────── 저장 ───────── */
const ser = c => ({ id: c.id, no: c.no, created: c.created, lt: c.lt, seen: c.seen, sx: r4(c.sx), sy: r4(c.sy), seed: c.seed, marks: c.marks, dryN: c.dryN, crack: c.crack, broken: c.broken || null, example: !!c.example });
function save() { try { localStorage.setItem(STORE, JSON.stringify(clays.map(ser))); } catch (e) { /* 저장 공간 없음 */ } }
let saveT = 0;
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };
function load() {
  try {
    const raw = localStorage.getItem(STORE); if (!raw) return null;
    const arr = JSON.parse(raw); if (!Array.isArray(arr)) return null;
    return arr.filter(c => c && c.id && Array.isArray(c.marks) && c.sx && c.sy).map(c => ({ ...c, seen: c.seen || c.lt, v: 1 }));
  } catch (e) { return null; }
}
function loadLearned() {
  try { learned = JSON.parse(localStorage.getItem(LEARN) || '{}') || {}; } catch (e) { learned = {}; }
  try { penSeen = localStorage.getItem(PEN) === '1'; } catch (e) { penSeen = false; }
}
function learn(k) { if (learned[k]) return; learned[k] = true; try { localStorage.setItem(LEARN, JSON.stringify(learned)); } catch (e) { /* 무시 */ } }
function notePen() { if (penSeen) return; penSeen = true; try { localStorage.setItem(PEN, '1'); } catch (e) { /* 무시 */ } toast('펜슬은 누르는 힘만큼 깊게 새겨져요'); }

/* ───────── 점토 만들기 ───────── */
function printMark(u, v, kx, ky, D, rot, g) {
  return { t: 'p', u: r4(u), v: r4(v), kx: r4(kx), ky: r4(ky), A: r4(15 + Math.random() * 2), B: r4(19 + Math.random() * 2.4), r: r4(rot), D: r4(D), g: r4(g), s: rint() };
}
function newClay() {
  const no = clays.reduce((m, c) => Math.max(m, c.no || 0), 0) + 1, t = now();
  const c = { id: 'c' + t.toString(36) + rint().toString(36), no, created: t, lt: t, seen: t, sx: 1, sy: 1, seed: rint(), marks: [], dryN: 0, crack: null, broken: null, example: false, v: 1 };
  const a = Math.random() * 6.283;  // 반죽에서 떼어낸 자리의 엄지 자국
  c.marks.push(printMark(Math.cos(a) * .5, Math.sin(a) * .5, R0, R0, 1.7, a + Math.PI / 2, 1));
  return c;
}
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
function scribble(x0, x1, y, r) {
  const pts = []; for (let x = x0; x <= x1; x += 3) pts.push([x, y + Math.sin(x * .42 + r() * .4) * 3.2 + Math.sin(x * .13) * 1.5 + (r() - .5) * .8]);
  return pts;
}
function makeExamples() {
  const hour = 36e5, day = 24 * hour, t = now();
  const spec = [   // seenAgo: 마지막으로 들여다본 뒤 지난 시간
    { no: 1, seed: 1201, sx: 1.9, sy: 1.3, prints: 7, smears: 3, ago: 3.2 * day, seenAgo: 2 * hour, write: 'list' },
    { no: 2, seed: 2402, sx: 1, sy: 1, prints: 11, smears: 2, ago: 2.6 * day, seenAgo: 5 * hour },
    { no: 3, seed: 3603, sx: 1.8, sy: 1.7, prints: 5, smears: 4, ago: 2.1 * day, seenAgo: 3 * hour, write: 'tongyeong' },
    { no: 4, seed: 4804, sx: 1.5, sy: 1.25, prints: 4, smears: 2, ago: 6 * day, seenAgo: 5 * day, write: 'lines' },
    { no: 5, seed: 6005, sx: 1.2, sy: 1.1, prints: 9, smears: 1, ago: 1.4 * day, seenAgo: 9 * hour },
    { no: 6, seed: 7206, sx: 1.7, sy: 1.4, prints: 3, smears: 3, ago: 20 * hour, seenAgo: 1 * hour, write: 'lines' },
    { no: 7, seed: 8407, sx: 1.05, sy: 1.3, prints: 6, smears: 2, ago: 9 * hour, seenAgo: 2 * hour },
    { no: 8, seed: 9608, sx: 1.6, sy: 1.55, prints: 4, smears: 2, ago: 4 * hour, seenAgo: .5 * hour, write: 'lines' },
  ];
  return spec.map(s => {
    const r = rng(s.seed), area = s.sx * s.sy, gA = Math.pow(area, .35), kx = R0 * s.sx, ky = R0 * s.sy;
    const seen = DEMO ? (s.no === 4 ? t - 2 * BREAK_MS : t) : t - s.seenAgo;   // 시연 모드에서는 4번만 깨진 채로
    const c = { id: 'ex' + s.no, no: s.no, created: t - s.ago, lt: t - s.ago + 6e4, seen, sx: s.sx, sy: s.sy, seed: s.seed, marks: [], dryN: 0, crack: null, broken: null, example: true, v: 1 };
    for (let i = 0; i < s.prints; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * .74, early = r() < .5, g = early ? 1 : gA;
      c.marks.push({ t: 'p', u: r4(Math.cos(a) * d), v: r4(Math.sin(a) * d), kx: R0 * (early ? 1 : s.sx), ky: R0 * (early ? 1 : s.sy), A: 15 + r() * 2, B: 19 + r() * 2.4, r: (r() - .5) * 1.2 - .2, D: (1.2 + r() * .8) * g, g, s: (r() * 1e9) | 0 });
    }
    for (let i = 0; i < s.smears; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * .6, dir = r() * 6.283, len = (20 + r() * 30) / kx, u = Math.cos(a) * d, v = Math.sin(a) * d;
      c.marks.push({ t: 's', u0: u, v0: v, u1: u + Math.cos(dir) * len, v1: v + Math.sin(dir) * len, kx, ky, W: 9.5, D: 1.2 * gA });
    }
    let strokes = [];
    if (s.write === 'list') {
      [-30, 0, 30].forEach((y, i) => {
        const bx = -R0 * s.sx * .52;
        strokes.push([[bx, y - 6], [bx + 12, y - 6.5], [bx + 12.5, y + 6], [bx - .5, y + 6.5], [bx, y - 6]]);
        if (i < 2) strokes.push([[bx + 2, y], [bx + 6, y + 5], [bx + 15, y - 9]]);
        strokes.push(scribble(bx + 24, bx + 24 + 70 + r() * 50, y, r));
      });
    } else if (s.write === 'tongyeong') {
      strokes = [...glyphStrokes('통', -25, -18, 46, r), ...glyphStrokes('영', 25, -18, 46, r)];
      const w = []; for (let x = -62; x <= 62; x += 3) w.push([x, 30 + Math.sin(x * .16) * 5]);
      strokes.push(w);
    } else if (s.write === 'lines') {
      const n = 2 + ((r() * 2) | 0), x0 = -R0 * s.sx * .5;
      for (let i = 0; i < n; i++) strokes.push(scribble(x0, x0 + R0 * s.sx * (.6 + r() * .35), (i - (n - 1) / 2) * 26, r));
    }
    for (const st of strokes) c.marks.push({ t: 'g', pts: st.map(([x, y]) => [r4(x / kx), r4(y / ky), r4(.75 + r() * .4)]), kx, ky, W: 2.5, D: 1.9 * gA });
    ensureCrack(c); ensureBroken(c);
    return c;
  });
}

/* ───────── 화면 크기 · 확대 ───────── */
const sxMax = () => Math.max(1, Math.min(2.6, (W - 32) / (2 * R0 * 1.08)));
const syMax = () => Math.max(1, Math.min(3, (maxH * .62) / (2 * R0 * 1.08)));
let waterCv = document.createElement('canvas'), wctx = waterCv.getContext('2d'), waterUntil = 0;
const WS = 1 / 3;
function layout() {
  W = innerWidth; Hs = innerHeight; maxH = Math.max(maxH, Hs);
  R0 = clamp(Math.min(W, maxH) * .22, 72, 112);
  baseCx = W / 2; baseCy = Hs * .46;
  if (Z === 1) { cx = baseCx; cy = baseCy; }
  workR.size(W, Hs);
  fx.width = Math.round(W * DPR); fx.height = Math.round(Hs * DPR);
  waterCv.width = Math.max(1, Math.round(W * WS)); waterCv.height = Math.max(1, Math.round(Hs * WS)); waterUntil = 0;
  if (cur) setSpread(cur, cur.sx, cur.sy);
  layoutWheel();
  dirtyGL = true; fxDirty = true; wheelDirty = true;
}
function setSpread(c, sx, sy) {
  const was = writable(c);
  sx = clamp(sx, 1, Math.max(1, sxMax())); sy = clamp(sy, 1, Math.max(1, syMax()));
  if (hasWriting(c) && sx * sy < WRITE_AREA) return;
  c.sx = sx; c.sy = sy;
  if (!was && writable(c)) { buzz(12); learn('spread'); if (view === 'work') toast('이제 새길 수 있어요'); }
  c.v++; dirtyGL = true;
}
const easeOut = t => 1 - Math.pow(1 - t, 3);
function zoomTo(z1, px, py) {                                   // 가까이 들여다보기
  const tx1 = z1 === 1 ? baseCx : px - (px - cx) * (z1 / Z), ty1 = z1 === 1 ? baseCy : py - (py - cy) * (z1 / Z);
  zoomAnim = { t0: performance.now(), z0: Z, z1, x0: cx, y0: cy, x1: tx1, y1: ty1 };
  if (z1 > 1) learn('zoom');
}
function clampPan() {
  const R = R0 * Z, mx = R * cur.sx, my = R * cur.sy;
  cx = clamp(cx, W / 2 - mx, W / 2 + mx); cy = clamp(cy, Hs / 2 - my, Hs / 2 + my);
}

/* ───────── 작업 화면: 만지기 ───────── */
const scaleNow = () => R0 * spawnK * shrinkOf(moist(cur)) * Z;
function toLocal(x, y) { const k = scaleNow(); return [(x - cx) / (k * cur.sx), (y - cy) / (k * cur.sy)]; }
function rAt(x, y) { const [u, v] = toLocal(x, y); return rLocal(cur, u, v, ampsOf(cur, tmpAmps)); }
const depthFactor = c => .45 + .55 * smooth(0, .35, moist(c));
function trimMarks(c) {
  while (c.marks.length > MAX_MARKS) { const i = c.marks.findIndex(m => !isWriting(m)); if (i < 0) break; c.marks.splice(i, 1); }
}
const upFull = rect => { if (rect) { workR.upload(mapFull.rgba, rect, 0); dirtyGL = true; } };
const upBase = rect => { if (rect) { workR.upload(mapBase.rgba, rect, 2); dirtyGL = true; } };
function stampLive(m) { upFull(mapFull.add(m)); if (!isWriting(m)) upBase(mapBase.add(m)); }
function rebuildMaps() { workR.upload(mapFull.rgba, mapFull.build(cur), 0); workR.upload(mapBase.rgba, mapBase.build(cur, NOWRITE), 2); }
function addMark(m) { const c = cur; c.marks.push(m); trimMarks(c); stampLive(m); c.lt = now(); c.v++; saveSoon(); }
const physK = c => R0 * shrinkOf(moist(c));                    // 자국 크기는 화면 확대와 상관없는 실제 크기
function pressAt(x, y, D) {
  const c = cur, [u, v] = toLocal(x, y), g = Math.pow(areaOf(c), .35);
  const m = printMark(u, v, physK(c) * c.sx, physK(c) * c.sy, D * g * depthFactor(c), (Math.random() - .5) - .2, g);
  addMark(m); learn('print');
  return m;
}
function deepen(m, D) { m.D = r4(Math.max(m.D, D * m.g * depthFactor(cur))); stampLive(m); saveSoon(); }
function pokeAt(x, y, f) {                                      // 펜슬로 콕: 작은 구멍
  const c = cur, [u, v] = toLocal(x, y);
  addMark({ t: 'o', u: r4(u), v: r4(v), kx: r4(physK(c) * c.sx), ky: r4(physK(c) * c.sy), R: r4(1.4 + 1.8 * f), D: r4((1.1 + 1.8 * f) * depthFactor(c)) });
}
function smearSeg(x0, y0, x1, y1) {
  const c = cur, [u0, v0] = toLocal(x0, y0), [u1, v1] = toLocal(x1, y1), amps = ampsOf(c, tmpAmps);
  if (rLocal(c, u0, v0, amps) > 1 || rLocal(c, u1, v1, amps) > 1) return;
  const g = Math.pow(areaOf(c), .35);
  addMark({ t: 's', u0: r4(u0), v0: r4(v0), u1: r4(u1), v1: r4(v1), kx: r4(physK(c) * c.sx), ky: r4(physK(c) * c.sy), W: r4(9 + Math.random() * 2), D: r4(1.15 * g * depthFactor(c)) });
}

// 새기기: 손떨림을 걸러낸 점을 따라 홈을 판다. 점마다 누른 힘(f)을 함께 기록한다
const segOf = m => m.t === 'f' ? fingerSeg : grooveSeg;
function strokeBegin(x, y, f, kind) {
  const c = cur, g = Math.pow(areaOf(c), .35), [u, v] = toLocal(x, y), finger = kind === 'touch';
  const m = { t: finger ? 'f' : 'g', pts: [[r4(u), r4(v), r4(f)]], kx: r4(physK(c) * c.sx), ky: r4(physK(c) * c.sy),
    W: finger ? 8.5 : 2.5, D: r4((finger ? 1.7 : 1.9) * g * depthFactor(c)) };   // 손가락은 손가락 폭, 펜슬은 가는 꼬챙이
  c.marks.push(m); c.lt = now(); c.v++;
  upFull(mapFull.encode(segOf(m)(mapFull.H, m.pts[0], m.pts[0], m.kx, m.ky, m.W, m.D)));
  return { m, sx: x, sy: y, ex: x, ey: y, f };
}
function strokePoint(st, x, y) {
  const [u, v] = toLocal(x, y);
  if (rLocal(cur, u, v, ampsOf(cur, tmpAmps)) > .97) return false;
  const P = st.m.pts, a = P[P.length - 1], b = [r4(u), r4(v), r4(st.f)];
  P.push(b); st.ex = x; st.ey = y;
  upFull(mapFull.encode(segOf(st.m)(mapFull.H, a, b, st.m.kx, st.m.ky, st.m.W, st.m.D)));
  cur.lt = now(); cur.v++;
  return true;
}
function strokeMove(st, x, y, f, final) {
  st.f = lerp(st.f, f, .35);
  const k = final ? 1 : .3;
  st.sx += (x - st.sx) * k; st.sy += (y - st.sy) * k;
  if (Math.hypot(st.sx - st.ex, st.sy - st.ey) >= (final ? .5 : 3)) { if (!strokePoint(st, st.sx, st.sy)) return null; }
  return st;
}
function strokeEnd(st) {                                         // 손가락 획 끝에 밀린 흙
  if (!st || st.m.t !== 'f' || st.m.pts.length < 2) return;
  const P = st.m.pts; upFull(mapFull.encode(pileAt(mapFull.H, P[P.length - 2], P[P.length - 1], st.m.kx, st.m.ky, st.m.W, st.m.D)));
}
// 누른 힘: 펜슬은 실제 압력, 손가락·마우스는 천천히 누를수록 깊게
function forceOf(e, p) {
  if (e.pointerType === 'pen') return clamp(.15 + 1.45 * Math.pow(clamp(e.pressure || .5, .02, 1), 1.1), .15, 1.6);
  const dt = Math.max(1, e.timeStamp - (p.lt || e.timeStamp - 16)), v = Math.hypot(e.clientX - (p.lx || e.clientX), e.clientY - (p.ly || e.clientY)) / dt;
  return clamp(1.15 - v * .45, .45, 1.1);
}

// 문질러 메우기
function startErase(g) {
  const c = cur;
  if (c.marks.length > g.m0) { c.marks.splice(g.m0); rebuildMaps(); }
  g.stroke = null; g.ended = true;
  const m = { t: 'e', pts: g.trail.map(([x, y]) => toLocal(x, y).map(r4)), kx: r4(physK(c) * c.sx), ky: r4(physK(c) * c.sy), W: 15 };
  c.marks.push(m); stampLive(m);
  g.erase = m; g.ex = g.trail[g.trail.length - 1][0]; g.ey = g.trail[g.trail.length - 1][1];
  c.lt = now(); c.v++; buzz(8);
}
function eraseTo(g, x, y) {
  if (Math.hypot(x - g.ex, y - g.ey) < 4) return;
  const m = g.erase, P = m.pts, a = P[P.length - 1], b = toLocal(x, y).map(r4);
  P.push(b); g.ex = x; g.ey = y;
  upFull(mapFull.erase(a, b, m)); upBase(mapBase.erase(a, b, m));
  if (Math.random() < .2) dust(x, y, 1, '178,164,146');
  cur.lt = now(); cur.v++;
}
function finishErase(g) {
  const c = cur, m = g.erase, rx = R0 * c.sx, ry = R0 * c.sy;
  const covered = ([u, v]) => m.pts.some(([eu, ev]) => Math.hypot((u - eu) * rx, (v - ev) * ry) < m.W * .85);
  c.marks = c.marks.filter(k => !((k.t === 'g' || k.t === 'f') && k.pts.every(covered)));
  if (!learned.erase) toast('문질러서 메웠어요');
  learn('erase'); saveSoon();
}

// 물 묻히기
function paintWater(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(0,0,0,.42)'); g.addColorStop(.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function wetStroke(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i <= n; i++) paintWater(wctx, lerp(x0, x1, i / n) * WS, lerp(y0, y1, i / n) * WS, 30 * Z * WS);
  waterUntil = performance.now() + 7000; dirtyGL = true;
  cur.seen = now();
  if (moist(cur) === 0 && hasWriting(cur)) learn('water');
  return d;
}
function dryWater(ctx, w, h, a) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
function dust(x, y, n, rgb) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - .5) * 130, vy: -Math.random() * 90 - 10, life: 1, s: .8 + Math.random() * 1.6, rgb });
  fxDirty = true;
}
function endWarm() { rubbing = false; if (moist(cur) > .25 && cur.crack) { cur.crack = null; cur.v++; } cur.seen = now(); saveSoon(); }

/* 굳은 점토 부수기 — 톡톡 칠수록 두께 있는 판 조각으로 금이 가며 들뜨고, 끝내 와르르 갈라져 흩어진 뒤 가루로 사라진다.
   점토 화면을 한 장 떠서(스냅샷) 보로노이 조각으로 자르고, 조각마다 옆면(두께)과 그림자를 그려 입체로 보이게 한다. */
const CRUMBLE_TAPS = 8, TAP_GAP = 450;
let pokeN = 0, pokeT = 0, shake = 0, shatter = null, chips = [], freshId = null;
const snapCv = document.createElement('canvas'), snapCtx = snapCv.getContext('2d');
function clipPoly(poly, nx, ny, d) {                            // nx*x + ny*y <= d 쪽만 남긴다
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function centroidOf(poly) {
  let x = 0, y = 0, A = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], k = a[0] * b[1] - b[0] * a[1]; A += k; x += (a[0] + b[0]) * k; y += (a[1] + b[1]) * k; }
  A *= .5; if (Math.abs(A) < 1e-9) return [poly[0][0], poly[0][1], 0];
  return [x / (6 * A), y / (6 * A), Math.abs(A)];
}
function jagged(poly) {                                         // 금은 곧지 않다: 긴 변마다 살짝 꺾는다 (이웃 조각과 같은 모양으로)
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push(a);
    if (L < .07) continue;
    const ka = a[0].toFixed(3) + a[1].toFixed(3), kb = b[0].toFixed(3) + b[1].toFixed(3), fw = ka < kb;
    const [p, q] = fw ? [a, b] : [b, a], key = fw ? ka + kb : kb + ka;
    let h = 2166136261; for (let j = 0; j < key.length; j++) h = Math.imul(h ^ key.charCodeAt(j), 16777619);
    const r = rng(h >>> 0), nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L, ins = [];
    for (const t of [.3, .62]) { const o = (r() - .5) * Math.min(.05, L * .22); ins.push([p[0] + (q[0] - p[0]) * t + nx * o, p[1] + (q[1] - p[1]) * t + ny * o]); }
    if (!fw) ins.reverse();
    out.push(...ins);
  }
  return out;
}
function buildShatter(c) {
  const amps = ampsOf(c, new Float32Array(12)), r = rng((c.seed ^ 0x5eed) >>> 0), sc = Math.sqrt(c.sx * c.sy);
  const rim = [];
  for (let i = 0; i < 240; i++) { const th = i / 240 * Math.PI * 2, e = edgeAt(c, th, amps); rim.push([Math.cos(th) * e * c.sx, Math.sin(th) * e * c.sy]); }
  const seeds = [], md = .25 * sc;
  for (let k = 0; k < 900 && seeds.length < 46; k++) {
    const u = (r() * 2 - 1) * 1.25, v = (r() * 2 - 1) * 1.25, rr = rLocal(c, u, v, amps);
    if (rr > 1.12) continue;
    const p = [u * c.sx, v * c.sy];
    if (seeds.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) > md * (rr > .85 ? .8 : 1))) seeds.push(p);
  }
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    let poly = rim; const a = seeds[i];
    for (let j = 0; j < seeds.length && poly.length > 2; j++) {
      if (j === i) continue; const b = seeds[j], nx = b[0] - a[0], ny = b[1] - a[1];
      poly = clipPoly(poly, nx, ny, nx * (a[0] + b[0]) / 2 + ny * (a[1] + b[1]) / 2);
    }
    if (poly.length < 3) continue;
    const [gx, gy, A] = centroidOf(poly); if (A < 1e-4) continue;
    cells.push({ poly: jagged(poly), cut: poly, gx, gy, A, k: 0, tgt: 0, ax: 0, ay: 0, rs: r() - .5 });
  }
  return { cells, pieces: null, brk: 0, snapOk: false, lx: 0, ly: 0 };
}
const curR = () => R0 * spawnK * shrinkOf(moist(cur)) * Z;
function captureSnap(m) {                                       // 지금 보이는 점토(마른 금 포함)를 한 장 뜬다
  if (snapCv.width !== glCv.width || snapCv.height !== glCv.height) { snapCv.width = glCv.width; snapCv.height = glCv.height; }
  snapCtx.setTransform(1, 0, 0, 1, 0, 0); snapCtx.clearRect(0, 0, snapCv.width, snapCv.height); snapCtx.drawImage(glCv, 0, 0);
  snapCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const c = cur, R = R0 * spawnK * shrinkOf(m) * Z;
  if (c.crack) { const al = 1 - smooth(0, .25, m); if (al > 0) drawCracks(snapCtx, c, cx, cy, R, 1, al, Z * (1 + decayOf(c) * 1.3)); }
  if (c.broken) drawBreak(snapCtx, c, cx, cy, R, Z, '#F6F2EC');
  shatter.snapOk = true;
}
function tapDry(x, y) {
  const t = performance.now();
  pokeN = t - pokeT < TAP_GAP ? pokeN + 1 : 1; pokeT = t;
  if (!shatter) { shatter = buildShatter(cur); dirtyGL = true; }
  const S = shatter, R = curR(), px = (x - cx) / R, py = (y - cy) / R, sc = Math.sqrt(cur.sx * cur.sy);
  const reach = (.16 + .15 * pokeN) * sc;
  for (const q of S.cells) {                                     // 한 번 톡은 부스러기만, 두 번째부터 금이 번진다
    if (pokeN < 2) break;
    const dx = q.gx - px, dy = q.gy - py, d = Math.hypot(dx, dy);
    if (d > reach) continue;
    q.tgt = Math.min(1, Math.max(q.tgt, .3 + .7 * (1 - d / reach)) + .12);
    if (!q.ax && !q.ay) { const l = d || 1; q.ax = dx / l; q.ay = dy / l; }
  }
  S.lx = px; S.ly = py;
  spawnChips(x, y, 2 + pokeN, 60 + pokeN * 10, 1);
  dust(x, y, 3 + pokeN, '226,219,208');
  shake = Math.max(shake, 1 + pokeN * .5); buzz(6 + pokeN * 2); fxDirty = true;
  if (pokeN === 1 && !learned.crumble) toast('계속 톡톡 두드리면 부서져요');
  if (pokeN >= CRUMBLE_TAPS) breakApart();
}
function spawnChips(x, y, n, sp, size) {                        // 튀어나가는 작은 흙 부스러기 (두께 있음)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = sp * (.3 + Math.random()), s = (1.4 + Math.random() * 3.2) * size * Math.max(1, Z * .7), k = 3 + (Math.random() * 2 | 0), pts = [];
    for (let j = 0; j < k; j++) { const b = j / k * Math.PI * 2 + Math.random() * .8, rr = s * (.55 + Math.random() * .6); pts.push([Math.cos(b) * rr, Math.sin(b) * rr]); }
    chips.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - .5) * 8, pts, th: .8 + s * .25, life: 1, fade: .004 + Math.random() * .004 });
  }
}
function breakApart() {
  const S = shatter, r = Math.random; pokeN = 0; learn('crumble'); buzz(60);
  S.brk = performance.now(); gest = null; pts.clear();
  const R = curR(), sc = Math.sqrt(cur.sx * cur.sy), pieces = [];
  const split = (poly, depth) => {
    const [gx, gy, A] = centroidOf(poly);
    if (depth > 0 && A > .03 * sc * sc) {
      const th = r() * Math.PI, nx = Math.cos(th), ny = Math.sin(th), d = nx * gx + ny * gy + (r() - .5) * .04;
      const a = clipPoly(poly, nx, ny, d), b = clipPoly(poly, -nx, -ny, -d);
      if (a.length > 2 && b.length > 2) { split(a, depth - 1); split(b, depth - (r() < .5 ? 1 : 2)); return; }
    }
    const dl = Math.hypot(gx - S.lx, gy - S.ly), dc = Math.hypot(gx, gy) || 1;
    const ox = gx / dc * .75 + (gx - S.lx) / (dl || 1) * .5, oy = gy / dc * .75 + (gy - S.ly) / (dl || 1) * .5, ol = Math.hypot(ox, oy) || 1;
    pieces.push({ poly: jagged(poly), gx, gy, dx: ox / ol, dy: oy / ol, dist: (.015 + r() * .05 + dc * .07) * (r() < .1 ? 2.6 : 1), rot: (r() - .5) * .35, delay: dl / sc * 170 + r() * 50, th: 3 + r() * 3.5, fadeAt: 1500 + r() * 500 });
  };
  for (const q of S.cells) split(q.cut, 1 + (r() < .35 ? 1 : 0));
  S.pieces = pieces;
  for (let i = 0; i < 45; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * .95;
    spawnChips(cx + Math.cos(a) * rr * R * cur.sx, cy + Math.sin(a) * rr * R * cur.sy, 1, 90, 1);
  }
  glCv.style.opacity = '0';
}
function shardPath(ctx, poly, R) { ctx.beginPath(); poly.forEach((p, i) => { const x = cx + p[0] * R, y = cy + p[1] * R; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
function drawShard(ctx, poly, gx, gy, R, tx, ty, rot, sc, th, alpha) {
  const ox = cx + gx * R, oy = cy + gy * R;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of poly) { const x = cx + p[0] * R, y = cy + p[1] * R; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1); x1 = Math.min(W, Math.ceil(x1) + 1); y1 = Math.min(Hs, Math.ceil(y1) + 1);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(ox + tx, oy + ty); ctx.rotate(rot); ctx.scale(sc, sc); ctx.translate(-ox, -oy);
  ctx.save(); ctx.translate(th * .7, th * 1.5); shardPath(ctx, poly, R); ctx.fillStyle = 'rgba(58,44,30,.13)'; ctx.fill();   // 바닥에 지는 그림자 (두 겹으로 부드럽게)
  ctx.translate(-th * .35, -th * .6); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(0, th); shardPath(ctx, poly, R); ctx.fillStyle = '#ad9d88'; ctx.fill(); ctx.restore();  // 옆면(두께)
  shardPath(ctx, poly, R);
  ctx.save(); ctx.clip(); ctx.drawImage(snapCv, x0 * DPR, y0 * DPR, (x1 - x0) * DPR, (y1 - y0) * DPR, x0, y0, x1 - x0, y1 - y0); ctx.restore();   // 윗면 = 원래 점토 표면
  ctx.lineJoin = 'round'; ctx.lineWidth = .9; ctx.strokeStyle = 'rgba(255,251,244,.6)'; ctx.stroke();
  ctx.save(); ctx.translate(0, Math.min(th, 2.2)); ctx.strokeStyle = 'rgba(96,78,58,.28)'; ctx.stroke(); ctx.restore();
  ctx.restore();
}
function drawShatter(ctx, t) {
  const S = shatter, R = curR();
  if (!S.brk) {
    if (!S.snapOk) return;
    ctx.drawImage(snapCv, 0, 0, W, Hs);
    const live = S.cells.filter(q => (q.k += (q.tgt - q.k) * .35) > .01).sort((a, b) => a.k - b.k);
    for (const q of live) { shardPath(ctx, q.poly, R); ctx.fillStyle = `rgba(52,40,28,${(.78 * q.k).toFixed(3)})`; ctx.fill(); }   // 들뜬 자리 밑 틈
    for (const q of live) {
      const k = q.k, z = Math.max(1, Z * .8);
      drawShard(ctx, q.poly, q.gx, q.gy, R, q.ax * 2.2 * k * z, (q.ay * 2.2 - 1.8) * k * z, q.rs * .07 * k, 1 - .065 * k, (1.5 + 4.5 * k) * z, 1);
    }
    if (live.some(q => Math.abs(q.tgt - q.k) > .005)) fxDirty = true;
    return;
  }
  const e = t - S.brk, z = Math.max(1, Z * .8);
  for (const p of S.pieces) {
    const k = easeOut(clamp((e - p.delay) / 650, 0, 1)), f = clamp((e - p.fadeAt) / 520, 0, 1);
    if (f >= 1) continue;
    if (f > 0 && Math.random() < .25) dust(cx + (p.gx + p.dx * p.dist * k) * R, cy + (p.gy + p.dy * p.dist * k) * R, 1, '226,219,208');
    drawShard(ctx, p.poly, p.gx, p.gy, R, p.dx * p.dist * R * k, p.dy * p.dist * R * k + (1 - k) * -2, p.rot * k, 1 - .06 * k - .12 * f, (1.5 + p.th * k) * z, 1 - f);
  }
  if (e > 2600) { endCrumble(); return; }
  fxDirty = true;
}
function drawChips(ctx) {
  chips = chips.filter(q => (q.life -= q.fade) > 0);
  for (const q of chips) {
    q.x += q.vx / 60; q.y += q.vy / 60; q.vx *= .88; q.vy *= .88; q.rot += q.vr / 60; q.vr *= .9;
    const a = Math.min(1, q.life * 2.5);
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.globalAlpha = a;
    ctx.beginPath(); q.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] + q.th) : ctx.moveTo(p[0], p[1] + q.th)); ctx.closePath();
    ctx.fillStyle = '#ad9e8a'; ctx.fill();
    ctx.beginPath(); q.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = '#e3dccf'; ctx.fill(); ctx.lineWidth = .6; ctx.strokeStyle = 'rgba(255,252,246,.6)'; ctx.stroke();
    ctx.restore();
  }
  if (chips.length) fxDirty = true;
}
function endCrumble() {
  const id = cur.id; shatter = null; chips = []; particles = []; glCv.style.opacity = '';
  showView('home'); removeClay(id, '파스스 부서졌어요');
}
// 새로 만든 점토만: 굳어도 '가장자리'를 동글동글 문지르면 다시 말랑해진다 (안쪽을 문지르면 물만 묻는다)
const SOFTEN_TURNS = 2;
function turnSoften(g, x, y) {
  if (!cur || cur.id !== freshId || moist(cur) > 0) return;
  if (g.tx === undefined) { g.tx = x; g.ty = y; g.turn = 0; return; }
  const dx = x - g.tx, dy = y - g.ty; if (Math.hypot(dx, dy) < 5) return;
  const r = rAt(x, y);
  if (r < .72 || r > 1.25) { g.ta = undefined; g.tx = x; g.ty = y; return; }   // 안쪽은 물 묻히기일 뿐
  const a = Math.atan2(dy, dx);
  if (g.ta !== undefined) { const d = a - g.ta; g.turn += Math.atan2(Math.sin(d), Math.cos(d)); }
  g.ta = a; g.tx = x; g.ty = y;
  const k = Math.abs(g.turn) / (Math.PI * 2 * SOFTEN_TURNS);
  warm = Math.max(warm, Math.min(1, k) * .9); dirtyGL = true;
  if (k >= 1) {
    cur.lt = now(); cur.crack = null; cur.v++; g.turn = 0;
    shatter = null; chips = []; pokeN = 0; glCv.style.opacity = '';
    toast('다시 말랑해졌어요'); learn('rub'); buzz(15); saveSoon(); fxDirty = true;
  }
}

/* 제스처
   손가락 — 톡 = 지문(오래 누를수록 깊게), 긋기 = 손가락 폭으로 흙을 밀며 새기기(천천히 그을수록 깊게),
            두 손가락 벌리기 = 펼치기, 두 손가락 톡톡 = 점토로 화면 가득(확대 중 벌리기·오므리기 = 확대 조절, 끌기 = 자리 옮기기)
   펜슬 — 긋기 = 꼬챙이로 새기기(살살 = 가늘고 얕게, 세게 = 굵고 깊게), 콕 = 작은 구멍. 펜슬이 닿아 있는 동안 손바닥은 무시한다
   덜 펼친 덩어리에서 그으면 엄지 자국. 왔다 갔다 문지르면 메워진다.
   굳은 점토 — 문지르기 = 물 묻혀 글 보기, 빠르게 톡톡 여러 번 = 조각나 부서짐(지우기)
              방금 새로 만든 점토만 가장자리를 동글동글 문지르면 다시 말랑해진다
   깨진 점토 — 굳은 점토와 같다: 문지르면 물만 묻고, 다시 말랑해지지 않는다 */
const stage = $('#stage'), pts = new Map();
let gest = null, lastTwoTap = null, tap2 = null;   // tap2: 지금 두 손가락이 톡 닿았는지 (마른 점토여도)
const fillZoom = () => { const R = R0 * shrinkOf(moist(cur)); return clamp(Math.min(W / (2 * R * cur.sx), Hs / (2 * R * cur.sy)) * .94, 1.4, 5); };
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('pointerdown', e => {
  if (view !== 'work' || !cur || (shatter && shatter.brk)) return;
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  const kind = e.pointerType;
  if (kind === 'pen') notePen();
  const p = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), kind, lx: e.clientX, ly: e.clientY, lt: e.timeStamp };
  pts.set(e.pointerId, p);
  const dry = moist(cur) === 0;
  if (pts.size === 1) {
    const r = rAt(p.x, p.y);
    if (kind === 'mouse' && r > .88 && r < 1.2 && !dry && Z === 1) { gest = { type: 'edge', id: e.pointerId, sx0: cur.sx, sy0: cur.sy, moved: 0, inside: r <= 1 }; return; }
    if (r > 1) { gest = { type: 'none', id: e.pointerId }; return; }
    if (dry) {
      gest = { type: 'wet', id: e.pointerId, moved: 0, lx: p.x, ly: p.y, hold: false };
      return;
    }
    gest = { type: 'press', id: e.pointerId, kind, moved: 0, lx: p.x, ly: p.y, mark: null, f0: kind === 'pen' ? forceOf(e, p) : 1,
      ax: p.x, ay: p.y, revs: [], trail: [[p.x, p.y]], m0: cur.marks.length };
    return;
  }
  if ([...pts.values()].some(q => q.kind === 'pen')) return;   // 펜슬을 쥔 손이 화면에 닿아도 무시
  tap2 = pts.size === 2 ? { t0: performance.now(), maxMove: 0, x: [...pts.values()].reduce((s, q) => s + q.x / 2, 0), y: [...pts.values()].reduce((s, q) => s + q.y / 2, 0) } : null;
  if (gest && gest.timer) clearTimeout(gest.timer);
  if (gest && gest.type === 'wet' && gest.hold) endWarm();
  const list = [...pts.values()], anyOn = list.some(q => rAt(q.x, q.y) <= 1.05);
  if (!anyOn && Z === 1) { gest = { type: 'none' }; return; }
  if (dry && !cur.broken) { gest = { type: 'none' }; return; }   // 굳은 점토는 감싸도 다시 말랑해지지 않는다
  if (cur.broken) { gest = { type: 'none' }; return; }
  if (pts.size === 2) {
    const ids = [...pts.keys()], a = pts.get(ids[0]), b = pts.get(ids[1]);
    gest = { type: 'two', ids, t0: performance.now(), maxMove: 0, z0: Z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, m0x: (a.x + b.x) / 2, m0y: (a.y + b.y) / 2,
      ux0: Math.abs(b.x - a.x), uy0: Math.abs(b.y - a.y), d0: Math.hypot(b.x - a.x, b.y - a.y), sx0: cur.sx, sy0: cur.sy };
  }
});
stage.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) { hoverCursor(e); return; }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) moveOne(ev, p);
});
function moveOne(e, p) {
  const f = gest && gest.type === 'press' ? forceOf(e, p) : 1;
  p.x = e.clientX; p.y = e.clientY;
  if (tap2) tap2.maxMove = Math.max(tap2.maxMove, Math.hypot(p.x - p.x0, p.y - p.y0));
  if (!gest) { p.lx = p.x; p.ly = p.y; p.lt = e.timeStamp; return; }
  if (gest.type === 'two') {
    const a = pts.get(gest.ids[0]), b = pts.get(gest.ids[1]); if (!a || !b) return;
    for (const q of [a, b]) gest.maxMove = Math.max(gest.maxMove, Math.hypot(q.x - q.x0, q.y - q.y0));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (Z > 1) {                                                                             // 확대 중: 벌리고 오므려 확대 조절, 끌어서 자리 옮기기
      zoomAnim = null;
      const z1 = clamp(gest.z0 * Math.hypot(b.x - a.x, b.y - a.y) / (gest.d0 || 1), 1, 6), zf = z1 / Z;
      cx = mx - (gest.mx - cx) * zf; cy = my - (gest.my - cy) * zf; Z = z1; clampPan(); dirtyGL = true;
    }
    else if (gest.maxMove > 8) {                                                             // 펼치기
      const k = 2 * R0, iso = .45 * (Math.hypot(b.x - a.x, b.y - a.y) - gest.d0) / k;
      setSpread(cur, gest.sx0 + (Math.abs(b.x - a.x) - gest.ux0) / k + iso, gest.sy0 + (Math.abs(b.y - a.y) - gest.uy0) / k + iso);
      cur.lt = now();
    }
    gest.mx = mx; gest.my = my;
    return;
  }
  if (e.pointerId !== gest.id) return;
  gest.moved = Math.max(gest.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
  if (gest.type === 'edge') {
    if (gest.moved < 4) return;
    const ox = p.x0 - cx, oy = p.y0 - cy, ol = Math.hypot(ox, oy) || 1, dx = ox / ol, dy = oy / ol;
    const amt = (p.x - p.x0) * dx + (p.y - p.y0) * dy, iso = .2 * amt / R0;
    setSpread(cur, gest.sx0 + amt * Math.abs(dx) / R0 + iso, gest.sy0 + amt * Math.abs(dy) / R0 + iso);
    cur.lt = now(); gest.stretched = true;
  } else if (gest.type === 'press') {
    if (gest.moved >= 6) pressMove(e, p, f);
  } else if (gest.type === 'wet' && !gest.hold) {
    if (Math.hypot(p.x - gest.lx, p.y - gest.ly) >= 2) { clearTimeout(gest.timer); wetStroke(gest.lx, gest.ly, p.x, p.y); gest.lx = p.x; gest.ly = p.y; }
    turnSoften(gest, p.x, p.y);
  }
  p.lx = p.x; p.ly = p.y; p.lt = e.timeStamp;
}
function pressMove(e, p, f) {
  const g = gest, tnow = performance.now(), sd = Math.hypot(p.x - g.ax, p.y - g.ay);
  if (sd >= 6) {
    const dx = (p.x - g.ax) / sd, dy = (p.y - g.ay) / sd;
    if (g.pdx !== undefined && dx * g.pdx + dy * g.pdy < -.3) g.revs.push(tnow);
    g.pdx = dx; g.pdy = dy; g.ax = p.x; g.ay = p.y; g.trail.push([p.x, p.y]);
  }
  g.revs = g.revs.filter(t => tnow - t < 650);
  if (!g.erase && g.revs.length >= 3) startErase(g);
  if (g.erase) { eraseTo(g, p.x, p.y); return; }
  const writer = true;   // 펜슬·손가락·마우스 모두 그으면 새겨진다
  if (writer && writable(cur)) {
    if (!g.stroke && !g.ended) { g.stroke = g.last = strokeBegin(p.x0, p.y0, g.kind === 'pen' ? f : 1, g.kind); learn('write'); }
    if (g.stroke) { g.stroke = strokeMove(g.stroke, p.x, p.y, f, false); if (!g.stroke) { g.ended = true; strokeEnd(g.last); } }
    return;
  }
  if (Math.hypot(p.x - g.lx, p.y - g.ly) >= 7) { smearSeg(g.lx, g.ly, p.x, p.y); g.lx = p.x; g.ly = p.y; }
  if (writer && !g.told && g.moved > 40) { g.told = true; toast(COARSE ? '두 손가락으로 조금만 펼치면 새길 수 있어요' : '가장자리를 끌어 조금만 펼치면 새길 수 있어요'); }
}
function endPtr(e, cancel) {
  const p = pts.get(e.pointerId); if (!p) return;
  pts.delete(e.pointerId);
  if (tap2) {                                                                                  // 두 손가락 톡톡 = 화면 가득 / 원래대로
    const t = performance.now(), ok = !cancel && t - tap2.t0 < 380 && tap2.maxMove < 12;
    if (ok && lastTwoTap && t - lastTwoTap.t < 520 && Math.hypot(tap2.x - lastTwoTap.x, tap2.y - lastTwoTap.y) < 90) {
      lastTwoTap = null; zoomTo(Z > 1.02 ? 1 : fillZoom(), tap2.x, tap2.y);
    } else lastTwoTap = ok ? { t, x: tap2.x, y: tap2.y } : null;
    tap2 = null;
  }
  if (!gest) return;
  const g = gest;
  if (g.type === 'two' || g.type === 'warm') {
    if (g.type === 'warm' && pts.size < 2) endWarm();
    if (g.type === 'two' && Z > 1 && Z < 1.15 && !zoomAnim) zoomTo(1, 0, 0);                      // 거의 다 오므리면 원래 크기로
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
    if (g.stroke) { strokeMove(g.stroke, p.x, p.y, g.stroke.f, true); strokeEnd(g.stroke); saveSoon(); return; }
    if (g.moved < 6) {
      if (g.kind === 'pen') pokeAt(p.x0, p.y0, g.f0);
      else { const m = pressAt(p.x0, p.y0, 1.25); if (dur > 230) deepen(m, 1.25 + Math.min(dur, 900) / 900 * 1.1); }
    }
    saveSoon();
  } else if (g.type === 'edge') {
    if (!g.stretched && g.inside) { const m = pressAt(p.x0, p.y0, 1.25); if (dur > 230) deepen(m, 1.25 + Math.min(dur, 900) / 900 * 1.1); }
    saveSoon();
  } else if (g.type === 'wet' && g.moved < 6 && dur < 300) tapDry(p.x, p.y);
}
stage.addEventListener('pointerup', e => endPtr(e, false));
stage.addEventListener('pointercancel', e => endPtr(e, true));
function hoverCursor(e) {
  if (e.pointerType !== 'mouse' || !cur || view !== 'work') return;
  const r = rAt(e.clientX, e.clientY), dry = moist(cur) === 0;
  stage.style.cursor = r > 1.2 ? 'default' : dry || cur.broken ? 'grab' : r > .88 && Z === 1 ? 'move' : 'crosshair';
}
// 노트북: 휠·트랙패드로 가까이 보기
stage.addEventListener('wheel', e => {
  if (view !== 'work' || !cur) return;
  e.preventDefault();
  const z1 = clamp(Z * Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0025)), 1, 6);
  if (z1 === Z) return;
  zoomAnim = null;
  if (z1 <= 1.001) { Z = 1; cx = baseCx; cy = baseCy; }
  else { cx = e.clientX - (e.clientX - cx) * (z1 / Z); cy = e.clientY - (e.clientY - cy) * (z1 / Z); Z = z1; clampPan(); learn('zoom'); }
  dirtyGL = true;
}, { passive: false });

/* ───────── 안내 문구 · 라벨 ───────── */
function hintText() {
  const c = cur; if (!c) return '';
  const m = moist(c);
  if (m === 0 || c.broken) {
    if (hasWriting(c) && !learned.water) return '문질러서 물을 묻히면 숨은 글이 보여요';
    if (c.id === freshId) return COARSE ? '가장자리를 동글동글 문지르면 다시 말랑해져요' : '가장자리를 동그랗게 문지르면 다시 말랑해져요';
    if (!learned.crumble) return COARSE ? '빠르게 톡톡 여러 번 두드리면 부서져요' : '빠르게 여러 번 클릭하면 부서져요';
    return '';
  }
  if (hasWriting(c)) return '굳으면 문질러서 물을 묻혀 다시 볼 수 있어요';
  if (!learned.print) return '만져보세요';
  if (!writable(c)) return learned.write ? '' : COARSE ? '두 손가락으로 벌려 조금 펼치면 새길 수 있어요' : '가장자리를 잡고 끌어 조금 펼치면 새길 수 있어요';
  if (!learned.write) return penSeen ? '펜슬로 그으면 새겨져요 · 세게 누를수록 깊게' : COARSE ? '그으면 새겨져요 · 펜슬이 있으면 펜슬로' : '드래그하면 새겨져요';
  if (!learned.zoom) return COARSE ? '두 손가락으로 톡톡 치면 점토가 화면 가득 커져요' : '휠을 굴리면 가까이 볼 수 있어요';
  if (hasWriting(c) && !learned.erase) return '잘못 새긴 곳은 왔다 갔다 문지르면 메워져요';
  return '';
}
function stateOf(c) {
  const m = moist(c);
  if (c.broken) return '깨짐';
  if (m === 0) return decayOf(c) > .5 ? '금 가는 중' : c.crack && c.crack.type === 'split' ? '갈라짐' : '굳음';
  return m >= .55 ? '말랑함' : '꾸덕해지는 중';
}
function labelText() {                                          // 새 점토: 굳기까지 카운트다운 / 물레에서 꺼낸 점토: 언제 쓴 메모인지
  const c = cur; if (!c) return '';
  const m = moist(c);
  if (c.id === freshId) return m > 0 ? `${Math.ceil(m * CONFIG.dryMs / 1000)}초 뒤에 굳어요` : '';
  const d = new Date(c.created), h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad2(d.getMinutes())}에 쓴 메모`;
}
// 새 점토가 굳으면: 물레에 보관하기
const storeBtn = document.createElement('button');
storeBtn.type = 'button'; storeBtn.className = 'store-btn'; storeBtn.textContent = '물레에 보관하기'; storeBtn.hidden = true;
labelEl.after(storeBtn);
storeBtn.addEventListener('click', goHome);
const syncStore = () => { const on = !!cur && cur.id === freshId && moist(cur) === 0 && !(shatter && shatter.brk); if (storeBtn.hidden === on) storeBtn.hidden = !on; };
let hintNow = null, hintT = 0;
function setHint(t) {
  if (t === hintNow) return; hintNow = t;
  hintEl.classList.add('fade'); clearTimeout(hintT);
  hintT = setTimeout(() => { hintEl.textContent = t; hintEl.classList.remove('fade'); }, RM ? 0 : 300);
}
const setLabel = t => { if (labelEl.textContent !== t) labelEl.textContent = t; };

/* ───────── 작업 화면 그리기 ───────── */
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
let lastLabel = 0, lastT = 0, waterOn = false, seenTick = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (t - lastT) / 1000 || 0); lastT = t;
  if (view === 'home') { tickWheel(dt); return; }
  if (!cur) return;
  const c = cur;
  const m = moist(c);
  if (m === 0 && ensureCrack(c)) { crackAnim = RM ? null : { t0: t }; learn('dry'); buzz(20); c.v++; saveSoon(); fxDirty = true; }
  if (m === 0 && !c.broken && t - seenTick > 1000) { seenTick = t; c.seen = now(); saveSoon(); }   // 들여다보는 동안은 깨지지 않는다
  if (spawnT < 1) { spawnT = clamp((t - spawnStart) / 520, 0, 1); spawnK = Math.max(.02, easeOutBack(spawnT)); dirtyGL = true; } else spawnK = 1;
  if (zoomAnim) {
    const k = easeOut(clamp((t - zoomAnim.t0) / 380, 0, 1));
    Z = lerp(zoomAnim.z0, zoomAnim.z1, k); cx = lerp(zoomAnim.x0, zoomAnim.x1, k); cy = lerp(zoomAnim.y0, zoomAnim.y1, k);
    if (k >= 1) { zoomAnim = null; if (Z > 1) clampPan(); }
    dirtyGL = true;
  }
  if (warm > 0 && !(gest && (gest.type === 'warm' || gest.hold))) { warm = Math.max(0, warm - .02); dirtyGL = true; }
  if (performance.now() < waterUntil) { dryWater(wctx, waterCv.width, waterCv.height, .012); workR.setWater(waterCv); waterOn = true; dirtyGL = true; }
  else if (waterOn) { wctx.clearRect(0, 0, waterCv.width, waterCv.height); waterOn = false; dirtyGL = true; }
  let shrink = shrinkOf(m), ox = 0, oy = 0;
  if (shake > .05) { ox = (Math.random() - .5) * shake; oy = (Math.random() - .5) * shake; shake *= .82; dirtyGL = true; } else if (shake) { shake = 0; dirtyGL = true; }
  if (shatter && shake) fxDirty = true;
  const wet = wetOf(m), hide = 1 - smooth(0, .3, m);
  if (Math.abs(wet - lastWet) > .006 || Math.abs(hide - lastHide) > .01 || Math.abs(shrink - lastShrink) > .0008) dirtyGL = true;
  if (dirtyGL) {
    const sh = !shatter;                                              // 부수는 중엔 흔들림을 조각 쪽에서 준다
    workR.draw(c, { cx: cx + (sh ? ox : 0), cy: cy + (sh ? oy : 0), R0: R0 * spawnK * shrink * Z, wet, warm, hide, waterTex: waterOn });
    if (shatter && !shatter.brk) captureSnap(m);
    lastWet = wet; lastHide = hide; lastShrink = shrink; dirtyGL = false; fxDirty = true;
  }
  drawFx(t, m, ox, oy);
  if (t - lastLabel > 200) { lastLabel = t; setLabel(labelText()); setHint(hintText()); syncStore(); }
}
function drawFx(t, m, ox = 0, oy = 0) {
  if (!fxDirty && !crackAnim && !particles.length && !chips.length && !(shatter && shatter.brk)) return;
  fxDirty = false;
  fctx.setTransform(DPR, 0, 0, DPR, 0, 0); fctx.clearRect(0, 0, W, Hs);
  const c = cur, R = R0 * spawnK * shrinkOf(m) * Z;
  if (shatter) {
    fctx.save(); fctx.translate(ox, oy); drawShatter(fctx, t); fctx.restore();
    if (!shatter) return;                                             // 다 부서져 물레로 돌아감
  } else if (c.crack) {
    let p = 1;
    if (crackAnim) { p = clamp((t - crackAnim.t0) / 1700, 0, 1); if (p >= 1) crackAnim = null; }
    const alpha = 1 - smooth(0, .25, m);
    if (alpha > 0) drawCracks(fctx, c, cx, cy, R, p, alpha, Z * (1 + decayOf(c) * 1.3));
  }
  if (c.broken && !shatter) drawBreak(fctx, c, cx, cy, R, Z, '#F6F2EC');
  if (chips.length) drawChips(fctx);
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
  if (v === 'work') { dirtyGL = true; fxDirty = true; } else { wheelDirty = true; if (!thumbBusy) pumpThumbs(); }
}
function openClay(c, { spawn = false, fresh = spawn } = {}) {
  cur = c; c.seen = now();
  ensureCrack(c);
  rebuildMaps();
  crackAnim = null; particles = []; shatter = null; chips = []; glCv.style.opacity = ''; freshId = fresh ? c.id : null; pokeN = 0; shake = 0; warm = 0; rubbing = false; gest = null; pts.clear();
  wctx.clearRect(0, 0, waterCv.width, waterCv.height); waterUntil = 0; waterOn = false;
  Z = 1; zoomAnim = null; cx = baseCx; cy = baseCy;
  spawnT = spawn && !RM ? 0 : 1; spawnStart = performance.now(); spawnK = spawnT < 1 ? .02 : 1;
  lastWet = -1; lastHide = -1; lastShrink = -1; hintNow = null;
  showView('work'); setLabel(labelText()); saveSoon();
}
function goHome() {
  if (cur && moist(cur) > 0) { cur.lt = now() - CONFIG.dryMs; ensureCrack(cur); }   // 물레에 올린 점토는 바로 굳는다 (다시 말랑해지지 않는다)
  if (cur) cur.v++; storeBtn.hidden = true; save(); showView('home'); refreshHome(); }
$('#home-btn').addEventListener('click', goHome);

/* ───────── 홈: 물레 ─────────
   가운데 = 가장 최근 점토, 바깥으로 갈수록 오래된 점토. 물레판을 돌려 지난 점토를 찾는다.
   점토를 톡 = 열기, 문지르기 = 물 묻혀 숨은 글 보기, 3초 꾹 = 납작해지며 지우기 */
const wheelCv = $('#wheel'), wheelCtx = wheelCv.getContext('2d'), infoEl = $('#wheel-info');
const RINGS = [{ r: 0, n: 1, cell: .3 }, { r: .33, n: 6, cell: .2 }, { r: .62, n: 10, cell: .155 }, { r: .86, n: 15, cell: .118 }];
const WHEEL_BG = '#EAE2D7';
let D = 300, wheelAng = 0, wheelVel = 0, wheelDirty = true, slots = [], focusId = null;
const thumbs = new Map(), activeThumbs = new Set();
let thumbQ = [], thumbBusy = false, homeT = 0, lastRemoved = null;
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = ms => { const d = new Date(ms); return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; };
const compCv = document.createElement('canvas'), compCtx = compCv.getContext('2d');

function layoutWheel() {
  const top = $('.home-head').getBoundingClientRect().bottom || 110;
  D = Math.round(Math.max(220, Math.min(W - 28, Hs - top - 230, 640)));
  wheelCv.style.width = D + 'px'; wheelCv.style.height = D + 'px';
  wheelCv.width = Math.round(D * DPR); wheelCv.height = Math.round(D * DPR);
  wheelDirty = true;
}
function refreshHome(force) {
  const list = [...clays].sort((a, b) => b.created - a.created);
  $('#count').textContent = `점토 ${list.length}개`;
  slots = []; let i = 0;
  RINGS.forEach((ring, ri) => {
    for (let k = 0; k < ring.n && i < list.length; k++, i++) slots.push({ c: list[i], ring: ri, a0: k / ring.n * Math.PI * 2 + ri * .37 - Math.PI / 2, del: null });
  });
  for (const id of [...thumbs.keys()]) if (!clays.some(c => c.id === id)) thumbs.delete(id);
  for (const s of slots) {
    const c = s.c; ensureCrack(c); ensureBroken(c);
    const size = Math.round(RINGS[s.ring].cell * D), m = moist(c);
    const key = `${c.v}|${size}|${m > 0 ? Math.round(wetOf(m) * 8) : 'd'}|${Math.round(decayOf(c) * 4)}|${c.broken ? 'b' : ''}`;
    let th = thumbs.get(c.id);
    if (!th) { th = { mask: document.createElement('canvas'), until: 0 }; thumbs.set(c.id, th); }
    if (force || th.key !== key) { th.key = key; th.size = size; queueThumb(c); }
  }
  if (!focusId || !clays.some(c => c.id === focusId)) focusId = list[0] ? list[0].id : null;
  updateInfo(); wheelDirty = true;
  clearTimeout(homeT);
  if (list.some(c => moist(c) > 0 || (!c.broken && moist(c) === 0))) homeT = setTimeout(() => { if (view === 'home') refreshHome(); }, 3000);
}
function updateInfo() {
  const c = clays.find(x => x.id === focusId);
  if (!c) { infoEl.innerHTML = '<span class="i-no">아직 점토가 없어요</span><span class="i-sub">아래 흙을 위로 끌어 떼어내세요</span>'; return; }
  const w = writeSummary(c);
  infoEl.innerHTML = '';
  const a = document.createElement('span'); a.className = 'i-no'; a.textContent = `No.${pad2(c.no)} · ${fmtDate(c.created)} · ${stateOf(c)}${c.example ? ' (예시)' : ''}`;
  const b = document.createElement('span'); b.className = 'i-sub'; b.textContent = `${w || '새김 없음'} · 지문 ${countOf(c, 'p')}${decayOf(c) > .5 ? ' · 오래 안 봐서 금이 가고 있어요' : ''}`;
  infoEl.append(a, b);
}
function queueThumb(c) { if (!thumbQ.includes(c)) thumbQ.push(c); if (!thumbBusy) pumpThumbs(); }
function pumpThumbs() {
  if (view !== 'home') { thumbBusy = false; return; }
  const c = thumbQ.shift();
  if (!c) { thumbBusy = false; return; }
  thumbBusy = true;
  try { renderThumb(c); } catch (e) { console.error(e); }
  wheelDirty = true;
  setTimeout(pumpThumbs, 16);
}
function renderThumb(c) {
  const th = thumbs.get(c.id); if (!th || !clays.includes(c)) return;
  const w = th.size, px = Math.round(w * DPR), m = moist(c), wet = wetOf(m), sh = shrinkOf(m);
  const k = Math.min((w * .42) / (R0 * 1.9), (w * .44) / (R0 * Math.max(c.sx, c.sy) * 1.12));
  const R = R0 * k * sh, ccx = w / 2, ccy = w * .47;
  thumbR.size(w, w);
  thumbR.upload(mapFull.rgba, mapFull.build(c), 0);
  thumbR.upload(mapBase.rgba, mapBase.build(c, NOWRITE), 2);
  const snap = o => {
    thumbR.draw(c, { cx: ccx, cy: ccy, R0: R, wet, warm: 0, ...o });
    const cv = document.createElement('canvas'); cv.width = px; cv.height = px;
    const ctx = cv.getContext('2d'); ctx.drawImage(thumbR.cv, 0, 0); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const s = Math.max(.5, k * 1.4);
    if (c.crack && m === 0) drawCracks(ctx, c, ccx, ccy, R, 1, o.waterAll ? .55 : 1, s * (1 + decayOf(c) * 1.3));
    if (c.broken) drawBreak(ctx, c, ccx, ccy, R, s, WHEEL_BG);
    return cv;
  };
  th.hid = snap({ hide: 1 });
  th.rev = snap({ hide: 0, waterAll: 1 });
  th.mask.width = Math.round(w / 2); th.mask.height = Math.round(w / 2); th.w = w;
  th.comp = document.createElement('canvas'); th.comp.width = px; th.comp.height = px;
  composeThumb(th);
}
function composeThumb(th) {
  if (!th.hid) return;
  const ctx = th.comp.getContext('2d'), px = th.comp.width;
  ctx.clearRect(0, 0, px, px); ctx.drawImage(th.hid, 0, 0);
  if (!activeThumbs.has(th)) return;
  if (compCv.width !== px) { compCv.width = px; compCv.height = px; }
  compCtx.globalCompositeOperation = 'source-over'; compCtx.clearRect(0, 0, px, px); compCtx.drawImage(th.rev, 0, 0, px, px);
  compCtx.globalCompositeOperation = 'destination-in'; compCtx.drawImage(th.mask, 0, 0, px, px);
  compCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(compCv, 0, 0);
}
function slotPos(s) {
  const ring = RINGS[s.ring], a = s.a0 + (s.ring ? wheelAng : 0);
  return [D / 2 + Math.cos(a) * ring.r * D / 2, D / 2 + Math.sin(a) * ring.r * D / 2, RINGS[s.ring].cell * D];
}
function drawWheel() {
  const g = wheelCtx, r = D / 2;
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, D, D);
  // 바닥 그림자 · 물레판
  g.fillStyle = 'rgba(110,90,66,.10)'; g.beginPath(); g.ellipse(r + 4, r + 9, r * .97, r * .97, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = WHEEL_BG; g.beginPath(); g.arc(r, r, r * .97, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#DCD1C2'; g.lineWidth = 1.2; g.stroke();
  g.save(); g.translate(r, r); g.rotate(wheelAng);
  for (let i = 1; i <= 22; i++) {                                // 물레 자국(돌면서 같이 돈다)
    const rr = r * .95 * i / 22;
    g.strokeStyle = `rgba(150,128,102,${i % 4 ? .07 : .12})`; g.lineWidth = .8;
    g.beginPath(); g.ellipse(0, 0, rr, rr * (1 - .004 * (i % 3)), i * .3, 0, Math.PI * 2); g.stroke();
  }
  for (let i = 0; i < 7; i++) {                                  // 흙물 얼룩
    const a = i * .9 + .2, rr = r * (.25 + (i * 37 % 60) / 100);
    g.strokeStyle = 'rgba(176,158,134,.16)'; g.lineWidth = 3 + (i % 3) * 2; g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, rr, a, a + .35 + (i % 4) * .12); g.stroke();
  }
  g.restore();
  g.fillStyle = '#E2D8CB'; g.beginPath(); g.arc(r, r, r * .07, 0, Math.PI * 2); g.fill();
  // 점토들: 뒤(위쪽)부터
  const order = slots.map(s => [s, slotPos(s)]).sort((a, b) => a[1][1] - b[1][1]);
  for (const [s, [x, y, size]] of order) {
    const th = thumbs.get(s.c.id), sq = s.del ? clamp((performance.now() - s.del.t0 - 250) / 2750, 0, 1) : 0;
    g.save(); g.translate(x, y + size * .03);
    if (sq > 0) g.scale(1 + .5 * sq, 1 - .78 * sq);
    if (th && th.comp) g.drawImage(th.comp, -size / 2, -size * .47, size, size);
    else { g.fillStyle = '#D9CDBD'; g.beginPath(); g.ellipse(0, 0, size * .2, size * .17, 0, 0, Math.PI * 2); g.fill(); }
    if (s.c.id === focusId && slots.length > 1) { g.strokeStyle = 'rgba(74,63,53,.35)'; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.arc(0, 0, size * .46, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    g.restore();
  }
}
function tickWheel(dt) {
  if (!wheelPtr && Math.abs(wheelVel) > .0004) { wheelAng += wheelVel; wheelVel *= .955; wheelDirty = true; }
  const t = performance.now();
  for (const th of activeThumbs) {
    dryWater(th.mask.getContext('2d'), th.mask.width, th.mask.height, .012);
    if (t > th.until) { activeThumbs.delete(th); th.mask.getContext('2d').clearRect(0, 0, th.mask.width, th.mask.height); }
    composeThumb(th); wheelDirty = true;
  }
  if (slots.some(s => s.del)) wheelDirty = true;
  if (wheelDirty) { drawWheel(); wheelDirty = false; }
}
function slotAt(x, y) {
  let best = null, bd = Infinity;
  for (const s of slots) { const [sx, sy, size] = slotPos(s), d = Math.hypot(x - sx, y - sy); if (d < size * .34 && d < bd) { bd = d; best = s; } }
  return best;
}
let wheelPtr = null;
const wheelLocal = e => { const r = wheelCv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const angAt = (x, y) => Math.atan2(y - D / 2, x - D / 2);
wheelCv.addEventListener('pointerdown', e => {
  if (wheelPtr) return;
  const [x, y] = wheelLocal(e);
  if (Math.hypot(x - D / 2, y - D / 2) > D / 2) return;
  try { wheelCv.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  const s = slotAt(x, y);
  wheelPtr = { id: e.pointerId, x0: x, y0: y, x, y, t0: performance.now(), slot: s, moved: false, a: angAt(x, y) };
  wheelVel = 0;
  if (s) { focusId = s.c.id; updateInfo(); s.del = { t0: performance.now() }; wheelDirty = true; }
});
wheelCv.addEventListener('pointermove', e => {
  const w = wheelPtr; if (!w || e.pointerId !== w.id) return;
  const [x, y] = wheelLocal(e);
  if (!w.moved && Math.hypot(x - w.x0, y - w.y0) > 8) { w.moved = true; if (w.slot) w.slot.del = null; }
  if (w.moved && w.slot) {                                       // 점토를 문지르면 물이 묻는다
    const th = thumbs.get(w.slot.c.id), [sx, sy, size] = slotPos(w.slot);
    if (th && th.w) {
      const mctx = th.mask.getContext('2d'), s = th.mask.width / th.w, k = th.w / size;
      const ox = th.w / 2, oy = th.w * .47, ax = (w.x - sx) * k + ox, ay = (w.y - sy - size * .03) * k + oy, bx = (x - sx) * k + ox, by = (y - sy - size * .03) * k + oy;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
      for (let i = 1; i <= n; i++) paintWater(mctx, lerp(ax, bx, i / n) * s, lerp(ay, by, i / n) * s, th.w * .11 * s);
      th.until = performance.now() + 7000; activeThumbs.add(th); composeThumb(th);
      w.slot.c.seen = now(); learn('water'); saveSoon();
    }
  } else if (w.moved) {                                          // 판을 잡고 돌리기
    const a = angAt(x, y); let d = a - w.a; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
    wheelAng += d; wheelVel = d; w.a = a; learn('spin');
  }
  w.x = x; w.y = y; wheelDirty = true;
});
function endWheel(e, cancel) {
  const w = wheelPtr; if (!w || e.pointerId !== w.id) return;
  wheelPtr = null;
  if (w.slot) w.slot.del = null;
  if (!cancel && w.slot && !w.moved && performance.now() - w.t0 < 400) openById(w.slot.c.id);
  wheelDirty = true;
}
wheelCv.addEventListener('pointerup', e => endWheel(e, false));
wheelCv.addEventListener('pointercancel', e => endWheel(e, true));
wheelCv.addEventListener('wheel', e => { e.preventDefault(); wheelAng += e.deltaY * .003; wheelVel = 0; wheelDirty = true; learn('spin'); }, { passive: false });
wheelCv.addEventListener('contextmenu', e => e.preventDefault());
function checkHolds() {                                          // 3초 꾹 = 지우기
  const w = wheelPtr;
  if (w && w.slot && w.slot.del && performance.now() - w.slot.del.t0 >= 3000) {
    const id = w.slot.c.id; wheelPtr = null; removeClay(id);
  }
  requestAnimationFrame(checkHolds);
}
requestAnimationFrame(checkHolds);
function openById(id) { const c = clays.find(x => x.id === id); if (c) openClay(c); }
function removeClay(id, msg = '납작하게 눌러 지웠어요') {
  const i = clays.findIndex(c => c.id === id); if (i < 0) return;
  const c = clays[i];
  clays.splice(i, 1); save(); buzz(30); lastRemoved = c;
  if (focusId === id) focusId = null;
  refreshHome();
  toast(msg, '되돌리기', () => { if (!lastRemoved) return; clays.push(lastRemoved); lastRemoved = null; save(); refreshHome(); });
}

/* ───────── 홈: 흙에서 떼어내기 ───────── */
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
  if (!cancel && p.on && p.y0 - p.y > 80) { tearOff(); return; }
  piece.classList.remove('on');
  if (!cancel && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) toast('흙을 위로 끌어 떼어내세요');
}
dough.addEventListener('pointerup', e => endPull(e, false));
dough.addEventListener('pointercancel', e => endPull(e, true));
dough.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tearOff(); } });
function tearOff() {
  const c = newClay(); clays.push(c); save(); buzz(14);
  piece.classList.add('on'); void piece.offsetWidth;
  piece.classList.add('fly'); placePiece(W / 2, baseCy, R0 / 30);
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
  toastT = setTimeout(() => { toastEl.classList.remove('on'); toastFn = null; }, act ? 4500 : 2600);
}
toastAct.addEventListener('click', () => { const f = toastFn; toastEl.classList.remove('on'); toastFn = null; if (f) f(); });

/* ───────── 시작 ───────── */
function boot() {
  try { workR = new Renderer(glCv, false); thumbR = new Renderer(document.createElement('canvas'), true); }
  catch (e) { console.error(e); $('#fallback').hidden = false; return; }
  buildNoise(); loadLearned();
  if (DEMO) $('#demo-tag').hidden = false;
  layout();
  renderDough();
  const saved = load();
  if (saved) { clays = saved; clays.forEach(c => { ensureCrack(c); ensureBroken(c); }); showView('home'); refreshHome(true); }
  else { clays = makeExamples(); const c = newClay(); clays.push(c); save(); openClay(c, { fresh: true }); }
  if (CONFIG.photo) {
    const img = new Image();
    img.onload = () => { workR.setPhoto(img); thumbR.setPhoto(img); if (cur && view === 'work') rebuildMaps(); if (view === 'home') refreshHome(true); };
    img.src = CONFIG.photo;
  }
  requestAnimationFrame(frame);
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); if (view === 'home') refreshHome(true); }, 120); });
  addEventListener('hashchange', () => location.reload());
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
}
boot();
})();