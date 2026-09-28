const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const Constraint = Matter.Constraint;
const Events = Matter.Events;

let engine;
let rings = [];
let stems = [];
let flowers = [];

// 꽃 색 
const PETALS = ["#ec5a43", "#6fa8ea", "#3f8f45", "#f2a0c6", "#f7d44c", "#3d63c9", "#f0843c", "#b9a3ea", "#9bd3a0", "#fbf3e1"];
const CENTERS = ["#f7d44c", "#ffffff", "#ec5a43", "#f2a0c6", "#6fa8ea"];
// 꽃이 떨어질 줄기 
const ORDER = [3, 0, 5, 1, 4, 2];
const TOTAL = 20; 

const W = 1200;
const H = 900;

function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);
  engine = Engine.create();

  // walls
  let margin = 20;
  Composite.add(engine.world, [
    Bodies.rectangle(W / 2, H - margin, W, margin, { isStatic: true }),
    Bodies.rectangle(W / 2, margin, W, margin, { isStatic: true }),
    Bodies.rectangle(margin, H / 2, margin, H, { isStatic: true }),
    Bodies.rectangle(W - margin, H / 2, margin, H, { isStatic: true }),
  ]);

  // 꽃병
  let offsets = [4, -3, 7, -6, 3, -8, -3, 6, 0];
  for (let i = 0; i < 9; i++) {
    let ring = Bodies.rectangle(W / 2 + offsets[i], H - 50 - i * 34, 170, 38, {
      isStatic: true,
      collisionFilter: { group: -1 }, 
    });
    rings.push(ring);
  }
  Composite.add(engine.world, rings);

  // 줄기
  let topY = H - 50 - 8 * 34;
  let angles = [-34, -15, -3, 7, 19, 35];
  let lens = [240, 300, 230, 330, 280, 250];

  for (let i = 0; i < 6; i++) {
    let a = radians(angles[i]);
    let L = lens[i];
    let stem = Bodies.rectangle(W / 2 + (sin(a) * L) / 2, topY - (cos(a) * L) / 2, 5, L, {
      angle: a,
      density: 0.0005,
      frictionAir: 0.04,
      collisionFilter: { group: -1, category: 0x0002 },
      label: "stem",
    });
    stem.len = L;

    // 줄기 아래는 바닥 고정
    let pivot = Constraint.create({
      pointA: { x: W / 2, y: topY },
      bodyB: stem,
      pointB: { x: (-sin(a) * L) / 2, y: (cos(a) * L) / 2 },
      length: 0,
      stiffness: 1,
    });
    // 스프링
    let spring = Constraint.create({
      pointA: { x: W / 2 + sin(a) * L, y: topY - cos(a) * L },
      bodyB: stem,
      pointB: { x: (sin(a) * L) / 2, y: (-cos(a) * L) / 2 },
      length: 0,
      stiffness: 0.005,
    });

    stems.push(stem);
    Composite.add(engine.world, [stem, pivot, spring]);
  }

  // 꽃이 줄기에 닿으면 줄기 끝 붙이기
  Events.on(engine, "collisionStart", (e) => {
    for (let p of e.pairs) {
      let f = p.bodyA.label === "flower" ? p.bodyA : p.bodyB;
      let st = p.bodyA.label === "stem" ? p.bodyA : p.bodyB;
      if (f.label === "flower" && st.label === "stem" && !f.stuck && !st.full) {
        Composite.add(
          engine.world,
          Constraint.create({
            bodyA: st,
            pointA: { x: (sin(st.angle) * st.len) / 2, y: (-cos(st.angle) * st.len) / 2 },
            bodyB: f,
            length: 0,
            stiffness: 0.2,
          })
        );
        f.collisionFilter.mask = 0xfffd; 
        f.stuck = true;
        st.full = true;
      }
    }
  });
}

function draw() {
  background("#a9c4c9");
  Engine.update(engine);

  // 화면 크기에 맞추기
  let sc = min(width / W, height / H);
  push();
  translate((width - W * sc) / 2, height - H * sc);
  scale(sc);

  // 꽃 하나씩
  if (frameCount > 120 && frameCount % 50 === 0 && flowers.length < TOTAL) {
    spawnFlower();
  }

  // 줄기
  stroke("#6f8b3d");
  strokeWeight(4);
  for (let st of stems) {
    let dx = (sin(st.angle) * st.len) / 2;
    let dy = (cos(st.angle) * st.len) / 2;
    line(st.position.x - dx, st.position.y + dy, st.position.x + dx, st.position.y - dy);
  }

  // 꽃
  for (let f of flowers) {
    drawFlower(f);
  }

  // 꽃병
  stroke("#142b74");
  strokeWeight(2);
  fill("#1f3c9c");
  for (let r of rings) {
    rect(r.position.x, r.position.y, 170, 38, 19);
  }
  pop();
}

// 창 크기가 바뀌면 캔버스도 다시 맞추기
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------- 꽃 만들기 ----------
function spawnFlower() {
  let i = flowers.length;
  let x;
  if (i < ORDER.length) {
    let st = stems[ORDER[i]];
    x = st.position.x + (sin(st.angle) * st.len) / 2; 
  } else {
    x = W / 2 + random(-150, 150); 
  }

  let r = random(10, 60); 
  let f = Bodies.circle(x, 60, r, {
    density: 0.0006,
    frictionAir: 0.02,
    restitution: 0.3,
    friction: 0.8,
    label: "flower",
  });
  f.r = r;
  f.n = random([4, 5, 6, 8]); 
  f.long = random() < 0.4; 
  f.petal = random(PETALS);
  f.center = random(CENTERS);

  flowers.push(f);
  Composite.add(engine.world, f);
}

// ---------- 꽃 그리기 ----------
function drawFlower(f) {
  push();
  translate(f.position.x, f.position.y);
  rotate(f.angle);

  // 꽃잎을 두 번 그림
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) {
      stroke(30);
      strokeWeight(5);
    } else {
      noStroke();
    }
    fill(f.petal);
    for (let k = 0; k < f.n; k++) {
      push();
      rotate((TWO_PI / f.n) * k);
      if (f.long) {
        ellipse(0, -f.r * 0.55, f.r * 0.6, f.r * 1.1);
      } else {
        circle(0, -f.r * 0.5, f.r * 1.1);
      }
      pop();
    }
  }

  // 꽃 가운데
  stroke(30);
  strokeWeight(2.5);
  fill(f.center);
  circle(0, 0, f.r * 0.7);
  pop();}