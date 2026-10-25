import React, { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { findAddressBridgeCommands } from '../../utils/TemplateSchema';

// Показывается вместо прямого соединения, когда второй exec-провод пытается
// войти в уже занятый вход, а источник не умеет сам указать адрес (см.
// completeLinking/pendingBridge в useEditorStore.ts). Список — это команды
// шаблона с собственным адресным выходом (Goto и т.п.), отобранные по
// структуре (findAddressBridgeCommands), а не по жёстко заданному имени.
export const BridgePicker: React.FC = () => {
    const { pendingBridge, activeTemplate, nodeDefinitions, resolveBridge, cancelBridge } = useEditorStore();
    const [filter, setFilter] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (pendingBridge) {
            setFilter('');
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [pendingBridge]);

    useEffect(() => {
        if (!pendingBridge) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) cancelBridge();
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancelBridge();
        };
        window.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [pendingBridge, cancelBridge]);

    if (!pendingBridge) return null;

    const candidates = findAddressBridgeCommands(activeTemplate)
        .map(({ commandId }) => ({ commandId, name: nodeDefinitions.find(d => d.id === commandId)?.name ?? commandId }))
        .filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div
            ref={ref}
            className="fixed z-50 bg-neutral-800 border border-neutral-700 shadow-xl rounded py-1 min-w-[180px]"
            style={{ left: pendingBridge.screenPosition.x, top: pendingBridge.screenPosition.y }}
        >
            <div className="px-2 pb-1 pt-1 border-b border-neutral-700">
                <input
                    ref={inputRef}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && candidates.length > 0) resolveBridge(candidates[0].commandId);
                    }}
                    placeholder="Вход занят — найти переход..."
                    className="w-full bg-neutral-900 text-neutral-200 text-sm px-2 py-1 rounded outline-none"
                />
            </div>
            {candidates.length === 0 && (
                <div className="px-3 py-2 text-sm text-neutral-500">Ничего не найдено</div>
            )}
            {candidates.map(c => (
                <div
                    key={c.commandId}
                    className="px-3 py-2 text-sm cursor-pointer text-neutral-200 hover:bg-neutral-700"
                    onClick={() => resolveBridge(c.commandId)}
                >
                    {c.name}
                </div>
            ))}
        </div>
    );
};
