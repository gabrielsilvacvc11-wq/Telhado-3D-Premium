import { useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Box,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Home,
  LandPlot,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Sun,
  Trees,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_META, NEIGHBOR_META, type CameraPreset, type NeighborKind, type RoofKind } from "@/lib/plant/types";
import { derived, shadeHint, usePlant } from "@/lib/plant/store";
import { HEADING_LABEL } from "@/lib/plant/types";
import { formatHour } from "@/lib/plant/shade";
import { InstallApp } from "@/components/overlay/InstallApp";

const KINDS: { id: RoofKind; icon: typeof Home }[] = [
  { id: "gable", icon: Home },
  { id: "hip", icon: Building2 },
  { id: "warehouse", icon: Warehouse },
  { id: "hidden", icon: Layers },
  { id: "flat", icon: Square },
  { id: "ground", icon: LandPlot },
];

const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: "front", label: "Frontal" },
  { id: "side", label: "Lateral" },
  { id: "top", label: "Superior" },
  { id: "aerial", label: "Aérea" },
  { id: "modules", label: "Módulos" },
  { id: "structure", label: "Estrutura" },
  { id: "inverter", label: "Inversor" },
];

function speedLabel(v: number) {
  if (v < 0.45) return "Bem lenta";
  if (v < 0.75) return "Lenta";
  if (v < 1.15) return "Normal";
  if (v < 1.8) return "Rápida";
  return "Muito rápida";
}

const PEEK = 124;

function sheetSnaps() {
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  return { peek: PEEK, mid: Math.round(vh * 0.4), full: Math.round(vh * 0.76) };
}

