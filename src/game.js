// にくきゅうキャッチ！
// 落ちてくる猫の肉球をタップして跳ねさせ、地面に落とさないようにスコアを稼ぐゲーム。
// アートは Phaser の Graphics で描画、鳴き声は Web Audio で合成しているため外部アセット不要。

'use strict';

const W = 480;
const H = 720;
const GROUND_H = 84;
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif';
const BEST_KEY = 'nikukyu-catch-best';

// ---------------------------------------------------------------------------
// 効果音(Web Audio 合成)
// ---------------------------------------------------------------------------
const SoundFX = {
  ctx: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  // 「にゃっ♪」猫の鳴き声。ピッチを上げてから下げるグライドで鳴き声らしさを出す
  meow() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = 460 + Math.random() * 240;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.9, t + 0.08);
    osc.frequency.linearRampToValueAtTime(base * 1.2, t + 0.2);
    osc.frequency.linearRampToValueAtTime(base * 0.72, t + 0.32);

    const vib = ctx.createOscillator();
    vib.frequency.value = 24;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 16;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(base * 2.2, t);
    filter.frequency.linearRampToValueAtTime(base * 3.1, t + 0.1);
    filter.frequency.linearRampToValueAtTime(base * 1.4, t + 0.32);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
    gain.gain.setValueAtTime(0.4, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 0.4);
    vib.stop(t + 0.4);
  },

  // 肉球が地面に落ちたときの「ぽてっ」という残念な音
  poof() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.28);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  },

  // スタート時の明るいファンファーレ
  start() {
    this.jingle([523, 659, 784], 0.09, 0.22);
  },

  // ゲームオーバーの切ないジングル
  gameOver() {
    this.jingle([440, 349, 262], 0.16, 0.3);
  },

  jingle(freqs, step, len) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const t = t0 + i * step;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len + 0.02);
    });
  }
};

// ---------------------------------------------------------------------------
// ベストスコアの保存(localStorage が使えない環境でも動くようにガード)
// ---------------------------------------------------------------------------
function loadBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch (e) {
    /* 保存できなくてもゲームは続行 */
  }
}

// ---------------------------------------------------------------------------
// 共通のテキストスタイル/背景
// ---------------------------------------------------------------------------
function textStyle(size, color, strokeWidth) {
  return {
    fontFamily: FONT,
    fontSize: size + 'px',
    fontStyle: 'bold',
    color: color,
    stroke: '#ffffff',
    strokeThickness: strokeWidth === undefined ? 6 : strokeWidth,
    align: 'center'
  };
}

function drawBackground(scene) {
  const g = scene.add.graphics();
  g.fillGradientStyle(0xffe3ee, 0xffe3ee, 0xfff8e6, 0xfff8e6, 1);
  g.fillRect(0, 0, W, H);

  // ふわふわ流れる雲
  for (let i = 0; i < 3; i++) {
    const cloud = scene.add.image(
      Phaser.Math.Between(0, W),
      70 + i * 90,
      'cloud'
    ).setAlpha(0.85).setScale(0.8 + i * 0.15);
    scene.tweens.add({
      targets: cloud,
      x: cloud.x + W + 200,
      duration: Phaser.Math.Between(26000, 40000),
      repeat: -1,
      onRepeat: () => { cloud.x = -120; }
    });
  }

  // 地面(パステルグリーンの芝生とお花)
  const ground = scene.add.graphics();
  ground.fillStyle(0xbde8b4, 1);
  ground.fillRect(0, H - GROUND_H, W, GROUND_H);
  ground.fillStyle(0xa9dfa0, 1);
  for (let x = -10; x < W + 10; x += 40) {
    ground.fillEllipse(x, H - GROUND_H + 4, 52, 22);
  }
  const flowerColors = [0xffffff, 0xffd6e4, 0xfff3b8];
  for (let i = 0; i < 9; i++) {
    const fx = 20 + i * 52 + Phaser.Math.Between(-10, 10);
    const fy = H - GROUND_H + Phaser.Math.Between(26, 66);
    const c = flowerColors[i % flowerColors.length];
    ground.fillStyle(c, 1);
    for (let p = 0; p < 5; p++) {
      const a = (Math.PI * 2 * p) / 5;
      ground.fillCircle(fx + Math.cos(a) * 6, fy + Math.sin(a) * 6, 4.5);
    }
    ground.fillStyle(0xffc94d, 1);
    ground.fillCircle(fx, fy, 4);
  }
}

