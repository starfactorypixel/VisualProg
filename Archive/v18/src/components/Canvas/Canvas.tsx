import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { Grid } from './Grid';
import { MagneticGrid } from './MagneticGrid';
import { Node } from './Node';
import { ConnectionLayer } from './ConnectionLayer';
import { Position } from '../../types';
import { ContextMenu } from '../UI/ContextMenu';

const NODE_WIDTH = 150;
const NODE_HEIGHT = 100;
const VIEWPORT_MARGIN = 200;

export const Canvas: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        nodes,
        pan,
        scale,
        setPan,
        setScale,
        selectedPort,
        removeNode,
        removeConnection,
        removeSelectedNodes,
        selectedNodeIds,
        clipboard,
        magneticGridMode
    } = useEditorStore();

    const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    const [isPanning, setIsPanning] = useState(false);
    const panningStartPos = useRef({ x: 0, y: 0 });
    const panningStartPan = useRef({ x: 0, y: 0 });
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'node' | 'connection', id: string } | null>(null);
    const [emptySpaceMenu, setEmptySpaceMenu] = useState<{ x: number, y: number } | null>(null);

    const [selectionBox, setSelectionBox] = useState<{ start: Position; current: Position } | null>(null);

    // Виртуализация - рендерим только видимые ноды
    const visibleNodes = useMemo(() => {
        const worldLeft = -pan.x / scale - VIEWPORT_MARGIN / scale;
        const worldTop = -pan.y / scale - VIEWPORT_MARGIN / scale;
        const worldRight = (viewportSize.width - pan.x) / scale + VIEWPORT_MARGIN / scale;
        const worldBottom = (viewportSize.height - pan.y) / scale + VIEWPORT_MARGIN / scale;
        const margin = VIEWPORT_MARGIN / scale;

        return nodes.filter(node => {
            const nodeRight = node.position.x + NODE_WIDTH;
            const nodeBottom = node.position.y + NODE_HEIGHT;
            return (
                node.position.x <= worldRight + margin &&
                nodeRight >= worldLeft - margin &&
                node.position.y <= worldBottom + margin &&
                nodeBottom >= worldTop - margin
            );
        });
    }, [nodes, pan, scale, viewportSize.width, viewportSize.height]);

    // Отслеживание размера viewport
    useEffect(() => {
        const handleResize = () => {
            setViewportSize({ width: window.innerWidth, height: window.innerHeight });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1) {
            setIsPanning(true);
            panningStartPos.current = { x: e.clientX, y: e.clientY };
            panningStartPan.current = { x: pan.x, y: pan.y };
            e.preventDefault();
            return;
        }

        if (e.button === 0) {
            const store = useEditorStore.getState();
            
            // Cancel linking only if clicking on truly empty canvas (not on a node)
            // Check if the target is the canvas container itself
            if (store.selectedPort && e.target === e.currentTarget) {
                store.cancelLinking();
            }
            
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setSelectionBox({ start: { x, y }, current: { x, y } });

                if (!e.shiftKey) useEditorStore.getState().deselectAll();
            }
        }
    };

    // Handle Escape key to cancel linking
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                useEditorStore.getState().cancelLinking();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        const handleWindowMouseMove = (e: MouseEvent) => {
            if (isPanning) {
                const dx = e.clientX - panningStartPos.current.x;
                const dy = e.clientY - panningStartPos.current.y;
                setPan({
                    x: panningStartPan.current.x + dx,
                    y: panningStartPan.current.y + dy
                });
            }

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

            if (selectionBox) {
                const { start, current } = selectionBox;
                const x1 = (Math.min(start.x, current.x) - pan.x) / scale;
                const y1 = (Math.min(start.y, current.y) - pan.y) / scale;
                const x2 = (Math.max(start.x, current.x) - pan.x) / scale;
                const y2 = (Math.max(start.y, current.y) - pan.y) / scale;

                if (Math.abs(start.x - current.x) > 5 || Math.abs(start.y - current.y) > 5) {
                    useEditorStore.getState().selectNodesInRect({ x1, y1, x2, y2 });
                }
                setSelectionBox(null);
            }
        };

        if (isPanning || selectionBox) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isPanning, selectionBox, setPan, pan, scale]);

    const handleContextMenu = (e: React.MouseEvent, type: 'node' | 'connection', id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setEmptySpaceMenu(null);  // Close empty space menu
        setContextMenu({ x: e.clientX, y: e.clientY, type, id });
    };

    const handleCanvasContextMenu = (e: React.MouseEvent) => {
        // This handles right-click on empty space (event bubbles up)
        setContextMenu(null);  // Close node/connection menu
        setEmptySpaceMenu({ x: e.clientX, y: e.clientY });
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

                        const worldX = (mouseX - pan.x) / oldScale;
                        const worldY = (mouseY - pan.y) / oldScale;

                        const newPanX = mouseX - worldX * newScale;
                        const newPanY = mouseY - worldY * newScale;

                        setPan({ x: newPanX, y: newPanY });
                    }

                    setScale(newScale);
                }}
                onContextMenu={handleCanvasContextMenu}
            >
                {magneticGridMode ? <MagneticGrid /> : <Grid />}
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
                    {(() => {
                        if (selectedPort && useEditorStore.getState().hoveredSidebarType) {
                            // Get mouse position from ConnectionLayer via store state or calculate
                            // For now, we'll skip the ghost node preview in click mode
                            // as it requires mouse tracking which is now in ConnectionLayer
                            return null;
                        }
                        return null;
                    })()}

                    {visibleNodes.map(node => (
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
                            label: 'Copy',
                            action: () => {
                                if (contextMenu.type === 'node') {
                                    const store = useEditorStore.getState();
                                    // If node is not in selection, select it first
                                    if (!selectedNodeIds.includes(contextMenu.id)) {
                                        store.selectNode(contextMenu.id, false);
                                    }
                                    store.copySelectedNodes();
                                }
                            }
                        },
                        {
                            label: selectedNodeIds.length > 1
                                ? `Duplicate ${selectedNodeIds.length} Nodes`
                                : 'Duplicate',
                            action: () => {
                                if (contextMenu.type === 'node') {
                                    const store = useEditorStore.getState();
                                    // If node is not in selection, select it first
                                    if (!selectedNodeIds.includes(contextMenu.id)) {
                                        store.selectNode(contextMenu.id, false);
                                    }
                                    store.duplicateSelectedNodes();
                                }
                            }
                        },
                        {
                            label: 'Paste',
                            action: () => {
                                const store = useEditorStore.getState();
                                const rect = containerRef.current?.getBoundingClientRect();
                                if (rect) {
                                    const worldX = (contextMenu.x - rect.left - pan.x) / scale;
                                    const worldY = (contextMenu.y - rect.top - pan.y) / scale;
                                    store.pasteNodes({ x: worldX, y: worldY });
                                }
                            },
                        },
                        {
                            label: contextMenu.type === 'node'
                                ? (selectedNodeIds.length > 1 ? `Delete ${selectedNodeIds.length} Nodes` : 'Delete Node')
                                : 'Delete Connection',
                            danger: true,
                            action: () => {
                                if (contextMenu.type === 'node') {
                                    // If multiple nodes are selected, delete all of them
                                    if (selectedNodeIds.length > 1) {
                                        removeSelectedNodes();
                                    } else {
                                        removeNode(contextMenu.id);
                                    }
                                } else {
                                    removeConnection(contextMenu.id);
                                }
                            }
                        }
                    ]}
                />
            )}

            {emptySpaceMenu && (
                <ContextMenu
                    x={emptySpaceMenu.x}
                    y={emptySpaceMenu.y}
                    onClose={() => setEmptySpaceMenu(null)}
                    items={[
                        {
                            label: clipboard ? `Paste (${clipboard.nodes.length} nodes)` : 'Paste (clipboard empty)',
                            action: () => {
                                if (clipboard) {
                                    const store = useEditorStore.getState();
                                    const rect = containerRef.current?.getBoundingClientRect();
                                    if (rect) {
                                        const worldX = (emptySpaceMenu.x - rect.left - pan.x) / scale;
                                        const worldY = (emptySpaceMenu.y - rect.top - pan.y) / scale;
                                        store.pasteNodes({ x: worldX, y: worldY });
                                    }
                                }
                            },
                        },
                        {
                            label: 'Select All',
                            action: () => {
                                const store = useEditorStore.getState();
                                store.deselectAll();
                                store.nodes.forEach(node => {
                                    store.selectNode(node.id, true);
                                });
                            }
                        },
                        {
                            label: 'Deselect All',
                            action: () => {
                                useEditorStore.getState().deselectAll();
                            }
                        }
                    ]}
                />
            )}
        </>
    );
};
