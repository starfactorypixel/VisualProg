import React, { useState, useRef, useCallback, useEffect } from 'react';
import clsx from 'clsx';
import defaultRegistry from '../../config/functions_registry.json';
import { useEditorStore } from '../../store/useEditorStore';
import {
    isFileSystemAccessSupported, pickExistingJsonFile, createNewJsonFile,
    queryHandlePermission, requestHandlePermission, readJsonFromHandle, writeJsonToHandle,
    saveHandle, loadHandle, resolveRelativePath, getOrCreateFileInDirectory,
} from '../../utils/fileSystemAccess';
import { slugifyPinName, applyPinEdits } from '../../utils/functionSignature';
import { PinDef, PinDirection, FunctionFileData } from '../../types/function';
import { useProjectDirectory } from './useProjectDirectory';
import { FunctionConstructor, PIN_DIRECTIONS } from './FunctionConstructor';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FunctionEntry {
    id: string;
    file: string;
    name: string;
    description: string;
}

type EditablePin = { id?: string; name: string; dir: PinDirection; dataType: string };

type DiskStatus = 'unsupported' | 'disconnected' | 'needs-permission' | 'connected';

// ─── Storage ─────────────────────────────────────────────────────────────────
// localStorage — мгновенный локальный кэш (чтобы список не мигал пустым при
// загрузке и работал оффлайн). Настоящий файл на диске подключается через
// File System Access API (см. src/utils/fileSystemAccess.ts) — без бэкенда и
// без привязки к npm/dev-серверу: хендл выбранного файла хранится в
// IndexedDB и переживает перезапуски браузера. Плюс универсальный
// экспорт/импорт JSON-файла работает в любом браузере как запасной вариант.

const STORAGE_KEY = 'fn_registry_v1';
const HANDLE_KEY = 'functions_registry';

const loadLocalRegistry = (): FunctionEntry[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return (defaultRegistry as { functions: FunctionEntry[] }).functions || [];
};