// ---------------------------------------------------------------------------
// BootScene: すべてのテクスチャをコードで生成する
// ---------------------------------------------------------------------------
class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  create() {
    this.makePawTexture();
    this.makeHeartTexture();
    this.makeCloudTexture();
    this.makeCatTexture('cat-happy', false);
    this.makeCatTexture('cat-sad', true);
    this.scene.start('title');
  }

  // 猫の肉球:クリーム色のおててにピンクのぷにぷに
  makePawTexture() {
    const g = this.add.graphics();
    g.fillStyle(0xfff6ec, 1);
    g.fillCircle(64, 70, 52);
    g.lineStyle(5, 0xf2c19d, 1);
    g.strokeCircle(64, 70, 52);

    g.fillStyle(0xffa3bd, 1);
    g.fillEllipse(64, 86, 52, 40);   // メインパッド
    g.fillEllipse(30, 48, 20, 25);   // 指のぷにぷに x4
    g.fillEllipse(52, 34, 20, 25);
    g.fillEllipse(76, 34, 20, 25);
    g.fillEllipse(98, 48, 20, 25);

    g.fillStyle(0xffc4d6, 1);
    g.fillEllipse(56, 80, 18, 12);   // パッドのつや

    g.generateTexture('paw', 128, 128);
    g.destroy();
  }

  makeHeartTexture() {
    const g = this.add.graphics();
    g.fillStyle(0xff8fb3, 1);
    g.fillCircle(8, 9, 8);
    g.fillCircle(20, 9, 8);
    g.fillTriangle(1, 13, 27, 13, 14, 27);
    g.generateTexture('heart', 28, 28);
    g.destroy();
  }

  makeCloudTexture() {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(32, 38, 22);
    g.fillCircle(68, 28, 27);
    g.fillCircle(104, 38, 22);
    g.fillRect(30, 34, 76, 24);
    g.generateTexture('cloud', 140, 62);
    g.destroy();
  }

  // 見守り役の猫。sad=true で泣き顔になる
  makeCatTexture(key, sad) {
    const g = this.add.graphics();

    // 耳
    g.fillStyle(0xfff6ec, 1);
    g.fillTriangle(28, 62, 46, 8, 78, 44);
    g.fillTriangle(132, 62, 114, 8, 82, 44);
    g.fillStyle(0xffb9cd, 1);
    g.fillTriangle(40, 50, 49, 22, 66, 42);
    g.fillTriangle(120, 50, 111, 22, 94, 42);

    // 顔
    g.fillStyle(0xfff6ec, 1);
    g.fillCircle(80, 82, 55);
    g.lineStyle(5, 0xf2c19d, 1);
    g.strokeCircle(80, 82, 55);

    // ほっぺ
    g.fillStyle(0xffc4d6, 0.9);
    g.fillCircle(44, 96, 10);
    g.fillCircle(116, 96, 10);

    // 目と口
    g.lineStyle(5, 0x6b4a3a, 1);
    if (sad) {
      // への字の目と涙
      g.beginPath();
      g.arc(58, 82, 9, 0, Math.PI, false);
      g.strokePath();
      g.beginPath();
      g.arc(102, 82, 9, 0, Math.PI, false);
      g.strokePath();
      g.fillStyle(0x9ed4ff, 1);
      g.fillEllipse(50, 98, 10, 16);
      g.fillEllipse(110, 98, 10, 16);
      g.lineStyle(5, 0x6b4a3a, 1);
      g.beginPath();
      g.arc(80, 108, 8, Math.PI, Math.PI * 2, false);
      g.strokePath();
    } else {
      // にっこりの目(∩ ∩)と ω の口
      g.beginPath();
      g.arc(58, 80, 9, Math.PI, Math.PI * 2, false);
      g.strokePath();
      g.beginPath();
      g.arc(102, 80, 9, Math.PI, Math.PI * 2, false);
      g.strokePath();
      g.beginPath();
      g.arc(72, 100, 7, 0, Math.PI, false);
      g.strokePath();
      g.beginPath();
      g.arc(88, 100, 7, 0, Math.PI, false);
      g.strokePath();
    }

    // 鼻
    g.fillStyle(0xff8fb3, 1);
    g.fillTriangle(74, 92, 86, 92, 80, 99);

    // ひげ
    g.lineStyle(3, 0xd9b391, 1);
    g.lineBetween(18, 88, 40, 90);
    g.lineBetween(18, 100, 40, 98);
    g.lineBetween(142, 88, 120, 90);
    g.lineBetween(142, 100, 120, 98);

    g.generateTexture(key, 160, 140);
    g.destroy();
  }
}

