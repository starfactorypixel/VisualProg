import React, { useState } from 'react';
import clsx from 'clsx';
import { useEditorStore } from '../../store/useEditorStore';
import { genId } from '../../utils/id';
import { NodeInstance, Connection } from '../../types';
import { PinDef, PinDirection, FunctionFileData } from '../../types/function';
import { slugifyPinName } from '../../utils/functionSignature';
import { getOrCreateFileInDirectory, writeJsonToHandle, resolveRelativePath } from '../../utils/fileSystemAccess';
import { useProjectDirectory } from './useProjectDirectory';

interface FunctionEntry {
    id: string;
    file: string;
    name: string;
    description: string;
}

interface FunctionConstructorProps {
    onCreated: (entry: FunctionEntry) => void;
    onCancel: () => void;
}

export const PIN_DIRECTIONS: { value: PinDirection; label: string }[] = [
    { value: 'in', label: 'In' },
    { value: 'out', label: 'Out' },
    { value: 'inout', label: 'InOut' },
];

// Минимально валидное тело функции: Begin -> End плюс одна placeholder-нода
// на каждый пин сигнатуры — ровно то, что setData() на холсте функции и так
// умеет гарантировать идемпотентно, просто уже с самого начала.
function buildStarterFile(pins: PinDef[]): FunctionFileData {
    const beginId = genId();
    const endId = genId();

    const pinNodes: NodeInstance[] = pins.map((pin, i) => ({
        id: genId(),
        definitionId: pin.dataType,
        type: 'data',
        position: { x: 40, y: 140 + i * 110 },
        data: { isPin: true, pinId: pin.id, pinDir: pin.dir, label: pin.name, value: '' },
    }));

    const nodes: NodeInstance[] = [
        { id: beginId, definitionId: 'cmd_FunctionStart', type: 'command', position: { x: 320, y: 40 }, data: {} },
        { id: endId, definitionId: 'cmd_End', type: 'command', position: { x: 320, y: 400 }, data: {} },
        ...pinNodes,
    ];

    const connections: Connection[] = [
        { id: genId(), fromNodeId: beginId, fromPortId: 'exec_out', toNodeId: endId, toPortId: 'exec_in' },
    ];

    return { nodes, connections, signature: { pins } };
}

