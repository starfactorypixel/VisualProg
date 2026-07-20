import React, { useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { AnimationManager } from './AnimationManager';

const HEADER_HEIGHT = 32;

// Пересчитывает SVG-путь для связи с учётом позиций нод
// Используется как при рендере, так и при ghost drag (прямое DOM-обновление)
function calcConnectionPath(
    conn: { fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string },
    fromNodePos: { x: number; y: number },
    toNodePos: { x: number; y: number },
    fromNode: { type: string; definitionId: string },
    toNode: { type: string; definitionId: string },
    nodeDefinitions: any[],
    dataTypes: any[]
): string | null {
    function getPortInfo(
        node: { type: string; definitionId: string; position: { x: number; y: number } },
        portId: string,
        portType: 'input' | 'output'
    ) {
        const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();
        const isExec = (t: string) => getBaseType(t) === 'execution';

        if (node.type === 'data') {
            const w = 150, h = 86;
            const p = { x: 0, y: 0, dx: 0, dy: 0 };
            if (portId === 'left')   { p.x = node.position.x;         p.y = node.position.y + h/2; p.dx = -1; }
            else if (portId === 'right')  { p.x = node.position.x + w; p.y = node.position.y + h/2; p.dx = 1; }
            else if (portId === 'top')    { p.x = node.position.x + w/2; p.y = node.position.y;     p.dy = -1; }
            else if (portId === 'bottom') { p.x = node.position.x + w/2; p.y = node.position.y + h; p.dy = 1; }
            return p;
        }

        const def = nodeDefinitions.find((d: any) => d.id === node.definitionId);
        if (!def) return null;

        const inputs = def.inputs || [];
        const outputs = def.outputs || [];
        const execInputs = inputs.filter((p: any) => isExec(p.type));
        const execOutputs = outputs.filter((p: any) => isExec(p.type));
        const dataInputs = inputs.filter((p: any) => !isExec(p.type));
        const dataOutputs = outputs.filter((p: any) => !isExec(p.type));
        const execRows = Math.max(execInputs.length, execOutputs.length);

        const ports = portType === 'input' ? inputs : outputs;
        const port = ports.find((p: any) => p.id === portId);
        if (!port) return null;

        const eIdx = portType === 'input'
            ? execInputs.findIndex((p: any) => p.id === portId)
            : execOutputs.findIndex((p: any) => p.id === portId);

        let visualIndex = 0;
        if (eIdx !== -1) {
            visualIndex = eIdx;
        } else {
            const dIdx = portType === 'input'
                ? dataInputs.findIndex((p: any) => p.id === portId)
                : dataOutputs.findIndex((p: any) => p.id === portId);
            visualIndex = execRows + dIdx;
        }

        const offsetY = HEADER_HEIGHT + 8 + visualIndex * 25 + 8;
        if (portType === 'output') {
            return { x: node.position.x + 136, y: node.position.y + offsetY, dx: 1, dy: 0 };
        } else {
            return { x: node.position.x + 14, y: node.position.y + offsetY, dx: -1, dy: 0 };
        }
    }

    const fromInfo = getPortInfo(
        { ...fromNode, position: fromNodePos },
        conn.fromPortId, 'output'
    );
    const toInfo = getPortInfo(
        { ...toNode, position: toNodePos },
        conn.toPortId, 'input'
    );
    if (!fromInfo || !toInfo) return null;

    const nubLen = 35;
    const deltaX = Math.abs(toInfo.x - fromInfo.x);
    const deltaY = Math.abs(toInfo.y - fromInfo.y);
    const controlDist = Math.max(Math.max(deltaX, deltaY) * 0.2, 25);

    const sNub = { x: fromInfo.x + fromInfo.dx * nubLen, y: fromInfo.y + fromInfo.dy * nubLen };
    const eNub = { x: toInfo.x  + toInfo.dx  * nubLen, y: toInfo.y  + toInfo.dy  * nubLen };

    let cp1 = { x: sNub.x + fromInfo.dx * controlDist, y: sNub.y + fromInfo.dy * controlDist };
    let cp2 = { x: eNub.x + toInfo.dx  * controlDist, y: eNub.y  + toInfo.dy  * controlDist };

    const isBackwards = fromInfo.dx > 0 && toInfo.dx < 0 && toInfo.x < fromInfo.x;
    if (isBackwards) {
        const topY = Math.min(fromNodePos.y, toNodePos.y);
        cp1 = { x: fromInfo.x + 300, y: topY - 60 };
        cp2 = { x: toInfo.x  - 300, y: topY - 60 };
    }

    return `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${eNub.x} ${eNub.y} L ${toInfo.x} ${toInfo.y}`;
}

interface ConnectionLayerProps {
    onContextMenu: (e: React.MouseEvent, type: 'connection', id: string) => void;
}

export const ConnectionLayer: React.FC<ConnectionLayerProps> = ({ onContextMenu }) => {
    const {
        connections, nodes, nodeDefinitions, dataTypes,
        selectedPort, pan, scale,
        hoveredNodeId, hoveredType
    } = useEditorStore();

    // Track mouse position for temporary connection line
    const [mousePos, setMousePos] = React.useState<{ x: number; y: number } | null>(null);

    // Refs to visible SVG path elements — for ghost drag direct DOM updates
    const visPathRefs = useRef<Map<string, SVGPathElement>>(new Map());

    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const container = document.getElementById('canvas-container');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const rawX = e.clientX - rect.left;
            const rawY = e.clientY - rect.top;
            const worldX = (rawX - pan.x) / scale;
            const worldY = (rawY - pan.y) / scale;
            setMousePos({ x: worldX, y: worldY });

            // Ghost drag: обновляем связи напрямую в DOM пока нода двигается
            const draggingEl = document.querySelector<HTMLElement>('[data-node-id][style*="translate"]');
            if (!draggingEl) return;

            const draggingNodeId = draggingEl.getAttribute('data-node-id');
            if (!draggingNodeId) return;

            const match = draggingEl.style.transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
            if (!match) return;
            const dx = parseFloat(match[1]);
            const dy = parseFloat(match[2]);

            const store = useEditorStore.getState();
            const movingIds = new Set(
                store.selectedNodeIds.length > 1 && store.selectedNodeIds.includes(draggingNodeId)
                    ? store.selectedNodeIds
                    : [draggingNodeId]
            );

            store.connections.forEach(conn => {
                const fromMoving = movingIds.has(conn.fromNodeId);
                const toMoving   = movingIds.has(conn.toNodeId);
                if (!fromMoving && !toMoving) return;

                const pathEl = visPathRefs.current.get(conn.id);
                if (!pathEl) return;

                const fromNode = store.nodes.find(n => n.id === conn.fromNodeId);
                const toNode   = store.nodes.find(n => n.id === conn.toNodeId);
                if (!fromNode || !toNode) return;

                const fromPos = fromMoving
                    ? { x: fromNode.position.x + dx, y: fromNode.position.y + dy }
                    : fromNode.position;
                const toPos = toMoving
                    ? { x: toNode.position.x + dx, y: toNode.position.y + dy }
                    : toNode.position;

                const d = calcConnectionPath(conn, fromPos, toPos, fromNode, toNode, store.nodeDefinitions, store.dataTypes);
                if (d) pathEl.setAttribute('d', d);
            });
        };

        const handleMouseUp = () => {
            setMousePos(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [pan, scale]);

    // Refs to SVG circle elements — updated directly by AnimationManager (no re-render)
    const dot1Refs = useRef<Map<string, SVGCircleElement>>(new Map());
    const dot2Refs = useRef<Map<string, SVGCircleElement>>(new Map());

    type PathData = {
        fx: number; fy: number; sx: number; sy: number;
        c1x: number; c1y: number; c2x: number; c2y: number;
        ex: number; ey: number; tx: number; ty: number;
    };
    const pathsRef = useRef<Map<string, PathData>>(new Map());

    useEffect(() => {
        // Helpers for composite path: Line(from→sNub) + Bezier(sNub→eNub) + Line(eNub→to)
        function d2(ax: number, ay: number, bx: number, by: number) {
            return Math.sqrt((bx-ax)**2 + (by-ay)**2);
        }
        function bez(t: number, p0: number, p1: number, p2: number, p3: number) {
            const u = 1-t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
        }
        function bezLen(p0x: number, p0y: number, p1x: number, p1y: number,
                        p2x: number, p2y: number, p3x: number, p3y: number) {
            let len = 0, px = p0x, py = p0y;
            for (let i = 1; i <= 20; i++) {
                const t = i/20;
                const nx = bez(t,p0x,p1x,p2x,p3x), ny = bez(t,p0y,p1y,p2y,p3y);
                len += d2(px,py,nx,ny); px=nx; py=ny;
            }
            return len;
        }
        function pointOnPath(t: number, p: PathData) {
            const l1 = d2(p.fx,p.fy, p.sx,p.sy);
            const lb = bezLen(p.sx,p.sy, p.c1x,p.c1y, p.c2x,p.c2y, p.ex,p.ey);
            const l2 = d2(p.ex,p.ey, p.tx,p.ty);
            const total = l1+lb+l2;
            if (total === 0) return { x: p.fx, y: p.fy };
            const tgt = t * total;
            if (tgt <= l1) {
                const lt = l1>0 ? tgt/l1 : 0;
                return { x: p.fx+(p.sx-p.fx)*lt, y: p.fy+(p.sy-p.fy)*lt };
            }
            if (tgt >= l1+lb) {
                const lt = l2>0 ? (tgt-l1-lb)/l2 : 1;
                return { x: p.ex+(p.tx-p.ex)*lt, y: p.ey+(p.ty-p.ey)*lt };
            }
            const bt = lb>0 ? (tgt-l1)/lb : 0;
            return { x: bez(bt,p.sx,p.c1x,p.c2x,p.ex), y: bez(bt,p.sy,p.c1y,p.c2y,p.ey) };
        }

        const unsub = AnimationManager.subscribe('svg-dots', (tick) => {
            pathsRef.current.forEach((p, id) => {
                for (const [dot, phase] of [
                    [dot1Refs.current.get(id), 0],
                    [dot2Refs.current.get(id), 0.5]
                ] as [SVGCircleElement | undefined, number][]) {
                    if (!dot) continue;
                    const t = (tick + phase) % 1;
                    let op = 0;
                    if (t < 0.1) op = t / 0.1;
                    else if (t < 0.85) op = 1;
                    else op = 1 - (t - 0.85) / 0.15;
                    dot.setAttribute('opacity', String(op));
                    if (op > 0.01) {
                        const pos = pointOnPath(t, p);
                        dot.setAttribute('cx', String(pos.x));
                        dot.setAttribute('cy', String(pos.y));
                    }
                }
            });
        });
        return unsub;
    }, []);

    const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();

    const getPortColor = React.useCallback((type: string) => {
        if (type === 'execution') return '#ffffff';
        const bt = getBaseType(type);
        const dt = dataTypes.find(d => d.name.toLowerCase() === bt);
        return dt ? dt.color : '#828282';
    }, [dataTypes]);

    const getPortInfo = React.useCallback((nodeId: string, portId: string, type: 'input' | 'output') => {
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

        if (eIdx !== -1) {
            visualIndex = eIdx;
            found = true;
        }

        if (!found) {
            const dInputIdx = dataInputs.findIndex(p => p.id === portId);
            const dOutputIdx = dataOutputs.findIndex(p => p.id === portId);

            if (type === 'input' && dInputIdx !== -1) {
                visualIndex = dInputIdx;
                found = true;
                foundInData = true;
            } else if (type === 'output' && dOutputIdx !== -1) {
                visualIndex = dataInputs.length + dOutputIdx;
                found = true;
                foundInData = true;
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
            if (execRows > 0 && (dataInputs.length > 0 || dataOutputs.length > 0)) {
                offsetY += 16;
            }
        }

        offsetY += (visualIndex * 24);
        offsetY += 8;

        if (type === 'output') {
            return { x: node.position.x + 136, y: node.position.y + offsetY, dx: 1, dy: 0, type: port.type };
        } else {
            return { x: node.position.x + 14, y: node.position.y + offsetY, dx: -1, dy: 0, type: port.type };
        }
    }, [nodes, nodeDefinitions]);

    const connectionPaths = React.useMemo(() => {
        return connections.map(conn => {
            const fromInfo = getPortInfo(conn.fromNodeId, conn.fromPortId, 'output');
            const toInfo = getPortInfo(conn.toNodeId, conn.toPortId, 'input');

            const isRef = fromInfo.type.startsWith('ref:') || toInfo.type.startsWith('ref:');

            const isHighlighted = (
                (hoveredNodeId && (conn.fromNodeId === hoveredNodeId || conn.toNodeId === hoveredNodeId) && fromInfo.type !== 'execution' && toInfo.type !== 'execution') ||
                (hoveredType && (
                    fromInfo.type === hoveredType ||
                    fromInfo.type.replace('ref:', '') === hoveredType ||
                    toInfo.type === hoveredType ||
                    toInfo.type.replace('ref:', '') === hoveredType
                ))
            );

            const nubLen = 35;
            const deltaX = Math.abs(toInfo.x - fromInfo.x);
            const deltaY = Math.abs(toInfo.y - fromInfo.y);
            const controlDist = Math.max(Math.max(deltaX, deltaY) * 0.2, 25);

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
                cp1.y = arcHeight;
                cp2.y = arcHeight;
                cp1.x = fromInfo.x + 300;
                cp2.x = toInfo.x - 300;
            }

            const path = `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${eNub.x} ${eNub.y} L ${toInfo.x} ${toInfo.y}`;
            const connColor = getPortColor(fromInfo.type);

            // Store path geometry for AnimationManager dot positioning
            pathsRef.current.set(conn.id, {
                fx: fromInfo.x, fy: fromInfo.y,
                sx: sNub.x, sy: sNub.y,
                c1x: cp1.x, c1y: cp1.y,
                c2x: cp2.x, c2y: cp2.y,
                ex: eNub.x, ey: eNub.y,
                tx: toInfo.x, ty: toInfo.y,
            });

            return { id: conn.id, path, color: connColor, isRef, isHighlighted };
        });
    }, [connections, hoveredNodeId, hoveredType, getPortInfo, getPortColor, nodes]);

    // Clean up refs for removed connections
    const connIds = new Set(connections.map(c => c.id));
    dot1Refs.current.forEach((_, id) => {
        if (!connIds.has(id)) {
            dot1Refs.current.delete(id);
            dot2Refs.current.delete(id);
            pathsRef.current.delete(id);
        }
    });

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                {connectionPaths.map(connPath => {
                    const strokeColor = connPath.isHighlighted ? "#fff" : connPath.color;
                    return (
                        <g key={connPath.id}>
                            <path
                                d={connPath.path}
                                stroke="transparent"
                                strokeWidth={20}
                                fill="none"
                                className="pointer-events-auto cursor-pointer"
                                onContextMenu={(e) => onContextMenu(e, 'connection', connPath.id)}
                            />
                            <path
                                ref={el => { if (el) visPathRefs.current.set(connPath.id, el); }}
                                d={connPath.path}
                                stroke={strokeColor}
                                strokeWidth={connPath.isHighlighted ? (connPath.isRef ? 7 : 4) : (connPath.isRef ? 5 : 2)}
                                fill="none"
                                className="pointer-events-none"
                                strokeOpacity={connPath.isHighlighted ? 1 : (connPath.isRef ? 0.8 : 0.6)}
                                style={{
                                    filter: connPath.isHighlighted ? 'drop-shadow(0 0 3px rgba(255,255,255,0.8))' : 'none'
                                }}
                            />
                            {/* Dots — plain SVG circles, position driven by AnimationManager via setAttribute */}
                            <circle
                                ref={el => { if (el) dot1Refs.current.set(connPath.id, el); }}
                                r={connPath.isRef ? 4 : 3}
                                fill={connPath.color}
                                fillOpacity={0.9}
                                opacity={0}
                            />
                            <circle
                                ref={el => { if (el) dot2Refs.current.set(connPath.id, el); }}
                                r={connPath.isRef ? 4 : 3}
                                fill={connPath.color}
                                fillOpacity={0.9}
                                opacity={0}
                            />
                        </g>
                    );
                })}

                {selectedPort && mousePos && (
                    (() => {
                        const fromInfo = getPortInfo(selectedPort.fromNodeId, selectedPort.fromPortId, selectedPort.fromPortType);
                        const mouseX = mousePos.x;
                        const mouseY = mousePos.y;

                        const nubLen = 20;
                        const sNub = {
                            x: fromInfo.x + (fromInfo.dx * nubLen),
                            y: fromInfo.y + (fromInfo.dy * nubLen)
                        };

                        const dist = Math.sqrt(Math.pow(mouseX - fromInfo.x, 2) + Math.pow(mouseY - fromInfo.y, 2));
                        const controlDist = Math.max(dist * 0.15, 15);

                        const cp1 = {
                            x: sNub.x + (fromInfo.dx * controlDist),
                            y: sNub.y + (fromInfo.dy * controlDist)
                        };

                        const cp2 = { x: mouseX, y: mouseY };

                        const isRef = fromInfo.type.startsWith('ref:');
                        const linkColor = getPortColor(fromInfo.type);

                        const d = `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${mouseX} ${mouseY}`;

                        return (
                            <g key="linking-line">
                                <path
                                    d={d}
                                    stroke={linkColor === '#ffffff' ? '#4fc3f7' : linkColor}
                                    strokeWidth={isRef ? 4 : 2}
                                    strokeDasharray="5,5"
                                    fill="none"
                                    className="pointer-events-none"
                                    style={{
                                        filter: 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.8))'
                                    }}
                                />
                                <circle
                                    cx={mouseX}
                                    cy={mouseY}
                                    r={6}
                                    fill={linkColor === '#ffffff' ? '#4fc3f7' : linkColor}
                                    fillOpacity={0.5}
                                    className="pointer-events-none"
                                />
                            </g>
                        );
                    })()
                )}
            </g>
        </svg>
    );
};