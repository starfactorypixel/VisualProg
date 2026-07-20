import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import clsx from 'clsx';

export const VariablesBar: React.FC = () => {
    const { nodes, dataTypes, updateNodeData, linking } = useEditorStore();

    const dataNodes = nodes.filter(n => n.type === 'data');

    if (dataNodes.length === 0) return null;

    const groupedNodes = dataNodes.reduce((acc, node) => {
        const group = node.data?.group || 'Global';
        if (!acc[group]) acc[group] = [];
        acc[group].push(node);
        return acc;
    }, {} as Record<string, typeof dataNodes>);

    const handleDragStart = (e: React.DragEvent, nodeId: string) => {
        e.dataTransfer.setData('app/nodeId', nodeId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDrop = (e: React.DragEvent, targetGroup: string) => {
        e.preventDefault();
        const nodeId = e.dataTransfer.getData('app/nodeId');
        if (nodeId) {
            updateNodeData(nodeId, { group: targetGroup });
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    return (
        <div className="h-16 bg-[#252526] border-b border-neutral-700 flex items-start px-4 gap-4 overflow-x-auto text-xs shadow-sm z-40 py-1">

            {Object.entries(groupedNodes).map(([group, nodes]) => (
                <div
                    key={group}
                    className="flex flex-col gap-1 border-r border-neutral-800 pr-4 last:border-0 h-full min-w-[60px]"
                    onDrop={(e) => handleDrop(e, group)}
                    onDragOver={handleDragOver}
                >
                    <div
                        className="text-neutral-500 font-bold text-[10px] uppercase tracking-wider px-1 cursor-text"
                        title="Group Name"
                    >
                        {group}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {nodes.map(node => {
                            const typeDef = dataTypes.find(t => t.name === node.definitionId);
                            const displayName = node.data?.label || typeDef?.name || node.definitionId;

                            const isLinkingMatch = (() => {
                                if (!linking || linking.fromNodeId === node.id) return false;
                                const fromType = linking.fromPortTypeStr.toLowerCase();
                                const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
                                const btFrom = getBaseType(fromType);
                                const btTarget = getBaseType(node.definitionId.toLowerCase());
                                return btFrom === btTarget || fromType === 'any' || node.definitionId.toLowerCase() === 'any';
                            })();

                            return (
                                <div
                                    key={node.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, node.id)}
                                    onPointerEnter={() => useEditorStore.getState().setHoveredNodeId(node.id)}
                                    onPointerLeave={() => useEditorStore.getState().setHoveredNodeId(null)}
                                    className={clsx(
                                        "bg-neutral-700 hover:bg-neutral-600 transition-all px-2 py-0.5 rounded text-neutral-200 border flex items-center gap-1 cursor-grab active:cursor-grabbing select-none",
                                        isLinkingMatch ? "border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] ring-1 ring-green-500" : "border-neutral-600"
                                    )}
                                    style={{ borderLeftColor: typeDef?.color || '#555', borderLeftWidth: 2 }}
                                    title={`Type: ${typeDef?.name}\nDouble click to rename node on canvas\nDrop wire here to connect`}
                                >
                                    <span className="font-medium truncate max-w-[80px]">{displayName}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Area to create new group by dropping */}
            <div
                className="h-full border-l border-neutral-800 pl-4 flex items-center justify-center min-w-[100px] border-dashed border-2 border-neutral-700 rounded opacity-50 hover:opacity-100 transition-opacity text-neutral-500"
                onDrop={(e) => {
                    e.preventDefault();
                    const nodeId = e.dataTransfer.getData('app/nodeId');
                    const sidebarTypeId = e.dataTransfer.getData('application/reactflow/id');
                    const sidebarType = e.dataTransfer.getData('application/reactflow/type');

                    if (nodeId) {
                        const group = prompt('New Group Name:', 'New Group');
                        if (group) {
                            updateNodeData(nodeId, { group });

                            // Spawn Selector Node nearby
                            const store = useEditorStore.getState();
                            const node = store.nodes.find(n => n.id === nodeId);
                            if (node && node.type === 'data') {
                                store.addNode({
                                    id: crypto.randomUUID(),
                                    definitionId: node.definitionId,
                                    type: 'data',
                                    position: { x: node.position.x + 200, y: node.position.y },
                                    data: { group, label: group, isGroupSelector: true }
                                });
                            }
                        }
                    } else if (sidebarTypeId && sidebarType === 'data') {
                        const group = prompt('New Group Name:', sidebarTypeId.toUpperCase());
                        if (group) {
                            const store = useEditorStore.getState();
                            const { pan, scale } = store;
                            const rect = document.getElementById('canvas-container')?.getBoundingClientRect();
                            const cx = rect ? (rect.width / 2 - pan.x) / scale : 100;
                            const cy = rect ? (rect.height / 2 - pan.y) / scale : 100;

                            // 1. Create the base node
                            const baseNodeId = crypto.randomUUID();
                            store.addNode({
                                id: baseNodeId,
                                definitionId: sidebarTypeId,
                                type: 'data',
                                position: { x: cx, y: cy },
                                data: { group, value: '' }
                            });

                            // 2. Create the Selector node nearby
                            store.addNode({
                                id: crypto.randomUUID(),
                                definitionId: sidebarTypeId,
                                type: 'data',
                                position: { x: cx + 200, y: cy },
                                data: { group, label: group, isGroupSelector: true }
                            });
                        }
                    }
                }}
                onDragOver={handleDragOver}
            >
                <span className="text-[10px] text-center pointer-events-none">Drop here<br />for new group</span>
            </div>
        </div>
    );
};