function nearestSnap(h: number) {
  const { peek, mid, full } = sheetSnaps();
  return [peek, mid, full].reduce((best, p) => (Math.abs(p - h) < Math.abs(best - h) ? p : best));
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block pt-3">
      <span className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums text-accent">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        suppressHydrationWarning
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

export function Studio() {
  const s = usePlant();
  const d = useMemo(
    () =>
      derived({
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
        watt: s.watt,
      }),
    [s.kind, s.width, s.depth, s.wall, s.pitch, s.ridge, s.yaw, s.selectedFaces, s.quantity, s.modulesOn, s.structureOn, s.watt],
  );
  const meta = KIND_META[s.kind];
  const [sheetH, setSheetH] = useState(PEEK);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const sheetOpen = sheetH > PEEK + 24;

  function onSheetPointerDown(e: PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetH, moved: false };
  }
  function onSheetPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    if (Math.abs(dy) > 8) drag.current.moved = true;
    const { peek, full } = sheetSnaps();
    setSheetH(Math.min(full, Math.max(peek, drag.current.h + dy)));
  }
  function onSheetPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      const { mid } = sheetSnaps();
      setSheetH(sheetOpen ? PEEK : mid);
      return;
    }
    setSheetH((h) => nearestSnap(h));
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-2 md:p-5">
      <header className="pointer-events-auto flex items-center justify-between gap-2 md:items-start md:gap-3">
        <div className="min-w-0">
          <p className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-accent md:block">Simulador fotovoltaico</p>
          <h1 className="hidden font-display text-2xl tracking-tight text-fg md:block md:text-3xl">Monte o telhado da sua casa</h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <InstallApp />
          <button
            type="button"
            className={cn(
              "rounded-full border px-3 py-2 text-sm md:backdrop-blur-md",
              s.realistic ? "border-transparent bg-fg text-bg" : "border-border bg-elevated text-fg md:bg-elevated/80",
            )}
            onClick={() => s.setRealistic(!s.realistic)}
            aria-pressed={s.realistic}
            aria-label={s.realistic ? "Desligar modo realista" : "Ligar modo realista"}
          >
            <Sparkles className="inline size-4 md:mr-1" />
            <span className="hidden md:inline">{s.realistic ? "Realista: ligado" : "Modo realista"}</span>
          </button>
          <button
            type="button"
            className="rounded-full border border-border bg-elevated px-3 py-2 text-sm text-fg md:bg-elevated/80 md:backdrop-blur-md"
            onClick={() => {
              s.setCamera("orbit");
              s.patch({ yaw: 0 });
            }}
            aria-label="Recentrar"
          >
            <RotateCcw className="inline size-4 md:mr-1" />
            <span className="hidden md:inline">Recentrar</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 md:flex-row md:items-stretch md:justify-between md:pt-4">
        <aside
          className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-elevated p-3 shadow-panel md:!h-auto md:max-h-[calc(100vh-6.5rem)] md:w-80 md:overflow-auto md:bg-elevated/90 md:p-4 md:backdrop-blur-md"
          style={{ height: sheetH }}
        >
          <button
            type="button"
            className="mb-2 flex w-full shrink-0 touch-none flex-col items-center gap-1 pb-1 text-muted md:hidden"
            aria-label={sheetOpen ? "Abaixar configurações" : "Puxar configurações"}
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
          >
            <span className="h-1 w-10 rounded-full bg-fg/35" />
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Configurações
              {sheetOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </span>
          </button>
          <div className="min-h-0 flex-1 overflow-auto md:overflow-visible">
          <ol className="mb-4 flex gap-1 text-xs font-medium text-muted">
            {(["roof", "modules", "view"] as const).map((step, i) => (
              <li key={step} className="flex-1">
                <button
                  type="button"
                  onClick={() => s.setStep(step)}
                  className={cn(
                    "w-full rounded-full px-2 py-1.5",
                    s.step === step ? "bg-fg text-bg" : "bg-subtle text-muted",
                  )}
                >
                  {i + 1}. {step === "roof" ? "Telhado" : step === "modules" ? "Módulos" : "Ver"}
                </button>
              </li>
            ))}
          </ol>

          {s.step === "roof" && (
            <>
              <h2 className="font-display text-xl text-fg">Criar o telhado</h2>
              <p className="mt-1 text-sm text-muted">Escolha o modelo e ajuste as medidas. Gire a casa no canvas.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {KINDS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => s.setKind(id)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left",
                      s.kind === id ? "border-fg/40 bg-subtle" : "border-border bg-bg/40",
                    )}
                  >
                    <Icon className="mb-2 size-4 text-accent" />
                    <span className="block text-sm font-medium text-fg">{KIND_META[id].name}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">{KIND_META[id].blurb}</span>
                  </button>
                ))}
              </div>
              <SliderRow
                label="Largura"
                value={s.width}
                display={`${s.width.toFixed(1)} m`}
                min={6}
                max={22}
                step={0.1}
                onChange={(width) => s.patch({ width })}
              />
              <SliderRow
                label="Comprimento"
                value={s.depth}
                display={`${s.depth.toFixed(1)} m`}
                min={6}
                max={28}
                step={0.1}
                onChange={(depth) => s.patch({ depth })}
              />
              {meta.showWall && (
                <SliderRow
                  label="Altura da parede"
                  value={s.wall}
                  display={`${s.wall.toFixed(2)} m`}
                  min={2.4}
                  max={7}
                  step={0.05}
                  onChange={(wall) => s.patch({ wall })}
                />
              )}
              <SliderRow
                label={meta.pitchLabel}
                value={s.pitch}
                display={`${s.pitch.toFixed(0)}°`}
                min={s.kind === "flat" || s.kind === "ground" ? 5 : 6}
                max={s.kind === "warehouse" || s.kind === "hidden" ? 25 : 40}
                step={1}
                onChange={(pitch) => s.patch({ pitch })}
              />
              {meta.showRidge && (
                <SliderRow
                  label="Posição da cumeeira"
                  value={s.ridge}
                  display={`${Math.round(s.ridge * 100)}%`}
                  min={0.28}
                  max={0.72}
                  step={0.01}
                  onChange={(ridge) => s.patch({ ridge })}
                />
              )}
              <SliderRow
                label="Orientação do telhado"
                value={s.yaw}
                display={`${s.yaw.toFixed(0)}°`}
                min={0}
                max={359}
                step={1}
                onChange={(yaw) => s.patch({ yaw })}
              />
              {s.kind === "ground" || s.kind === "flat" ? (
                s.structureOn ? (
                  <button
                    type="button"
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-fg py-3 text-sm font-semibold text-bg"
                    onClick={() => s.enableModules()}
                  >
                    Adicionar módulos
                    <ChevronRight className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-fg py-3 text-sm font-semibold text-bg"
                    onClick={() => s.enableStructure()}
                  >
                    Adicionar estrutura
                    <ChevronRight className="size-4" />
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-fg py-3 text-sm font-semibold text-bg"
                  onClick={() => s.enableModules()}
                >
                  Adicionar módulos
                  <ChevronRight className="size-4" />
                </button>
              )}
            </>
          )}

          {s.step === "modules" && (
            <>
              <h2 className="font-display text-xl text-fg">Colocar os painéis</h2>
              <p className="mt-1 text-sm text-muted">
                Os módulos acompanham a inclinação da água. Escolha onde instalar.
              </p>
              <ul className="mt-3 space-y-1.5">
                {d.faces.map((f) => {
                  const on = s.selectedFaces.includes(f.id);
                  const cap = derived({ ...s, selectedFaces: [f.id], modulesOn: true, quantity: 9999 }).max;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => s.toggleFace(f.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm",
                          on ? "border-fg/40 bg-subtle text-fg" : "border-border text-muted",
                        )}
                      >
                        <span>
                          {f.label}
                          <span className="ml-2 text-[11px] uppercase tracking-wide">{HEADING_LABEL[f.heading]}</span>
                        </span>
                        <span className="tabular-nums">{cap} vagas</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {d.faces.length > 1 && (
                <button
                  type="button"
                  onClick={() => s.selectAllFaces()}
                  className={cn(
                    "mt-1.5 w-full rounded-xl border px-3 py-2 text-sm",
                    s.selectedFaces.length === d.faces.length
                      ? "border-fg/40 bg-subtle text-fg"
                      : "border-border text-muted",
                  )}
                >
                  Todas as águas
                </button>
              )}
              <SliderRow
                label="Quantidade de módulos"
                value={s.quantity}
                display={String(Math.min(s.quantity, d.max))}
                min={0}
                max={Math.max(d.max, 1)}
                step={1}
                onChange={(quantity) => s.setQuantity(quantity)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-xl border border-border py-2 text-fg"
                  onClick={() => s.setQuantity(Math.max(0, s.quantity - 1))}
                >
                  <Minus className="mx-auto size-4" />
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-xl border border-border py-2 text-fg"
                  onClick={() => s.setQuantity(Math.min(d.max, s.quantity + 1))}
                >
                  <Plus className="mx-auto size-4" />
                </button>
                <button
                  type="button"
                  className="flex-[2] rounded-xl border border-border py-2 text-sm font-medium text-fg"
                  onClick={() => s.setQuantity(d.max)}
                >
                  Preencher
                </button>
              </div>
              <SliderRow
                label="Potência do módulo"
                value={s.watt}
                display={`${s.watt} W`}
                min={400}
                max={700}
                step={5}
                onChange={(watt) => s.setWatt(watt)}
              />
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-subtle px-3 py-2">
                  <dt className="text-muted">Módulos</dt>
                  <dd className="font-medium tabular-nums text-fg">{d.n}</dd>
                </div>
                <div className="rounded-xl bg-subtle px-3 py-2">
                  <dt className="text-muted">Potência total</dt>
                  <dd className="font-medium tabular-nums text-fg">{d.kWp.toFixed(2)} kWp</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="rounded-full border border-border px-4 py-3 text-sm text-fg"
                  onClick={() => s.setStep("roof")}
                >
                  <ChevronLeft className="inline size-4" />
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-fg py-3 text-sm font-semibold text-bg"
                  onClick={() => s.setStep("view")}
                >
                  Visualizar projeto 3D
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </>
          )}

          {s.step === "view" && (
            <>
              <h2 className="font-display text-xl text-fg">Visualizar a usina</h2>
              <p className="mt-1 text-sm text-muted">Câmeras prontas, estrutura de fixação, inversor e o sol do dia.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {CAMERAS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => s.setCamera(c.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm",
                      s.cameraPreset === c.id ? "border-fg/40 bg-subtle text-fg" : "border-border text-muted",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {d.n > 0 && (
                <div className="mt-3 rounded-xl bg-subtle px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                    Perda de energia · {formatHour(s.shade.t)}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">Agora</dt>
                      <dd className="font-medium tabular-nums text-fg">{(s.shade.nowW / 1000).toFixed(2)} kW</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Perda agora</dt>
                      <dd className="font-medium tabular-nums text-fg">
                        {s.shade.nowLossPct.toFixed(1)}% · {(s.shade.nowLossW / 1000).toFixed(2)} kW
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Hoje</dt>
                      <dd className="font-medium tabular-nums text-fg">{s.shade.dayKwh.toFixed(2)} kWh</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Perda no dia</dt>
                      <dd className="font-medium tabular-nums text-fg">
                        {s.shade.dayLossPct.toFixed(1)}% · {s.shade.dayLossKwh.toFixed(2)} kWh
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Ano, céu claro</dt>
                      <dd className="font-medium tabular-nums text-fg">
                        {s.shade.yearKwh >= 1000 ? `${(s.shade.yearKwh / 1000).toFixed(2)} MWh` : `${s.shade.yearKwh.toFixed(0)} kWh`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Perda no ano</dt>
                      <dd className="font-medium tabular-nums text-fg">
                        {s.shade.yearLossPct.toFixed(1)}% · {s.shade.yearLossKwh.toFixed(0)} kWh
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-sm text-muted">
                    {s.shade.clear} livres · {s.shade.partial} parciais · {s.shade.full} cobertos
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Cada módulo tem 3 diodos de bypass. A faixa sombreada zera; o resto do painel continua gerando.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => s.setSunOn(!s.sunOn)}
                className={cn(
                  "mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold",
                  s.sunOn ? "bg-fg text-bg" : "border border-border bg-subtle text-fg",
                )}
              >
                <Sun className="size-4" />
                {s.sunOn ? "Encerrar o sol" : "Simular sol"}
              </button>
              {s.sunOn && (
                <>
                  <button
                    type="button"
                    onClick={() => s.setSunPaused(!s.sunPaused)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-subtle py-3 text-sm font-semibold text-fg"
                  >
                    {s.sunPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {s.sunPaused ? `Continuar · ${formatHour(s.sunT)}` : `Pausar · ${formatHour(s.sunT)}`}
                  </button>
                  <SliderRow
                    label="Velocidade do dia"
                    value={s.sunSpeed}
                    display={speedLabel(s.sunSpeed)}
                    min={0.25}
                    max={2.6}
                    step={0.05}
                    onChange={(v) => s.setSunSpeed(v)}
                  />
                  <SliderRow
                    label="Hora do dia"
                    value={s.sunT}
                    display={formatHour(s.sunT)}
                    min={0.02}
                    max={0.98}
                    step={0.005}
                    onChange={(t) => s.setSunT(t)}
                  />
                </>
              )}
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="font-display text-lg text-fg">Casa vizinha</h3>
                <p className="mt-1 text-sm text-muted">
                  Até quatro obstáculos ao redor — casa, prédio, galpão ou árvore — para ver a sombra no telhado.
                </p>
                <button
                  type="button"
                  onClick={() => s.setNeighborOn(!s.neighborOn)}
                  className={cn(
                    "mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold",
                    s.neighborOn ? "bg-fg text-bg" : "border border-border bg-subtle text-fg",
                  )}
                >
                  <Building2 className="size-4" />
                  {s.neighborOn ? "Vizinhos no lote" : "Adicionar vizinho"}
                </button>
                {s.neighborOn && (
                  <>
                    <p className="mt-3 text-sm text-muted">Tipo</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["house", Home],
                          ["building", Building2],
                          ["warehouse", Warehouse],
                          ["tree", Trees],
                        ] as const
                      ).map(([id, Icon]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => s.setNeighborKind(id satisfies NeighborKind)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-xl border px-2 py-2 text-left text-xs",
                            s.neighborKind === id ? "border-fg/40 bg-subtle text-fg" : "border-border text-muted",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          {NEIGHBOR_META[id].name}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">{NEIGHBOR_META[s.neighborKind].blurb}</p>
                    <p className="mt-3 text-sm text-muted">Lado principal</p>
                    <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                      {(["N", "S", "L", "O"] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          onClick={() => s.setNeighborSide(side)}
                          className={cn(
                            "rounded-xl border px-1 py-2 text-xs",
                            s.neighborSide === side ? "border-fg/40 bg-subtle text-fg" : "border-border text-muted",
                          )}
                        >
                          {HEADING_LABEL[side]}
                        </button>
                      ))}
                    </div>
                    <SliderRow
                      label="Quantidade ao redor"
                      value={s.neighborCount}
                      display={`${s.neighborCount}`}
                      min={1}
                      max={4}
                      step={1}
                      onChange={(n) => s.setNeighborCount(n)}
                    />
                    <SliderRow
                      label={s.neighborKind === "tree" ? "Altura da árvore" : "Altura do vizinho"}
                      value={s.neighborHeight}
                      display={`${s.neighborHeight.toFixed(1)} m`}
                      min={NEIGHBOR_META[s.neighborKind].minH}
                      max={NEIGHBOR_META[s.neighborKind].maxH}
                      step={0.1}
                      onChange={(h) => s.setNeighborHeight(h)}
                    />
                    <SliderRow
                      label="Distância"
                      value={s.neighborGap}
                      display={`${s.neighborGap.toFixed(1)} m`}
                      min={1.5}
                      max={12}
                      step={0.1}
                      onChange={(g) => s.setNeighborGap(g)}
                    />
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {shadeHint(s.neighborSide, s.neighborHeight, s.wall, s.pitch, s.depth, s.neighborKind)}
                    </p>
                  </>
                )}
              </div>
              <p className="mt-3 text-sm text-muted">
                {d.n} módulos de {s.watt} W — {d.kWp.toFixed(2)} kWp sobre {meta.name.toLowerCase()}.
              </p>
              <button
                type="button"
                className="mt-3 w-full rounded-full border border-border py-3 text-sm text-fg"
                onClick={() => s.setStep("modules")}
              >
                Voltar aos módulos
              </button>
            </>
          )}
          </div>
        </aside>

        <aside className="pointer-events-auto hidden w-64 self-end rounded-2xl border border-border bg-elevated/90 p-4 shadow-panel md:block md:backdrop-blur-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Prévia da usina</p>
          <h2 className="font-display mt-1 text-lg text-fg">
            {s.modulesOn ? "É assim que a usina fica" : s.structureOn ? "Estrutura no lugar — agora os módulos" : "Telhado sem módulos"}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between border-b border-border py-1.5 text-muted">
              Módulos <strong className="tabular-nums text-fg">{d.n}</strong>
            </li>
            <li className="flex justify-between border-b border-border py-1.5 text-muted">
              Potência <strong className="tabular-nums text-fg">{d.kWp.toFixed(2)} kWp</strong>
            </li>
            <li className="flex justify-between border-b border-border py-1.5 text-muted">
              Inclinação <strong className="tabular-nums text-fg">{s.pitch.toFixed(0)}°</strong>
            </li>
            <li className="flex justify-between py-1.5 text-muted">
              Formato <strong className="text-fg">{meta.name}</strong>
            </li>
            {s.neighborOn && (
              <li className="flex justify-between border-t border-border py-1.5 text-muted">
                Vizinho
                <strong className="text-fg">
                  {NEIGHBOR_META[s.neighborKind].name} {s.neighborHeight.toFixed(0)} m · {s.neighborCount}
                </strong>
              </li>
            )}
            {s.modulesOn && (
              <>
                <li className="flex justify-between border-t border-border py-1.5 text-muted">
                  Agora
                  <strong className="tabular-nums text-fg">{(s.shade.nowW / 1000).toFixed(2)} kW</strong>
                </li>
                <li className="flex justify-between py-1.5 text-muted">
                  Perda de sombra
                  <strong className="tabular-nums text-fg">
                    {s.shade.nowLossPct.toFixed(1)}% agora · {s.shade.yearLossPct.toFixed(1)}% ao ano
                  </strong>
                </li>
              </>
            )}
          </ul>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Box className="size-3.5" />
            Arraste para girar · role para aproximar
          </p>
        </aside>
      </div>
    </div>
  );
}