// ---------------------------------------------------------------------------
// TitleScene
// ---------------------------------------------------------------------------
class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    drawBackground(this);

    const paw = this.add.image(W / 2, 200, 'paw').setScale(1.6);
    this.tweens.add({
      targets: paw,
      y: 185,
      angle: 6,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.add.text(W / 2, 330, 'にくきゅう\nキャッチ！', textStyle(52, '#ff6f9c', 10))
      .setOrigin(0.5).setLineSpacing(6);

    this.add.text(W / 2, 448,
      'おちてくる にくきゅうを タップして\nじめんに おとさないでね！\nぜんぶ おちたら ゲームオーバー',
      textStyle(20, '#8a6d5c', 4)
    ).setOrigin(0.5).setLineSpacing(8);

    const best = loadBest();
    if (best > 0) {
      this.add.text(W / 2, 522, `ベストスコア: ${best}`, textStyle(22, '#ffa04d', 5)).setOrigin(0.5);
    }

    const startText = this.add.text(W / 2, 575, 'タップして スタート！', textStyle(28, '#ff6f9c'))
      .setOrigin(0.5);
    this.tweens.add({
      targets: startText,
      alpha: 0.25,
      duration: 600,
      yoyo: true,
      repeat: -1
    });

    // 草むらからひょっこり顔を出す猫
    this.add.image(W / 2, H - 55, 'cat-happy');

    this.input.once('pointerdown', () => {
      SoundFX.start();
      this.scene.start('game');
    });
  }
}

// ---------------------------------------------------------------------------
// GameScene
// ---------------------------------------------------------------------------
class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  create() {
    drawBackground(this);

    this.score = 0;
    this.best = loadBest();
    this.gravityY = 240;
    this.isGameOver = false;

    // 左右と上でだけ跳ね返り、下には抜ける
    this.physics.world.setBounds(0, -60, W, H + 260);
    this.physics.world.setBoundsCollision(true, true, true, false);

    this.paws = this.physics.add.group();

    this.scoreText = this.add.text(20, 16, 'スコア 0', textStyle(34, '#ff6f9c'));
    this.add.text(W - 20, 24, `ベスト ${this.best}`, textStyle(20, '#ffa04d', 4)).setOrigin(1, 0);

    // 最初の肉球
    this.time.delayedCall(400, () => this.spawnPaw());

