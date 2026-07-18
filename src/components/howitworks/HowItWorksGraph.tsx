"use client";

/**
 * Интерактивная карта «Как всё устроено»: узлы можно перетаскивать, холст —
 * панорамировать и зумить (колесо / пинч / кнопки), тап по узлу открывает
 * панель с полным описанием, режим «Связать» добавляет свои рёбра между узлами.
 * Раскладка и свои связи хранятся в localStorage (STORE_KEY) — сервер не трогаем.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { EDGES, GROUPS, NODES, type GraphEdge, type GraphNode } from "./graphData";

// v2: схема упрощена до одного пути производства — старые раскладки не подходят
const STORE_KEY = "ss_how_it_works_v2";
const MIN_K = 0.15;
const MAX_K = 2;

type XY = { x: number; y: number };
type View = { x: number; y: number; k: number };

type Stored = {
  pos?: Record<string, XY>;
  custom?: Array<{ from: string; to: string }>;
};

const groupById = new Map(GROUPS.map((g) => [g.id, g]));
const nodeById = new Map(NODES.map((n) => [n.id, n]));
const defaultPos = (): Record<string, XY> =>
  Object.fromEntries(NODES.map((n) => [n.id, { x: n.x, y: n.y }]));

type Rect = XY & { w: number; h: number };

/**
 * Путь ребра между двумя карточками: выходим из середины стороны, обращённой
 * к соседу (по доминирующей оси), кривая Безье. Размеры у карточек разные
 * (этапы пути крупнее спутников), поэтому принимаем прямоугольники целиком.
 * Возвращает и середину — для подписи ребра.
 */
function edgePath(a: Rect, b: Rect): { d: string; mid: XY } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  let sx: number, sy: number, ex: number, ey: number, d: string;
  if (Math.abs(dx) >= Math.abs(dy)) {
    sx = a.x + (dx > 0 ? a.w : 0);
    sy = acy;
    ex = b.x + (dx > 0 ? 0 : b.w);
    ey = bcy;
    const c = Math.max(40, Math.abs(ex - sx) * 0.4);
    d = `M ${sx} ${sy} C ${sx + (dx > 0 ? c : -c)} ${sy}, ${ex - (dx > 0 ? c : -c)} ${ey}, ${ex} ${ey}`;
  } else {
    sx = acx;
    sy = a.y + (dy > 0 ? a.h : 0);
    ex = bcx;
    ey = b.y + (dy > 0 ? 0 : b.h);
    const c = Math.max(40, Math.abs(ey - sy) * 0.4);
    d = `M ${sx} ${sy} C ${sx} ${sy + (dy > 0 ? c : -c)}, ${ex} ${ey - (dy > 0 ? c : -c)}, ${ex} ${ey}`;
  }
  return { d, mid: { x: (sx + ex) / 2, y: (sy + ey) / 2 } };
}

