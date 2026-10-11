import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { forceCollide, forceX, forceY } from 'd3-force';
import type { VaultIndex } from '../vault';
import { inkColor, withAlpha, type Theme } from '../palette';
import { cssVar } from '../theme';

interface GNode {
  id: string;
  kind: 'domain' | 'note';
  label: string;
  ink?: string;
  r: number;
  due?: boolean;
  ref: string; // note id or domain slug
}
interface GLink {
  kind: 'member' | 'ref' | 'parent';
  ink?: string;
}
type N = NodeObject<GNode>;
type L = LinkObject<GNode, GLink>;

// Node objects are kept across renders (and remounts) so positions survive
// vault reloads and view switches instead of the layout starting over.
const nodeCache = new Map<string, N>();
let hasFitted = false;
let settledOnce = false;

const FONT = '"Recursive Variable", ui-sans-serif, system-ui, sans-serif';
const endId = (e: L['source']) => (typeof e === 'object' ? (e as N).id : String(e));
const truncate = (s: string, n = 42) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

interface Props {
  index: VaultIndex;
  theme: Theme;
  selectedNote?: string;
  selectedDomain?: string;
  panelOpen: boolean;
  onOpenNote: (id: string) => void;
  onOpenDomain: (slug: string) => void;
  onBackground: () => void;
}