    // 徐々に肉球を増やす
    this.addTimer = this.time.addEvent({
      delay: 9000,
      loop: true,
      callback: () => {
        if (this.isGameOver) return;
        if (this.paws.countActive(true) >= 7) return;
        this.spawnPaw();
        this.announce('にくきゅうが ふえた！');
      }
    });
  }

  spawnPaw() {
    if (this.isGameOver) return;
    const x = Phaser.Math.Between(70, W - 70);
    const paw = this.paws.create(x, -70, 'paw');
    paw.setBounce(0.9, 0.4);
    paw.setCollideWorldBounds(true);
    paw.body.gravity.y = this.gravityY;
    paw.setVelocity(Phaser.Math.Between(-60, 60), Phaser.Math.Between(30, 90));
    paw.setAngularVelocity(Phaser.Math.Between(-40, 40));
    paw.setScale(0);
    this.tweens.add({ targets: paw, scale: 1, duration: 250, ease: 'Back.easeOut' });

    paw.setInteractive({ useHandCursor: true });
    paw.on('pointerdown', (pointer) => this.tapPaw(paw, pointer));
    return paw;
  }

  tapPaw(paw, pointer) {
    if (this.isGameOver || !paw.active) return;

    // 上に跳ねる。タップ位置の左右で弾く方向が変わる
    const vy = -(300 + this.gravityY * 0.35 + Math.random() * 60);
    let vx = (paw.x - pointer.worldX) * 8 + Phaser.Math.Between(-40, 40);
    vx = Phaser.Math.Clamp(paw.body.velocity.x * 0.3 + vx, -220, 220);
    paw.setVelocity(vx, vy);
    paw.setAngularVelocity(Phaser.Math.Between(-90, 90));

    // ぷにっとつぶれる
    this.tweens.add({
      targets: paw,
      scaleX: 1.2,
      scaleY: 0.75,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut'
    });

    SoundFX.meow();
    this.score += 1;
    this.scoreText.setText(`スコア ${this.score}`);
    this.tweens.add({
      targets: this.scoreText,
      scale: 1.15,
      duration: 90,
      yoyo: true
    });

    // 鳴き声の吹き出しとハート
    const cries = ['にゃ！', 'ニャン♪', 'みゃ！', 'にゃ〜ん'];
    const cry = this.add.text(paw.x, paw.y - 60, Phaser.Utils.Array.GetRandom(cries),
      textStyle(24, '#ff6f9c', 5)).setOrigin(0.5);
    this.tweens.add({
      targets: cry,
      y: cry.y - 50,
      alpha: 0,
      duration: 650,
      onComplete: () => cry.destroy()
    });

    for (let i = 0; i < 3; i++) {
      const heart = this.add.image(
        paw.x + Phaser.Math.Between(-30, 30),
        paw.y + Phaser.Math.Between(-20, 20),
        'heart'
      ).setScale(Phaser.Math.FloatBetween(0.5, 0.9));
      this.tweens.add({
        targets: heart,
        y: heart.y - Phaser.Math.Between(40, 80),
        alpha: 0,
        angle: Phaser.Math.Between(-30, 30),
        duration: 550,
        onComplete: () => heart.destroy()
      });
    }
  }

  dropPaw(paw) {
    paw.disableInteractive();
    this.paws.remove(paw);
    paw.body.enable = false;

    SoundFX.poof();
    this.cameras.main.shake(120, 0.004);

    const oops = this.add.text(paw.x, H - GROUND_H - 70, 'あぅ…', textStyle(22, '#8a6d5c', 4))
      .setOrigin(0.5);
    this.tweens.add({
      targets: oops,
      y: oops.y - 40,
      alpha: 0,
      duration: 700,
      onComplete: () => oops.destroy()
    });

    // ぺたんとつぶれて消える
    this.tweens.add({
      targets: paw,
      y: H - GROUND_H + 10,
      scaleY: 0.35,
      scaleX: 1.25,
      angle: 0,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeIn',
      onComplete: () => paw.destroy()
    });

    if (!this.isGameOver && this.paws.countActive(true) === 0) {
      this.gameOver();
    }
  }

  announce(message) {
    const t = this.add.text(W / 2, 130, message, textStyle(26, '#ffa04d')).setOrigin(0.5).setScale(0);
    this.tweens.add({
      targets: t,
      scale: 1,
      duration: 200,
      ease: 'Back.easeOut'
    });
    this.tweens.add({
      targets: t,
      alpha: 0,
      delay: 900,
      duration: 300,
      onComplete: () => t.destroy()
    });
  }

  gameOver() {
    this.isGameOver = true;
    this.addTimer.remove();
    SoundFX.gameOver();

    if (this.score > this.best) {
      saveBest(this.score);
    }

    this.cameras.main.shake(200, 0.006);
    this.time.delayedCall(700, () => {
      this.scene.start('over', { score: this.score, best: this.best });
    });
  }

  update(time, delta) {
    if (this.isGameOver) return;

    // だんだん落下が速くなる
    this.gravityY = Math.min(560, this.gravityY + delta * 0.004);

    this.paws.getChildren().forEach((paw) => {
      if (!paw.active) return;
      paw.body.gravity.y = this.gravityY;
      if (paw.y > H - GROUND_H + 6) {
        this.dropPaw(paw);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// GameOverScene
// ---------------------------------------------------------------------------
class GameOverScene extends Phaser.Scene {
  constructor() { super('over'); }

  init(data) {
    this.finalScore = data.score || 0;
    this.prevBest = data.best || 0;
  }

  create() {
    drawBackground(this);

    this.add.text(W / 2, 150, 'ゲームオーバー', textStyle(46, '#ff6f9c', 9)).setOrigin(0.5);

    const cat = this.add.image(W / 2, 290, 'cat-sad').setScale(1.2);
    this.tweens.add({
      targets: cat,
      angle: 3,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.add.text(W / 2, 420, `スコア: ${this.finalScore}`, textStyle(36, '#ff6f9c')).setOrigin(0.5);

    if (this.finalScore > this.prevBest) {
      const record = this.add.text(W / 2, 472, '✨ しんきろく！ ✨', textStyle(28, '#ffa04d')).setOrigin(0.5);
      this.tweens.add({
        targets: record,
        scale: 1.1,
        duration: 450,
        yoyo: true,
        repeat: -1
      });
    } else {
      this.add.text(W / 2, 472, `ベスト: ${Math.max(this.prevBest, this.finalScore)}`,
        textStyle(24, '#ffa04d', 5)).setOrigin(0.5);
    }

    const retry = this.add.text(W / 2, 560, 'タップして もういちど！', textStyle(28, '#ff6f9c')).setOrigin(0.5);
    this.tweens.add({
      targets: retry,
      alpha: 0.25,
      duration: 600,
      yoyo: true,
      repeat: -1
    });

    // 装飾: ゆっくり落ちる肉球
    this.time.addEvent({
      delay: 1400,
      loop: true,
      callback: () => {
        const p = this.add.image(Phaser.Math.Between(40, W - 40), -60, 'paw')
          .setScale(Phaser.Math.FloatBetween(0.4, 0.7)).setAlpha(0.6);
        this.tweens.add({
          targets: p,
          y: H + 80,
          angle: Phaser.Math.Between(-90, 90),
          duration: Phaser.Math.Between(5000, 8000),
          onComplete: () => p.destroy()
        });
      }
    });

    this.input.once('pointerdown', () => {
      SoundFX.start();
      this.scene.start('game');
    });
  }
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#ffe9f0',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene, TitleScene, GameScene, GameOverScene]
};

window.__game = new Phaser.Game(config);
