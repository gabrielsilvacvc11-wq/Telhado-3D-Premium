import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { MODULE, computePlan, layoutSlots, polyGeometry, relabelFaces } from "./geometry";
import { addMounting } from "./mount";
import { orientOnRoof } from "./mount/hardware";
import { makeRealisticTextures, makeTextures } from "./textures";
import { DAY_HOURS, SHADE_STRINGS, finishReport, sunIrradiance, sunPos, type ShadeReport } from "./shade";
import { detectQuality, type Quality } from "./quality";
import type { CameraPreset, Heading, NeighborKind, PlantConfig } from "./types";
import type { PlantState } from "./store";

export type EngineSnapshot = Pick<
  PlantState,
  | "kind"
  | "width"
  | "depth"
  | "wall"
  | "pitch"
  | "ridge"
  | "yaw"
  | "selectedFaces"
  | "quantity"
  | "modulesOn"
  | "structureOn"
  | "sunOn"
  | "sunPaused"
  | "sunSpeed"
  | "sunT"
  | "cameraPreset"
  | "step"
  | "watt"
  | "neighborOn"
  | "neighborKind"
  | "neighborCount"
  | "neighborSide"
  | "neighborHeight"
  | "neighborGap"
  | "realistic"
>;

type ModuleProbe = {
  group: THREE.Group;
  cells: THREE.Mesh[];
};

