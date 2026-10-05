// 풍선껌 클래스

const MOUTH = { x: 810, y: 572 }; // 사진 속 입술 위치
const R_MAX = 110; // 최대 크기
const HANG_TIME = 3000; // 늘어난 껌이 입으로 되감기는 시간
const TAP_GAP = 350; // 이 시간 안에 다음 클릭이 오면 '연속 클릭'
const TAPS_TO_BURST = 5; // 터지는 데 필요한 연속 클릭 수

class Gum {
  constructor() {
    this.state = "round"; // round, stretch, hanging, tearing, empty
    this.r = 0;
    this.wrinkle = 0; // 쭈글쭈글한 정도 0~1
    this.end = this.center(); // 풍선 끝(몸통) 위치
    this.holes = []; // 레벨 3 구멍
    this.lastTap = null; // 마지막 클릭 시간
    this.firstTap = null; // 첫 클릭 위치
    this.shake = 0;
    this.timer = 0;
    this.seed = random(1000);
    this.effects = []; // 팡, 뽁, 펑 순간 연출
  }

  // 둥근 상태일 때 풍선 중심 (입술 앞으로 부풀어 나옴)
  center() {
    return { x: MOUTH.x, y: MOUTH.y + this.r * 0.3 };
  }

  update() {
    if (this.state === "round") {
      // 점점 커짐
      if (this.r < R_MAX) this.r = min(R_MAX, this.r + 0.28);
      this.wrinkle = max(0, this.wrinkle - 0.004);
      this.end = this.center();
      // 클릭 후 TAP_GAP 동안 다음 클릭이 없으면 판정
      if (this.lastTap !== null && !pressing && millis() - this.lastTap > TAP_GAP) {
        if (this.holes.length === 0) {
          this.pop(); // 한 번만 클릭 → 레벨 1: 팡
        } else {
          // 연속 클릭이 끊김 → 구멍이 스르륵 메워짐 (실패)
          for (let h of this.holes) h.healing = true;
        }
        this.lastTap = null;
      }
    } else if (this.state === "stretch") {
      // 레벨 2: 마우스를 따라 늘어나며 바람이 빠짐
      let m = toImage(mouseX, mouseY);
      this.end.x += (m.x - this.end.x) * 0.35;
      this.end.y += (m.y - this.end.y) * 0.35;
      this.r -= 0.22;
      this.wrinkle = min(1, this.wrinkle + 0.01);
      if (this.r < 10) this.vanish(); // 다 쪼그라들면 사라짐
    } else if (this.state === "hanging") {
      // 레벨 2 이후: 늘어난 채 멈춘 껌이 서서히 입으로 되감김
      let p = constrain((millis() - this.hangStart) / HANG_TIME, 0, 1);
      let e = p * p * (3 - 2 * p);
      let c = this.center();
      this.end.x = lerp(this.hangFrom.x, c.x, e);
      this.end.y = lerp(this.hangFrom.y, c.y, e);
      if (p >= 1) {
        // 시간 초과 → 다시 둥근 풍선으로
        this.state = "round";
      }
    } else if (this.state === "tearing") {
      // 구멍이 점점 커지다가 터짐
      this.timer++;
      let k = this.timer / 18;
      for (let h of this.holes) h.burst = 1 + k * k * 4;
      this.shake = 1;
      if (this.timer >= 18) this.burst();
    } else if (this.state === "empty") {
      // 잠시 후 다시 불기 시작
      this.timer++;
      if (this.timer > 45) {
        this.state = "round";
        this.r = 0;
        this.wrinkle = 0;
        this.holes = [];
        this.seed = random(1000);
      }
    }
    this.shake *= 0.88;
    for (let h of this.holes) {
      if (h.healing) h.grow -= 0.06;
      else h.grow = min(1, h.grow + 0.25);
    }
    this.holes = this.holes.filter((h) => h.grow > 0);
    for (let fx of this.effects) fx.t++;
    this.effects = this.effects.filter((fx) => fx.t < fx.life);
  }

