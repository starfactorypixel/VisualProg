import React, { useState, useRef } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { NodeGroupsPanel } from './NodeGroupsPanel';
import clsx from 'clsx';

type SidebarTab = 'commands' | 'groups' | 'data';

export const Sidebar: React.FC = () => {
    const { nodeDefinitions, dataTypes, linking } = useEditorStore();
    const [activeTab, setActiveTab] = useState<SidebarTab>('commands');
    const [cmdFilter, setCmdFilter] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    const handleDragStart = (e: React.DragEvent, type: 'command' | 'data', id: string) => {
        e.dataTransfer.setData('application/reactflow/type', type);
        e.dataTransfer.setData('application/reactflow/id', id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const tabs: { id: SidebarTab; label: string; title: string }[] = [
        { id: 'commands', label: 'CMD',   title: 'Commands' },
        { id: 'groups',   label: 'GRP',   title: 'Groups' },
        { id: 'data',     label: 'DATA',  title: 'Data Types' },
    ];

    return (
        <div className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col flex-shrink-0 select-none">

            {/* Tab Bar */}
            <div className="flex border-b border-neutral-800 shrink-0">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        title={tab.title}
                        onClick={() => setActiveTab(tab.id)}
                        className={clsx(
                            "flex-1 py-2.5 text-[11px] font-semibold tracking-wider uppercase transition-colors",
                            activeTab === tab.id
                                ? "text-neutral-100 border-b-2 border-blue-500 bg-neutral-800"
                                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab: Commands */}
            {activeTab === 'commands' && (
                <>
                    {/* Search bar */}
                    <div className="p-2 border-b border-neutral-800 shrink-0">
                        <div className="relative">
                            <svg
                                className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 pointer-events-none"
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                            </svg>
                            <input
                                ref={searchRef}
                                type="text"
                                placeholder="Фильтр команд..."
                                value={cmdFilter}
                                onChange={e => setCmdFilter(e.target.value)}
                                onMouseDown={e => e.stopPropagation()}
                                className="w-full bg-neutral-800 border border-neutral-700 rounded pl-7 pr-7 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
                            />
                            {cmdFilter && (
                                <button
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
                                    onClick={() => { setCmdFilter(''); searchRef.current?.focus(); }}
                                >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {(() => {
                            const query = cmdFilter.trim().toLowerCase();
                            const filtered = query
                                ? nodeDefinitions.filter(def =>
                                    def.name.toLowerCase().includes(query) ||
                                    def.id.toLowerCase().includes(query)
                                )
                                : nodeDefinitions;

                            if (filtered.length === 0) {
                                return (
                                    <div className="text-center py-8 text-neutral-600 text-xs italic">
                                        Ничего не найдено
                                    </div>
                                );
                            }

                            return filtered.map(def => {
                                // Highlight matching part in name
                                const renderName = (name: string) => {
                                    if (!query) return <span>{name}</span>;
                                    const idx = name.toLowerCase().indexOf(query);
                                    if (idx === -1) return <span>{name}</span>;
                                    return (
                                        <>
                                            {name.slice(0, idx)}
                                            <mark className="bg-blue-500/30 text-blue-300 rounded-sm">
                                                {name.slice(idx, idx + query.length)}
                                            </mark>
                                            {name.slice(idx + query.length)}
                                        </>
                                    );
                                };

                                return (
                                    <div
                                        key={def.id}
                                        className="px-3 py-2 bg-neutral-800 rounded border border-neutral-700 hover:border-blue-500 cursor-grab active:cursor-grabbing transition-colors"
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, 'command', def.id)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                                style={{ backgroundColor: def.visual?.color || '#555' }}
                                            />
                                            <span className="font-medium text-xs text-neutral-200 truncate">
                                                {renderName(def.name)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </>
            )}

            {/* Tab: Groups */}
            {activeTab === 'groups' && (
                <>
                    <div className="p-3 border-b border-neutral-800 shrink-0">
                        <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                            Node Groups
                        </h2>
                        <p className="text-[10px] text-neutral-600 mt-0.5">
                            Пошаговый выбор нод по параметрам
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <NodeGroupsPanel />
                    </div>
                </>
            )}

            {/* Tab: Data Types */}
            {activeTab === 'data' && (
                <>
                    <div className="p-3 border-b border-neutral-800 shrink-0">
                        <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                            Data Types
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {dataTypes.map(dt => {
                            const isMatching = (() => {
                                if (!linking) return false;
                                const fromType = linking.fromPortTypeStr.toLowerCase();
                                const getBaseType = (t: string) => t.startsWith('ref:') ? t.slice(4) : t;
                                const btFrom = getBaseType(fromType);
                                const btTarget = getBaseType(dt.name.toLowerCase());
                                return btFrom === btTarget || fromType === 'any' || dt.name.toLowerCase() === 'any';
                            })();

                            return (
                                <div
                                    key={dt.name}
                                    className={clsx(
                                        "px-3 py-2 bg-neutral-800 rounded border transition-all cursor-grab active:cursor-grabbing",
                                        isMatching
                                            ? "border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)] ring-1 ring-green-500"
                                            : "border-neutral-700 hover:border-green-500"
                                    )}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, 'data', dt.name)}
                                    onPointerEnter={() => useEditorStore.getState().setHoveredSidebarType(dt.name)}
                                    onPointerLeave={() => useEditorStore.getState().setHoveredSidebarType(null)}
                                    onPointerUp={() => {
                                        const store = useEditorStore.getState();
                                        if (store.linking) {
                                            const { pan, scale } = store;
                                            const rect = document.getElementById('canvas-container')?.getBoundingClientRect();
                                            const cx = rect ? (rect.width / 2 - pan.x) / scale : 0;
                                            const cy = rect ? (rect.height / 2 - pan.y) / scale : 0;
                                            store.spawnNodeAndConnect(dt.name, 'data', { x: cx, y: cy });
                                        }
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: dt.color }}
                                        />
                                        <span className="font-medium text-xs text-neutral-200 capitalize">
                                            {dt.name}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};