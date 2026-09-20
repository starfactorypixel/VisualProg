import React, { useState, useEffect, useRef, memo } from 'react';
import { NodeInstance, NodeDefinition } from '../../types';
import { useEditorStore } from '../../store/useEditorStore';
import clsx from 'clsx';
import { Lock, Unlock } from 'lucide-react';

interface NodeProps {
    data: NodeInstance;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const NodeComponent: React.FC<NodeProps> = ({ data, onContextMenu }) => {
    const {
        nodeDefinitions, updateNodePosition, updateNodeData, dataTypes,
        hoveredType, hoveredNodeId, connections, setHoveredNodeId,
        selectedNodeIds, selectNode, selectedPort
    } = useEditorStore();
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredPort, setHoveredPort] = useState<{ portId: string; type: 'input' | 'output' } | null>(null);

    // Ghost drag: двигаем DOM напрямую, не трогая Zustand до mouseup
    const nodeRef = useRef<HTMLDivElement>(null);
    const ghostOffset = useRef({ x: 0, y: 0 });

    let definition: NodeDefinition | undefined;

    if (data.type === 'command') {
        definition = nodeDefinitions.find(def => def.id === data.definitionId);
    } else {
        const dataType = dataTypes.find(dt => dt.name === data.definitionId);
        if (dataType) {
            definition = {
                id: data.definitionId,
                type: 'data',
                name: dataType.name,
                visual: { color: dataType.color },
                inputs: [
                    { id: 'left', name: '', type: data.definitionId as any },
                    { id: 'right', name: '', type: data.definitionId as any },
                    { id: 'top', name: '', type: data.definitionId as any },
                    { id: 'bottom', name: '', type: data.definitionId as any }
                ],
                outputs: [
                    { id: 'left', name: '', type: data.definitionId as any },
                    { id: 'right', name: '', type: data.definitionId as any },
                    { id: 'top', name: '', type: data.definitionId as any },
                    { id: 'bottom', name: '', type: data.definitionId as any }
                ]
            };
        }
    }

    const [title, setTitle] = useState(data.data?.label || definition?.name || '');

    if (!definition) return null;

    const isHoveredTypeMatch = hoveredType && (
        (data.type === 'data' && data.definitionId === hoveredType) ||
        (data.type === 'command' && (
            definition.inputs?.some(p => p.type === hoveredType || p.type.replace('ref:', '') === hoveredType) ||
            definition.outputs?.some(p => p.type === hoveredType || p.type.replace('ref:', '') === hoveredType)
        ))
    );

    const isHoveredNodeMatch = hoveredNodeId && (
        data.id === hoveredNodeId ||
        connections.some(c => {
            const isConnected = (c.fromNodeId === data.id && c.toNodeId === hoveredNodeId) ||
                (c.toNodeId === data.id && c.fromNodeId === hoveredNodeId);
            if (!isConnected) return false;

            const sourceNode = useEditorStore.getState().nodes.find(n => n.id === c.fromNodeId);
            const targetNode = useEditorStore.getState().nodes.find(n => n.id === c.toNodeId);

            if (sourceNode?.type === 'data' || targetNode?.type === 'data') return true;

            return false;
        })
    );

    const isLinkingMatch = useEditorStore((state) => {
        if (!state.selectedPort || state.selectedPort.fromNodeId === data.id) return false;
        const fromType = state.selectedPort.fromPortTypeStr.toLowerCase();
        const fromPortType = state.selectedPort.fromPortType;

        const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
        const btFrom = getBaseType(fromType);

        const targetPorts = fromPortType === 'output' ? definition?.inputs : definition?.outputs;
        return targetPorts?.some(p => {
            const btTarget = getBaseType(p.type.toLowerCase());
            return btFrom === btTarget || fromType === 'any' || p.type.toLowerCase() === 'any';
        });
    });

    // Check if a specific port is the selected port
    const isPortSelected = (portId: string, type: 'input' | 'output') => {
        if (!selectedPort) return false;
        return selectedPort.fromNodeId === data.id && 
               selectedPort.fromPortId === portId && 
               selectedPort.fromPortType === type;
    };