  ////////////////////////////// 입력
  hitTest(x, y) {
    if (this.state === "round") {
      let c = this.center();
      return this.r > 3 && dist(x, y, c.x, c.y) < this.r + 8;
    }
    if (this.state === "hanging") {
      // 늘어난 껌은 다시 잡아서 드래그 가능
      let g = this.geom();
      if (dist(x, y, g.E.x, g.E.y) < g.endR + 8) return true;
      let t = this.project(g, x, y);
      let px = g.B.x + (g.E.x - g.B.x) * t;
      let py = g.B.y + (g.E.y - g.B.y) * t;
      return dist(x, y, px, py) < this.widthAt(g, t) + 8;
    }
    return false;
  }

  startStretch() {
    if (this.state === "round") {
      this.end = this.center();
      this.lastTap = null;
      this.holes = [];
      this.state = "stretch";
      return true;
    }
    if (this.state === "hanging") {
      this.state = "stretch";
      return true;
    }
    return false;
  }

  release() {
    if (this.state !== "stretch") return;
    this.state = "hanging";
    this.hangStart = millis();
    this.hangFrom = { x: this.end.x, y: this.end.y };
  }

  click(x, y) {
    if (this.state !== "round") return;
    let now = millis();
    if (this.lastTap !== null && now - this.lastTap < TAP_GAP) {
      // 빠른 연속 클릭 → 구멍이 뿅뿅
      if (this.holes.length === 0 || this.holes.every((h) => h.healing)) {
        this.holes = [];
        this.addHole(this.firstTap.x, this.firstTap.y);
      }
      this.addHole(x, y);
      if (this.holes.length >= TAPS_TO_BURST) {
        // 5번째: 구멍들이 확 커지기 시작
        this.state = "tearing";
        this.timer = 0;
        this.lastTap = null;
        return;
      }
    } else {
      // 첫 클릭 (잠시 기다려서 다음 클릭이 없으면 팡)
      this.firstTap = { x: x, y: y };
    }
    this.lastTap = now;
    this.shake = 0.6;
  }

  ////////////////////////////// 삭제 방법
  // 레벨 1: 팡 — 한 번에 삭제
  pop() {
    let c = this.center();
    this.effects.push({ type: "pang", x: c.x, y: c.y, r: this.r, t: 0, life: 9 });
    for (let i = 0; i < 30; i++) {
      let a = random(TWO_PI);
      let d = this.r * random(0.6, 1);
      let sp = random(2, 7);
      pieces.push(
        new Piece(
          c.x + cos(a) * d,
          c.y + sin(a) * d,
          random(2, 6) + this.r * 0.03,
          cos(a) * sp,
          sin(a) * sp - 1
        )
      );
    }
    this.vanish();
  }

  // 레벨 3: 부푼 껌에 구멍 뚫기
  addHole(x, y) {
    let c = this.center();
    let R = this.r;
    let ux = (x - c.x) / R;
    let uy = (y - c.y) / R;
    let d = sqrt(ux * ux + uy * uy);
    if (d > 0.7) {
      ux *= 0.7 / d;
      uy *= 0.7 / d;
    }
    let hole = { type: "blob", ux: ux, uy: uy };
    hole.size = random(0.7, 0.95) + this.holes.length * 0.08; // 갈수록 크게
    hole.grow = 0;
    hole.burst = 1;
    this.holes.push(hole);
    this.effects.push({ type: "pok", x: c.x + ux * R, y: c.y + uy * R, r: R * 0.3, t: 0, life: 8 });
    this.shake = 1;
  }

  // 레벨 3 완료: 구멍이 커지다 펑 터짐
  burst() {
    let g = this.geom();
    this.effects.push({ type: "burst", x: g.E.x, y: g.E.y, r: g.endR, t: 0, life: 10 });
    // 몸통이 찢어진 껌 조각으로 터져 나감
    for (let i = 0; i < 16; i++) {
      let a = random(TWO_PI);
      let d = random(g.endR * 0.9);
      let sp = random(3, 8);
      pieces.push(
        new Piece(
          g.E.x + cos(a) * d,
          g.E.y + sin(a) * d,
          random(g.endR * 0.1, g.endR * 0.24),
          cos(a) * sp,
          sin(a) * sp - 2
        )
      );
    }
    this.vanish();
  }

