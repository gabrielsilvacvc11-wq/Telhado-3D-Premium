import { create } from "zustand";
import { computePlan, layoutSlots, relabelFaces } from "./geometry";
import { KIND_DEFAULTS, NEIGHBOR_META, type CameraPreset, type Heading, type NeighborKind, type PlantConfig, type RoofKind, type StudioStep } from "./types";
import { emptyShade, type ShadeReport } from "./shade";

const WATT_DEFAULT = 610;

export type PlantState = PlantConfig & {
  step: StudioStep;
  selectedFaces: string[];
  watt: number;
  quantity: number;
  modulesOn: boolean;
  structureOn: boolean;
  sunOn: boolean;
  sunPaused: boolean;
  sunSpeed: number;
  sunT: number;
  cameraPreset: CameraPreset;
  neighborOn: boolean;
  neighborKind: NeighborKind;
  neighborCount: number;
  neighborSide: Heading;
  neighborHeight: number;
  neighborGap: number;
  realistic: boolean;
  shade: ShadeReport;
  setKind: (kind: RoofKind) => void;
  patch: (p: Partial<PlantConfig>) => void;
  setStep: (step: StudioStep) => void;
  toggleFace: (id: string) => void;
  selectAllFaces: () => void;
  setSelectedFaces: (ids: string[]) => void;
  setWatt: (watt: number) => void;
  setQuantity: (n: number) => void;
  enableStructure: () => void;
  enableModules: () => void;
  setSunOn: (on: boolean) => void;
  setSunPaused: (paused: boolean) => void;
  setSunSpeed: (speed: number) => void;
  setSunT: (t: number) => void;
  setCamera: (preset: CameraPreset) => void;
  setNeighborOn: (on: boolean) => void;
  setNeighborKind: (kind: NeighborKind) => void;
  setNeighborCount: (n: number) => void;
  setNeighborSide: (side: Heading) => void;
  setNeighborHeight: (h: number) => void;
  setNeighborGap: (g: number) => void;
  setShade: (shade: ShadeReport) => void;
  setRealistic: (on: boolean) => void;
};

function planFor(s: PlantConfig) {
  return computePlan(s);
}

export function shadeHint(
  side: Heading,
  neighborHeight: number,
  wall: number,
  pitch: number,
  depth: number,
  kind: NeighborKind = "house",
) {
  const peak = wall + Math.tan((pitch * Math.PI) / 180) * (depth * 0.5);
  const label = kind === "tree" ? "A árvore" : kind === "building" ? "O prédio" : kind === "warehouse" ? "O galpão" : "A casa vizinha";
  if (neighborHeight <= peak + 0.3) {
    return `${label} está na mesma altura — o sombreamento tende a ser baixo.`;
  }
  if (side === "N") return `${label} ao norte: no Brasil, essa é a sombra mais crítica no meio do dia.`;
  if (side === "L") return `${label} a leste: sombra pela manhã, quando o sol nasce.`;
  if (side === "O") return `${label} a oeste: sombra à tarde, quando o sol cai.`;
  return `${label} ao sul: o sol passa ao norte, então o impacto no Brasil é menor.`;
}

export function derived(
  s: PlantConfig & Pick<PlantState, "selectedFaces" | "quantity" | "modulesOn" | "structureOn" | "watt">,
) {
  const plan = planFor(s);
  const faces = relabelFaces(plan.faces, s.yaw);
  const slots = layoutSlots(faces, s.selectedFaces);
  const max = slots.length;
  const n = s.modulesOn ? Math.min(s.quantity, max) : 0;
  return { plan, faces, slots, max, n, kWp: (n * s.watt) / 1000 };
}

