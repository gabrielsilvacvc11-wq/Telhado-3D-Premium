import { useEffect, useRef } from "react";
import { PlantEngine, type EngineSnapshot } from "@/lib/plant/engine";
import { usePlant } from "@/lib/plant/store";

function snap(s: ReturnType<typeof usePlant.getState>): EngineSnapshot {
  return {
    kind: s.kind,
    width: s.width,
    depth: s.depth,
    wall: s.wall,
    pitch: s.pitch,
    ridge: s.ridge,
    yaw: s.yaw,
    selectedFaces: s.selectedFaces,
    quantity: s.quantity,
    modulesOn: s.modulesOn,
    structureOn: s.structureOn,
    sunOn: s.sunOn,
    sunPaused: s.sunPaused,
    sunSpeed: s.sunSpeed,
    sunT: s.sunT,
    cameraPreset: s.cameraPreset,
    step: s.step,
    watt: s.watt,
    neighborOn: s.neighborOn,
    neighborKind: s.neighborKind,
    neighborCount: s.neighborCount,
    neighborSide: s.neighborSide,
    neighborHeight: s.neighborHeight,
    neighborGap: s.neighborGap,
    realistic: s.realistic,
  };
}

export function PlantCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new PlantEngine(canvas);
    engine.onReport = (r) => usePlant.getState().setShade(r);
    engine.sync(snap(usePlant.getState()));
    const unsub = usePlant.subscribe((s) => engine.sync(snap(s)));
    return () => {
      unsub();
      engine.dispose();
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 size-full touch-none" aria-label="Estúdio 3D do telhado" />;
}