export function GraphView({ index, theme, selectedNote, selectedDomain, panelOpen, onOpenNote, onOpenDomain, onBackground }: Props) {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colors = useMemo(
    () => ({
      paper: cssVar('--paper'),
      gridMinor: cssVar('--grid-minor'),
      gridMajor: cssVar('--grid-major'),
      ink: cssVar('--ink'),
      muted: cssVar('--ink-2'),
      red: cssVar('--red'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  const { data, neighbors } = useMemo(() => {
    const nodes: N[] = [];
    const links: L[] = [];
    const seen = new Set<string>();
    const upsert = (props: GNode) => {
      const node = nodeCache.get(props.id) ?? ({} as N);
      Object.assign(node, props);
      nodeCache.set(props.id, node);
      seen.add(props.id);
      nodes.push(node);
    };

    for (const d of index.domains) {
      const count = index.notesByDomain.get(d.slug)?.length ?? 0;
      upsert({ id: `d:${d.slug}`, kind: 'domain', label: d.name, ink: d.color, r: Math.min(30, 9 + Math.sqrt(count) * 3.2), ref: d.slug });
      if (d.parent && index.domainBySlug.has(d.parent) && d.parent !== d.slug) {
        links.push({ source: `d:${d.slug}`, target: `d:${d.parent}`, kind: 'parent', ink: d.color });
      }
    }
    for (const n of index.notes) {
      const degree = (index.outLinks.get(n.id)?.length ?? 0) + (index.backLinks.get(n.id)?.length ?? 0);
      const primary = index.domainBySlug.get(n.domains[0]);
      upsert({ id: `n:${n.id}`, kind: 'note', label: n.title, ink: primary?.color, r: 3.2 + Math.min(degree, 10) * 0.5, due: index.isDue(n), ref: n.id });
      for (const s of n.domains) {
        if (index.domainBySlug.has(s)) links.push({ source: `n:${n.id}`, target: `d:${s}`, kind: 'member', ink: index.domainBySlug.get(s)?.color });
      }
      for (const t of index.outLinks.get(n.id) ?? []) links.push({ source: `n:${n.id}`, target: `n:${t}`, kind: 'ref' });
    }
    for (const key of nodeCache.keys()) if (!seen.has(key)) nodeCache.delete(key);

    const neighbors = new Map<string, Set<string>>();
    for (const l of links) {
      const a = endId(l.source), b = endId(l.target);
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }
    return { data: { nodes, links }, neighbors };
  }, [index]);

  // What to emphasise: the hovered node, else the open note, else the open domain's cluster.
  const lit = useMemo(() => {
    const focus = hover ?? (selectedNote ? `n:${selectedNote}` : selectedDomain ? `d:${selectedDomain}` : null);
    if (!focus) return null;
    const set = new Set([focus, ...(neighbors.get(focus) ?? [])]);
    if (focus.startsWith('d:') && !hover) {
      // Include sub-domains and their notes.
      const visited = new Set([focus.slice(2)]);
      const stack = [focus.slice(2)];
      while (stack.length) {
        for (const child of index.childDomains.get(stack.pop()!) ?? []) {
          if (visited.has(child.slug)) continue;
          visited.add(child.slug);
          stack.push(child.slug);
          set.add(`d:${child.slug}`);
          for (const n of neighbors.get(`d:${child.slug}`) ?? []) set.add(n);
        }
      }
    }
    return set;
  }, [hover, selectedNote, selectedDomain, neighbors, index]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    (g.d3Force('charge') as any)?.strength((n: N) => (n.kind === 'domain' ? -240 : -40)).distanceMax(360);
    // A gentle pull to the middle keeps unrelated domains from drifting apart.
    g.d3Force('x', forceX<N>(0).strength(0.045) as any);
    g.d3Force('y', forceY<N>(0).strength(0.045) as any);
    (g.d3Force('link') as any)
      ?.distance((l: L) => (l.kind === 'member' ? 30 + ((l.target as N).r ?? 10) : l.kind === 'ref' ? 70 : 150))
      .strength((l: L) => (l.kind === 'member' ? 0.7 : l.kind === 'ref' ? 0.12 : 0.35));
    g.d3Force('collide', forceCollide<N>((n) => n.r + (n.kind === 'domain' ? 10 : 3)) as any);
    g.d3ReheatSimulation();
  }, [size.width > 0]);

  // Fit everything on first load, unless the URL already points at something.
  useEffect(() => {
    if (hasFitted || !size.width || !index.notes.length) return;
    const t = setTimeout(() => {
      hasFitted = true;
      if (!selectedNote && !selectedDomain) fg.current?.zoomToFit(600, 110);
    }, 350);
    return () => clearTimeout(t);
  }, [size.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the selected node into view, leaving room for the side panel.
  // A note created a moment ago has no position until the simulation places it.
  useEffect(() => {
    const id = selectedNote ? `n:${selectedNote}` : selectedDomain ? `d:${selectedDomain}` : null;
    if (!id) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const focus = () => {
      const node = nodeCache.get(id);
      const g = fg.current;
      if (!node || !g || node.x === undefined || node.y === undefined) {
        if (tries++ < 10) timer = setTimeout(focus, 120);
        return;
      }
      const zoom = Math.max(g.zoom(), selectedNote ? 1.6 : 1.1);
      const shift = panelOpen && size.width > 900 ? Math.min(560, size.width * 0.45) / 2 / zoom : 0;
      g.centerAt(node.x + shift, node.y, 600);
      g.zoom(zoom, 600);
    };
    focus();
    return () => clearTimeout(timer);
  }, [selectedNote, selectedDomain]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawGrid = (ctx: CanvasRenderingContext2D, scale: number) => {
    const g = fg.current;
    if (!g || !size.width) return;
    const tl = g.screen2GraphCoords(0, 0);
    const br = g.screen2GraphCoords(size.width, size.height);
    const line = (step: number, color: string) => {
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        ctx.moveTo(x, tl.y);
        ctx.lineTo(x, br.y);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        ctx.moveTo(tl.x, y);
        ctx.lineTo(br.x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / scale;
      ctx.stroke();
    };
    if (20 * scale > 7) line(20, colors.gridMinor);
    line(100, colors.gridMajor);
  };

  const label = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, weight: number, color: string, align: CanvasTextAlign, scale: number) => {
    ctx.font = `${weight} ${px / scale}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4 / scale;
    ctx.strokeStyle = colors.paper;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  const paintNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0, y = node.y ?? 0;
    const dim = lit && !lit.has(node.id);
    const ink = inkColor(node.ink, theme);
    ctx.globalAlpha = dim ? 0.14 : 1;

    if (node.kind === 'domain') {
      // A stamped seal: solid ink disc with a paper-coloured inner ring.
      ctx.beginPath();
      ctx.arc(x, y, node.r, 0, 2 * Math.PI);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, node.r * 0.72, 0, 2 * Math.PI);
      ctx.strokeStyle = colors.paper;
      ctx.lineWidth = Math.max(1, node.r * 0.07);
      ctx.stroke();
      if (node.ref === selectedDomain) {
        ctx.beginPath();
        ctx.arc(x, y, node.r + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();
      }
      label(ctx, node.label, x, y + node.r + 11 / scale, 13, 700, colors.ink, 'center', scale);
    } else {
      const isSelected = node.ref === selectedNote;
      ctx.beginPath();
      ctx.arc(x, y, node.r, 0, 2 * Math.PI);
      ctx.fillStyle = ink;
      ctx.fill();
      if (node.due) {
        // Due for review: the index card's red rule, as a ring.
        ctx.beginPath();
        ctx.arc(x, y, node.r + 2.2, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.red;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, node.r + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1.6 / scale;
        ctx.stroke();
      }
      const showLabel = isSelected || node.id === hover || scale > 1.9 || (lit?.has(node.id) && lit.size <= 40);
      if (showLabel) label(ctx, truncate(node.label), x + node.r + 5 / scale, y, 11.5, isSelected ? 650 : 480, colors.ink, 'left', scale);
    }
    ctx.globalAlpha = 1;
  };

  const linkColor = (l: L) => {
    const on = !lit || (lit.has(endId(l.source)) && lit.has(endId(l.target)));
    if (l.kind === 'ref') return withAlpha(colors.ink.startsWith('#') ? colors.ink : '#1E2A24', on ? 0.55 : 0.05);
    return withAlpha(inkColor(l.ink, theme), on ? (l.kind === 'parent' ? 0.6 : 0.3) : 0.04);
  };

  return (
    <div className="graph" ref={wrap}>
      {size.width > 0 && (
        <ForceGraph2D<GNode, GLink>
          ref={fg}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor={colors.paper}
          nodeId="id"
          nodeLabel={() => ''}
          nodeRelSize={1}
          nodeVal={(n) => n.r * n.r}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 4, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={linkColor}
          linkWidth={(l) => (l.kind === 'ref' ? 1.3 : l.kind === 'parent' ? 1.6 : 0.9)}
          linkLineDash={(l) => (l.kind === 'parent' ? [5, 4] : null)}
          linkDirectionalArrowLength={(l) => (l.kind === 'ref' ? 3.5 : 0)}
          linkDirectionalArrowRelPos={0.92}
          onRenderFramePre={drawGrid}
          onNodeHover={(n) => setHover(n ? n.id : null)}
          onNodeClick={(n) => (n.kind === 'note' ? onOpenNote(n.ref) : onOpenDomain(n.ref))}
          onBackgroundClick={onBackground}
          onNodeDragEnd={(n) => {
            n.fx = undefined;
            n.fy = undefined;
          }}
          warmupTicks={60}
          cooldownTime={4000}
          d3VelocityDecay={0.32}
          onEngineStop={() => {
            // Refit once the first layout has settled, unless something is open.
            if (settledOnce) return;
            settledOnce = true;
            if (!selectedNote && !selectedDomain) fg.current?.zoomToFit(700, 110);
          }}
          minZoom={0.2}
          maxZoom={8}
        />
      )}
      {index.notes.length === 0 && (
        <div className="graph-empty">
          <p className="graph-empty-title">Nothing captured yet</p>
          <p>
            Press <kbd>N</kbd> to write your first note, or run <code>/learn</code> at the end of a Claude Code session.
          </p>
        </div>
      )}
    </div>
  );
}