export const FunctionConstructor: React.FC<FunctionConstructorProps> = ({ onCreated, onCancel }) => {
    const dataTypes = useEditorStore(s => s.dataTypes);
    const [name, setName] = useState('');
    const [relPath, setRelPath] = useState('');
    const [pathTouched, setPathTouched] = useState(false);
    const [pins, setPins] = useState<{ name: string; dir: PinDirection; dataType: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const { dirHandle, status, connect, reconnect } = useProjectDirectory();

    const handleNameChange = (value: string) => {
        setName(value);
        if (!pathTouched) {
            setRelPath(value.trim() ? `functions/${slugifyPinName(value, 0)}.json` : '');
        }
    };

    const addPin = () => {
        setPins(prev => [...prev, { name: `Pin${prev.length + 1}`, dir: 'in', dataType: dataTypes[0]?.name || '' }]);
    };
    const updatePin = (i: number, patch: Partial<{ name: string; dir: PinDirection; dataType: string }>) => {
        setPins(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
    };
    const removePin = (i: number) => setPins(prev => prev.filter((_, idx) => idx !== i));

    const handleCreate = async () => {
        setError(null);
        if (!name.trim()) { setError('Укажите название функции'); return; }
        if (!relPath.trim()) { setError('Укажите путь для сохранения'); return; }

        let handle = dirHandle;
        if (status !== 'connected') {
            if (status === 'needs-permission') {
                const ok = await reconnect();
                if (!ok) { setError('Нет доступа к папке проекта — нажмите ещё раз, чтобы переподключить'); return; }
            } else {
                handle = await connect();
                if (!handle) { setError('Нужно выбрать папку проекта, чтобы сохранить файл на диске'); return; }
            }
        }
        if (!handle) { setError('Нет доступа к папке проекта'); return; }

        const seenIds = new Set<string>();
        const pinDefs: PinDef[] = pins.map((p, i) => {
            let id = slugifyPinName(p.name, i);
            while (seenIds.has(id)) id = `${id}_${i}`;
            seenIds.add(id);
            return { id, name: p.name.trim() || `Pin ${i + 1}`, dir: p.dir, dataType: p.dataType };
        });

        setIsSaving(true);
        try {
            const fileHandle = await getOrCreateFileInDirectory(handle, relPath.trim());
            if (!fileHandle) { setError('Не удалось создать файл по этому пути'); return; }

            const ok = await writeJsonToHandle(fileHandle, buildStarterFile(pinDefs));
            if (!ok) { setError('Не удалось записать файл'); return; }

            const resolvedPath = await resolveRelativePath(handle, fileHandle);
            const finalPath = resolvedPath || relPath.trim();

            // На случай, если эта функция уже кидалась на холст раньше (с тем же
            // путём, тогда ещё без файла) — кэш сигнатуры в сторе мог застрять
            // на null. Обновляем сразу, не дожидаясь перезагрузки страницы.
            useEditorStore.getState().setFunctionSignature(finalPath, { pins: pinDefs });

            onCreated({
                id: `fn_${Date.now()}`,
                file: finalPath,
                name: name.trim(),
                description: '',
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="rounded border border-purple-500/60 bg-neutral-800 p-2 space-y-1.5" onMouseDown={e => e.stopPropagation()}>
            <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">
                Конструктор функции
            </p>

            <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Название *</label>
                <input
                    autoFocus
                    className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
                    value={name}
                    onChange={e => handleNameChange(e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    placeholder="Название функции"
                />
            </div>

            <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Путь сохранения *</label>
                <input
                    className="w-full mt-0.5 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-400 font-mono focus:outline-none focus:border-purple-500"
                    value={relPath}
                    onChange={e => { setRelPath(e.target.value); setPathTouched(true); }}
                    onMouseDown={e => e.stopPropagation()}
                    placeholder="functions/my_func.json"
                />
            </div>

            <div className="space-y-1">
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Пины</label>
                {pins.map((pin, i) => (
                    <div key={i} className="flex items-center gap-1">
                        <input
                            className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500"
                            value={pin.name}
                            onChange={e => updatePin(i, { name: e.target.value })}
                            onMouseDown={e => e.stopPropagation()}
                            placeholder="Имя"
                        />
                        <select
                            className="bg-neutral-900 border border-neutral-700 rounded px-1 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500"
                            value={pin.dir}
                            onChange={e => updatePin(i, { dir: e.target.value as PinDirection })}
                            onMouseDown={e => e.stopPropagation()}
                        >
                            {PIN_DIRECTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                        <select
                            className="bg-neutral-900 border border-neutral-700 rounded px-1 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-purple-500 min-w-0"
                            value={pin.dataType}
                            onChange={e => updatePin(i, { dataType: e.target.value })}
                            onMouseDown={e => e.stopPropagation()}
                        >
                            {dataTypes.map(dt => <option key={dt.name} value={dt.name}>{dt.name}</option>)}
                        </select>
                        <button
                            className="shrink-0 w-4 text-center text-neutral-500 hover:text-red-400 text-sm leading-none"
                            onClick={() => removePin(i)}
                            onMouseDown={e => e.stopPropagation()}
                            title="Удалить пин"
                        >
                            ×
                        </button>
                    </div>
                ))}
                <button
                    className="w-full py-1 rounded border border-dashed border-neutral-700 hover:border-purple-500 text-neutral-500 hover:text-purple-400 text-[11px] transition-colors"
                    onClick={addPin}
                >
                    + Добавить пин
                </button>
            </div>

            {status !== 'connected' && (
                <p className="text-[10px] text-yellow-600">
                    {status === 'unsupported'
                        ? 'Этот браузер не поддерживает сохранение в папку проекта (нужен Chrome/Edge)'
                        : 'При создании будет предложено подключить папку проекта'}
                </p>
            )}
            {error && <p className="text-[10px] text-red-400">{error}</p>}

            <div className="flex gap-1 pt-0.5">
                <button
                    className={clsx(
                        'flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors',
                        name.trim() && !isSaving
                            ? 'bg-purple-600 hover:bg-purple-500 text-white'
                            : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                    )}
                    onClick={handleCreate}
                    disabled={!name.trim() || isSaving}
                >
                    {isSaving ? 'Создание…' : 'Создать функцию'}
                </button>
                <button
                    className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-[11px] transition-colors"
                    onClick={onCancel}
                >
                    Отмена
                </button>
            </div>
        </div>
    );
};
