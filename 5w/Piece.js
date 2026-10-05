// 껌 조각 클래스 (터지거나 끊어질 때 날아가는 조각)

class Piece {
  constructor(x, y, size, vx, vy) {
    this.size = size;
    this.c = [random(225, 245), random(105, 140), random(145, 175)];
    this.body = Bodies.polygon(x, y, floor(random(4, 8)), size, {
      frictionAir: 0.02,
      collisionFilter: { group: -1 }, // 조각끼리는 부딪히지 않음
    });
    Body.setVelocity(this.body, { x: vx, y: vy });
    Body.setAngularVelocity(this.body, random(-0.2, 0.2));
    Composite.add(engine.world, this.body);
    this.life = 255;
    this.death = false;
  }

  display() {
    noStroke();
    fill(this.c[0], this.c[1], this.c[2], this.life);
    beginShape();
    for (let v of this.body.vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
  }

  checkDeath() {
    this.life -= 4;
    let pos = this.body.position;
    if (this.life <= 0 || pos.y > IMG_H + 100) {
      this.death = true;
      Composite.remove(engine.world, this.body);
    }
  }
}
