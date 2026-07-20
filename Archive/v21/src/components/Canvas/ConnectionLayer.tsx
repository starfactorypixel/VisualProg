import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { AnimationManager } from './AnimationManager';

const HEADER_HEIGHT = 32;

interface ConnectionLayerProps {
    onContextMenu: (e: React.MouseEvent, type: 'connection', id: string) => void;
}

// ─── Точное вычисление точки на составном пути: Line → CubicBezier → Line ──
//
// SVG путь: M from L sNub C cp1 cp2 eNub L to
// Три сегмента:
//   [0] Line:   from  → sNub   (длина nubLen)
//   [1] Bezier: sNub  → eNub   (через cp1, cp2)
//   [2] Line:   eNub  → to     (длина nubLen)
//
// t=0..1 распределяется пропорционально длинам сегментов.

function dist2d(ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
}

function cubicBezierPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Приблизительная длина кубической кривой Безье (сумма хорд по N шагам) */
function bezierLength(
    p0x: number, p0y: number,
    p1x: number, p1y: number,
    p2x: number, p2y: number,
    p3x: number, p3y: number,
    steps = 20
): number {
    let len = 0;
    let px = p0x, py = p0y;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const nx = cubicBezierPoint(t, p0x, p1x, p2x, p3x);
        const ny = cubicBezierPoint(t, p0y, p1y, p2y, p3y);
        len += dist2d(px, py, nx, ny);
        px = nx; py = ny;
    }
    return len;
}

/**
 * Возвращает точку на составном пути (Line + Bezier + Line) при глобальном t ∈ [0,1].
 * Параметр t распределяется пропорционально реальным длинам сегментов.
 */
function getPointOnCompositePath(
    t: number,
    fromX: number, fromY: number,
    sNubX: number, sNubY: number,
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    eNubX: number, eNubY: number,
    toX: number, toY: number
): { x: number; y: number } {
    const lenLine1 = dist2d(fromX, fromY, sNubX, sNubY);
    const lenBezier = bezierLength(sNubX, sNubY, cp1x, cp1y, cp2x, cp2y, eNubX, eNubY);
    const lenLine2 = dist2d(eNubX, eNubY, toX, toY);
    const totalLen = lenLine1 + lenBezier + lenLine2;

    if (totalLen === 0) return { x: fromX, y: fromY };

    const targetLen = t * totalLen;

    // Сегмент 1: from → sNub
    if (targetLen <= lenLine1) {
        const lt = lenLine1 > 0 ? targetLen / lenLine1 : 0;
        return { x: fromX + (sNubX - fromX) * lt, y: fromY + (sNubY - fromY) * lt };
    }

    // Сегмент 3: eNub → to
    const afterBezier = lenLine1 + lenBezier;
    if (targetLen >= afterBezier) {
        const lt = lenLine2 > 0 ? (targetLen - afterBezier) / lenLine2 : 1;
        return { x: eNubX + (toX - eNubX) * lt, y: eNubY + (toY - eNubY) * lt };
    }

    // Сегмент 2: кривая Безье sNub → eNub
    // Ищем локальный t кривой, соответствующий нужной длине (бинарный поиск)
    const targetBezierLen = targetLen - lenLine1;
    let lo = 0, hi = 1;
    for (let iter = 0; iter < 16; iter++) {
        const mid = (lo + hi) / 2;
        const midLen = bezierLength(sNubX, sNubY, cp1x, cp1y, cp2x, cp2y,
            cubicBezierPoint(mid, sNubX, cp1x, cp2x, eNubX),
            cubicBezierPoint(mid, sNubY, cp1y, cp2y, eNubY), 10);
        // Упрощённо: линейно масштабируем локальный t
        if (midLen < targetBezierLen) lo = mid; else hi = mid;
    }
    // Линейная интерполяция t внутри кривой по целевой длине
    const bt = lenBezier > 0 ? targetBezierLen / lenBezier : 0;
    return {
        x: cubicBezierPoint(bt, sNubX, cp1x, cp2x, eNubX),
        y: cubicBezierPoint(bt, sNubY, cp1y, cp2y, eNubY),
    };
}

// ─── Canvas-слой огоньков ───────────────────────────────────────────────────
interface DotInfo {
    x: number; y: number;
    r: number;
    fill: string;
    opacity: number;
}

