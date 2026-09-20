import React, { useState, useRef } from 'react';
import menuConfig from '../../config/menu.json';
import { useEditorStore } from '../../store/useEditorStore';
import { CodeGenerator } from '../../utils/CodeGenerator';

export const TopMenu: React.FC = () => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const { nodes, connections, setData, loadTemplate, magneticGridMode, toggleMagneticGrid: _toggleMagneticGrid, undo, redo, canUndo, canRedo } = useEditorStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadType, setUploadType] = useState<'project' | 'template'>('project');

    const handleExport = async () => {
        const template = useEditorStore.getState().activeTemplate;
        if (!template) {
            alert('Сначала загрузите шаблон языка: File → Load Template...');
            return;
        }
        const generator = new CodeGenerator(nodes, connections, template);
        const code = await generator.generate();

        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `program.${template.extension || 'txt'}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleAction = (action: string) => {
        console.log('handleAction called with:', action);
        if (!action) return;

        if (action === 'file:new') {
            if (confirm('Are you sure you want to create a new project? Unsaved changes will be lost.')) {
                setData({ nodes: [], connections: [] });
            }
        }
        else if (action === 'file:save') {
            const data = {
                nodes: useEditorStore.getState().nodes,
                connections: useEditorStore.getState().connections
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'project.json';
            a.click();
            URL.revokeObjectURL(url);
        }
        else if (action === 'file:open') {
            setUploadType('project');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'file:load_template') {
            setUploadType('template');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'file:export') {
            handleExport();
        }
        else if (action === 'view:toggle_magnetic_grid') {
            const store = useEditorStore.getState();
            if ((store as any).toggleMagneticGrid) {
                (store as any).toggleMagneticGrid();
            }
        }
    };

    const mergedMenu = {
        items: menuConfig.items.map(item => {
            if (item.label === 'File') {
                return {
                    ...item,
                    children: [
                        ...(item.children || []),
                        { label: '---', action: 'none' },
                        { label: 'Load Template...', action: 'file:load_template' },
                        { label: 'Export', action: 'file:export' }
                    ]
                };
            }
            if (item.label === 'View') {
                return {
                    ...item,
                    children: [
                        ...(item.children || []),
                        { label: '---', action: 'none' },
                        { label: 'Magnetic Grid Mode', action: 'view:toggle_magnetic_grid', checked: magneticGridMode }
                    ]
                };
            }
            return item;
        })
    };

    const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const content = ev.target?.result as string;
                const data = JSON.parse(content);

                if (uploadType === 'project') {
                    if (data.nodes && data.connections) {
                        setData(data);
                    } else {
                        alert('Invalid project file format');
                    }
                } else if (uploadType === 'template') {
                    if (data.boilerplate && (data.commands || data.nodes)) {
                        loadTemplate(data);
                    } else {
                        alert('Invalid template format');
                    }
                }

            } catch (err) {
                alert('Failed to parse file: ' + (err as any).message);
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="h-8 bg-neutral-900 border-b border-neutral-800 flex items-center select-none z-50">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".json"
                onChange={handleFileLoad}
            />
            
            <div className="flex items-center px-2">
                {mergedMenu.items.map(item => (
                    <div
                        key={item.label}
                        className="relative px-3 py-1 hover:bg-neutral-800 cursor-pointer text-sm text-neutral-300"
                        onMouseEnter={() => activeMenu && setActiveMenu(item.label)}
                        onClick={() => setActiveMenu(activeMenu === item.label ? null : item.label)}
                    >
                        {item.label}

                        {activeMenu === item.label && (
                            <div className="absolute top-full left-0 w-56 bg-neutral-800 border border-neutral-700 shadow-xl py-1 z-50">
                                {item.children?.map((child, idx) => {
                                    if (child.label === '---') {
                                        return <div key={idx} className="h-px bg-neutral-700 my-1" />;
                                    }
                                    return (
                                        <div
                                            key={child.label + idx}
                                            className="px-4 py-2 hover:bg-neutral-700 text-neutral-200 cursor-pointer flex justify-between items-center"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const action = (child as any).action;
                                                if (action && action !== 'none') handleAction(action);
                                                setActiveMenu(null);
                                            }}
                                        >
                                            <span>{child.label}</span>
                                            {(child as any).checked && <span className="text-blue-400">✓</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex-1" />
            <div className="flex items-center gap-2 px-4">
                {/* Undo/Redo buttons */}
                <div className="flex items-center gap-1 mr-4">
                    <button
                        onClick={undo}
                        disabled={!canUndo()}
                        className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-all ${
                            canUndo()
                                ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                                : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                        }`}
                        title="Undo (Ctrl+Z)"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7v6h6"/>
                            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                        </svg>
                        <span>Undo</span>
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo()}
                        className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-all ${
                            canRedo()
                                ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                                : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                        }`}
                        title="Redo (Ctrl+Y)"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 7v6h-6"/>
                            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/>
                        </svg>
                        <span>Redo</span>
                    </button>
                </div>

                <button
                    onClick={() => {
                        const store = useEditorStore.getState();
                        if ((store as any).toggleMagneticGrid) {
                            (store as any).toggleMagneticGrid();
                        }
                    }}
                    className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-medium transition-all ${
                        magneticGridMode
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                            : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                    }`}
                    title="Toggle Magnetic Grid Layout Mode"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <span>Magnetic Grid</span>
                    {magneticGridMode && <span className="text-xs opacity-75">ON</span>}
                </button>
            </div>

            {activeMenu && (
                <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setActiveMenu(null)}
                />
            )}
        </div>
    );
};