  vanish() {
    this.state = "empty";
    this.timer = 0;
    this.holes = [];
  }

  ////////////////////////////// 모양 계산
  geom() {
    let B = MOUTH;
    let E = this.end;
    let dx = E.x - B.x;
    let dy = E.y - B.y;
    let len = max(sqrt(dx * dx + dy * dy), 0.001);
    let dir = { x: dx / len, y: dy / len };
    let n = { x: -dir.y, y: dir.x };
    let k = constrain((len - this.r * 0.3) / (this.r * 3 + 1), 0, 1);
    let endR = this.r * (1 - 0.3 * k); // 늘어날수록 몸통이 작아짐
    let baseW = min(this.r * 0.45, 26); // 입술에 붙은 부분
    let dip = constrain((len - this.r) / (this.r * 3 + 1), 0, 0.7); // 가운데가 가늘어짐
    if (this.state === "hanging") dip = min(0.88, dip + this.holes.length * 0.05); // 구멍 날수록 팽팽
    return { B, E, len, dir, n, endR, baseW, dip };
  }

  widthAt(g, t) {
    let w = lerp(g.baseW, g.endR, pow(t, 1.6));
    return w * (1 - g.dip * pow(sin(PI * t), 1.5));
  }

  project(g, x, y) {
    let t = ((x - g.B.x) * g.dir.x + (y - g.B.y) * g.dir.y) / g.len;
    return constrain(t, 0, 1);
  }

  ////////////////////////////// 그리기
  display(pg) {
    if (this.state === "empty") return;
    pg.noStroke();

    let g = this.geom();
    // 떨림
    let sh = sin(frameCount * 1.7) * this.shake * 9;
    let E = { x: g.E.x + g.n.x * sh, y: g.E.y + g.n.y * sh };
    g.E = E;
    let R = g.endR;

    // 늘어난 부분 (입술 → 몸통)
    pg.fill(232, 116, 156);
    let steps = ceil(g.len / 2.5) + 1;
    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      pg.circle(
        g.B.x + (E.x - g.B.x) * t,
        g.B.y + (E.y - g.B.y) * t,
        this.widthAt(g, t) * 2
      );
    }
    // 몸통
    this.blob(pg, E.x, E.y, R);
    pg.fill(247, 158, 188);
    this.blob(pg, E.x - R * 0.1, E.y - R * 0.14, R * 0.82);

    // 늘어난 부분의 광택
    if (g.len > R) {
      pg.stroke(255, 255, 255, 90);
      pg.strokeWeight(max(1.5, g.baseW * 0.16));
      let w1 = this.widthAt(g, 0.15) * 0.45;
      let w2 = this.widthAt(g, 0.7) * 0.45;
      pg.line(
        g.B.x + (E.x - g.B.x) * 0.15 - g.n.x * w1,
        g.B.y + (E.y - g.B.y) * 0.15 - g.n.y * w1,
        g.B.x + (E.x - g.B.x) * 0.7 - g.n.x * w2,
        g.B.y + (E.y - g.B.y) * 0.7 - g.n.y * w2
      );
      pg.noStroke();
    }

    // 쭈글쭈글 주름 (바람 빠짐)
    if (this.wrinkle > 0.03) {
      pg.noFill();
      pg.stroke(196, 78, 120, 200 * this.wrinkle);
      pg.strokeWeight(max(1, R * 0.03));
      for (let k = 0; k < 7; k++) {
        let a = this.seed + k * 0.9 + noise(k, this.seed) * TWO_PI;
        let wob = (noise(k * 3, frameCount * 0.03) - 0.5) * R * 0.25;
        let x1 = E.x + cos(a) * R * 0.25;
        let y1 = E.y + sin(a) * R * 0.25;
        let x2 = E.x + cos(a + 0.35) * R * 0.85;
        let y2 = E.y + sin(a + 0.35) * R * 0.85;
        let cx = E.x + cos(a + 0.15) * R * 0.55 + wob;
        let cy = E.y + sin(a + 0.15) * R * 0.55 - wob;
        pg.bezier(x1, y1, cx, cy, cx, cy, x2, y2);
      }
      pg.noStroke();
    }

