import * as THREE from "three";

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas");
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export function makeTextures(anisotropy = 4, low = false) {
  const tileSize = low ? 256 : 384;
  const tile = canvasTex(tileSize, tileSize, (t) => {
    const s = tileSize;
    t.fillStyle = "#4a241c";
    t.fillRect(0, 0, s, s);
    const rowH = s / 16;
    const colW = s / 8;
    const tones = ["#9a5340", "#8a4333", "#7c3c2e", "#a15b45", "#6f3528", "#91503c", "#864636"];
    for (let y = 0; y < 16; y++) {
      const ox = (y % 2) * (colW * 0.5);
      for (let x = -1; x < 9; x++) {
        const px = x * colW + ox + s * 0.008;
        const py = y * rowH + s * 0.006;
        const tw = colW - s * 0.018;
        const th = rowH - s * 0.02;
        t.fillStyle = tones[(x + y * 3 + (y % 4)) % tones.length]!;
        t.fillRect(px, py, tw, th);
        t.fillStyle = "rgba(255,210,170,0.13)";
        t.fillRect(px, py, tw, th * 0.28);
        t.fillStyle = "rgba(40,12,8,0.22)";
        t.fillRect(px, py + th * 0.72, tw, th * 0.28);
        t.strokeStyle = "#3a1a14";
        t.lineWidth = Math.max(1, s / 256);
        t.strokeRect(px, py, tw, th);
      }
    }
  });
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping;

  const metal = canvasTex(256, 256, (t) => {
    t.fillStyle = "#8d9399";
    t.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 16; x++) {
      t.fillStyle = x % 2 ? "#858b92" : "#959ba2";
      t.fillRect(x * 16, 0, 15, 256);
      t.fillStyle = "rgba(255,255,255,0.08)";
      t.fillRect(x * 16 + 2, 0, 3, 256);
    }
  });
  metal.wrapS = metal.wrapT = THREE.RepeatWrapping;

  const panel = canvasTex(256, 512, (c) => {
    c.fillStyle = "#071422";
    c.fillRect(0, 0, 256, 512);
    for (let r = 0; r < 12; r++) {
      for (let col = 0; col < 6; col++) {
        const x = 10 + col * 39;
        const y = 10 + r * 41;
        const g = c.createLinearGradient(x, y, x + 36, y + 38);
        g.addColorStop(0, "#1a4a7c");
        g.addColorStop(0.5, "#0b2748");
        g.addColorStop(1, "#163e68");
        c.fillStyle = g;
        c.fillRect(x, y, 36, 38);
      }
    }
    c.strokeStyle = "#d2d8e0";
    c.lineWidth = 7;
    c.strokeRect(4, 4, 248, 504);
  });

  const plaster = canvasTex(128, 128, (p) => {
    p.fillStyle = "#ece6d8";
    p.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) {
      p.fillStyle = `rgba(150,130,105,${Math.random() * 0.06})`;
      p.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  });
  plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping;

  for (const tex of [tile, metal, panel, plaster]) {
    tex.anisotropy = anisotropy;
  }
  return { tile, metal, panel, plaster };
}

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Texturas extras, usadas só no modo realista (geradas na primeira vez que ele é ligado). */
export function makeRealisticTextures(anisotropy = 4, low = false) {
  const rnd = rand(7);

  // Relevo da telha: mesma grade da textura de cor (16 fileiras x 8 colunas), borda baixa mais alta.
  const bs = low ? 256 : 384;
  const tileBump = canvasTex(bs, bs, (t) => {
    t.fillStyle = "#1c1c1c";
    t.fillRect(0, 0, bs, bs);
    const rowH = bs / 16;
    const colW = bs / 8;
    for (let y = 0; y < 16; y++) {
      const ox = (y % 2) * (colW * 0.5);
      for (let x = -1; x < 9; x++) {
        const px = x * colW + ox + bs * 0.008;
        const py = y * rowH + bs * 0.006;
        const tw = colW - bs * 0.018;
        const th = rowH - bs * 0.02;
        const g = t.createLinearGradient(px, py, px, py + th);
        g.addColorStop(0, "#5a5a5a");
        g.addColorStop(0.7, "#bdbdbd");
        g.addColorStop(1, "#f2f2f2");
        t.fillStyle = g;
        t.fillRect(px, py, tw, th);
        const side = t.createLinearGradient(px, py, px + tw, py);
        side.addColorStop(0, "rgba(0,0,0,0.35)");
        side.addColorStop(0.18, "rgba(0,0,0,0)");
        side.addColorStop(0.82, "rgba(0,0,0,0)");
        side.addColorStop(1, "rgba(0,0,0,0.35)");
        t.fillStyle = side;
        t.fillRect(px, py, tw, th);
      }
    }
  });
  tileBump.colorSpace = THREE.NoColorSpace;
  tileBump.wrapS = tileBump.wrapT = THREE.RepeatWrapping;

  // Grama: manchas e fios em tons de verde.
  const gs = low ? 256 : 512;
  const grass = canvasTex(gs, gs, (g) => {
    g.fillStyle = "#5b7a3c";
    g.fillRect(0, 0, gs, gs);
    for (let i = 0; i < gs * 5; i++) {
      const x = rnd() * gs;
      const y = rnd() * gs;
      const l = 38 + rnd() * 22;
      g.fillStyle = `hsla(${88 + rnd() * 26},${38 + rnd() * 20}%,${l}%,${0.1 + rnd() * 0.22})`;
      g.fillRect(x, y, 1 + rnd() * 2, 2 + rnd() * 5);
    }
    for (let i = 0; i < 40; i++) {
      const x = rnd() * gs;
      const y = rnd() * gs;
      const r = 20 + rnd() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${rnd() > 0.5 ? "120,140,60" : "40,70,30"},0.14)`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(22, 22);

  const grassBump = canvasTex(gs, gs, (g) => {
    g.fillStyle = "#777";
    g.fillRect(0, 0, gs, gs);
    for (let i = 0; i < gs * 6; i++) {
      const v = Math.floor(80 + rnd() * 150);
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(rnd() * gs, rnd() * gs, 1 + rnd(), 2 + rnd() * 4);
    }
  });
  grassBump.colorSpace = THREE.NoColorSpace;
  grassBump.wrapS = grassBump.wrapT = THREE.RepeatWrapping;
  grassBump.repeat.set(22, 22);

  // Cascalho / calçada do pátio.
  const gv = low ? 128 : 256;
  const gravel = canvasTex(gv, gv, (g) => {
    g.fillStyle = "#9a9386";
    g.fillRect(0, 0, gv, gv);
    for (let i = 0; i < gv * 14; i++) {
      const v = 110 + rnd() * 90;
      g.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.25 + rnd() * 0.4})`;
      const s = 1 + rnd() * 2.5;
      g.fillRect(rnd() * gv, rnd() * gv, s, s);
    }
  });
  gravel.wrapS = gravel.wrapT = THREE.RepeatWrapping;
  gravel.repeat.set(7, 7);

  for (const tex of [tileBump, grass, grassBump, gravel]) tex.anisotropy = anisotropy;
  return { tileBump, grass, grassBump, gravel };
}
