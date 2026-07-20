import React, { useState, useRef, useCallback } from 'react';
import clsx from 'clsx';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FunctionEntry {
    id: string;
    file: string;
    name: string;
    description: string;
}

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'fn_registry_v1';

const loadRegistry = (): FunctionEntry[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    // fallback — try to import static config
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const cfg = require('../../config/functions_registry.json');
        return cfg.functions || [];
    } catch {}
    return [];
};

const saveRegistry = (entries: FunctionEntry[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {}
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const IconFile = () => (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0121 9.414V19a2 2 0 01-2 2z" />
    </svg>
);

const IconEdit = () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
);

const IconTrash = () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

const IconPlus = () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
);

const IconCheck = () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

const IconX = () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

export const FunctionsPanel: React.FC = () => {
    const [entries, setEntries] = useState<FunctionEntry[]>(loadRegistry);
    const [filter, setFilter] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<Partial<FunctionEntry>>({});
    const [isAdding, setIsAdding] = useState(false);
    const [newDraft, setNewDraft] = useState<Partial<FunctionEntry>>({});
    const searchRef = useRef<HTMLInputElement>(null);

    const persist = useCallback((next: FunctionEntry[]) => {
        setEntries(next);
        saveRegistry(next);
    }, []);

    // ── Filtering ────────────────────────────────────────────────────────────

    const query = filter.trim().toLowerCase();
    const filtered = query
        ? entries.filter(e =>
            e.name.toLowerCase().includes(query) ||
            e.file.toLowerCase().includes(query) ||
            e.description.toLowerCase().includes(query)
        )
        : entries;

    // ── Highlight helper ─────────────────────────────────────────────────────

    const highlight = (text: string) => {
        if (!query) return <span>{text}</span>;
        const idx = text.toLowerCase().indexOf(query);
        if (idx === -1) return <span>{text}</span>;
        return (
            <>
                {text.slice(0, idx)}
                <mark className="bg-purple-500/30 text-purple-300 rounded-sm">
                    {text.slice(idx, idx + query.length)}
                </mark>
                {text.slice(idx + query.length)}
            </>
        );
    };

    // ── Drag ─────────────────────────────────────────────────────────────────

    const handleDragStart = (e: React.DragEvent, entry: FunctionEntry) => {
        // Drag as cmd_function with file pre-filled via custom data
        e.dataTransfer.setData('application/reactflow/type', 'command');
        e.dataTransfer.setData('application/reactflow/id', 'cmd_function');
        e.dataTransfer.setData('application/reactflow/fnfile', entry.file);
        e.dataTransfer.setData('application/reactflow/fnname', entry.name);
        e.dataTransfer.effectAllowed = 'move';
    };

    // ── Edit ─────────────────────────────────────────────────────────────────

    const startEdit = (entry: FunctionEntry) => {
        setEditingId(entry.id);
        setEditDraft({ name: entry.name, description: entry.description, file: entry.file });
        setIsAdding(false);
    };

    const commitEdit = () => {
        if (!editingId) return;
        persist(entries.map(e =>
            e.id === editingId
                ? { ...e, ...editDraft } as FunctionEntry
                : e
        ));
        setEditingId(null);
        setEditDraft({});
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft({});
    };

    // ── Add ──────────────────────────────────────────────────────────────────

    const startAdd = () => {
        setIsAdding(true);
        setNewDraft({ file: '', name: '', description: '' });
        setEditingId(null);
    };

    const commitAdd = () => {
        if (!newDraft.file?.trim()) return;
        const entry: FunctionEntry = {
            id: `fn_${Date.now()}`,
            file: newDraft.file!.trim(),
            name: newDraft.name?.trim() || newDraft.file!.trim(),
            description: newDraft.description?.trim() || '',
        };
        persist([...entries, entry]);
        setIsAdding(false);
        setNewDraft({});
    };

    const cancelAdd = () => {
        setIsAdding(false);
        setNewDraft({});
    };

    // ── Delete ───────────────────────────────────────────────────────────────

    const handleDelete = (id: string) => {
        persist(entries.filter(e => e.id !== id));
        if (editingId === id) cancelEdit();
    };

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full">

            {/* Search bar */}
            <div className="p-2 border-b border-neutral-800 shrink-0">
                <div className="relative">
                    <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 pointer-events-none"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                    </svg>
                    <input
                        ref={searchRef}
                        type="text"
                        placeholder="Поиск функций..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded pl-7 pr-7 py-1.5 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                    {filter && (
                        <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                            onClick={() => { setFilter(''); searchRef.current?.focus(); }}
                        >
                            <IconX />
                        </button>
                    )}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">

                {filtered.length === 0 && !isAdding && (
                    <div className="text-center py-8 text-neutral-600 text-xs italic">
                        {query ? 'Ничего не найдено' : 'Нет функций — добавьте первую'}
                    </div>
                )}

                {filtered.map(entry => {
                    const isEditing = editingId === entry.id;

                    return (
                        <div
                            key={entry.id}
                            className={clsx(
                                "rounded border transition-all",
                                isEditing
                                    ? "border-purple-500/60 bg-neutral-800"
                                    : "border-neutral-700 bg-neutral-800 hover:border-purple-500/50 cursor-grab active:cursor-grabbing"
                            )}
                            draggable={!isEditing}
                            onDragStart={!isEditing ? (e) => handleDragStart(e, entry) : undefined}
                        >
                            {isEditing ? (
                                /* ── Edit form ── */
                                <div className="p-2 space-y-1.5" onMouseDown={e => e.stopPropagation()}>
                                    <div>
                                        <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Название</label>
                                        <input
                                            autoFocus
                                            className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
                                            value={editDraft.name || ''}
                                            onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                                            onMouseDown={e => e.stopPropagation()}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Файл</label>
                                        <input
                                            className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-400 font-mono focus:outline-none focus:border-purple-500"
                                            value={editDraft.file || ''}
                                            onChange={e => setEditDraft(d => ({ ...d, file: e.target.value }))}
                                            onMouseDown={e => e.stopPropagation()}
                                            placeholder="path/to/function.json"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Описание</label>
                                        <textarea
                                            className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-purple-500 resize-none"
                                            rows={2}
                                            value={editDraft.description || ''}
                                            onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                                            onMouseDown={e => e.stopPropagation()}
                                            placeholder="Описание функции..."
                                        />
                                    </div>
                                    <div className="flex gap-1 pt-0.5">
                                        <button
                                            className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] transition-colors"
                                            onClick={commitEdit}
                                        >
                                            <IconCheck /> Сохранить
                                        </button>
                                        <button
                                            className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-[11px] transition-colors"
                                            onClick={cancelEdit}
                                        >
                                            <IconX /> Отмена
                                        </button>
                                        <button
                                            className="flex items-center gap-1 ml-auto px-2 py-1 rounded bg-neutral-900 hover:bg-red-900/40 text-neutral-500 hover:text-red-400 text-[11px] transition-colors"
                                            onClick={() => handleDelete(entry.id)}
                                        >
                                            <IconTrash />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* ── Display row ── */
                                <div className="px-2.5 py-2 flex items-start gap-2">
                                    <div className="mt-0.5 text-purple-400">
                                        <IconFile />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-neutral-200 truncate">
                                            {highlight(entry.name)}
                                        </div>
                                        {entry.description && (
                                            <div className="text-[10px] text-neutral-500 mt-0.5 leading-tight line-clamp-2">
                                                {highlight(entry.description)}
                                            </div>
                                        )}
                                        <div className="text-[9px] text-neutral-600 mt-1 font-mono truncate">
                                            {highlight(entry.file)}
                                        </div>
                                    </div>
                                    <button
                                        className="shrink-0 mt-0.5 text-neutral-600 hover:text-purple-400 transition-colors p-0.5 rounded"
                                        title="Редактировать"
                                        onClick={e => { e.stopPropagation(); startEdit(entry); }}
                                        onMouseDown={e => e.stopPropagation()}
                                    >
                                        <IconEdit />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Add new form */}
                {isAdding && (
                    <div className="rounded border border-purple-500/60 bg-neutral-800 p-2 space-y-1.5">
                        <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">
                            Новая функция
                        </p>
                        <div>
                            <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Файл *</label>
                            <input
                                autoFocus
                                className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-400 font-mono focus:outline-none focus:border-purple-500"
                                value={newDraft.file || ''}
                                onChange={e => setNewDraft(d => ({ ...d, file: e.target.value }))}
                                onMouseDown={e => e.stopPropagation()}
                                placeholder="functions/my_func.json"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Название</label>
                            <input
                                className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
                                value={newDraft.name || ''}
                                onChange={e => setNewDraft(d => ({ ...d, name: e.target.value }))}
                                onMouseDown={e => e.stopPropagation()}
                                placeholder="Название функции"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Описание</label>
                            <textarea
                                className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-purple-500 resize-none"
                                rows={2}
                                value={newDraft.description || ''}
                                onChange={e => setNewDraft(d => ({ ...d, description: e.target.value }))}
                                onMouseDown={e => e.stopPropagation()}
                                placeholder="Описание..."
                            />
                        </div>
                        <div className="flex gap-1 pt-0.5">
                            <button
                                className={clsx(
                                    "flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors",
                                    newDraft.file?.trim()
                                        ? "bg-purple-600 hover:bg-purple-500 text-white"
                                        : "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                                )}
                                onClick={commitAdd}
                                disabled={!newDraft.file?.trim()}
                            >
                                <IconCheck /> Добавить
                            </button>
                            <button
                                className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-[11px] transition-colors"
                                onClick={cancelAdd}
                            >
                                <IconX /> Отмена
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer: Add button + count */}
            <div className="shrink-0 border-t border-neutral-800 px-2 py-2 flex items-center justify-between">
                <span className="text-[10px] text-neutral-600">
                    {entries.length} функц{entries.length === 1 ? 'ия' : entries.length < 5 ? 'ии' : 'ий'}
                </span>
                <button
                    className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-300 text-[11px] transition-all"
                    onClick={startAdd}
                    disabled={isAdding}
                >
                    <IconPlus /> Добавить
                </button>
            </div>
        </div>
    );
};