export default function HowItWorksGraph() {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, XY>>(defaultPos);
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 0.45 });
  const [selected, setSelected] = useState<string | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [custom, setCustom] = useState<Array<{ from: string; to: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  // жесты: один активный драг (панорама или узел) + карта пойнтеров для пинча.
  // Масштаб (scaleAtStart) захватывается в начале жеста: пока идёт одиночный
  // драг, зум измениться не может, а читать view из ref в рендере нельзя.
  const drag = useRef<{
    mode: "pan" | "node";
    id?: string;
    pointerId: number;
    startX: number;
    startY: number;
    origin: XY;
    scaleAtStart: number;
    moved: boolean;
  } | null>(null);
  const pointers = useRef(new Map<number, XY>());
  const pinch = useRef<{ dist: number; view: View; mid: XY } | null>(null);

  // восстановление раскладки и своих связей: localStorage существует только в
  // браузере, поэтому чтение — в эффекте (паттерн SynopsisEditor)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Stored;
        if (stored.pos) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setPos((prev) => {
            const next = { ...prev };
            for (const [id, xy] of Object.entries(stored.pos!)) {
              if (next[id] && typeof xy?.x === "number" && typeof xy?.y === "number") next[id] = xy;
            }
            return next;
          });
        }
        if (Array.isArray(stored.custom)) {
          setCustom(stored.custom.filter((e) => nodeById.has(e.from) && nodeById.has(e.to)));
        }
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ pos, custom } satisfies Stored));
    } catch {}
  }, [pos, custom, loaded]);

  function nodeRect(n: GraphNode): Rect {
    const p = pos[n.id] ?? { x: n.x, y: n.y };
    return { x: p.x, y: p.y, w: n.w, h: n.h };
  }

  function fitView() {
    const el = wrapRef.current;
    if (!el) return;
    const rects = NODES.map(nodeRect);
    const minX = Math.min(...rects.map((r) => r.x)) - 40;
    const minY = Math.min(...rects.map((r) => r.y)) - 40;
    const maxX = Math.max(...rects.map((r) => r.x + r.w)) + 40;
    const maxY = Math.max(...rects.map((r) => r.y + r.h)) + 40;
    const rect = el.getBoundingClientRect();
    const k = Math.min(Math.max(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)), MIN_K), 1.1);
    setView({
      x: (rect.width - (maxX - minX) * k) / 2 - minX * k,
      y: (rect.height - (maxY - minY) * k) / 2 - minY * k,
      k,
    });
  }

  // первый показ: вписать всю карту в экран (после восстановления раскладки)
  useEffect(() => {
    if (loaded) fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** Зум вокруг точки холста: k' = k × mult, точка под курсором остаётся на месте. */
  function zoomBy(cx: number, cy: number, mult: number) {
    setView((v) => {
      const k = Math.min(Math.max(v.k * mult, MIN_K), MAX_K);
      return { x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k, k };
    });
  }

  function zoomButtons(mult: number) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomBy(r.width / 2, r.height / 2, mult);
  }

  function centerOn(id: string) {
    const el = wrapRef.current;
    const n = nodeById.get(id);
    if (!el || !n) return;
    const rect = nodeRect(n);
    const r = el.getBoundingClientRect();
    setView((v) => {
      const k = Math.max(v.k, 0.7);
      return {
        x: r.width / 2 - (rect.x + rect.w / 2) * k,
        y: r.height / 2 - (rect.y + rect.h / 2) * k,
        k,
      };
    });
  }

  function localPoint(e: { clientX: number; clientY: number }): XY {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- жесты холста ----------
  function onCanvasPointerDown(e: React.PointerEvent) {
    const pt = localPoint(e);
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        view,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
      drag.current = null;
      return;
    }
    drag.current = {
      mode: "pan",
      pointerId: e.pointerId,
      startX: pt.x,
      startY: pt.y,
      origin: { x: view.x, y: view.y },
      scaleAtStart: view.k,
      moved: false,
    };
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) && !drag.current) return;
    const pt = localPoint(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);

    if (pinch.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const { view: v0, dist: d0, mid } = pinch.current;
      const k = Math.min(Math.max((v0.k * dist) / Math.max(d0, 1), MIN_K), MAX_K);
      setView({ x: mid.x - ((mid.x - v0.x) * k) / v0.k, y: mid.y - ((mid.y - v0.y) * k) / v0.k, k });
      return;
    }

    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = pt.x - d.startX;
    const dy = pt.y - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy }));
    } else if (d.id) {
      const k = d.scaleAtStart;
      setPos((p) => ({ ...p, [d.id!]: { x: d.origin.x + dx / k, y: d.origin.y + dy / k } }));
    }
  }

  function onCanvasPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      if (d.mode === "node" && !d.moved && d.id) handleNodeTap(d.id);
      if (d.mode === "pan" && !d.moved) {
        setSelected(null);
        setLinkFrom(null);
      }
      drag.current = null;
    }
  }

  function onWheel(e: React.WheelEvent) {
    const pt = localPoint(e);
    zoomBy(pt.x, pt.y, Math.exp(-e.deltaY * 0.0012));
  }

  // ---------- узлы ----------
  function onNodePointerDown(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    // capture может бросить, если пойнтер уже отпущен (стилус, гонка событий) —
    // драг без капчура всё равно работает, пока палец не уходит с элемента
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    const pt = localPoint(e);
    drag.current = {
      mode: "node",
      id,
      pointerId: e.pointerId,
      startX: pt.x,
      startY: pt.y,
      origin: { ...pos[id] },
      scaleAtStart: view.k,
      moved: false,
    };
  }

  function handleNodeTap(id: string) {
    if (linkMode) {
      if (!linkFrom) {
        setLinkFrom(id);
        return;
      }
      if (linkFrom === id) {
        setLinkFrom(null);
        return;
      }
      const exists =
        custom.some((c) => (c.from === linkFrom && c.to === id) || (c.from === id && c.to === linkFrom)) ||
        EDGES.some((c) => (c.from === linkFrom && c.to === id) || (c.from === id && c.to === linkFrom));
      if (exists) {
        toast(t("Связь уже есть", "Link already exists"));
      } else {
        setCustom((c) => [...c, { from: linkFrom, to: id }]);
        toast(t("Связь добавлена", "Link added"));
      }
      setLinkFrom(null);
      return;
    }
    setSelected((s) => (s === id ? null : id));
  }

  function resetLayout() {
    setPos(defaultPos());
    setSelected(null);
    requestAnimationFrame(fitView);
    toast(t("Раскладка сброшена", "Layout reset"));
  }

  // ---------- отрисовка ----------
  const dimmed = (nodeId: string) => (focusGroup ? nodeById.get(nodeId)?.group !== focusGroup : false);
  const edgeDimmed = (e: GraphEdge) =>
    (focusGroup ? dimmed(e.from) && dimmed(e.to) : false) ||
    (selected ? e.from !== selected && e.to !== selected : false);
  const edgeActive = (e: GraphEdge) => selected !== null && (e.from === selected || e.to === selected);

  const showLabels = view.k > 0.55;
  const sel = selected ? nodeById.get(selected) : null;
  const selGroup = sel ? groupById.get(sel.group) : null;
  const selLinks = useMemo(() => {
    if (!selected) return { built: [] as Array<{ edge: GraphEdge; other: string; out: boolean }>, custom: [] as number[] };
    const built = EDGES.filter((e) => e.from === selected || e.to === selected).map((e) => ({
      edge: e,
      other: e.from === selected ? e.to : e.from,
      out: e.from === selected,
    }));
    const customIdx = custom
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.from === selected || e.to === selected)
      .map(({ i }) => i);
    return { built, custom: customIdx };
  }, [selected, custom]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink-800">
      {/* холст */}
      <div
        ref={wrapRef}
        className="absolute inset-0 touch-none select-none overflow-hidden"
        style={{
          backgroundImage: "radial-gradient(rgba(164,127,198,0.10) 1px, transparent 1px)",
          backgroundSize: `${28 * view.k}px ${28 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          cursor: "grab",
        }}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        onWheel={onWheel}
      >
        <div
          className="absolute left-0 top-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
        >
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width="1"
            height="1"
          >
            <defs>
              <marker id="hiw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--text-400)" />
              </marker>
              <marker id="hiw-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--violet-300)" />
              </marker>
              <marker id="hiw-arrow-custom" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--magenta-400)" />
              </marker>
            </defs>
            {EDGES.map((e, i) => {
              const na = nodeById.get(e.from);
              const nb = nodeById.get(e.to);
              if (!na || !nb) return null;
              const { d, mid } = edgePath(nodeRect(na), nodeRect(nb));
              const active = edgeActive(e);
              const dim = edgeDimmed(e);
              // сплошные рёбра — основной путь серии: заметнее пунктирной обвязки
              const main = !e.dashed;
              return (
                <g key={i} opacity={dim ? 0.12 : active ? 1 : main ? 0.9 : 0.5}>
                  <path
                    d={d}
                    fill="none"
                    stroke={active ? "var(--violet-300)" : main ? "var(--violet-400)" : "var(--text-400)"}
                    strokeWidth={active ? 2.6 : main ? 2.4 : 1.4}
                    strokeDasharray={e.dashed ? "6 5" : undefined}
                    markerEnd={active || main ? "url(#hiw-arrow-hi)" : "url(#hiw-arrow)"}
                  />
                  {showLabels && e.label && !dim && (
                    <text
                      x={mid.x}
                      y={mid.y - 6}
                      textAnchor="middle"
                      fontSize="11"
                      fill={active || main ? "var(--violet-200)" : "var(--text-300)"}
                      stroke="var(--ink-800)"
                      strokeWidth="4"
                      paintOrder="stroke"
                      style={{ fontFamily: "var(--font-golos), sans-serif" }}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {custom.map((e, i) => {
              const na = nodeById.get(e.from);
              const nb = nodeById.get(e.to);
              if (!na || !nb) return null;
              const { d } = edgePath(nodeRect(na), nodeRect(nb));
              const dim = focusGroup ? dimmed(e.from) && dimmed(e.to) : false;
              return (
                <path
                  key={`c${i}`}
                  d={d}
                  fill="none"
                  stroke="var(--magenta-400)"
                  strokeWidth={1.8}
                  strokeDasharray="2 4"
                  markerEnd="url(#hiw-arrow-custom)"
                  opacity={dim ? 0.12 : 0.9}
                />
              );
            })}
          </svg>

          {NODES.map((n) => {
            const p = pos[n.id];
            const g = groupById.get(n.group)!;
            const isSel = selected === n.id;
            const isLinkFrom = linkFrom === n.id;
            const dim = dimmed(n.id) && !isSel;
            const isStage = n.group === "path"; // этапы пути — крупнее и заметнее
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onNodePointerDown(n.id, e)}
                className="absolute flex flex-col justify-center rounded-lg border bg-ink-700 px-3"
                style={{
                  left: p.x,
                  top: p.y,
                  width: n.w,
                  height: n.h,
                  borderColor: isSel || isLinkFrom ? g.color : isStage ? "var(--border-strong)" : "var(--border-default)",
                  borderLeftWidth: 4,
                  borderLeftColor: g.color,
                  boxShadow: isSel
                    ? `0 0 0 1px ${g.color}, 0 0 18px ${g.color}55`
                    : isLinkFrom
                      ? `0 0 0 1px ${g.color}, 0 0 14px ${g.color}88`
                      : isStage
                        ? "var(--glow-violet-sm)"
                        : "var(--shadow-sm)",
                  opacity: dim ? 0.22 : 1,
                  cursor: "grab",
                  touchAction: "none",
                }}
              >
                <div
                  className={`font-semibold leading-tight text-t100 ${isStage ? "text-[14px]" : "text-[12px]"}`}
                  style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {n.title}
                </div>
                {n.sub && (
                  <div className={`truncate text-t400 ${isStage ? "text-[10.5px]" : "text-[9.5px]"}`}>{n.sub}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* легенда групп */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 p-3 pr-24">
        {GROUPS.map((g) => {
          const active = focusGroup === g.id;
          return (
            <button
              key={g.id}
              onClick={() => setFocusGroup(active ? null : g.id)}
              className="pointer-events-auto flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold"
              style={{
                borderColor: active ? g.color : "var(--border-subtle)",
                background: active ? "var(--ink-600)" : "rgba(10,8,16,.82)",
                color: active ? "var(--text-100)" : "var(--text-300)",
                backdropFilter: "blur(6px)",
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
              {g.label}
            </button>
          );
        })}
      </div>

      {/* панель инструментов (кнопки — явным JSX: обработчики читают refs,
          и линтер должен видеть их именно в onClick, а не в массиве данных) */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button
          onClick={() => zoomButtons(1.35)}
          title={t("Приблизить", "Zoom in")}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-ink-700 text-[15px] text-t200 hover:bg-ink-600"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          +
        </button>
        <button
          onClick={() => zoomButtons(1 / 1.35)}
          title={t("Отдалить", "Zoom out")}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-ink-700 text-[15px] text-t200 hover:bg-ink-600"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          −
        </button>
        <button
          onClick={() => fitView()}
          title={t("Вписать всё", "Fit view")}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-ink-700 text-[15px] text-t200 hover:bg-ink-600"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          ⛶
        </button>
        <button
          onClick={() => resetLayout()}
          title={t("Сбросить раскладку", "Reset layout")}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] bg-ink-700 text-[15px] text-t200 hover:bg-ink-600"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          ⟲
        </button>
        <button
          onClick={() => {
            setLinkMode((v) => !v);
            setLinkFrom(null);
          }}
          title={t("Связать узлы: тап по первому, затем по второму", "Link nodes: tap first, then second")}
          className="flex h-10 w-10 items-center justify-center rounded-lg border text-[13px] font-bold"
          style={{
            borderColor: linkMode ? "var(--border-strong)" : "var(--border-default)",
            background: linkMode ? "var(--violet-600)" : "var(--ink-700)",
            color: linkMode ? "#fff" : "var(--text-200)",
            boxShadow: linkMode ? "var(--glow-violet-sm)" : "var(--shadow-sm)",
          }}
        >
          ⧉
        </button>
      </div>

      {/* подсказка режима связи */}
      {linkMode && (
        <div className="absolute inset-x-0 top-2 flex justify-center">
          <div className="rounded-full border border-[var(--border-strong)] bg-ink-700 px-3 py-1.5 text-[10.5px] text-t200" style={{ boxShadow: "var(--shadow-md)" }}>
            {linkFrom
              ? t("Теперь тап по второму узлу — связь добавится", "Now tap the second node to add a link")
              : t("Режим связи: тап по первому узлу", "Link mode: tap the first node")}
          </div>
        </div>
      )}

      {/* панель деталей выбранного узла */}
      {sel && selGroup && (
        <div
          className="absolute inset-x-2 bottom-14 z-10 flex max-h-[52%] flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-ink-700 md:inset-x-auto md:right-3 md:top-3 md:bottom-auto md:max-h-[calc(100%-90px)] md:w-[380px]"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <div className="flex items-start gap-2 border-b border-[var(--border-subtle)] p-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: selGroup.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold leading-tight text-t100">{sel.title}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[10px] text-t400">{selGroup.label}</span>
                {sel.sub && <span className="text-[10px] text-t400">· {sel.sub}</span>}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[13px] text-t300 hover:bg-ink-500"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ul className="flex flex-col gap-1.5">
              {sel.details.map((d, i) => (
                <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-t200">
                  <span className="mt-[1px] shrink-0" style={{ color: selGroup.color }}>
                    •
                  </span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>

            {(selLinks.built.length > 0 || selLinks.custom.length > 0) && (
              <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5">
                <div className="section-label mb-1.5">{t("Связи", "Links")}</div>
                <div className="flex flex-col gap-1">
                  {selLinks.built.map(({ edge, other, out }, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelected(other);
                        centerOn(other);
                      }}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-t300 hover:bg-ink-600"
                    >
                      <span className="shrink-0 text-t400">{out ? "→" : "←"}</span>
                      <span className="truncate text-t200">{nodeById.get(other)?.title}</span>
                      {edge.label && <span className="ml-auto shrink-0 pl-2 text-[9.5px] text-t400">{edge.label}</span>}
                    </button>
                  ))}
                  {selLinks.custom.map((idx) => {
                    const e = custom[idx];
                    const other = e.from === sel.id ? e.to : e.from;
                    return (
                      <div key={`c${idx}`} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px]">
                        <span className="shrink-0" style={{ color: "var(--magenta-400)" }}>
                          {e.from === sel.id ? "→" : "←"}
                        </span>
                        <button
                          onClick={() => {
                            setSelected(other);
                            centerOn(other);
                          }}
                          className="truncate text-t200 hover:underline"
                        >
                          {nodeById.get(other)?.title}
                        </button>
                        <span className="text-[9px] text-t400">({t("моя связь", "my link")})</span>
                        <button
                          onClick={() => setCustom((c) => c.filter((_, i) => i !== idx))}
                          className="ml-auto shrink-0 rounded border border-[rgba(194,71,106,.4)] px-1.5 py-0.5 text-[9.5px] font-semibold text-danger hover:bg-[rgba(194,71,106,.08)]"
                        >
                          {t("убрать", "remove")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* шапка-оверлей */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <Link
          href="/settings"
          className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-ink-700 px-3 text-[11px] font-semibold text-t200 hover:bg-ink-600"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          ← {t("Настройки", "Settings")}
        </Link>
        <div className="rounded-lg bg-[rgba(10,8,16,.7)] px-2 py-1 text-[10px] text-t400" style={{ backdropFilter: "blur(6px)" }}>
          {t("тап — описание · перетаскивание — узлы и холст · ⧉ — связать", "tap — details · drag — nodes & canvas · ⧉ — link")}
        </div>
      </div>
    </div>
  );
}