interface ConnectionDots {
    connId: string;
    dot1: DotInfo;
    dot2: DotInfo;
}

/**
 * DotsCanvas — единый <canvas> для всех огоньков.
 *
 * Все огоньки рисуются в одном проходе ctx.clearRect + цикл arc.
 * Подписан на единый AnimationManager — один rAF на всё приложение.
 * SVG animateMotion полностью убраны.
 */
const DotsCanvas: React.FC<{
    dots: ConnectionDots[];
    pan: { x: number; y: number };
    scale: number;
    width: number;
    height: number;
}> = ({ dots, pan, scale, width, height }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Используем рефы чтобы избежать пересоздания подписки при каждом рендере
    const dotsRef = useRef(dots);
    dotsRef.current = dots;
    const panRef = useRef(pan);
    panRef.current = pan;
    const scaleRef = useRef(scale);
    scaleRef.current = scale;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const unsubscribe = AnimationManager.subscribe('dots-canvas', () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.translate(panRef.current.x, panRef.current.y);
            ctx.scale(scaleRef.current, scaleRef.current);

            for (const { dot1, dot2 } of dotsRef.current) {
                for (const dot of [dot1, dot2]) {
                    if (dot.opacity <= 0.01) continue;
                    ctx.globalAlpha = dot.opacity;
                    ctx.fillStyle = dot.fill;
                    ctx.beginPath();
                    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.restore();
        });

        return unsubscribe;
        // Подписка создаётся один раз при монтировании — данные читаются через рефы
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dpr = window.devicePixelRatio || 1;

    return (
        <canvas
            ref={canvasRef}
            width={width * dpr}
            height={height * dpr}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
            }}
        />
    );
};