const saveLocalRegistry = (entries: FunctionEntry[]) => {
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
    const [entries, setEntries] = useState<FunctionEntry[]>(loadLocalRegistry);
    const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
    const [diskStatus, setDiskStatus] = useState<DiskStatus>(isFileSystemAccessSupported() ? 'disconnected' : 'unsupported');
    const [filter, setFilter] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<Partial<FunctionEntry>>({});
    const [editPins, setEditPins] = useState<EditablePin[]>([]);
    const [editPinsLoading, setEditPinsLoading] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [newDraft, setNewDraft] = useState<Partial<FunctionEntry>>({});
    const [isConstructing, setIsConstructing] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const dataTypes = useEditorStore(s => s.dataTypes);
    const {
        dirHandle: projectDirHandle, status: projectDirStatus,
        connect: connectProjectDir, reconnect: reconnectProjectDir,
    } = useProjectDirectory();

    const loadFromHandle = async (handle: FileSystemFileHandle) => {
        const data = await readJsonFromHandle<{ functions: FunctionEntry[] }>(handle);
        if (data?.functions) {
            setEntries(data.functions);
            saveLocalRegistry(data.functions);
        }
    };

    // При монтировании пробуем восстановить ранее выбранный файл (хендл
    // лежит в IndexedDB) — без бэкенда и без привязки к npm/dev-серверу.
    // Браузер требует явный клик пользователя для повторной выдачи прав,
    // поэтому если разрешение не 'granted' — просим переподключиться.
    useEffect(() => {
        if (!isFileSystemAccessSupported()) return;
        (async () => {
            const handle = await loadHandle(HANDLE_KEY);
            if (!handle) return;
            setFileHandle(handle);
            const perm = await queryHandlePermission(handle);
            if (perm === 'granted') {
                setDiskStatus('connected');
                await loadFromHandle(handle);
            } else {
                setDiskStatus('needs-permission');
            }
        })();
    }, []);

    const persist = useCallback((next: FunctionEntry[]) => {
        setEntries(next);
        saveLocalRegistry(next);
        if (fileHandle && diskStatus === 'connected') {
            writeJsonToHandle(fileHandle, { functions: next }).then(ok => {
                if (!ok) setDiskStatus('needs-permission');
            });
        }
    }, [fileHandle, diskStatus]);

    // ── Подключение файла на диске (File System Access API) ────────────────────

    const connectExisting = async () => {
        const handle = await pickExistingJsonFile();
        if (!handle) return;
        await saveHandle(HANDLE_KEY, handle);
        setFileHandle(handle);
        setDiskStatus('connected');
        const data = await readJsonFromHandle<{ functions: FunctionEntry[] }>(handle);
        if (data?.functions) {
            setEntries(data.functions);
            saveLocalRegistry(data.functions);
        } else {
            await writeJsonToHandle(handle, { functions: entries });
        }
    };

    const connectNew = async () => {
        const handle = await createNewJsonFile('functions_registry.json');
        if (!handle) return;
        await saveHandle(HANDLE_KEY, handle);
        setFileHandle(handle);
        setDiskStatus('connected');
        await writeJsonToHandle(handle, { functions: entries });
    };

    const reconnect = async () => {
        if (!fileHandle) return;
        const perm = await requestHandlePermission(fileHandle);
        if (perm === 'granted') {
            setDiskStatus('connected');
            await loadFromHandle(fileHandle);
        }
    };

    // ── Экспорт/импорт JSON-файла — работает в любом браузере, без прав ────────

    const handleExport = () => {
        const blob = new Blob([JSON.stringify({ functions: entries }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'functions_registry.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string);
                if (!Array.isArray(data?.functions)) throw new Error('expected { functions: [] }');
                if (confirm(`Заменить текущий список (${entries.length}) импортированным (${data.functions.length})?`)) {
                    persist(data.functions);
                }
            } catch (err) {
                alert('Не удалось прочитать файл: ' + (err as Error).message);
            }
        };
        reader.readAsText(file);
    };

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
        setIsConstructing(false);
        setEditError(null);

        // Пины — не часть реестра, а часть самого файла функции, поэтому их
        // приходится отдельно подтягивать с диска при открытии формы.
        setEditPins([]);
        setEditPinsLoading(true);
        // no-store — иначе после более ранней правки пинов браузер может отдать
        // закэшированный (ещё пустой) ответ, форма покажет "пинов нет", а
        // commitEdit ниже воспримет это как намеренное удаление всех пинов.
        fetch(`/${entry.file}`, { cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                const pins: PinDef[] = data?.signature?.pins || [];
                setEditPins(pins.map(p => ({ id: p.id, name: p.name, dir: p.dir, dataType: p.dataType })));
            })
            .catch(() => {})
            .finally(() => setEditPinsLoading(false));
    };

    const addEditPin = () => {
        setEditPins(prev => [...prev, { name: `Pin${prev.length + 1}`, dir: 'in', dataType: dataTypes[0]?.name || '' }]);
    };
    const updateEditPin = (i: number, patch: Partial<EditablePin>) => {
        setEditPins(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
    };
    const removeEditPin = (i: number) => setEditPins(prev => prev.filter((_, idx) => idx !== i));

    const commitEdit = async () => {
        if (!editingId) return;
        setEditError(null);

        const currentEntry = entries.find(e => e.id === editingId);
        if (!currentEntry) return;

        const newFile = (editDraft.file || currentEntry.file).trim();
        if (!newFile) { setEditError('Укажите путь к файлу'); return; }

        const seenIds = new Set<string>();
        const pinDefs: PinDef[] = editPins.map((p, i) => {
            let id = p.id || slugifyPinName(p.name, i);
            while (seenIds.has(id)) id = `${id}_${i}`;
            seenIds.add(id);
            return { id, name: p.name.trim() || `Pin ${i + 1}`, dir: p.dir, dataType: p.dataType };
        });

        setIsSavingEdit(true);
        try {
            // Подтягиваем актуальное тело файла — трогать нужно только
            // пин-плейсхолдеры, а не то, что пользователь уже нарисовал внутри.
            // Если файл не читается — прерываем сохранение, а не тихо пишем
            // пустую заглушку поверх существующей логики функции.
            let fileData: FunctionFileData;
            try {
                const res = await fetch(`/${currentEntry.file}`, { cache: 'no-store' });
                if (!res.ok) { setEditError(`Не удалось прочитать ${currentEntry.file} перед сохранением — тело функции не тронуто`); return; }
                fileData = await res.json();
            } catch {
                setEditError(`Не удалось прочитать ${currentEntry.file} перед сохранением — тело функции не тронуто`);
                return;
            }

            const updatedFile = applyPinEdits(fileData, pinDefs);

            let dirHandle = projectDirHandle;
            if (projectDirStatus !== 'connected') {
                if (projectDirStatus === 'needs-permission') {
                    const ok = await reconnectProjectDir();
                    if (!ok) { setEditError('Нет доступа к папке проекта — нажмите «Сохранить» ещё раз, чтобы переподключить'); return; }
                } else {
                    dirHandle = await connectProjectDir();
                    if (!dirHandle) { setEditError('Нужно выбрать папку проекта, чтобы сохранить пины на диске'); return; }
                }
            }
            if (!dirHandle) { setEditError('Нет доступа к папке проекта'); return; }

            const fileHandle = await getOrCreateFileInDirectory(dirHandle, newFile);
            if (!fileHandle) { setEditError('Не удалось открыть файл по этому пути'); return; }

            const ok = await writeJsonToHandle(fileHandle, updatedFile);
            if (!ok) { setEditError('Не удалось записать файл'); return; }

            // Обновляем сигнатуру в сторе немедленно — иначе уже открытые ноды
            // вызова этой функции показывали бы старые порты до перезагрузки
            // страницы (store кэширует сигнатуру по пути файла, см. loadFunctionSignature).
            useEditorStore.getState().setFunctionSignature(newFile, updatedFile.signature ?? null);
            if (newFile !== currentEntry.file) {
                useEditorStore.getState().setFunctionSignature(currentEntry.file, null);
            }

            persist(entries.map(e =>
                e.id === editingId
                    ? { ...e, ...editDraft, file: newFile } as FunctionEntry
                    : e
            ));
            setEditingId(null);
            setEditDraft({});
            setEditPins([]);
        } finally {
            setIsSavingEdit(false);
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft({});
        setEditPins([]);
        setEditError(null);
    };

    // ── Add ──────────────────────────────────────────────────────────────────

    const startAdd = () => {
        setIsAdding(true);
        setIsConstructing(false);
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

    // ── Конструктор функции ──────────────────────────────────────────────────

    const startConstruct = () => {
        setIsConstructing(true);
        setIsAdding(false);
        setEditingId(null);
    };

    const cancelConstruct = () => setIsConstructing(false);

    const handleFunctionCreated = (entry: FunctionEntry) => {
        persist([...entries, entry]);
        setIsConstructing(false);
    };

    // ── Добавить готовую функцию с диска ─────────────────────────────────────

    const handleAddFromDisk = async () => {
        const handle = await pickExistingJsonFile();
        if (!handle) return;
        const data = await readJsonFromHandle<{ nodes?: unknown[]; connections?: unknown[] }>(handle);
        if (!data?.nodes || !data?.connections) {
            alert('Файл не похож на функцию — ожидается { nodes, connections }');
            return;
        }
        // Путь, который сможет найти fetch-based "Открыть"/экспорт кода, можно
        // вычислить только если файл лежит внутри уже подключённой папки
        // проекта — иначе просто подставляем имя файла, как и при ручном вводе.
        const resolvedPath = projectDirHandle ? await resolveRelativePath(projectDirHandle, handle) : null;
        setIsAdding(true);
        setIsConstructing(false);
        setEditingId(null);
        setNewDraft({
            file: resolvedPath || handle.name,
            name: handle.name.replace(/\.json$/i, ''),
            description: '',
        });
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

                                    <div className="space-y-1">
                                        <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Пины</label>
                                        {editPinsLoading && (
                                            <p className="text-[10px] text-neutral-600 italic">Загрузка пинов…</p>
                                        )}
                                        {!editPinsLoading && editPins.map((pin, i) => (
                                            <div key={pin.id ?? `new_${i}`} className="flex items-center gap-1">
                                                <input
                                                    className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500"
                                                    value={pin.name}
                                                    onChange={e => updateEditPin(i, { name: e.target.value })}
                                                    onMouseDown={e => e.stopPropagation()}
                                                    placeholder="Имя"
                                                />
                                                <select
                                                    className="bg-neutral-900 border border-neutral-700 rounded px-1 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500"
                                                    value={pin.dir}
                                                    onChange={e => updateEditPin(i, { dir: e.target.value as PinDirection })}
                                                    onMouseDown={e => e.stopPropagation()}
                                                >
                                                    {PIN_DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                                </select>
                                                <select
                                                    className="bg-neutral-900 border border-neutral-700 rounded px-1 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500 min-w-0"
                                                    value={pin.dataType}
                                                    onChange={e => updateEditPin(i, { dataType: e.target.value })}
                                                    onMouseDown={e => e.stopPropagation()}
                                                >
                                                    {dataTypes.map(dt => <option key={dt.name} value={dt.name}>{dt.name}</option>)}
                                                </select>
                                                <button
                                                    className="shrink-0 w-4 text-center text-neutral-500 hover:text-red-400 text-sm leading-none"
                                                    onClick={() => removeEditPin(i)}
                                                    onMouseDown={e => e.stopPropagation()}
                                                    title="Удалить пин"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                        {!editPinsLoading && (
                                            <button
                                                className="w-full py-1 rounded border border-dashed border-neutral-700 hover:border-purple-500 text-neutral-500 hover:text-purple-400 text-[11px] transition-colors"
                                                onClick={addEditPin}
                                            >
                                                + Добавить пин
                                            </button>
                                        )}
                                    </div>

                                    {editError && <p className="text-[10px] text-red-400">{editError}</p>}

                                    <div className="flex gap-1 pt-0.5">
                                        <button
                                            className="flex items-center gap-1 px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            onClick={commitEdit}
                                            disabled={isSavingEdit || editPinsLoading}
                                        >
                                            <IconCheck /> {isSavingEdit ? 'Сохранение…' : 'Сохранить'}
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
                            Добавить вручную
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

                {/* Конструктор функции — задать пины и сохранить новый файл */}
                {isConstructing && (
                    <FunctionConstructor onCreated={handleFunctionCreated} onCancel={cancelConstruct} />
                )}
            </div>

            {/* Footer: disk status + export/import + add */}
            <div className="shrink-0 border-t border-neutral-800 px-2 py-1.5 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-1">
                    <span
                        className="text-[10px] text-neutral-600 truncate"
                        title={
                            diskStatus === 'connected' ? `Сохраняется напрямую в файл: ${fileHandle?.name}`
                            : diskStatus === 'needs-permission' ? 'Браузер сбросил доступ к файлу после перезапуска — нужно подтвердить ещё раз'
                            : diskStatus === 'unsupported' ? 'Этот браузер не поддерживает прямую запись на диск — используйте Экспорт/Импорт'
                            : 'Хранится только в этом браузере — подключите файл для сохранения на диске'
                        }
                    >
                        {entries.length} функц{entries.length === 1 ? 'ия' : entries.length < 5 ? 'ии' : 'ий'}
                        {' · '}
                        <span className={clsx(
                            diskStatus === 'connected' && 'text-green-600',
                            diskStatus === 'needs-permission' && 'text-yellow-600',
                            (diskStatus === 'disconnected' || diskStatus === 'unsupported') && 'text-neutral-600'
                        )}>
                            {diskStatus === 'connected' && `файл: ${fileHandle?.name}`}
                            {diskStatus === 'needs-permission' && 'доступ сброшен'}
                            {(diskStatus === 'disconnected' || diskStatus === 'unsupported') && 'только в браузере'}
                        </span>
                    </span>

                    {diskStatus === 'disconnected' && (
                        <div className="flex gap-1 shrink-0">
                            <button
                                className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-400 text-[10px] transition-colors"
                                onClick={connectExisting}
                                title="Выбрать существующий JSON-файл на диске"
                            >
                                Подключить
                            </button>
                            <button
                                className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-400 text-[10px] transition-colors"
                                onClick={connectNew}
                                title="Создать новый JSON-файл на диске"
                            >
                                Создать
                            </button>
                        </div>
                    )}
                    {diskStatus === 'needs-permission' && (
                        <button
                            className="px-1.5 py-0.5 rounded bg-yellow-900/40 hover:bg-yellow-900/60 border border-yellow-700/50 text-yellow-400 text-[10px] transition-colors shrink-0"
                            onClick={reconnect}
                        >
                            Переподключить
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-400 text-[10px] transition-colors"
                        onClick={handleExport}
                        title="Скачать текущий список как JSON-файл"
                    >
                        Экспорт
                    </button>
                    <button
                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-400 text-[10px] transition-colors"
                        onClick={() => importInputRef.current?.click()}
                        title="Загрузить список из JSON-файла"
                    >
                        Импорт
                    </button>
                    <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
                </div>

                <div className="flex items-center gap-1">
                    <button
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-300 text-[11px] transition-all"
                        onClick={startAdd}
                        disabled={isAdding}
                        title="Зарегистрировать функцию по пути к файлу вручную"
                    >
                        <IconPlus /> Вручную
                    </button>
                    <button
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-300 text-[11px] transition-all"
                        onClick={startConstruct}
                        disabled={isConstructing}
                        title="Задать пины (in/out/inout) и создать новый файл функции"
                    >
                        <IconPlus /> Конструктор
                    </button>
                    <button
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-purple-500 text-neutral-300 text-[11px] transition-all"
                        onClick={handleAddFromDisk}
                        title="Выбрать уже существующий файл функции на диске"
                    >
                        <IconPlus /> С диска
                    </button>
                </div>
            </div>
        </div>
    );
};