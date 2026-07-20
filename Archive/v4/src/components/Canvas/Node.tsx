import React, { useState, useEffect, useRef } from 'react';
import { NodeInstance, NodeDefinition } from '../../types';
import { useEditorStore } from '../../store/useEditorStore';
import clsx from 'clsx';
import { Lock, Unlock } from 'lucide-react';

interface NodeProps {
    data: NodeInstance;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const Node: React.FC<NodeProps> = ({ data, onContextMenu }) => {
    const {
        nodeDefinitions, updateNodePosition, updateNodeData,
        startLinking, endLinking, dataTypes,
        hoveredType, hoveredNodeId, connections, setHoveredNodeId,
        selectedNodeIds, selectNode
    } = useEditorStore();
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

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
        if (!state.linking || state.linking.fromNodeId === data.id) return false;
        const fromType = state.linking.fromPortTypeStr.toLowerCase();
        const fromPortType = state.linking.fromPortType;

        const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
        const btFrom = getBaseType(fromType);

        const targetPorts = fromPortType === 'output' ? definition?.inputs : definition?.outputs;
        return targetPorts?.some(p => {
            const btTarget = getBaseType(p.type.toLowerCase());
            return btFrom === btTarget || fromType === 'any' || p.type.toLowerCase() === 'any';
        });
    });

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

            // Инициализируем магнитное перетаскивание для command nodes
            const store = useEditorStore.getState();
            if (store.magneticGridMode /*&& data.type === 'command'*/ && (store as any).startDragging) {
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

    const handlePortMouseDown = (e: React.MouseEvent, portId: string, type: 'input' | 'output') => {
        e.stopPropagation();
        e.preventDefault();
        const port = (type === 'input' ? definition?.inputs : definition?.outputs)?.find(p => p.id === portId);
        const portType = port?.type || 'any';
        if (e.button === 0) startLinking(data.id, portId, type, portType, { x: 0, y: 0 });
    };

    const handlePortMouseUp = (e: React.MouseEvent, portId: string, _suggestedType: 'input' | 'output') => {
        e.stopPropagation();
        const store = useEditorStore.getState();
        const currentLinking = store.linking;

        if (e.button === 0 && currentLinking && currentLinking.fromNodeId !== data.id) {
            const fromType = currentLinking.fromPortType;

            let sourceNodeId, sourcePortId, targetNodeId, targetPortId;

            if (fromType === 'output') {
                sourceNodeId = currentLinking.fromNodeId;
                sourcePortId = currentLinking.fromPortId;
                targetNodeId = data.id;
                targetPortId = portId;
            } else {
                sourceNodeId = data.id;
                sourcePortId = portId;
                targetNodeId = currentLinking.fromNodeId;
                targetPortId = currentLinking.fromPortId;
            }

            const getDef = (n: NodeInstance | undefined) => {
                if (!n) return undefined;
                if (n.type === 'command') return store.nodeDefinitions.find(d => d.id === n.definitionId);
                const dt = store.dataTypes.find(t => t.name === n.definitionId);
                if (dt) return {
                    id: n.definitionId, type: 'data', name: dt.name,
                    inputs: [
                        { id: 'left', name: '', type: n.definitionId },
                        { id: 'right', name: '', type: n.definitionId },
                        { id: 'top', name: '', type: n.definitionId },
                        { id: 'bottom', name: '', type: n.definitionId }
                    ],
                    outputs: [
                        { id: 'left', name: '', type: n.definitionId },
                        { id: 'right', name: '', type: n.definitionId },
                        { id: 'top', name: '', type: n.definitionId },
                        { id: 'bottom', name: '', type: n.definitionId }
                    ]
                } as NodeDefinition;
                return undefined;
            };

            const sourceNode = store.nodes.find(n => n.id === sourceNodeId);
            const targetNode = store.nodes.find(n => n.id === targetNodeId);
            const sourceDef = getDef(sourceNode);
            const targetDef = getDef(targetNode);

            if (sourceDef && targetDef) {
                const sPort = sourceDef.outputs?.find(p => p.id === sourcePortId);
                const tPort = targetDef.inputs?.find(p => p.id === targetPortId);

                if (sPort && tPort) {
                    const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
                    const btSource = getBaseType(sPort.type.toLowerCase());
                    const btTarget = getBaseType(tPort.type.toLowerCase());

                    if (btSource === btTarget || sPort.type === 'any' || tPort.type === 'any') {
                        store.addConnection({
                            id: Math.random().toString(36).substr(2, 9),
                            fromNodeId: sourceNodeId,
                            fromPortId: sourcePortId,
                            toNodeId: targetNodeId,
                            toPortId: targetPortId
                        });
                    }
                }
            }
        }
        endLinking();
    };

    useEffect(() => {
        const handleWinMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const store = useEditorStore.getState();
            const { scale, selectedNodeIds } = store;

            const dx = (e.clientX - dragStartPos.current.x) / scale;
            const dy = (e.clientY - dragStartPos.current.y) / scale;

            const newX = dragStartNodePos.current.x + dx;
            const newY = dragStartNodePos.current.y + dy;

            // Магнитный режим
            if (store.magneticGridMode && (store as any).updateDragging) {
                // Обновляем позицию перетаскивания (для расчета магнита)
                (store as any).updateDragging({ x: newX, y: newY });
            } else {
                // Обычное перемещение (без магнитов)
                if (selectedNodeIds.length > 1 && selectedNodeIds.includes(data.id)) {
                    // Групповое перемещение
                    store.updateNodesPosition({ x: dx, y: dy });
                    // Обновляем стартовую позицию для следующей итерации
                    dragStartPos.current = { x: e.clientX, y: e.clientY };
                    dragStartNodePos.current = { x: newX, y: newY };
                } else {
                    // Одиночное перемещение
                    updateNodePosition(data.id, { x: newX, y: newY });
                }
            }
        };
        
        const handleWinMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                
                const store = useEditorStore.getState();
                if (store.magneticGridMode /*&& data.type === 'command'*/ && (store as any).draggingState && (store as any).endDragging) {
                    // Завершаем магнитное перетаскивание
                    const commit = (store as any).draggingState.isMagnetic;
                    (store as any).endDragging(commit);
                }
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

                    const inputs = definition.inputs || [];
                    const outputs = definition.outputs || [];

                    const execInputs = inputs.filter(p => isExec(p.type));
                    const execOutputs = outputs.filter(p => isExec(p.type));
                    const dataInputs = inputs.filter(p => !isExec(p.type));
                    const dataOutputs = outputs.filter(p => !isExec(p.type));

                    const hasExec = execInputs.length > 0 || execOutputs.length > 0;
                    const hasData = dataInputs.length > 0 || dataOutputs.length > 0;

                    const renderPortDot = (port: any, type: 'input' | 'output') => (
                        <div
                            className={clsx(
                                "w-3 h-3 rounded-full hover:bg-white border-neutral-900 transition-all cursor-crosshair shrink-0",
                                port.type.startsWith('ref:') ? "border-2" : "border"
                            )}
                            style={{ backgroundColor: getPortColor(port.type) }}
                            onMouseDown={(e) => handlePortMouseDown(e, port.id, type)}
                            onMouseUp={(e) => handlePortMouseUp(e, port.id, type)}
                            title={port.type.startsWith('ref:') ? `Bi-directional (${port.type})` : port.type}
                        />
                    );

                    const renderPortRow = (port: any, type: 'input' | 'output') => (
                        <div key={port.id} className={clsx("flex items-center gap-2 h-4", type === 'output' && "justify-end")}>
                            {type === 'output' && <span className="text-neutral-400 truncate">{port.name}</span>}
                            {renderPortDot(port, type)}
                            {type === 'input' && <span className="text-neutral-400 truncate">{port.name}</span>}
                        </div>
                    );

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

            {/* Unified Data Connection Overlays */}
            {data.type === 'data' && (
                <>
                    <div
                        className="absolute left-0 top-8 bottom-0 w-4 -ml-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                        title="Left"
                        onMouseUp={(e) => handlePortMouseUp(e, 'left', 'input')}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full shadow-sm"
                            style={{ backgroundColor: definition.visual?.color || '#3b82f6' }}
                            onMouseDown={(e) => handlePortMouseDown(e, 'left', 'output')}
                        />
                    </div>

                    <div
                        className="absolute right-0 top-8 bottom-0 w-4 -mr-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                        title="Right"
                        onMouseUp={(e) => handlePortMouseUp(e, 'right', 'input')}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full shadow-sm"
                            style={{ backgroundColor: definition.visual?.color || '#3b82f6' }}
                            onMouseDown={(e) => handlePortMouseDown(e, 'right', 'output')}
                        />
                    </div>

                    <div
                        className="absolute top-0 left-0 right-0 h-4 -mt-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                        title="Top"
                        onMouseUp={(e) => handlePortMouseUp(e, 'top', 'input')}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full shadow-sm"
                            style={{ backgroundColor: definition.visual?.color || '#3b82f6' }}
                            onMouseDown={(e) => handlePortMouseDown(e, 'top', 'output')}
                        />
                    </div>

                    <div
                        className="absolute bottom-0 left-0 right-0 h-4 -mb-2 cursor-crosshair flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-10"
                        title="Bottom"
                        onMouseUp={(e) => handlePortMouseUp(e, 'bottom', 'input')}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full shadow-sm"
                            style={{ backgroundColor: definition.visual?.color || '#3b82f6' }}
                            onMouseDown={(e) => handlePortMouseDown(e, 'bottom', 'output')}
                        />
                    </div>
                </>
            )}
        </div>
    );
};