// ─── Основной компонент ─────────────────────────────────────────────────────
export const ConnectionLayer: React.FC<ConnectionLayerProps> = ({ onContextMenu }) => {
    const {
        connections, nodes, nodeDefinitions, dataTypes,
        linking, pan, scale,
        hoveredNodeId, hoveredType
    } = useEditorStore();

    // tick обновляется с частотой AnimationManager.fps
    const [tick, setTick] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const unsubscribe = AnimationManager.subscribe('connection-layer-tick', (t) => {
            setTick(t);
        });
        return unsubscribe;
    }, []);

    // Следим за размером контейнера
    useEffect(() => {
        const el = containerRef.current?.parentElement;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const e = entries[0];
            setCanvasSize({ width: e.contentRect.width, height: e.contentRect.height });
        });
        ro.observe(el);
        setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();

    const getPortColor = useCallback((type: string) => {
        if (type === 'execution') return '#ffffff';
        const bt = getBaseType(type);
        const dt = dataTypes.find(d => d.name.toLowerCase() === bt);
        return dt ? dt.color : '#828282';
    }, [dataTypes]);

    const getPortInfo = useCallback((nodeId: string, portId: string, type: 'input' | 'output') => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return { x: 0, y: 0, dx: 1, dy: 0, type: 'any' };

        if (node.type === 'data') {
            const w = 150;
            const h = 86;
            const info = { x: 0, y: 0, dx: 0, dy: 0, type: node.definitionId };
            if (portId === 'left') { info.x = node.position.x; info.y = node.position.y + (h / 2); info.dx = -1; }
            else if (portId === 'right') { info.x = node.position.x + w; info.y = node.position.y + (h / 2); info.dx = 1; }
            else if (portId === 'top') { info.x = node.position.x + (w / 2); info.y = node.position.y; info.dy = -1; }
            else if (portId === 'bottom') { info.x = node.position.x + (w / 2); info.y = node.position.y + h; info.dy = 1; }
            else { info.x = node.position.x + (w / 2); info.y = node.position.y + (h / 2); info.dx = 1; }
            return info;
        }

        let targetDef = nodeDefinitions.find(d => d.id === node.definitionId);
        if (!targetDef) return { x: 0, y: 0, dx: 1, dy: 0, type: 'any' };

        const port = type === 'input'
            ? targetDef.inputs?.find(p => p.id === portId)
            : targetDef.outputs?.find(p => p.id === portId);

        if (!port) return { x: 0, y: 0, dx: 1, dy: 0, type: 'any' };

        const isExec = (t: string) => getBaseType(t) === 'execution';
        const inputs = targetDef.inputs || [];
        const outputs = targetDef.outputs || [];

        const execInputs = inputs.filter(p => isExec(p.type));
        const execOutputs = outputs.filter(p => isExec(p.type));
        const dataInputs = inputs.filter(p => !isExec(p.type));
        const dataOutputs = outputs.filter(p => !isExec(p.type));

        const execRows = Math.max(execInputs.length, execOutputs.length);

        let visualIndex = 0;
        let found = false;
        let foundInData = false;

        const eIdx = type === 'input'
            ? execInputs.findIndex(p => p.id === portId)
            : execOutputs.findIndex(p => p.id === portId);

        if (eIdx !== -1) { visualIndex = eIdx; found = true; }

        if (!found) {
            const dInputIdx = dataInputs.findIndex(p => p.id === portId);
            const dOutputIdx = dataOutputs.findIndex(p => p.id === portId);
            if (type === 'input' && dInputIdx !== -1) {
                visualIndex = dInputIdx; found = true; foundInData = true;
            } else if (type === 'output' && dOutputIdx !== -1) {
                visualIndex = dataInputs.length + dOutputIdx; found = true; foundInData = true;
            }
        }

        if (!found) return { x: 0, y: 0, dx: 1, dy: 0, type: 'any' };

        let offsetY = HEADER_HEIGHT + 8;

        if (node.definitionId === 'cmd_function') {
            offsetY += 28;
            if (node.data?.file) offsetY += 4 + 24;
            offsetY += 8;
            offsetY += 8;
        }

        if (foundInData) {
            offsetY += (execRows * 24);
            if (execRows > 0 && (dataInputs.length > 0 || dataOutputs.length > 0)) offsetY += 16;
        }

        offsetY += (visualIndex * 24);
        offsetY += 8;

        if (type === 'output') {
            return { x: node.position.x + 136, y: node.position.y + offsetY, dx: 1, dy: 0, type: port.type };
        } else {
            return { x: node.position.x + 14, y: node.position.y + offsetY, dx: -1, dy: 0, type: port.type };
        }
    }, [nodes, nodeDefinitions]);

    // ── Геометрия путей (статичная часть — без анимаций) ─────────────────────
    const connectionPaths = connections.map(conn => {
        const fromInfo = getPortInfo(conn.fromNodeId, conn.fromPortId, 'output');
        const toInfo = getPortInfo(conn.toNodeId, conn.toPortId, 'input');

        const isRef = fromInfo.type.startsWith('ref:') || toInfo.type.startsWith('ref:');
        const isHighlighted = !!(
            (hoveredNodeId && (conn.fromNodeId === hoveredNodeId || conn.toNodeId === hoveredNodeId)
                && fromInfo.type !== 'execution' && toInfo.type !== 'execution') ||
            (hoveredType && (
                fromInfo.type === hoveredType || fromInfo.type.replace('ref:', '') === hoveredType ||
                toInfo.type === hoveredType || toInfo.type.replace('ref:', '') === hoveredType
            ))
        );

        const nubLen = 20;
        const deltaX = Math.abs(toInfo.x - fromInfo.x);
        const deltaY = Math.abs(toInfo.y - fromInfo.y);
        const controlDist = Math.max(Math.max(deltaX, deltaY) * 0.4, 40);

        const sNub = { x: fromInfo.x + (fromInfo.dx * nubLen), y: fromInfo.y + (fromInfo.dy * nubLen) };
        const eNub = { x: toInfo.x + (toInfo.dx * nubLen), y: toInfo.y + (toInfo.dy * nubLen) };

        let cp1 = { x: sNub.x + (fromInfo.dx * controlDist), y: sNub.y + (fromInfo.dy * controlDist) };
        let cp2 = { x: eNub.x + (toInfo.dx * controlDist), y: eNub.y + (toInfo.dy * controlDist) };

        const isBackwards = fromInfo.dx > 0 && toInfo.dx < 0 && toInfo.x < fromInfo.x;
        if (isBackwards) {
            const fromNode = nodes.find(n => n.id === conn.fromNodeId);
            const toNode = nodes.find(n => n.id === conn.toNodeId);
            const topY = Math.min(fromNode?.position.y ?? fromInfo.y, toNode?.position.y ?? toInfo.y);
            const arcHeight = topY - 60;
            cp1 = { x: fromInfo.x + 300, y: arcHeight };
            cp2 = { x: toInfo.x - 300, y: arcHeight };
        }

        const path = `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${eNub.x} ${eNub.y} L ${toInfo.x} ${toInfo.y}`;
        const connColor = getPortColor(fromInfo.type);

        return { conn, path, connColor, isRef, isHighlighted, fromInfo, toInfo, sNub, eNub, cp1, cp2 };
    });

    // ── Позиции огоньков на текущем tick ──────────────────────────────────────
    const dotsData: ConnectionDots[] = connectionPaths.map(({ conn, connColor, isRef, fromInfo, toInfo, sNub, eNub, cp1, cp2 }) => {
        const r = isRef ? 4 : 3;

        const makeDot = (phase: number): DotInfo => {
            const t = (tick + phase) % 1;
            // Плавный fade: 0→1 за первые 10%, горит до 85%, гаснет до 100%
            let opacity = 0;
            if (t < 0.1) opacity = t / 0.1;
            else if (t < 0.85) opacity = 1;
            else opacity = 1 - (t - 0.85) / 0.15;

            // Точный путь: from → sNub → (bezier cp1,cp2) → eNub → to
            const pos = getPointOnCompositePath(
                t,
                fromInfo.x, fromInfo.y,
                sNub.x, sNub.y,
                cp1.x, cp1.y,
                cp2.x, cp2.y,
                eNub.x, eNub.y,
                toInfo.x, toInfo.y
            );
            return { x: pos.x, y: pos.y, r, fill: connColor, opacity };
        };

        return {
            connId: conn.id,
            dot1: makeDot(0),
            dot2: makeDot(0.5), // сдвиг фазы на 50% — два огонька на линию
        };
    });

    return (
        <div ref={containerRef} className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            {/* SVG — только статичные линии. Никаких animateMotion! */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                    {connectionPaths.map(({ conn, path, connColor, isRef, isHighlighted }) => (
                        <g key={conn.id}>
                            <path
                                d={path}
                                stroke="transparent"
                                strokeWidth={20}
                                fill="none"
                                className="pointer-events-auto cursor-pointer"
                                onContextMenu={(e) => onContextMenu(e, 'connection', conn.id)}
                            />
                            <path
                                d={path}
                                stroke={isHighlighted ? "#fff" : connColor}
                                strokeWidth={isHighlighted ? (isRef ? 7 : 4) : (isRef ? 5 : 2)}
                                fill="none"
                                className="pointer-events-none"
                                strokeOpacity={isHighlighted ? 1 : (isRef ? 0.8 : 0.6)}
                                style={{
                                    filter: isHighlighted ? 'drop-shadow(0 0 3px rgba(255,255,255,0.8))' : 'none'
                                }}
                            />
                        </g>
                    ))}

                    {linking && (() => {
                        const fromInfo = getPortInfo(linking.fromNodeId, linking.fromPortId, linking.fromPortType);
                        const mouseX = linking.mousePos.x;
                        const mouseY = linking.mousePos.y;
                        const nubLen = 20;
                        const sNub = { x: fromInfo.x + (fromInfo.dx * nubLen), y: fromInfo.y + (fromInfo.dy * nubLen) };
                        const dist = Math.sqrt(Math.pow(mouseX - fromInfo.x, 2) + Math.pow(mouseY - fromInfo.y, 2));
                        const controlDist = Math.max(dist * 0.4, 40);
                        const cp1 = { x: sNub.x + (fromInfo.dx * controlDist), y: sNub.y + (fromInfo.dy * controlDist) };
                        const isRef = fromInfo.type.startsWith('ref:');
                        const linkColor = getPortColor(fromInfo.type);
                        const d = `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${mouseX} ${mouseY}, ${mouseX} ${mouseY}`;
                        return (
                            <path
                                d={d}
                                stroke={linkColor === '#ffffff' ? '#4fc3f7' : linkColor}
                                strokeWidth={isRef ? 4 : 2}
                                strokeDasharray="5,5"
                                fill="none"
                                className="pointer-events-none"
                            />
                        );
                    })()}
                </g>
            </svg>

            {/* Canvas — все огоньки в одном слое */}
            {canvasSize.width > 0 && (
                <DotsCanvas
                    dots={dotsData}
                    pan={pan}
                    scale={scale}
                    width={canvasSize.width}
                    height={canvasSize.height}
                />
            )}
        </div>
    );
};