export const usePlant = create<PlantState>()((set, get) => ({
  kind: "gable",
  ...KIND_DEFAULTS.gable,
  yaw: 0,
  step: "roof",
  selectedFaces: [],
  watt: WATT_DEFAULT,
  quantity: 24,
  modulesOn: false,
  structureOn: false,
  sunOn: false,
  sunPaused: false,
  sunSpeed: 0.7,
  sunT: 0.5,
  cameraPreset: "orbit",
  neighborOn: false,
  neighborKind: "house",
  neighborCount: 1,
  neighborSide: "N",
  neighborHeight: 9,
  neighborGap: 5.5,
  realistic: false,
  shade: emptyShade(),
  setKind: (kind) =>
    set({
      kind,
      ...KIND_DEFAULTS[kind],
      selectedFaces: [],
      modulesOn: false,
      structureOn: false,
      cameraPreset: "orbit",
    }),
  patch: (p) => set(p),
  setStep: (step) => set({ step }),
  toggleFace: (id) => {
    const s = get();
    if (s.selectedFaces.length === 1 && s.selectedFaces[0] === id) return;
    const plan = computePlan(s);
    const faces = relabelFaces(plan.faces, s.yaw);
    const max = layoutSlots(faces, [id]).length;
    set({ selectedFaces: [id], quantity: Math.max(1, max) });
  },
  selectAllFaces: () => {
    const s = get();
    const plan = computePlan(s);
    const faces = relabelFaces(plan.faces, s.yaw);
    const ids = faces.map((f) => f.id);
    const max = layoutSlots(faces, ids).length;
    set({ selectedFaces: ids, quantity: Math.max(1, max) });
  },
  setSelectedFaces: (ids) => set({ selectedFaces: ids }),
  setWatt: (watt) => set({ watt }),
  setQuantity: (n) => set({ quantity: Math.max(0, n) }),
  enableStructure: () => {
    const s = get();
    const plan = computePlan(s);
    const faces = relabelFaces(plan.faces, s.yaw);
    const selected = s.selectedFaces.length ? s.selectedFaces : faces.map((f) => f.id);
    set({
      structureOn: true,
      selectedFaces: selected,
      cameraPreset: s.kind === "ground" || s.kind === "flat" ? "structure" : s.cameraPreset,
    });
  },
  enableModules: () => {
    const s = get();
    const plan = computePlan(s);
    const faces = relabelFaces(plan.faces, s.yaw);
    const north = faces.filter((f) => f.heading === "N").map((f) => f.id);
    const selected = s.selectedFaces.length
      ? s.selectedFaces
      : north.length
        ? north
        : faces.map((f) => f.id);
    const max = layoutSlots(faces, selected).length;
    const qty = Math.min(Math.max(s.quantity, 1), Math.max(max, 1));
    const rack = s.kind === "ground" || s.kind === "flat";
    set({
      structureOn: true,
      modulesOn: true,
      step: "modules",
      selectedFaces: selected,
      quantity: max ? Math.min(rack ? max : 24, max) : qty,
      cameraPreset: rack ? "structure" : s.cameraPreset,
    });
  },
  setSunOn: (sunOn) =>
    set(
      sunOn
        ? { sunOn: true, sunPaused: false, sunT: 0.08 }
        : { sunOn: false, sunPaused: false, sunT: 0.5 },
    ),
  setSunPaused: (sunPaused) => set({ sunPaused }),
  setSunSpeed: (sunSpeed) => set({ sunSpeed: Math.min(3, Math.max(0.25, sunSpeed)) }),
  setSunT: (sunT) => set({ sunT: Math.min(0.99, Math.max(0.02, sunT)), sunPaused: true }),
  setCamera: (cameraPreset) => set({ cameraPreset }),
  setNeighborOn: (neighborOn) =>
    set({
      neighborOn,
      cameraPreset: neighborOn ? "aerial" : "orbit",
    }),
  setNeighborKind: (neighborKind) =>
    set({
      neighborKind,
      neighborHeight: NEIGHBOR_META[neighborKind].height,
    }),
  setNeighborCount: (neighborCount) => set({ neighborCount: Math.min(4, Math.max(1, Math.round(neighborCount))) }),
  setNeighborSide: (neighborSide) => set({ neighborSide }),
  setNeighborHeight: (neighborHeight) => set({ neighborHeight }),
  setNeighborGap: (neighborGap) => set({ neighborGap }),
  setShade: (shade) => set({ shade, sunT: shade.t }),
  setRealistic: (realistic) => set({ realistic }),
}));

