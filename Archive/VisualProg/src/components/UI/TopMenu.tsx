import React, { useState, useRef } from 'react';
import menuConfig from '../../config/menu.json';
import { useEditorStore } from '../../store/useEditorStore';
import { CodeGenerator } from '../../utils/CodeGenerator';

// Simple Menu Implementation
export const TopMenu: React.FC = () => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const { nodes, connections, setData, snapToGrid } = useEditorStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadType, setUploadType] = useState<'project' | 'template'>('project');

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
        else if (action === 'export:template') {
            setUploadType('template');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'view:toggle_snap') {
            useEditorStore.getState().toggleSnapToGrid();
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
                        { label: 'Export with Template...', action: 'export:template' }
                    ]
                };
            }
            if (item.label === 'View') {
                return {
                    ...item,
                    children: [
                        ...(item.children || []),
                        { label: '---', action: 'none' },
                        { label: 'Snap to Grid', action: 'view:toggle_snap', checked: snapToGrid }
                    ]
                };
            }
            return item;
        })
    };
    // ... rest of file logic, replacing menuConfig.items with mergedMenu.items in render


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
                    // Export Template Logic
                    if (data.boilerplate && data.nodes) {
                        const generator = new CodeGenerator(nodes, connections, data);
                        const code = await generator.generate();

                        const blob = new Blob([code], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `program.${data.extension || 'txt'}`;
                        a.click();
                        URL.revokeObjectURL(url);
                    } else {
                        alert('Invalid export template format');
                    }
                }

            } catch (err) {
                alert('Failed to parse file: ' + (err as any).message);
                console.error(err);
            }
        };
        reader.readAsText(file);
        // Reset input
        e.target.value = '';
    };

    return (
        <div className="h-8 bg-neutral-900 border-b border-neutral-800 flex items-center px-2 select-none z-50">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".json"
                onChange={handleFileLoad}
            />
            {mergedMenu.items.map(item => (
                <div
                    key={item.label}
                    className="relative px-3 py-1 hover:bg-neutral-800 cursor-pointer text-sm text-neutral-300"
                    onMouseEnter={() => activeMenu && setActiveMenu(item.label)}
                    onClick={() => setActiveMenu(activeMenu === item.label ? null : item.label)}
                >
                    {item.label}

                    {activeMenu === item.label && (
                        <div className="absolute top-full left-0 w-48 bg-neutral-800 border border-neutral-700 shadow-xl py-1 z-50">
                            {item.children?.map((child, idx) => (
                                <div
                                    key={child.label + idx}
                                    className="px-4 py-2 hover:bg-neutral-700 text-neutral-200 cursor-pointer flex justify-between"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        console.log('Clicked child:', child);
                                        // Cast to any to bypass TS error for now if structure is dynamic
                                        const action = (child as any).action;
                                        if (action && action !== 'none') handleAction(action);
                                        setActiveMenu(null);
                                    }}
                                >
                                    <span>{child.label}</span>
                                    {(child as any).checked && <span className="text-blue-400">✓</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Invisible Overlay to close menu */}
            {activeMenu && (
                <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setActiveMenu(null)}
                />
            )}
        </div>
    );
};