    // 하이라이트
    pg.fill(255, 255, 255, 190);
    pg.push();
    pg.translate(E.x - R * 0.38, E.y - R * 0.42);
    pg.rotate(-0.6);
    pg.ellipse(0, 0, R * 0.42, R * 0.2);
    pg.pop();
    pg.fill(255, 255, 255, 120);
    pg.circle(E.x + R * 0.42, E.y + R * 0.3, R * 0.08);

    // 레벨 3 구멍 (뚫린 곳으로 배경이 비침)
    for (let h of this.holes) {
      let x, y, s;
      if (h.type === "blob") {
        x = E.x + h.ux * R;
        y = E.y + h.uy * R;
        s = R * 0.24 * h.size;
      } else {
        let w = this.widthAt(g, h.t);
        x = g.B.x + (E.x - g.B.x) * h.t + g.n.x * h.off * w;
        y = g.B.y + (E.y - g.B.y) * h.t + g.n.y * h.off * w;
        s = max(5, w * 0.7) * h.size;
      }
      s *= h.grow * (h.burst || 1);
      pg.fill(196, 78, 120);
      this.blob(pg, x, y, s * 0.8, 0.6);
      pg.erase();
      this.blob(pg, x, y, s * 0.55, 0.6);
      pg.noErase();
    }
  }

  // 울퉁불퉁한 원 (주름이 많을수록 울퉁불퉁)
  blob(pg, x, y, r, rough) {
    let wr = rough === undefined ? this.wrinkle : rough;
    pg.beginShape();
    for (let i = 0; i < 64; i++) {
      let a = (TWO_PI * i) / 64;
      let nz = noise(this.seed + x * 0.01 + cos(a) * 1.5, this.seed + sin(a) * 1.5, frameCount * 0.01);
      let rr = r * (1 + 0.012 * sin(frameCount * 0.05 + a * 3) + wr * 0.14 * (nz - 0.5) * 2);
      pg.vertex(x + cos(a) * rr, y + sin(a) * rr);
    }
    pg.endShape(CLOSE);
  }

  // 순간 연출 (팡 / 뽁 / 펑)
  drawEffects() {
    for (let fx of this.effects) {
      let k = fx.t / fx.life;
      let a = 255 * (1 - k);
      noFill();
      if (fx.type === "pang") {
        // 팡: 사방으로 튀는 빛줄기 + 퍼지는 고리
        stroke(255, 255, 255, a);
        strokeWeight(5);
        for (let i = 0; i < 14; i++) {
          let ang = (TWO_PI * i) / 14 + 0.2;
          let r1 = fx.r * (1.0 + 0.5 * k);
          let r2 = fx.r * (1.35 + 0.9 * k);
          line(fx.x + cos(ang) * r1, fx.y + sin(ang) * r1, fx.x + cos(ang) * r2, fx.y + sin(ang) * r2);
        }
        stroke(255, 190, 215, a);
        strokeWeight(2);
        circle(fx.x, fx.y, fx.r * 2 * (1 + 0.4 * k));
      } else if (fx.type === "pok") {
        // 뽁: 구멍 자리에 작은 고리
        stroke(255, 255, 255, a);
        strokeWeight(2);
        circle(fx.x, fx.y, fx.r * (1 + k * 1.5));
      } else if (fx.type === "burst") {
        // 펑: 터진 자리에서 퍼지는 고리 + 짧은 빛줄기
        stroke(255, 255, 255, a);
        strokeWeight(3);
        circle(fx.x, fx.y, fx.r * 2 * (0.8 + 0.8 * k));
        for (let i = 0; i < 10; i++) {
          let ang = (TWO_PI * i) / 10;
          let r1 = fx.r * (0.9 + 0.6 * k);
          let r2 = fx.r * (1.15 + 0.8 * k);
          line(fx.x + cos(ang) * r1, fx.y + sin(ang) * r1, fx.x + cos(ang) * r2, fx.y + sin(ang) * r2);
        }
      }
    }
    noStroke();
  }
}