    // Check if a specific port is compatible with the selected port
    const isPortCompatible = (portId: string, type: 'input' | 'output') => {
        if (!selectedPort || selectedPort.fromNodeId === data.id) return false;
        
        const port = (type === 'input' ? definition?.inputs : definition?.outputs)?.find(p => p.id === portId);
        if (!port) return false;
        
        // Must be opposite type (input <-> output)
        if (type === selectedPort.fromPortType) return false;
        
        const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
        const btFrom = getBaseType(selectedPort.fromPortTypeStr.toLowerCase());
        const btTarget = getBaseType(port.type.toLowerCase());
        
        return btFrom === btTarget || selectedPort.fromPortTypeStr.toLowerCase() === 'any' || port.type.toLowerCase() === 'any';
    };

    const isHighlighted = isHoveredTypeMatch || isHoveredNodeMatch || isLinkingMatch;

    // Проверка магнитного состояния
    const isMagnetic = useEditorStore(state => 
        state.draggingState?.nodeId === data.id && state.draggingState?.isMagnetic
    );

    const dragStartPos = useRef({ x: 0, y: 0 });
    const dragStartNodePos = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (e.button === 0) {
            setIsDragging(true);
            dragStartPos.current = { x: e.clientX, y: e.clientY };
            dragStartNodePos.current = { x: data.position.x, y: data.position.y };
            ghostOffset.current = { x: 0, y: 0 };

            // Инициализируем перетаскивание для всех режимов
            const store = useEditorStore.getState();
            if ((store as any).startDragging) {
                (store as any).startDragging(data.id, data.position, data.type);
            }

            // Handle Selection
            const isSelected = selectedNodeIds.includes(data.id);
            if (e.shiftKey || e.ctrlKey) {
                selectNode(data.id, true);
            } else if (!isSelected) {
                selectNode(data.id, false);
            }
        }
    };

    const handlePortClick = (e: React.MouseEvent, portId: string, type: 'input' | 'output') => {
        e.stopPropagation();
        const port = (type === 'input' ? definition?.inputs : definition?.outputs)?.find(p => p.id === portId);
        const portType = port?.type || 'any';

        const store = useEditorStore.getState();

        // If no port is selected, select this one
        if (!store.selectedPort) {
            store.startLinking(data.id, portId, type, portType);
        } 
        // If clicking on the same port, cancel selection
        else if (store.selectedPort.fromNodeId === data.id && store.selectedPort.fromPortId === portId) {
            store.cancelLinking();
        }
        // If clicking on a different port, try to complete the connection
        else {
            store.completeLinking(data.id, portId, type);
        }
    };

    useEffect(() => {
        const handleWinMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const store = useEditorStore.getState();
            const { scale, selectedNodeIds: storeSelectedIds } = store;

            const rawDx = (e.clientX - dragStartPos.current.x) / scale;
            const rawDy = (e.clientY - dragStartPos.current.y) / scale;
            const newX = dragStartNodePos.current.x + rawDx;
            const newY = dragStartNodePos.current.y + rawDy;

            // Вычисляем итоговое смещение (с учётом магнита если нужно)
            let finalDx = rawDx;
            let finalDy = rawDy;

            if (store.magneticGridMode) {
                const nearest = store.findNearestGridPoint({ x: newX, y: newY }, data.type);
                const snapping = nearest !== null && nearest.distance <= store.magneticGridConfig.magnetRadius;
                const targetPos = snapping ? nearest!.point : { x: newX, y: newY };

                finalDx = targetPos.x - dragStartNodePos.current.x;
                finalDy = targetPos.y - dragStartNodePos.current.y;

                // Обновляем только draggingState (isMagnetic-ring) — nodes не трогаем
                if (store.draggingState) {
                    useEditorStore.setState({
                        draggingState: {
                            ...store.draggingState,
                            isMagnetic: snapping,
                            magneticPosition: snapping ? nearest!.point : null
                        }
                    });
                }
            }

            ghostOffset.current = { x: finalDx, y: finalDy };

            // Двигаем все затронутые ноды через DOM — одинаково для любого режима
            const nodeIds = storeSelectedIds.length > 1 && storeSelectedIds.includes(data.id)
                ? storeSelectedIds
                : [data.id];

            nodeIds.forEach(nodeId => {
                const el = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
                if (el) el.style.transform = `translate(${finalDx}px, ${finalDy}px)`;
            });
        };

        const handleWinMouseUp = () => {
            if (!isDragging) return;
            setIsDragging(false);

            const store = useEditorStore.getState();
            const { x: odx, y: ody } = ghostOffset.current;

            // Определяем затронутые ноды
            const nodeIds = store.selectedNodeIds.length > 1 && store.selectedNodeIds.includes(data.id)
                ? store.selectedNodeIds
                : [data.id];

            // Сбрасываем transform у всех
            nodeIds.forEach(nodeId => {
                const el = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
                if (el) el.style.transform = '';
            });

            // Коммитим финальные позиции одним setState
            useEditorStore.setState((state) => ({
                draggingState: null,
                nodes: state.nodes.map(n => {
                    if (!nodeIds.includes(n.id)) return n;
                    // Для магнитного snap одиночной ноды берём magneticPosition если есть
                    if (store.magneticGridMode && nodeIds.length === 1
                        && store.draggingState?.isMagnetic && store.draggingState.magneticPosition) {
                        return { ...n, position: store.draggingState.magneticPosition! };
                    }
                    return { ...n, position: { x: n.position.x + odx, y: n.position.y + ody } };
                })
            }));

            // После магнитного коммита — пересчитываем сетку
            if (store.magneticGridMode) {
                useEditorStore.getState().recalculateGrid();
            }

            // Сохраняем историю (только для обычного режима)
            if (!store.magneticGridMode && (store as any).endDragging) {
                const finalPositions = useEditorStore.getState().nodes
                    .filter(n => nodeIds.includes(n.id))
                    .map(n => ({ id: n.id, position: { ...n.position } }));
                (store as any).endDragging(true, finalPositions);
            }
        };
        
        if (isDragging) {
            window.addEventListener('mousemove', handleWinMouseMove);
            window.addEventListener('mouseup', handleWinMouseUp);
        }
        
        return () => {
            window.removeEventListener('mousemove', handleWinMouseMove);
            window.removeEventListener('mouseup', handleWinMouseUp);
        };
    }, [isDragging, data.id, data.type, updateNodePosition]);


    useEffect(() => {
        setTitle(data.data?.label || definition?.name || '');
    }, [data.data?.label, definition?.name]);

    const handleTitleSubmit = () => {
        setIsEditingTitle(false);
        updateNodeData(data.id, { label: title });
    };

    const isSelected = selectedNodeIds.includes(data.id);

    return (
        <div
            ref={nodeRef}
            data-node-id={data.id}
            className={clsx(
                "absolute flex flex-col rounded-md shadow-md border border-neutral-700 bg-neutral-800 text-xs w-[150px] select-none",
                !(isDragging || isSelected) && "transition-all duration-200",
                isDragging && "z-50 cursor-grabbing",
                isSelected && "ring-2 ring-blue-500 z-50",
                isHighlighted && "ring-4 ring-white shadow-[0_0_15px_rgba(255,255,255,0.5)] z-40",
                isMagnetic && "ring-4 ring-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.8)]"
            )}
            style={{
                left: data.position.x,
                top: data.position.y,
                borderColor: isHighlighted ? '#fff' : (isMagnetic ? '#3b82f6' : (definition.visual?.color || '#555'))
            }}
            onContextMenu={onContextMenu}
            onMouseEnter={() => setHoveredNodeId(data.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
        >
            {/* Header */}
            <div
                className="h-8 flex items-center px-3 cursor-grab active:cursor-grabbing rounded-t-md relative group"
                style={{ backgroundColor: (definition.visual?.color || '#333') + '33' }}
                onMouseDown={handleMouseDown}
                onDoubleClick={(e) => {
                    if (data.data.locked) return;
                    e.stopPropagation();
                    setIsEditingTitle(true);
                }}
            >
                {isEditingTitle ? (
                    <input
                        className="w-full bg-neutral-900 text-neutral-200 border-none outline-none rounded px-1 -ml-1 h-6"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={handleTitleSubmit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleTitleSubmit();
                            e.stopPropagation();
                        }}
                        autoFocus
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div className="flex items-center gap-2 w-full">
                        <span className="font-semibold text-neutral-200 capitalize truncate flex-1" title="Double click to rename">
                            {data.data?.label || definition.name}
                        </span>
                        {data.data?.label && data.data.label !== definition.name && (
                            <span className="text-[10px] text-neutral-400 font-normal shrink-0">
                                ({definition.name})
                            </span>
                        )}
                        {(data.type === 'data' || data.definitionId === 'cmd_function') && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all ml-auto"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateNodeData(data.id, { locked: !data.data.locked });
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                title={data.data.locked ? "Unlock edits" : "Lock edits"}
                            >
                                {data.data.locked ? (
                                    <Lock size={12} className="text-yellow-500" />
                                ) : (
                                    <Unlock size={12} className="text-neutral-400" />
                                )}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="p-2 space-y-2 relative">
                {/* Input/Select Field for Data Nodes */}
                {data.type === 'data' && (
                    <div className="mb-2">
                        {(() => {
                            const dataType = dataTypes.find(dt => dt.name === data.definitionId);
                            const isSelector = data.data.isGroupSelector;
                            const groupName = data.data.group;

                            if (isSelector && groupName) {
                                const store = useEditorStore.getState();
                                const groupNodes = store.nodes
                                    .filter(n => n.data?.group === groupName && n.id !== data.id && !n.data?.isGroupSelector)
                                    .filter(n => n.data?.value !== undefined && n.data?.value !== '')
                                    .map(n => ({
                                        value: n.data.value,
                                        label: n.data.label || n.definitionId,
                                        displayText: `${n.data.label || n.definitionId}: ${n.data.value}`
                                    }));

                                // Remove duplicates based on value
                                const uniqueNodes = Array.from(
                                    new Map(groupNodes.map(item => [item.value, item])).values()
                                );

                                return (
                                    <select
                                        className={clsx(
                                            "w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 focus:outline-none focus:border-purple-500 text-center transition-all appearance-none cursor-pointer",
                                            data.data.locked && "opacity-50 cursor-not-allowed bg-neutral-950"
                                        )}
                                        value={data.data.value || ''}
                                        disabled={data.data.locked}
                                        onChange={(e) => updateNodeData(data.id, { value: e.target.value })}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        <option value="" disabled>Pick from {groupName}...</option>
                                        {uniqueNodes.map(node => (
                                            <option key={node.value} value={node.value}>{node.displayText}</option>
                                        ))}
                                    </select>
                                );
                            }

                            if (dataType?.options) {
                                return (
                                    <select
                                        className={clsx(
                                            "w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 focus:outline-none focus:border-green-500 text-center transition-all appearance-none cursor-pointer",
                                            data.data.locked && "opacity-50 cursor-not-allowed bg-neutral-950"
                                        )}
                                        value={data.data.value || ''}
                                        disabled={data.data.locked}
                                        onChange={(e) => updateNodeData(data.id, { value: e.target.value })}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        <option value="" disabled>Select...</option>
                                        {dataType.options.map((opt, idx) => {
                                            // Support both string format and object format
                                            const optValue = typeof opt === 'string' ? opt : opt.value;
                                            const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.value);
                                            return (
                                                <option key={optValue || idx} value={optValue}>{optLabel}</option>
                                            );
                                        })}
                                    </select>
                                );
                            }
                            return (
                                <input
                                    className={clsx(
                                        "w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 focus:outline-none focus:border-blue-500 text-center transition-all",
                                        data.data.locked && "opacity-50 cursor-not-allowed bg-neutral-950"
                                    )}
                                    placeholder="Value..."
                                    value={data.data.value || ''}
                                    readOnly={data.data.locked}
                                    onChange={(e) => !data.data.locked && updateNodeData(data.id, { value: e.target.value })}
                                    onMouseDown={(e) => e.stopPropagation()}
                                />
                            );
                        })()}
                    </div>
                )}

                {/* Function Node File Binding */}
                {data.definitionId === 'cmd_function' && (
                    <div className="mb-2 space-y-1">
                        <input
                            className={clsx(
                                "w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-0 text-neutral-200 text-[10px] focus:outline-none focus:border-purple-500 h-7",
                                data.data.locked && "opacity-50 cursor-not-allowed bg-neutral-950"
                            )}
                            placeholder="filename.json"
                            value={data.data.file || ''}
                            readOnly={data.data.locked}
                            onChange={(e) => !data.data.locked && updateNodeData(data.id, { file: e.target.value })}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="Path to function file (relative to public/)"
                        />
                        {data.data.file && (
                            <button
                                className="w-full bg-neutral-700 hover:bg-neutral-600 border border-neutral-600 rounded px-2 py-0 h-6 text-[10px] text-neutral-300 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(`/?file=${data.data.file}`, '_blank');
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                Open in New Window
                            </button>
                        )}
                    </div>
                )}

                {/* Command Nodes: Grouped & Aligned Inputs/Outputs */}
                {data.type !== 'data' && (() => {
                    const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();
                    const isExec = (t: string) => getBaseType(t) === 'execution';

                    const getPortColor = (type: string) => {
                        if (isExec(type)) return '#ffffff';
                        const bt = getBaseType(type);
                        const dt = dataTypes.find(d => d.name.toLowerCase() === bt);
                        return dt ? dt.color : '#828282';
                    };

                    // Порт без подключённого провода — можно ввести локальное значение
                    // прямо на ноде; CodeGenerator сам подставит его через node.data[portId],
                    // если связи с дата-нодой нет (см. processNode/{param} в CodeGenerator.ts).
                    const isInputConnected = (portId: string) =>
                        connections.some(c => c.toNodeId === data.id && c.toPortId === portId);

                    const inputs = definition.inputs || [];
                    const outputs = definition.outputs || [];

                    const execInputs = inputs.filter(p => isExec(p.type));
                    const execOutputs = outputs.filter(p => isExec(p.type));
                    const dataInputs = inputs.filter(p => !isExec(p.type));
                    const dataOutputs = outputs.filter(p => !isExec(p.type));

                    const hasExec = execInputs.length > 0 || execOutputs.length > 0;
                    const hasData = dataInputs.length > 0 || dataOutputs.length > 0;

                    const renderPortDot = (port: any, type: 'input' | 'output') => {
                        const isSelected = isPortSelected(port.id, type);
                        const isCompatible = isPortCompatible(port.id, type);
                        const isHovered = hoveredPort?.portId === port.id;
                        
                        return (
                            <div
                                className={clsx(
                                    "w-3 h-3 rounded-full border-neutral-900 transition-all cursor-crosshair shrink-0",
                                    port.type.startsWith('ref:') ? "border-2" : "border",
                                    isSelected && "animate-pulse ring-2 ring-yellow-400 bg-yellow-400",
                                    !isSelected && isCompatible && "animate-pulse ring-2 ring-green-400 bg-green-400",
                                    !isSelected && !isCompatible && !isHovered && "hover:bg-white",
                                    isHovered && !isSelected && "ring-2 ring-white bg-white scale-125"
                                )}
                                style={{ 
                                    backgroundColor: isSelected || isCompatible || isHovered ? undefined : getPortColor(port.type)
                                }}
                                onClick={(e) => handlePortClick(e, port.id, type)}
                                onMouseEnter={() => setHoveredPort({ portId: port.id, type })}
                                onMouseLeave={() => setHoveredPort(null)}
                                title={port.type.startsWith('ref:') ? `Bi-directional (${port.type})` : (isSelected ? 'Selected port (click again to cancel)' : (isCompatible ? 'Compatible port (click to connect)' : port.type))}
                            />
                        );
                    };

                    const renderPortRow = (port: any, type: 'input' | 'output') => {
                        const showValueInput = type === 'input' && !isInputConnected(port.id);
                        const connectorGap = 22; // отступ инпута от границы ноды, px

                        return (
                            <div key={port.id} className={clsx("flex items-center gap-2 h-4 relative", type === 'output' && "justify-end")}>
                                {showValueInput && (
                                    <>
                                        {/* Линия-коннектор к точке порта */}
                                        <div
                                            className="absolute h-px pointer-events-none"
                                            style={{
                                                right: '100%',
                                                width: connectorGap,
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                backgroundColor: getPortColor(port.type)
                                            }}
                                        />
                                        <input
                                            type="text"
                                            className="absolute w-16 h-5 bg-neutral-900 border border-neutral-700 rounded px-1 text-[10px] leading-none text-neutral-200 text-center focus:outline-none focus:border-blue-500 z-10"
                                            style={{ right: `calc(100% + ${connectorGap}px)`, top: '50%', transform: 'translateY(-50%)' }}
                                            placeholder="…"
                                            value={data.data?.[port.id] ?? ''}
                                            onChange={(e) => updateNodeData(data.id, { [port.id]: e.target.value })}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                            title={`Локальное значение для "${port.name || port.id}" (используется, пока порт не подключён)`}
                                        />
                                    </>
                                )}
                                {type === 'output' && <span className="text-neutral-400 truncate">{port.name}</span>}
                                {renderPortDot(port, type)}
                                {type === 'input' && <span className="text-neutral-400 truncate">{port.name}</span>}
                            </div>
                        );
                    };

                    const renderRow = (inP: any, outP: any, key: string) => (
                        <div key={key} className="flex justify-between items-center h-4 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                {inP && (
                                    <>
                                        {renderPortDot(inP, 'input')}
                                        <span className="text-neutral-400 truncate">{inP.name}</span>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-2 min-w-0 justify-end flex-1">
                                {outP && (
                                    <>
                                        <span className="text-neutral-400 truncate">{outP.name}</span>
                                        {renderPortDot(outP, 'output')}
                                    </>
                                )}
                            </div>
                        </div>
                    );

                    const execRows = Math.max(execInputs.length, execOutputs.length);

                    return (
                        <div className="space-y-2">
                            {Array.from({ length: execRows }).map((_, i) =>
                                renderRow(execInputs[i], execOutputs[i], `exec-${i}`)
                            )}

                            {hasExec && hasData && <div className="h-2" />}

                            {dataInputs.map(p => renderPortRow(p, 'input'))}
                            {dataOutputs.map(p => renderPortRow(p, 'output'))}
                        </div>
                    );
                })()}
            </div>

            {/* Unified Data Connection Overlays - Bidirectional ports */}
            {data.type === 'data' && (
                <>
                    {(() => {
                        const getPortType = (_portId: string) => {
                            const store = useEditorStore.getState();
                            if (!store.selectedPort) return 'output';
                            return store.selectedPort.fromPortType === 'output' ? 'input' : 'output';
                        };
                        const portType = getPortType('left');
                        const leftSelected = isPortSelected('left', portType);
                        const leftCompatible = isPortCompatible('left', portType);
                        const leftHovered = hoveredPort?.portId === 'left';
                        
                        return (
                            <div
                                className="absolute left-0 top-0 bottom-0 w-4 -ml-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                                title={leftSelected ? 'Selected port (click again to cancel)' : (leftCompatible ? 'Compatible port (click to connect)' : 'Left (click to connect)')}
                                onClick={(e) => handlePortClick(e, 'left', portType)}
                                onMouseEnter={() => setHoveredPort({ portId: 'left', type: portType })}
                                onMouseLeave={() => setHoveredPort(null)}
                            >
                                <div
                                    className={clsx(
                                        "w-2.5 h-2.5 rounded-full shadow-sm transition-all",
                                        leftSelected && "animate-pulse ring-2 ring-yellow-400 bg-yellow-400",
                                        !leftSelected && leftCompatible && "animate-pulse ring-2 ring-green-400 bg-green-400",
                                        !leftSelected && !leftCompatible && !leftHovered && "hover:scale-125",
                                        leftHovered && !leftSelected && "ring-2 ring-white bg-white scale-125"
                                    )}
                                    style={{
                                        backgroundColor: leftSelected || leftCompatible || leftHovered ? undefined : (definition.visual?.color || '#3b82f6')
                                    }}
                                />
                            </div>
                        );
                    })()}

                    {(() => {
                        const getPortType = (_portId: string) => {
                            const store = useEditorStore.getState();
                            if (!store.selectedPort) return 'output';
                            return store.selectedPort.fromPortType === 'output' ? 'input' : 'output';
                        };
                        const portType = getPortType('right');
                        const rightSelected = isPortSelected('right', portType);
                        const rightCompatible = isPortCompatible('right', portType);
                        const rightHovered = hoveredPort?.portId === 'right';
                        
                        return (
                            <div
                                className="absolute right-0 top-0 bottom-0 w-4 -mr-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                                title={rightSelected ? 'Selected port (click again to cancel)' : (rightCompatible ? 'Compatible port (click to connect)' : 'Right (click to connect)')}
                                onClick={(e) => handlePortClick(e, 'right', portType)}
                                onMouseEnter={() => setHoveredPort({ portId: 'right', type: portType })}
                                onMouseLeave={() => setHoveredPort(null)}
                            >
                                <div
                                    className={clsx(
                                        "w-2.5 h-2.5 rounded-full shadow-sm transition-all",
                                        rightSelected && "animate-pulse ring-2 ring-yellow-400 bg-yellow-400",
                                        !rightSelected && rightCompatible && "animate-pulse ring-2 ring-green-400 bg-green-400",
                                        !rightSelected && !rightCompatible && !rightHovered && "hover:scale-125",
                                        rightHovered && !rightSelected && "ring-2 ring-white bg-white scale-125"
                                    )}
                                    style={{
                                        backgroundColor: rightSelected || rightCompatible || rightHovered ? undefined : (definition.visual?.color || '#3b82f6')
                                    }}
                                />
                            </div>
                        );
                    })()}

                    {(() => {
                        const getPortType = (_portId: string) => {
                            const store = useEditorStore.getState();
                            if (!store.selectedPort) return 'output';
                            return store.selectedPort.fromPortType === 'output' ? 'input' : 'output';
                        };
                        const portType = getPortType('top');
                        const topSelected = isPortSelected('top', portType);
                        const topCompatible = isPortCompatible('top', portType);
                        const topHovered = hoveredPort?.portId === 'top';
                        
                        return (
                            <div
                                className="absolute top-0 left-0 right-0 h-4 -mt-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                                title={topSelected ? 'Selected port (click again to cancel)' : (topCompatible ? 'Compatible port (click to connect)' : 'Top (click to connect)')}
                                onClick={(e) => handlePortClick(e, 'top', portType)}
                                onMouseEnter={() => setHoveredPort({ portId: 'top', type: portType })}
                                onMouseLeave={() => setHoveredPort(null)}
                            >
                                <div
                                    className={clsx(
                                        "w-2.5 h-2.5 rounded-full shadow-sm transition-all",
                                        topSelected && "animate-pulse ring-2 ring-yellow-400 bg-yellow-400",
                                        !topSelected && topCompatible && "animate-pulse ring-2 ring-green-400 bg-green-400",
                                        !topSelected && !topCompatible && !topHovered && "hover:scale-125",
                                        topHovered && !topSelected && "ring-2 ring-white bg-white scale-125"
                                    )}
                                    style={{
                                        backgroundColor: topSelected || topCompatible || topHovered ? undefined : (definition.visual?.color || '#3b82f6')
                                    }}
                                />
                            </div>
                        );
                    })()}

                    {(() => {
                        const getPortType = (_portId: string) => {
                            const store = useEditorStore.getState();
                            if (!store.selectedPort) return 'output';
                            return store.selectedPort.fromPortType === 'output' ? 'input' : 'output';
                        };
                        const portType = getPortType('bottom');
                        const bottomSelected = isPortSelected('bottom', portType);
                        const bottomCompatible = isPortCompatible('bottom', portType);
                        const bottomHovered = hoveredPort?.portId === 'bottom';
                        
                        return (
                            <div
                                className="absolute bottom-0 left-0 right-0 h-4 -mb-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                                title={bottomSelected ? 'Selected port (click again to cancel)' : (bottomCompatible ? 'Compatible port (click to connect)' : 'Bottom (click to connect)')}
                                onClick={(e) => handlePortClick(e, 'bottom', portType)}
                                onMouseEnter={() => setHoveredPort({ portId: 'bottom', type: portType })}
                                onMouseLeave={() => setHoveredPort(null)}
                            >
                                <div
                                    className={clsx(
                                        "w-2.5 h-2.5 rounded-full shadow-sm transition-all",
                                        bottomSelected && "animate-pulse ring-2 ring-yellow-400 bg-yellow-400",
                                        !bottomSelected && bottomCompatible && "animate-pulse ring-2 ring-green-400 bg-green-400",
                                        !bottomSelected && !bottomCompatible && !bottomHovered && "hover:scale-125",
                                        bottomHovered && !bottomSelected && "ring-2 ring-white bg-white scale-125"
                                    )}
                                    style={{
                                        backgroundColor: bottomSelected || bottomCompatible || bottomHovered ? undefined : (definition.visual?.color || '#3b82f6')
                                    }}
                                />
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
};

export const Node = memo(NodeComponent);