export class PlantEngine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  house = new THREE.Group();
  neighbor = new THREE.Group();
  sun: THREE.DirectionalLight;
  sunBall: THREE.Mesh;
  hemi: THREE.HemisphereLight;
  textures: ReturnType<typeof makeTextures>;
  mats: Record<string, THREE.MeshStandardMaterial>;
  running = true;
  private lastKey: string | null = null;
  private lastCam: CameraPreset | null = null;
  private lastKind: string | null = null;
  private lastNeighborKey = "";
  private camGoal: THREE.Vector3 | null = null;
  private lookGoal = new THREE.Vector3(0, 2.4, 0);
  private snapshot!: EngineSnapshot;
  private raf = 0;
  private lastTs = 0;
  private probes: ModuleProbe[] = [];
  private ray = new THREE.Raycaster();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private shadeAcc = 0;
  private lastDayKey = "";
  private dayCache = { kwh: 0, kwhClear: 0 };
  private lastShadeSig = "";
  onReport: ((r: ShadeReport) => void) | null = null;
  private quality: Quality;
  private boxGeos = new Map<string, THREE.BoxGeometry>();
  private sharedGeo = new WeakSet<THREE.BufferGeometry>();
  private shadowTick = 0;
  private lastSunPos = new THREE.Vector3();
  private realistic = false;
  private realTex: ReturnType<typeof makeRealisticTextures> | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private skyScene: THREE.Scene | null = null;
  private skyMesh: Sky | null = null;
  private skyRT: THREE.WebGLRenderTarget | null = null;
  private skyDir = new THREE.Vector3(0, 1, 0);
  private skyStamp = 0;
  private scenery = new THREE.Group();
  private baseMats = new Map<string, { color: THREE.Color; roughness: number; metalness: number; map: THREE.Texture | null; env: number }>();

  constructor(private canvas: HTMLCanvasElement) {
    this.quality = detectQuality();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: this.quality.low ? "low-power" : "high-performance",
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality.low ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = !this.quality.low;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#8aa7bd");
    this.scene.fog = new THREE.Fog("#8aa7bd", this.quality.low ? 28 : 36, this.quality.far * 0.72);

    this.camera = new THREE.PerspectiveCamera(this.quality.mobile ? 52 : 46, 1, 0.12, this.quality.far);
    this.camera.position.set(13, 9.5, -15);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = this.quality.mobile ? 0.1 : 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.66;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = this.quality.low ? 52 : 80;
    this.controls.rotateSpeed = this.quality.mobile ? 0.72 : 1;
    this.controls.zoomSpeed = this.quality.mobile ? 0.85 : 1;
    this.controls.addEventListener("start", () => {
      this.camGoal = null;
    });

    this.hemi = new THREE.HemisphereLight("#dce7f4", "#6a5c48", 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4dc", 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = this.quality.low ? 90 : 130;
    const extent = this.quality.low ? 28 : 42;
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -extent;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = extent;
    this.sun.shadow.bias = this.quality.low ? -0.0008 : -0.00028;
    this.scene.add(this.sun);
    const ballSeg = this.quality.low ? 10 : 16;
    this.sunBall = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, ballSeg, ballSeg),
      new THREE.MeshBasicMaterial({ color: "#ffd7a1" }),
    );
    this.scene.add(this.sunBall);

    if (!this.quality.low) {
      const fill = new THREE.DirectionalLight("#9bb0c4", 0.28);
      fill.position.set(12, 8, 16);
      this.scene.add(fill);
    }

    const aniso = Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    this.textures = makeTextures(aniso, this.quality.low);
    this.mats = {
      wall: new THREE.MeshStandardMaterial({ color: "#ece6d8", roughness: 0.88, map: this.textures.plaster }),
      metalWall: new THREE.MeshStandardMaterial({ color: "#9aa3ab", roughness: 0.55, metalness: 0.35, map: this.textures.metal }),
      tile: new THREE.MeshStandardMaterial({ color: "#8d4a38", roughness: 0.78, map: this.textures.tile }),
      metalRoof: new THREE.MeshStandardMaterial({ color: "#7d848c", roughness: 0.42, metalness: 0.45, map: this.textures.metal }),
      membrane: new THREE.MeshStandardMaterial({ color: "#4a4e53", roughness: 0.9 }),
      panel: new THREE.MeshStandardMaterial({
        color: "#10243d",
        roughness: 0.18,
        metalness: 0.38,
        map: this.textures.panel,
      }),
      silver: new THREE.MeshStandardMaterial({ color: "#c5ced6", roughness: 0.32, metalness: 0.7 }),
      rail: new THREE.MeshStandardMaterial({
        color: "#3d4550",
        roughness: 0.38,
        metalness: 0.72,
        side: this.quality.low ? THREE.FrontSide : THREE.DoubleSide,
      }),
      wood: new THREE.MeshStandardMaterial({ color: "#5e3822", roughness: 0.7 }),
      frame: new THREE.MeshStandardMaterial({ color: "#2a3138", roughness: 0.42 }),
      glass: new THREE.MeshStandardMaterial({ color: "#8fb0c4", roughness: 0.12, metalness: 0.28, transparent: true, opacity: 0.68 }),
      base: new THREE.MeshStandardMaterial({ color: "#b3ada2", roughness: 0.92 }),
      cap: new THREE.MeshStandardMaterial({ color: "#5a271e", roughness: 0.5 }),
      grass: new THREE.MeshStandardMaterial({ color: "#5e7540", roughness: 0.96 }),
      gravel: new THREE.MeshStandardMaterial({ color: "#9a9386", roughness: 0.9 }),
      invert: new THREE.MeshStandardMaterial({ color: "#e8ecf0", roughness: 0.32 }),
      neighborWall: new THREE.MeshStandardMaterial({ color: "#b7aea3", roughness: 0.9, map: this.textures.plaster }),
      neighborTile: new THREE.MeshStandardMaterial({ color: "#7a3d2f", roughness: 0.78, map: this.textures.tile }),
      leaf: new THREE.MeshStandardMaterial({ color: "#3f6a38", roughness: 0.88 }),
      panelShaded: new THREE.MeshStandardMaterial({
        color: "#05070c",
        roughness: 0.92,
        metalness: 0.08,
        map: this.textures.panel,
      }),
    };

    for (const [name, m] of Object.entries(this.mats)) {
      this.baseMats.set(name, { color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, map: m.map, env: m.envMapIntensity });
    }
    this.scene.add(this.scenery);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(58, this.quality.groundSeg), this.mats.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const patio = new THREE.Mesh(new THREE.CircleGeometry(12, this.quality.patioSeg), this.mats.gravel);
    patio.rotation.x = -Math.PI / 2;
    patio.position.y = 0.012;
    patio.receiveShadow = true;
    this.scene.add(patio);

    for (let i = 0; i < this.quality.trees; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.16, 1.2, this.quality.low ? 5 : 6),
        new THREE.MeshStandardMaterial({ color: "#5a3a24", roughness: 0.9 }),
      );
      trunk.position.y = 0.6;
      trunk.castShadow = !this.quality.low;
      const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.05, 0),
        new THREE.MeshStandardMaterial({ color: i % 2 ? "#3d6736" : "#4a783c", roughness: 0.85 }),
      );
      crown.position.y = 1.95;
      crown.castShadow = !this.quality.low;
      tree.add(trunk, crown);
      const a = (i / this.quality.trees) * Math.PI * 2 + 0.5;
      tree.position.set(Math.cos(a) * 26, 0, Math.sin(a) * 26);
      this.scene.add(tree);
    }

    this.scene.add(this.house);
    this.scene.add(this.neighbor);
    this.resize();
    this.loop(0);
    window.addEventListener("resize", this.resize);
    window.visualViewport?.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.visualViewport?.height || window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(this.quality.dpr);
  };

  private onVisibility = () => {
    if (document.hidden) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      return;
    }
    if (!this.running) {
      this.running = true;
      this.lastTs = 0;
      this.loop(performance.now());
    }
  };

  sync(s: EngineSnapshot) {
    this.snapshot = s;
    if (s.realistic !== this.realistic) this.setRealism(s.realistic);
    const key = [
      s.kind,
      s.width,
      s.depth,
      s.wall,
      s.pitch,
      s.ridge,
      s.yaw,
      s.selectedFaces.join(","),
      s.quantity,
      s.modulesOn,
      s.structureOn,
      s.step,
      s.neighborOn,
      s.neighborKind,
      s.neighborCount,
      s.neighborSide,
      s.neighborHeight,
      s.neighborGap,
    ].join("|");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.rebuild(s);
    }
    const nKey = `${s.neighborOn}:${s.neighborSide}:${s.neighborKind}:${s.neighborCount}`;
    this.applyCamera(
      s.cameraPreset,
      this.lastCam !== s.cameraPreset || this.lastNeighborKey !== nKey || this.lastKind !== s.kind,
    );
    this.lastCam = s.cameraPreset;
    this.lastNeighborKey = nKey;
    this.lastKind = s.kind;
  }

  applyCamera(preset: CameraPreset, force: boolean) {
    if (!force) return;
    if (preset === "orbit") {
      if (this.snapshot.kind === "ground") {
        this.lookGoal.set(0, 1.15, 0);
        this.camGoal = new THREE.Vector3(10.5, 3.4, -9.5);
      } else if (this.snapshot.kind === "flat") {
        this.lookGoal.set(0, this.snapshot.wall + 0.7, 0);
        this.camGoal = new THREE.Vector3(11, this.snapshot.wall + 3.4, -10);
      } else {
        this.camGoal = null;
      }
      return;
    }
    const d = Math.max(this.snapshot.width, this.snapshot.depth);
    const extra = this.snapshot.neighborOn ? 18 : 0;
    const h = this.snapshot.wall + 2;
    if (this.snapshot.neighborOn && (preset === "aerial" || preset === "front" || preset === "side" || preset === "top")) {
      const pair = this.pairFrame(this.snapshot, preset);
      this.camGoal = pair.cam;
      this.lookGoal.copy(pair.look);
      return;
    }
    this.lookGoal.set(0, Math.max(this.snapshot.wall * 0.4, 1.1), 0);
    if (preset === "structure") {
      if (this.snapshot.kind === "ground") {
        this.lookGoal.set(0, 1.35, 0);
        this.camGoal = new THREE.Vector3(5.8, 0.28, 4.4);
      } else if (this.snapshot.kind === "flat") {
        this.lookGoal.set(0, this.snapshot.wall + 0.72, 0);
        this.camGoal = new THREE.Vector3(5.6, this.snapshot.wall + 0.08, 4.2);
      } else {
        this.lookGoal.set(0, this.snapshot.wall + 1.85, 0);
        this.camGoal = new THREE.Vector3(7.2, this.snapshot.wall + 0.15, 2.4);
      }
      return;
    }
    const map: Record<Exclude<CameraPreset, "orbit">, THREE.Vector3> = {
      front: new THREE.Vector3(0, h, -d * 1.35 - 6),
      side: new THREE.Vector3(
        d * 1.3 + 6,
        this.snapshot.kind === "ground" ? 2.4 : this.snapshot.kind === "flat" ? this.snapshot.wall + 1.6 : h,
        0,
      ),
      top: new THREE.Vector3(0.2, d * 1.8 + 8, 0.2),
      aerial: new THREE.Vector3(d * 1.35, d * 0.85 + 11, -d * 1.45),
      modules: new THREE.Vector3(3.2, this.snapshot.wall + 3.2, -d * 0.2),
      structure: new THREE.Vector3(4.5, this.snapshot.wall + 1.4, -5),
      inverter: new THREE.Vector3(-this.snapshot.width * 0.7 - 3, 2.2, 1.4),
    };
    const goal = map[preset];
    if (force || !this.camGoal || this.camGoal.distanceTo(goal) > 0.05) this.camGoal = goal.clone();
  }

  private pairFrame(s: EngineSnapshot, preset: CameraPreset) {
    const span = Math.max(s.width, s.depth) + s.neighborGap + 14 + (s.neighborCount > 1 ? 10 : 0);
    const h = Math.max(s.neighborHeight, s.wall) * 0.5 + (preset === "top" ? span * 0.9 : 12);
    const look = new THREE.Vector3(0, 2.6, 0);
    const cam = new THREE.Vector3();
    const mid = 5.5;
    if (s.neighborSide === "N") {
      look.set(0, 2.6, mid);
      if (preset === "top") cam.set(1, h + 8, mid);
      else if (preset === "front") cam.set(0, h * 0.7, -span * 0.35);
      else cam.set(span * 0.92, h, mid);
    } else if (s.neighborSide === "S") {
      look.set(0, 2.6, -mid);
      if (preset === "top") cam.set(1, h + 8, -mid);
      else if (preset === "front") cam.set(0, h * 0.7, span * 0.35);
      else cam.set(span * 0.92, h, -mid);
    } else if (s.neighborSide === "L") {
      look.set(mid, 2.6, 0);
      if (preset === "top") cam.set(mid, h + 8, 1);
      else if (preset === "side") cam.set(span * 0.55, h, 0);
      else cam.set(mid, h, -span * 0.92);
    } else {
      look.set(-mid, 2.6, 0);
      if (preset === "top") cam.set(-mid, h + 8, 1);
      else if (preset === "side") cam.set(-span * 0.55, h, 0);
      else cam.set(-mid, h, -span * 0.92);
    }
    return { cam, look };
  }

  private box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    cast = true,
  ) {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private boxGeo(w: number, h: number, d: number) {
    const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
    let geo = this.boxGeos.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      this.boxGeos.set(key, geo);
      this.sharedGeo.add(geo);
    }
    return geo;
  }

  private clearGroup(group: THREE.Group) {
    while (group.children.length) {
      const ch = group.children.pop()!;
      ch.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry && !this.sharedGeo.has(mesh.geometry)) mesh.geometry.dispose();
      });
    }
  }

  private neighborYaw(side: Heading) {
    if (side === "S") return Math.PI;
    if (side === "L") return Math.PI / 2;
    if (side === "O") return -Math.PI / 2;
    return 0;
  }

  private buildNeighbor(s: EngineSnapshot) {
    this.clearGroup(this.neighbor);
    this.neighbor.visible = s.neighborOn;
    if (!s.neighborOn) return;

    const kind = s.neighborKind;
    const count = this.quality.low ? Math.min(s.neighborCount, 3) : s.neighborCount;
    const order: Heading[] = ["N", "L", "S", "O"];
    const start = Math.max(0, order.indexOf(s.neighborSide));
    const yaw = (s.yaw * Math.PI) / 180;
    const extX = Math.abs((s.width / 2) * Math.cos(yaw)) + Math.abs((s.depth / 2) * Math.sin(yaw));
    const extZ = Math.abs((s.width / 2) * Math.sin(yaw)) + Math.abs((s.depth / 2) * Math.cos(yaw));

    for (let i = 0; i < count; i++) {
      const side = order[(start + i) % 4]!;
      const hScale = i === 0 ? 1 : 0.82 + ((i * 17) % 13) / 50;
      const h = Math.max(2.4, s.neighborHeight * hScale);
      const g = this.makeNeighborMesh(kind, s, h, i);
      const nW = g.userData.nW as number;
      const nD = g.userData.nD as number;
      let x = 0;
      let z = 0;
      const reach = s.neighborGap + nD / 2;
      if (side === "N") z = extZ + reach;
      else if (side === "S") z = -(extZ + reach);
      else if (side === "L") x = extX + reach;
      else x = -(extX + reach);
      g.rotation.y = this.neighborYaw(side);
      g.position.set(x, 0, z);
      this.neighbor.add(g);
    }
  }

  private makeNeighborMesh(kind: NeighborKind, s: EngineSnapshot, nH: number, idx: number) {
    const g = new THREE.Group();
    if (kind === "tree") {
      const nW = 3.6;
      const nD = 3.6;
      g.userData = { nW, nD };
      this.addNeighborTree(g, nH);
      return g;
    }
    if (kind === "building") {
      const nW = Math.max(9, s.width * 0.72);
      const nD = Math.max(8, s.depth * 0.55);
      g.userData = { nW, nD };
      this.addNeighborBuilding(g, nW, nD, nH);
      return g;
    }
    if (kind === "warehouse") {
      const nW = Math.max(10, s.width * 0.88);
      const nD = Math.max(11, s.depth * 0.8);
      g.userData = { nW, nD };
      this.addNeighborWarehouse(g, nW, nD, nH);
      return g;
    }
    const nW = Math.max(8.2, s.width * 0.86);
    const nD = Math.max(7.4, s.depth * 0.74);
    g.userData = { nW, nD };
    this.addNeighborHouse(g, nW, nD, nH, idx);
    return g;
  }

  private addNeighborHouse(g: THREE.Group, nW: number, nD: number, nH: number, idx: number) {
    this.box(g, nW + 0.26, 0.16, nD + 0.26, 0, 0.08, 0, this.mats.base, false);
    this.box(g, nW, nH, 0.22, 0, nH / 2, -nD / 2 + 0.11, this.mats.neighborWall);
    this.box(g, nW, nH, 0.22, 0, nH / 2, nD / 2 - 0.11, this.mats.neighborWall);
    this.box(g, 0.22, nH, nD - 0.2, -nW / 2 + 0.11, nH / 2, 0, this.mats.neighborWall);
    this.box(g, 0.22, nH, nD - 0.2, nW / 2 - 0.11, nH / 2, 0, this.mats.neighborWall);
    const win = Math.min(1.35, nW * 0.18);
    for (const wx of [-nW * 0.26, nW * 0.26]) {
      this.box(g, win + 0.1, 1.12, 0.07, wx, nH * 0.42, -nD / 2 - 0.02, this.mats.frame);
      this.box(g, win, 1.02, 0.04, wx, nH * 0.42, -nD / 2 - 0.06, this.mats.glass);
    }
    this.box(g, 1.05, 2.15, 0.08, 0, 1.12, -nD / 2 - 0.03, this.mats.wood);
    const rise = Math.tan((27 * Math.PI) / 180) * (nW / 2);
    const y0 = nH;
    const yR = nH + rise;
    const hw = nW / 2 + 0.28;
    const hd = nD / 2 + 0.28;
    const left = [
      new THREE.Vector3(-hw, y0, -hd),
      new THREE.Vector3(-hw, y0, hd),
      new THREE.Vector3(0, yR, hd),
      new THREE.Vector3(0, yR, -hd),
    ];
    const right = [
      new THREE.Vector3(hw, y0, -hd),
      new THREE.Vector3(0, yR, -hd),
      new THREE.Vector3(0, yR, hd),
      new THREE.Vector3(hw, y0, hd),
    ];
    for (const pts of [left, right]) {
      const roof = new THREE.Mesh(polyGeometry(pts, 1.05), this.mats.neighborTile);
      roof.castShadow = true;
      roof.receiveShadow = true;
      g.add(roof);
    }
    this.box(g, 0.14, 0.08, nD + 0.4, 0, yR + 0.03, 0, this.mats.cap);
    if (!this.quality.low) this.box(g, 0.28, 0.85, 0.28, nW * 0.22, yR + 0.4, nD * 0.18, this.mats.cap);
    void idx;
  }

  private addNeighborBuilding(g: THREE.Group, nW: number, nD: number, nH: number) {
    this.box(g, nW + 0.4, 0.18, nD + 0.4, 0, 0.09, 0, this.mats.base, false);
    this.box(g, nW, nH, nD, 0, nH / 2, 0, this.mats.neighborWall);
    this.box(g, nW + 0.3, 0.22, nD + 0.3, 0, nH + 0.1, 0, this.mats.membrane);
    const floors = Math.max(2, Math.min(this.quality.low ? 5 : 8, Math.floor(nH / 2.7)));
    const cols = this.quality.low ? 3 : 4;
    const winW = Math.min(1.15, nW / (cols + 1.4));
    const winH = 1.15;
    for (let f = 0; f < floors; f++) {
      const y = 1.35 + f * (nH / (floors + 0.35));
      for (let c = 0; c < cols; c++) {
        const x = -nW * 0.32 + c * ((nW * 0.64) / Math.max(1, cols - 1));
        this.box(g, winW + 0.08, winH + 0.08, 0.06, x, y, -nD / 2 - 0.02, this.mats.frame);
        this.box(g, winW, winH, 0.04, x, y, -nD / 2 - 0.05, this.mats.glass);
      }
    }
  }

  private addNeighborWarehouse(g: THREE.Group, nW: number, nD: number, nH: number) {
    this.box(g, nW + 0.4, 0.16, nD + 0.4, 0, 0.08, 0, this.mats.base, false);
    this.box(g, nW, nH, nD, 0, nH / 2, 0, this.mats.metalWall);
    const rise = Math.tan((11 * Math.PI) / 180) * (nW / 2);
    const y0 = nH;
    const yR = nH + rise;
    const hw = nW / 2 + 0.2;
    const hd = nD / 2 + 0.2;
    const left = [
      new THREE.Vector3(-hw, y0, -hd),
      new THREE.Vector3(-hw, y0, hd),
      new THREE.Vector3(0, yR, hd),
      new THREE.Vector3(0, yR, -hd),
    ];
    const right = [
      new THREE.Vector3(hw, y0, -hd),
      new THREE.Vector3(0, yR, -hd),
      new THREE.Vector3(0, yR, hd),
      new THREE.Vector3(hw, y0, hd),
    ];
    for (const pts of [left, right]) {
      const roof = new THREE.Mesh(polyGeometry(pts, 1.4), this.mats.metalRoof);
      roof.castShadow = true;
      roof.receiveShadow = true;
      g.add(roof);
    }
    this.box(g, 3.4, nH * 0.62, 0.12, 0, nH * 0.35, -nD / 2 - 0.04, this.mats.frame);
  }

  private addNeighborTree(g: THREE.Group, nH: number) {
    const trunkH = Math.max(1.4, nH * 0.38);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.32, trunkH, this.quality.low ? 5 : 7),
      this.mats.wood,
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    const r = Math.max(2.1, nH * 0.34);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, this.quality.low ? 0 : 1), this.mats.leaf);
    crown.position.y = trunkH + r * 0.55;
    crown.castShadow = true;
    g.add(crown);
    if (!this.quality.low) {
      const side = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.62, 0), this.mats.leaf);
      side.position.set(r * 0.55, trunkH + r * 0.25, r * 0.2);
      side.castShadow = true;
      g.add(side);
    }
  }

  /** Liga/desliga o modo realista. Se algo falhar (ex.: GPU fraca), volta ao modo simples sem quebrar o app. */
  private setRealism(on: boolean) {
    try {
      this.realistic = on;
      if (on) this.enableRealism();
      else this.disableRealism();
    } catch (err) {
      console.error("Modo realista indisponível:", err);
      this.realistic = false;
      try {
        this.disableRealism();
      } catch {
        /* ignora */
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  private refreshMaterials() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else m.needsUpdate = true;
    });
  }

  private enableRealism() {
    const q = this.quality;
    this.realTex ??= makeRealisticTextures(Math.min(q.anisotropy, this.renderer.capabilities.getMaxAnisotropy()), q.low);
    const t = this.realTex;

    // Céu procedural + reflexos (PMREM) a partir da posição do sol.
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    if (!this.skyScene) {
      this.skyScene = new THREE.Scene();
      this.skyMesh = new Sky();
      this.skyMesh.scale.setScalar(450000);
      const u = this.skyMesh.material.uniforms;
      u["turbidity"]!.value = 4.5;
      u["rayleigh"]!.value = 1.4;
      u["mieCoefficient"]!.value = 0.004;
      u["mieDirectionalG"]!.value = 0.82;
      this.skyScene.add(this.skyMesh);
    }
    this.skyStamp = 0;
    this.skyDir.set(0, -1, 0);
    this.updateSky(true);
    this.scene.backgroundIntensity = 0.55;
    this.scene.environmentIntensity = 0.5;

    // Luz e sombras mais suaves.
    this.hemi.intensity = 0.22;
    this.renderer.shadowMap.type = q.low ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    const size = q.low ? 1024 : 2048;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.bias = q.low ? -0.0008 : -0.0002;
    this.renderer.toneMappingExposure = 0.95;

    // Materiais com relevo, grama e reflexos.
    const m = this.mats;
    m.tile!.bumpMap = t.tileBump;
    m.tile!.bumpScale = 2.2;
    m.tile!.roughness = 0.68;
    m.neighborTile!.bumpMap = t.tileBump;
    m.neighborTile!.bumpScale = 2.2;
    m.neighborTile!.roughness = 0.68;
    for (const k of ["wall", "neighborWall"]) {
      m[k]!.bumpMap = this.textures.plaster;
      m[k]!.bumpScale = 0.9;
    }
    m.metalRoof!.roughness = 0.3;
    m.metalRoof!.metalness = 0.8;
    m.metalRoof!.envMapIntensity = 1.5;
    m.metalWall!.roughness = 0.4;
    m.metalWall!.envMapIntensity = 1.2;
    m.panel!.roughness = 0.07;
    m.panel!.metalness = 0.55;
    m.panel!.envMapIntensity = 2;
    m.glass!.roughness = 0.04;
    m.glass!.envMapIntensity = 1.8;
    m.silver!.envMapIntensity = 1.4;
    m.rail!.envMapIntensity = 1.2;
    m.grass!.map = t.grass;
    m.grass!.bumpMap = t.grassBump;
    m.grass!.bumpScale = 1.4;
    m.grass!.color.set("#ffffff");
    m.grass!.roughness = 1;
    m.gravel!.map = t.gravel;
    m.gravel!.color.set("#ffffff");
    this.buildScenery();
    this.refreshMaterials();
  }

  private disableRealism() {
    const q = this.quality;
    this.scene.environment = null;
    this.scene.background = new THREE.Color("#8aa7bd");
    this.scene.backgroundIntensity = 1;
    this.scene.environmentIntensity = 1;
    this.hemi.intensity = 0.7;
    this.sun.color.set("#fff4dc");
    this.renderer.shadowMap.type = q.low ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.sun.shadow.normalBias = 0;
    this.sun.shadow.bias = q.low ? -0.0008 : -0.00028;
    for (const name of ["tile", "neighborTile", "wall", "neighborWall", "grass"]) {
      const m = this.mats[name]!;
      m.bumpMap = null;
      m.bumpScale = 1;
    }
    for (const [name, b] of this.baseMats) {
      const m = this.mats[name]!;
      m.color.copy(b.color);
      m.roughness = b.roughness;
      m.metalness = b.metalness;
      m.map = b.map;
      m.envMapIntensity = b.env;
    }
    this.clearGroup(this.scenery);
    this.skyRT?.dispose();
    this.skyRT = null;
    this.refreshMaterials();
  }

  /** Regera o céu/reflexos quando o sol mudou de lugar (limitado no tempo para não pesar). */
  private updateSky(force = false) {
    if (!this.pmrem || !this.skyScene || !this.skyMesh) return;
    const now = performance.now();
    const gap = this.quality.low ? 900 : 350;
    if (!force && now - this.skyStamp < gap) return;
    const dir = this.sun.position.clone().normalize();
    if (!force && dir.dot(this.skyDir) > 0.9996) return;
    this.skyStamp = now;
    this.skyDir.copy(dir);
    this.skyMesh.material.uniforms["sunPosition"]!.value.copy(dir);
    const rt = this.pmrem.fromScene(this.skyScene);
    this.skyRT?.dispose();
    this.skyRT = rt;
    this.scene.environment = rt.texture;
    this.scene.background = rt.texture;
  }

  /** Mais vegetação ao redor do lote (só no modo realista). */
  private buildScenery() {
    this.clearGroup(this.scenery);
    const count = this.quality.low ? 8 : 22;
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3a24", roughness: 0.95 });
    const leafMats = ["#37622f", "#44742f", "#2f5a3a", "#557f35"].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
    );
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ((i * 37) % 11) * 0.09;
      const r = 31 + ((i * 53) % 17);
      const sc = 0.9 + ((i * 29) % 9) / 9;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.2, this.quality.low ? 5 : 7), trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = !this.quality.low;
      tree.add(trunk);
      const lobes = this.quality.low ? 1 : 3;
      for (let k = 0; k < lobes; k++) {
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.5 - k * 0.22, this.quality.low ? 0 : 1),
          leafMats[(i + k) % leafMats.length]!,
        );
        crown.position.set(k === 0 ? 0 : (k === 1 ? 0.7 : -0.6), 3 + k * 0.5, k === 2 ? 0.5 : 0);
        crown.castShadow = !this.quality.low;
        tree.add(crown);
      }
      tree.scale.setScalar(sc);
      tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.scenery.add(tree);
    }
  }

  private rebuild(s: EngineSnapshot) {
    this.clearGroup(this.house);

    const cfg: PlantConfig = {
      kind: s.kind,
      width: s.width,
      depth: s.depth,
      wall: s.wall,
      pitch: s.pitch,
      ridge: s.ridge,
      yaw: s.yaw,
    };
    const plan = computePlan(cfg);
    const faces = relabelFaces(plan.faces, 0);
    const W = s.width;
    const D = s.depth;
    const H = s.wall;
    const wallMat = s.kind === "warehouse" ? this.mats.metalWall : this.mats.wall;
    const roofMat =
      plan.style === "metal" ? this.mats.metalRoof : plan.style === "membrane" ? this.mats.membrane : this.mats.tile;

    for (const pts of plan.walls) {
      const mesh = new THREE.Mesh(polyGeometry(pts, 2.5), wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.house.add(mesh);
    }
    for (const roof of plan.roofs) {
      const mesh = new THREE.Mesh(polyGeometry(roof.corners, 1.05), roofMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.house.add(mesh);
    }

    if (s.kind === "ground" || s.kind === "flat") {
      const padH = s.kind === "ground" ? 0.08 : 0.04;
      const padY = s.kind === "ground" ? 0.04 : s.wall + 0.02;
      this.box(this.house, s.width + 0.8, padH, s.depth + 0.8, 0, padY, 0, this.mats.base, false);
    }

    if (s.kind !== "ground") {
      this.box(this.house, W + 0.28, 0.18, D + 0.28, 0, 0.09, 0, this.mats.base, false);
      this.box(this.house, 1.1, 2.1, 0.08, 0, 1.1, -D / 2 - 0.04, this.mats.wood);
      this.box(this.house, 0.08, 0.16, 0.05, 0.34, 1.1, -D / 2 - 0.08, this.mats.frame);
      const win = Math.min(1.5, W * 0.2);
      for (const x of [-W * 0.28, W * 0.28]) {
        this.box(this.house, win + 0.1, 1.18, 0.07, x, 1.65, -D / 2 - 0.03, this.mats.frame);
        this.box(this.house, win, 1.08, 0.04, x, 1.65, -D / 2 - 0.07, this.mats.glass);
      }
    }

    if (plan.ridge && (s.kind === "gable" || s.kind === "warehouse" || s.kind === "hidden")) {
      this.box(this.house, 0.14, 0.08, plan.ridge.length, plan.ridge.x, plan.ridge.y + 0.03, 0, this.mats.cap);
    }

    const selected = s.selectedFaces;
    const slots = layoutSlots(faces, selected);
    const n = s.modulesOn ? Math.min(s.quantity, slots.length) : 0;
    this.probes = [];

    const wantStructure = s.structureOn || s.modulesOn;
    if (wantStructure && slots.length) {
      this.criarEstrutura(s, slots, faces);
    }
    if (n > 0) this.criarModulos(s, slots, n);

    if (s.step === "view" && n > 0) {
      const inv = new THREE.Group();
      this.box(inv, 0.5, 0.72, 0.26, 0, 0, 0, this.mats.invert);
      this.box(inv, 0.24, 0.14, 0.02, 0, 0.1, 0.14, this.mats.frame);
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.02),
        new THREE.MeshStandardMaterial({ color: "#2f9e68", emissive: "#146b3c", emissiveIntensity: 0.4 }),
      );
      led.position.set(-0.15, -0.22, 0.14);
      inv.add(led);
      if (s.kind === "ground") {
        this.box(this.house, 1.4, 0.12, 1.1, -W / 2 - 1.2, 0.06, 0, this.mats.base, false);
        inv.position.set(-W / 2 - 1.2, 0.52, 0);
      } else {
        inv.position.set(-W / 2 - 0.14, 1.3, -D * 0.12);
        inv.rotation.y = Math.PI / 2;
      }
      this.house.add(inv);
    }

    this.house.rotation.y = (s.yaw * Math.PI) / 180;
    this.buildNeighbor(s);
    this.house.updateMatrixWorld(true);
    this.neighbor.updateMatrixWorld(true);
    this.lastDayKey = "";
    this.renderer.shadowMap.needsUpdate = true;
    this.measureAndReport(true);
    if (typeof window !== "undefined") {
      (window as unknown as { __plantDebug?: object }).__plantDebug = {
        kind: s.kind,
        structureOn: s.structureOn,
        modulesOn: s.modulesOn,
        slots: slots.length,
        house: this.house.children.length,
        instanced: this.house.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh).length,
      };
    }
  }

  private criarEstrutura(s: EngineSnapshot, slots: ReturnType<typeof layoutSlots>, faces: ReturnType<typeof relabelFaces>) {
    const gradeY = s.kind === "flat" ? s.wall + 0.04 : 0.08;
    addMounting(
      this.house,
      slots,
      s.kind,
      { rail: this.mats.rail, silver: this.mats.silver },
      (w, h, d) => this.boxGeo(w, h, d),
      this.quality.low,
      gradeY,
      faces,
    );
  }

  private criarModulos(s: EngineSnapshot, slots: ReturnType<typeof layoutSlots>, n: number) {
    const cols = this.quality.cellCols;
    const strings = SHADE_STRINGS;
    for (let i = 0; i < n; i++) {
      const sl = slots[i]!;
      const g = new THREE.Group();
      const border = new THREE.Mesh(
        this.boxGeo(sl.pw + 0.016, MODULE.t + 0.006, sl.ph + 0.016),
        this.mats.silver,
      );
      border.castShadow = true;
      g.add(border);
      const cells: THREE.Mesh[] = [];
      const cw = sl.pw / cols - 0.012;
      const ch = sl.ph / strings - 0.012;
      for (let r = 0; r < strings; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = new THREE.Mesh(this.boxGeo(cw, MODULE.t, ch), this.mats.panel);
          cell.position.set((c + 0.5) * (sl.pw / cols) - sl.pw / 2, 0.004, (r + 0.5) * (sl.ph / strings) - sl.ph / 2);
          cell.castShadow = !this.quality.low;
          cell.receiveShadow = !this.quality.low;
          g.add(cell);
          cells.push(cell);
        }
      }
      g.position.copy(sl.pos);
      orientOnRoof(g, sl.normal, sl.vDir);
      this.house.add(g);
      this.probes.push({ group: g, cells });
    }
  }

  private sampleModule(mod: ModuleProbe, sun: THREE.Vector3, irr: number, paint: boolean) {
    mod.group.getWorldQuaternion(this.tmpQ);
    this.tmpN.set(0, 1, 0).applyQuaternion(this.tmpQ);
    mod.group.getWorldPosition(this.tmpA);
    this.tmpB.copy(sun).sub(this.tmpA).normalize();
    const cos = Math.max(0, this.tmpN.dot(this.tmpB));
    const wClear = this.snapshot.watt * irr * cos;
    const strings = [false, false, false];
    let cellsHit = 0;
    const canShade = this.snapshot.neighborOn && this.neighbor.visible && irr > 0.02 && cos > 0.02;
    for (let i = 0; i < mod.cells.length; i++) {
      const cell = mod.cells[i]!;
      let hit = false;
      if (canShade) {
        cell.getWorldPosition(this.tmpA);
        this.tmpA.addScaledVector(this.tmpN, 0.05);
        this.tmpB.copy(sun).sub(this.tmpA).normalize();
        this.ray.set(this.tmpA, this.tmpB);
        this.ray.far = 90;
        const hits = this.ray.intersectObject(this.neighbor, true);
        hit = hits.length > 0 && hits[0]!.distance > 0.08;
      }
      if (hit) {
        cellsHit += 1;
        strings[Math.floor(i / Math.max(1, Math.round(mod.cells.length / SHADE_STRINGS)))] = true;
      }
      if (paint) cell.material = hit ? this.mats.panelShaded : this.mats.panel;
    }
    const dead = strings.filter(Boolean).length;
    const w = canShade ? wClear * ((SHADE_STRINGS - dead) / SHADE_STRINGS) : wClear;
    const kind = dead === 0 ? "clear" : dead === SHADE_STRINGS ? "full" : "partial";
    return { w, wClear, kind, cellsHit, dead };
  }

  private measureDay() {
    const key = [
      this.snapshot.kind,
      this.snapshot.width,
      this.snapshot.depth,
      this.snapshot.wall,
      this.snapshot.pitch,
      this.snapshot.ridge,
      this.snapshot.yaw,
      this.snapshot.quantity,
      this.snapshot.selectedFaces.join(","),
      this.snapshot.watt,
      this.snapshot.neighborOn,
      this.snapshot.neighborKind,
      this.snapshot.neighborCount,
      this.snapshot.neighborSide,
      this.snapshot.neighborHeight,
      this.snapshot.neighborGap,
      this.probes.length,
    ].join("|");
    if (key === this.lastDayKey) return;
    this.lastDayKey = key;
    if (!this.probes.length) {
      this.dayCache = { kwh: 0, kwhClear: 0 };
      return;
    }
    const steps = this.quality.daySteps;
    let e = 0;
    let eClear = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sun = sunPos(t);
      const irr = sunIrradiance(t);
      let p = 0;
      let pClear = 0;
      for (const mod of this.probes) {
        const s = this.sampleModule(mod, sun, irr, false);
        p += s.w;
        pClear += s.wClear;
      }
      e += p;
      eClear += pClear;
    }
    const scale = DAY_HOURS / ((steps + 1) * 1000);
    this.dayCache = { kwh: e * scale, kwhClear: eClear * scale };
  }

  private measureAndReport(forceDay: boolean) {
    if (forceDay) this.lastDayKey = "";
    this.measureDay();
    const s = this.snapshot;
    const t = s.sunOn ? s.sunT : 0.52;
    const sun = sunPos(t);
    const irr = sunIrradiance(t);
    let nowW = 0;
    let nowWClear = 0;
    let clear = 0;
    let partial = 0;
    let full = 0;
    for (const mod of this.probes) {
      const r = this.sampleModule(mod, sun, irr, true);
      nowW += r.w;
      nowWClear += r.wClear;
      if (r.kind === "full") full += 1;
      else if (r.kind === "partial") partial += 1;
      else clear += 1;
    }
    const report = finishReport({
      modules: this.probes.length,
      clear,
      partial,
      full,
      nowW,
      nowWClear,
      dayKwh: this.dayCache.kwh,
      dayKwhClear: this.dayCache.kwhClear,
      hour: 6 + t * 12,
      t,
    });
    const sig = [Math.round(report.nowW), report.partial, report.full, Math.round(report.dayLossKwh * 100)].join("|");
    if (sig === this.lastShadeSig && !forceDay) return;
    this.lastShadeSig = sig;
    this.onReport?.(report);
    if (typeof window !== "undefined") {
      (window as unknown as { __shade?: ShadeReport }).__shade = report;
    }
  }

  private loop = (ts: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((ts - (this.lastTs || ts)) / 1000, 0.1);
    this.lastTs = ts;
    const s = this.snapshot;
    if (s) {
      const real = this.realistic;
      if (s.sunOn) {
        if (!s.sunPaused) {
          s.sunT = (s.sunT + dt * 0.028 * (s.sunSpeed || 1)) % 1;
        }
        const next = s.sunT;
        const arc = Math.sin(next * Math.PI);
        this.sun.intensity = 1.2 + arc * 1.6;
        this.renderer.toneMappingExposure = (real ? 0.7 : 0.85) + arc * 0.35;
        const fog = this.scene.fog as THREE.Fog;
        const dawn = new THREE.Color(real ? "#d9a97f" : "#c48a62");
        const noon = new THREE.Color(real ? "#a9c4da" : "#87a8c2");
        fog.color.copy(dawn).lerp(noon, arc);
        if (real) this.sun.color.set("#ff9f5a").lerp(new THREE.Color("#fff4dc"), Math.min(1, arc * 1.6));
        else this.scene.background = fog.color;
      } else {
        this.sun.intensity = real ? 2.5 : 2.15;
        this.renderer.toneMappingExposure = real ? 0.95 : 1.05;
        const fog = this.scene.fog as THREE.Fog;
        fog.color.set(real ? "#a9c4da" : "#8aa7bd");
        if (real) this.sun.color.set("#fff1d6");
        else this.scene.background = fog.color;
      }
      const p = sunPos(s.sunOn ? s.sunT : 0.52);
      this.sun.position.copy(p);
      this.sun.target.position.set(0, 1, 0);
      this.sun.target.updateMatrixWorld();
      this.sunBall.position.copy(p);
      this.sunBall.visible = !this.realistic && (s.sunOn || s.neighborOn);
      if (this.realistic) this.updateSky();
      (this.sunBall.material as THREE.MeshBasicMaterial).color.set(s.sunOn ? "#ffbe7a" : "#ffe4b5");

      if (this.quality.low) {
        this.shadowTick += 1;
        const sunMoved = this.lastSunPos.distanceToSquared(p) > 0.08;
        if (sunMoved && this.shadowTick % this.quality.shadowEvery === 0) {
          this.renderer.shadowMap.needsUpdate = true;
          this.lastSunPos.copy(p);
        }
      }

      if (this.camGoal) {
        this.camera.position.lerp(this.camGoal, 1 - Math.exp(-dt * 3.2));
        this.controls.target.lerp(this.lookGoal, 1 - Math.exp(-dt * 3.2));
        if (this.camera.position.distanceTo(this.camGoal) < 0.08) this.camGoal = null;
      }

      this.shadeAcc += dt;
      const interval = s.sunOn ? this.quality.shadeDt : this.quality.shadeDt * 2.2;
      if (this.shadeAcc > interval) {
        this.shadeAcc = 0;
        this.measureAndReport(false);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.visualViewport?.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    for (const geo of this.boxGeos.values()) geo.dispose();
    this.boxGeos.clear();
    this.skyRT?.dispose();
    this.pmrem?.dispose();
    this.realTex?.tileBump.dispose();
    this.realTex?.grass.dispose();
    this.realTex?.grassBump.dispose();
    this.realTex?.gravel.dispose();
    this.renderer.dispose();
  }
}
