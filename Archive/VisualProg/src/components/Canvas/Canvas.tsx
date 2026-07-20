import React, { useRef, useState, useEffect } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { Grid } from './Grid';
import { Node } from './Node';
import { ConnectionLayer } from './ConnectionLayer';
import { Position } from '../../types';
import { ContextMenu } from '../UI/ContextMenu';

export const Canvas: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        nodes,
        pan,
        scale,
        setPan,
        setScale,
        linking,
        updateLinking,
        endLinking,
        removeNode,
        removeConnection
    } = useEditorStore();

    const [isPanning, setIsPanning] = useState(false);
    const panningStartPos = useRef({ x: 0, y: 0 });
    const panningStartPan = useRef({ x: 0, y: 0 });
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'node' | 'connection', id: string } | null>(null);

    const [selectionBox, setSelectionBox] = useState<{ start: Position; current: Position } | null>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) { // Middle click for panning
            setIsPanning(true);
            panningStartPos.current = { x: e.clientX, y: e.clientY };
            panningStartPan.current = { x: pan.x, y: pan.y };
            e.preventDefault(); // Prevent default middle-click behavior
            return;
        }

        if (e.button === 0) { // Left click for selection
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setSelectionBox({ start: { x, y }, current: { x, y } });

                // Clear selection if clicking background without shift
                if (!e.shiftKey) useEditorStore.getState().deselectAll();
            }
        }
    };

    // Global Mouse Handling for Panning, Linking and Selection
    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            const store = useEditorStore.getState();
            const { pan: currentPan, scale: currentScale, linking: currentLinking } = store;

            // Panning
            if (isPanning) {
                const dx = e.clientX - panningStartPos.current.x;
                const dy = e.clientY - panningStartPos.current.y;
                setPan({
                    x: panningStartPan.current.x + dx,
                    y: panningStartPan.current.y + dy
                });
            }

            // Linking
            if (currentLinking && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const rawX = e.clientX - rect.left;
                const rawY = e.clientY - rect.top;
                const worldX = (rawX - currentPan.x) / currentScale;
                const worldY = (rawY - currentPan.y) / currentScale;
                updateLinking({ x: worldX, y: worldY });
            }

            // Selection Box
            if (selectionBox) {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    setSelectionBox(prev => prev ? { ...prev, current: { x, y } } : null);
                }
            }
        };

        const handleWindowMouseUp = () => {
            if (isPanning) setIsPanning(false);

            const store = useEditorStore.getState();
            const currentLinking = store.linking;

            if (currentLinking) {
                if (store.hoveredSidebarType) {
                    store.spawnNodeAndConnect(store.hoveredSidebarType, 'data', currentLinking.mousePos);
                } else if (store.hoveredNodeId) {
                    store.completeLinkingToNode(store.hoveredNodeId);
                } else {
                    store.endLinking();
                }
            }

            if (selectionBox) {
                const { start, current } = selectionBox;
                const x1 = (Math.min(start.x, current.x) - pan.x) / scale;
                const y1 = (Math.min(start.y, current.y) - pan.y) / scale;
                const x2 = (Math.max(start.x, current.x) - pan.x) / scale;
                const y2 = (Math.max(start.y, current.y) - pan.y) / scale;

                // Only select if box has some size
                if (Math.abs(start.x - current.x) > 5 || Math.abs(start.y - current.y) > 5) {
                    store.selectNodesInRect({ x1, y1, x2, y2 });
                }
                setSelectionBox(null);
            }
        };

        if (isPanning || linking || selectionBox) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isPanning, linking !== null, selectionBox, setPan, updateLinking, endLinking, pan, scale]);

    const handleContextMenu = (e: React.MouseEvent, type: 'node' | 'connection', id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, type, id });
    };

    return (
        <>
            <div
                id="canvas-container"
                ref={containerRef}
                className="w-full h-full bg-[#1e1e1e] cursor-crosshair overflow-hidden relative"
                onMouseDown={handleMouseDown}
                onWheel={(e) => {
                    const zoomSensitivity = 0.001;
                    const delta = -e.deltaY * zoomSensitivity;
                    const oldScale = scale;
                    const newScale = Math.min(Math.max(0.1, scale + delta), 5);

                    if (containerRef.current) {
                        const rect = containerRef.current.getBoundingClientRect();
                        const mouseX = e.clientX - rect.left;
                        const mouseY = e.clientY - rect.top;

                        // Calculate where the mouse pointer is in "world" space before zoom
                        const worldX = (mouseX - pan.x) / oldScale;
                        const worldY = (mouseY - pan.y) / oldScale;

                        // Calculate new pan so that the same world point is at the same mouse position
                        const newPanX = mouseX - worldX * newScale;
                        const newPanY = mouseY - worldY * newScale;

                        setPan({ x: newPanX, y: newPanY });
                    }

                    setScale(newScale);
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu(null); // Close if clicked on empty space
                }}
            >
                <Grid />
                <ConnectionLayer onContextMenu={handleContextMenu} />

                {selectionBox && (
                    <div
                        className="selection-box"
                        style={{
                            left: Math.min(selectionBox.start.x, selectionBox.current.x),
                            top: Math.min(selectionBox.start.y, selectionBox.current.y),
                            width: Math.abs(selectionBox.start.x - selectionBox.current.x),
                            height: Math.abs(selectionBox.start.y - selectionBox.current.y)
                        }}
                    />
                )}

                <div
                    className="absolute top-0 left-0 origin-top-left will-change-transform"
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                >
                    {/* Ghost Preview Node */}
                    {(() => {
                        if (linking && useEditorStore.getState().hoveredSidebarType) {
                            const store = useEditorStore.getState();
                            const dt = store.dataTypes.find(t => t.name === store.hoveredSidebarType);
                            return (
                                <div
                                    className="absolute w-[150px] opacity-40 border-2 border-dashed rounded-md bg-neutral-800 flex flex-col pointer-events-none z-50 shadow-lg"
                                    style={{
                                        left: linking.mousePos.x - 75,
                                        top: linking.mousePos.y - 15,
                                        borderColor: dt?.color || '#555'
                                    }}
                                >
                                    <div className="h-4 bg-neutral-700 rounded-t-sm" style={{ backgroundColor: dt?.color + '44' }} />
                                    <div className="p-2 text-[10px] text-neutral-400 font-bold uppercase tracking-tighter">
                                        Spawn: {dt?.name}
                                    </div>
                                    <div className="flex justify-between px-2 mb-1">
                                        <div className="w-2 h-2 rounded-full bg-neutral-600" />
                                        <div className="w-2 h-2 rounded-full bg-neutral-600" />
                                    </div>
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {nodes.map(node => (
                        <Node
                            key={node.id}
                            data={node}
                            onContextMenu={(e: React.MouseEvent) => handleContextMenu(e, 'node', node.id)}
                        />
                    ))}
                </div>
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={[
                        {
                            label: 'Set Group',
                            action: () => {
                                const group = prompt('Enter Group Name (e.g. Player, Game):', 'Global');
                                if (group !== null) {
                                    useEditorStore.getState().updateNodeData(contextMenu.id, { group: group || 'Global' });
                                }
                            }
                        },
                        {
                            label: 'Duplicate',
                            action: () => {
                                if (contextMenu.type === 'node') {
                                    const store = useEditorStore.getState();
                                    const nodeToClone = store.nodes.find(n => n.id === contextMenu.id);
                                    if (nodeToClone) {
                                        store.addNode({
                                            ...nodeToClone,
                                            id: crypto.randomUUID(),
                                            position: {
                                                x: nodeToClone.position.x + 20,
                                                y: nodeToClone.position.y + 20
                                            }
                                        });
                                    }
                                }
                            }
                        },
                        {
                            label: contextMenu.type === 'node' ? 'Delete Node' : 'Delete Connection',
                            danger: true,
                            action: () => {
                                if (contextMenu.type === 'node') removeNode(contextMenu.id);
                                else removeConnection(contextMenu.id);
                            }
                        }
                    ]}
                />
            )}
        </>
    );
};
