// Bubblegum — Delete, Delete, Delete
// 레벨 1 · 클릭 한 번    : 한 번 클릭하고 잠깐 기다리면 "팡" 사라짐
// 레벨 2 · 드래그        : 누른 채 끌면 주욱 늘어나며 "쉬이이" 바람이 빠져 쪼그라듦 (떼면 멈춤)
// 레벨 3 · 빠른 연속 클릭 : 빠르게 연속 클릭하면 구멍이 뿅뿅, 5번째에 구멍이 커지며 펑 (끊기면 구멍이 메워짐)

const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const Body = Matter.Body;

// 엔진 객체 생성
let engine;
let bg; // 배경 사진
let layer; // 풍선껌을 그리는 레이어 (반투명 + 구멍 뚫기용)
let gum; // 풍선껌 객체
let pieces = []; // 터진 껌 조각들이 담길 배열

// 배경 사진 원본 크기 (모든 좌표는 이 사진 기준으로 계산)
const IMG_W = 1586;
const IMG_H = 992;
let fit = { x: 0, y: 0, s: 1 };

// 마우스 상태
let pressing = false;
let dragging = false;
let pressTime = 0;
let pressX = 0;
let pressY = 0;
let lastRelease = -1000;

function setup() {
  createCanvas(windowWidth, windowHeight);
  loadImage("girl.jpg", (img) => {
    bg = img;
  });
  layer = createGraphics(windowWidth, windowHeight);
  fitImage();

  // Matter setting
  engine = Engine.create();
  engine.gravity.y = 1; // 조각은 아래로 떨어짐
  engine.gravity.scale = 0.001;

  ///////////////////////////// Gum
  gum = new Gum();
}

function draw() {
  background(111, 167, 230);
  Engine.update(engine);

  // 배경 사진 (화면을 꽉 채우게)
  if (bg) image(bg, fit.x, fit.y, IMG_W * fit.s, IMG_H * fit.s);

  // 꾹 누르고 있으면 움직이지 않아도 늘리기 시작
  if (pressing && !dragging && millis() - pressTime > 350) {
    startDrag();
  }

  ///////////////////////////// Gum
  gum.update();
  layer.clear();
  layer.push();
  layer.translate(fit.x, fit.y);
  layer.scale(fit.s);
  gum.display(layer);
  layer.pop();
  push();
  tint(255, 235); // 살짝 비치는 풍선껌
  image(layer, 0, 0, width, height);
  noTint();
  pop();

  ///////////////////////////// Pieces
  push();
  translate(fit.x, fit.y);
  scale(fit.s);
  for (let p of pieces) {
    p.display();
    p.checkDeath();
  }
  gum.drawEffects(); // 팡 / 뽁 / 펑 순간 연출
  pop();
  // 조각 배열 삭제하기
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].death === true) {
      pieces.splice(i, 1);
    }
  }

  updateCursor();
}

// 1번만 실행
function mousePressed() {
  if (millis() - lastRelease < 40) return; // 터치 중복 입력 방지
  let p = toImage(mouseX, mouseY);
  if (gum.hitTest(p.x, p.y)) {
    pressing = true;
    dragging = false;
    pressTime = millis();
    pressX = mouseX;
    pressY = mouseY;
  }
}

function mouseDragged() {
  if (pressing && !dragging && dist(mouseX, mouseY, pressX, pressY) > 8) {
    startDrag();
  }
}

function mouseReleased() {
  lastRelease = millis();
  if (!pressing) return;
  pressing = false;
  if (dragging) {
    // 드래그를 놓으면 → 늘어난 채 멈췄다가 입으로 되감김
    gum.release();
  } else {
    // 짧게 클릭 → 한 번이면 레벨 1, 빠르게 연속이면 레벨 3
    let p = toImage(mouseX, mouseY);
    gum.click(p.x, p.y);
  }
  dragging = false;
}

function startDrag() {
  dragging = true;
  if (!gum.startStretch()) pressing = false;
}

// 화면 좌표 → 사진 좌표
function toImage(x, y) {
  return { x: (x - fit.x) / fit.s, y: (y - fit.y) / fit.s };
}

// 사진이 화면을 꽉 채우도록(cover) 크기와 위치 계산
function fitImage() {
  fit.s = max(width / IMG_W, height / IMG_H);
  fit.x = (width - IMG_W * fit.s) / 2;
  fit.y = (height - IMG_H * fit.s) / 2;
}

function updateCursor() {
  if (dragging) {
    cursor("grabbing");
  } else {
    let p = toImage(mouseX, mouseY);
    if (gum.hitTest(p.x, p.y)) cursor(HAND);
    else cursor(ARROW);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layer.remove();
  layer = createGraphics(windowWidth, windowHeight);
  fitImage();
}
