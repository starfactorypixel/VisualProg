import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import clsx from 'clsx';

export const Sidebar: React.FC = () => {
    const { nodeDefinitions, dataTypes, selectedPort } = useEditorStore();

    const handleDragStart = (e: React.DragEvent, type: 'command' | 'data', id: string) => {
        e.dataTransfer.setData('application/reactflow/type', type);
        e.dataTransfer.setData('application/reactflow/id', id);
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col flex-shrink-0 select-none">
            {/* Commands Section */}
            <div className="p-4 border-b border-neutral-800">
                <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Commands</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[50%] border-b border-neutral-800">
                {nodeDefinitions.map(def => (
                    <div
                        key={def.id}
                        className="p-3 bg-neutral-800 rounded border border-neutral-700 hover:border-blue-500 cursor-grab active:cursor-grabbing transition-colors"
                        draggable
                        onDragStart={(e) => handleDragStart(e, 'command', def.id)}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: def.visual?.color || '#555' }} />
                            <span className="font-medium text-sm text-neutral-200">{def.name}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Data Types Section */}
            <div className="p-4 border-b border-neutral-800 bg-neutral-900">
                <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Data Types</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {dataTypes.map(dt => {
                    const isMatching = (() => {
                        if (!selectedPort) return false;
                        const fromType = selectedPort.fromPortTypeStr.toLowerCase();
                        const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
                        const btFrom = getBaseType(fromType);
                        const btTarget = getBaseType(dt.name.toLowerCase());
                        return btFrom === btTarget || fromType === 'any' || dt.name.toLowerCase() === 'any';
                    })();

                    return (
                        <div
                            key={dt.name}
                            className={clsx(
                                "p-3 bg-neutral-800 rounded border transition-all cursor-grab active:cursor-grabbing",
                                isMatching ? "border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)] ring-1 ring-green-500" : "border-neutral-700 hover:border-green-500"
                            )}
                            draggable
                            onDragStart={(e) => handleDragStart(e, 'data', dt.name)}
                            onPointerEnter={() => useEditorStore.getState().setHoveredSidebarType(dt.name)}
                            onPointerLeave={() => useEditorStore.getState().setHoveredSidebarType(null)}
                            onPointerUp={() => {
                                const store = useEditorStore.getState();
                                if (store.selectedPort) {
                                    // For click-based, we need port info - skip sidebar spawn for now
                                    store.cancelLinking();
                                }
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: dt.color }} />
                                <span className="font-medium text-sm text-neutral-200 capitalize">{dt.name}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
