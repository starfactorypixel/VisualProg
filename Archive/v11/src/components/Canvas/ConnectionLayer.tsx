import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';

const HEADER_HEIGHT = 32;

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
        };

        const handleMouseUp = () => {
            setMousePos(null);
        };

        // Always track mouse movement
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [pan, scale]); // Re-create when pan/scale changes

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

        // 1. Data Node Priority Logic
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

        // Group 1: Exec (Aligned in rows)
        const eIdx = type === 'input'
            ? execInputs.findIndex(p => p.id === portId)
            : execOutputs.findIndex(p => p.id === portId);

        if (eIdx !== -1) {
            visualIndex = eIdx;
            found = true;
        }

        if (!found) {
            // Group 2: Data (Stacked: Inputs then Outputs)
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

        // Logic coordinate system (must match Node.tsx)
        let offsetY = HEADER_HEIGHT + 8; // Top padding

        if (node.definitionId === 'cmd_function') {
            offsetY += 28; // input h-7
            if (node.data?.file) offsetY += 4 + 24; // space-y-1 gap + button h-6
            offsetY += 8; // mb-2
            offsetY += 8; // Parent space-y-2 gap to the Ports wrapper
        }

        if (foundInData) {
            offsetY += (execRows * 24); // rows * (height + spacing)
            if (execRows > 0 && (dataInputs.length > 0 || dataOutputs.length > 0)) {
                offsetY += 16; // Separator h-2 (8px) + its top gap (8px)
            }
        }

        offsetY += (visualIndex * 24);
        offsetY += 8; // Center of 16px row

        if (type === 'output') {
            return { x: node.position.x + 136, y: node.position.y + offsetY, dx: 1, dy: 0, type: port.type };
        } else {
            return { x: node.position.x + 14, y: node.position.y + offsetY, dx: -1, dy: 0, type: port.type };
        }
    }, [nodes, nodeDefinitions]);

    // Memoize connection paths calculation
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

            return {
                id: conn.id,
                path,
                color: connColor,
                isRef,
                isHighlighted
            };
        });
    }, [connections, hoveredNodeId, hoveredType, getPortInfo, getPortColor, nodes]);

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
                            <circle r={connPath.isRef ? 4 : 3} fill={connPath.color} fillOpacity={0.9}>
                                <animateMotion dur="2s" repeatCount="indefinite" path={connPath.path} />
                                <animate attributeName="opacity" values="0;1;1;0" dur="2s" repeatCount="indefinite" />
                            </circle>
                            <circle r={connPath.isRef ? 4 : 3} fill={connPath.color} fillOpacity={0.9}>
                                <animateMotion dur="2s" repeatCount="indefinite" path={connPath.path} begin="1s" />
                                <animate attributeName="opacity" values="0;1;1;0" dur="2s" repeatCount="indefinite" begin="0.5s" />
                            </circle>
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
                        const controlDist = Math.max(dist * 0.15, 15); // Ещё меньше изгиб

                        const cp1 = {
                            x: sNub.x + (fromInfo.dx * controlDist),
                            y: sNub.y + (fromInfo.dy * controlDist)
                        };

                        // For linking, we don't have a target port yet, so cp2 follows mouse loosely
                        const cp2 = { x: mouseX, y: mouseY };

                        const isRef = fromInfo.type.startsWith('ref:');
                        const linkColor = getPortColor(fromInfo.type);

                        const d = `M ${fromInfo.x} ${fromInfo.y} L ${sNub.x} ${sNub.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${mouseX} ${mouseY}`;

                        return (
                            <g key="linking-line">
                                {/* Temporary connection line from selected port to mouse */}
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
                                {/* Mouse position indicator */}
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
