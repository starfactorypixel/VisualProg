// Обёртка над File System Access API (Chrome/Edge) — позволяет один раз
// выбрать файл на диске и затем читать/писать его напрямую, без какого-либо
// бэкенда/dev-сервера. Хендл файла хранится между сессиями в IndexedDB
// (localStorage не умеет сериализовать объекты-хендлы).
//
// TS lib.dom.d.ts ещё не описывает showOpenFilePicker/showSaveFilePicker и
// методы queryPermission/requestPermission у FileSystemHandle — это активная
// часть спецификации, но не финализирована, поэтому часть типов ниже
// объявлена вручную.

export type PermissionState = 'granted' | 'denied' | 'prompt';

interface HandleWithPermissions extends FileSystemHandle {
    queryPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export function isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

export function isDirectoryPickerSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickExistingJsonFile(): Promise<FileSystemFileHandle | null> {
    try {
        const [handle] = await (window as any).showOpenFilePicker({
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
            excludeAcceptAllOption: false,
            multiple: false,
        });
        return handle ?? null;
    } catch {
        return null; // пользователь закрыл диалог выбора файла
    }
}

export async function createNewJsonFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
    try {
        return await (window as any).showSaveFilePicker({
            suggestedName,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        });
    } catch {
        return null; // пользователь закрыл диалог сохранения
    }
}

export function queryHandlePermission(handle: FileSystemHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
    return (handle as HandleWithPermissions).queryPermission({ mode });
}

export function requestHandlePermission(handle: FileSystemHandle, mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
    return (handle as HandleWithPermissions).requestPermission({ mode });
}

// ─── Директория проекта (для сохранения файлов функций по относительному пути,
// чтобы их продолжали находить fetch-based "Открыть" и экспорт кода) ───────────

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
    try {
        return await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
        return null; // пользователь закрыл диалог выбора папки
    }
}

export async function getOrCreateFileInDirectory(dirHandle: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemFileHandle | null> {
    try {
        const parts = relativePath.split('/').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return null;

        let dir = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: true });
        }
        return await dir.getFileHandle(parts[parts.length - 1], { create: true });
    } catch {
        return null;
    }
}

export async function resolveRelativePath(root: FileSystemDirectoryHandle, target: FileSystemHandle): Promise<string | null> {
    try {
        const parts = await root.resolve(target);
        return parts ? parts.join('/') : null;
    } catch {
        return null;
    }
}

export async function readJsonFromHandle<T>(handle: FileSystemFileHandle): Promise<T | null> {
    try {
        const file = await handle.getFile();
        const text = await file.text();
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

export async function writeJsonToHandle(handle: FileSystemFileHandle, data: unknown): Promise<boolean> {
    try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        return true;
    } catch {
        return false;
    }
}

// ─── Персист хендла между сессиями ──────────────────────────────────────────

const DB_NAME = 'visualprog-fs-handles';
const STORE_NAME = 'handles';

function openHandleDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveHandle(key: string, handle: FileSystemHandle): Promise<void> {
    const db = await openHandleDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadHandle<T extends FileSystemHandle = FileSystemFileHandle>(key: string): Promise<T | null> {
    try {
        const db = await openHandleDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}
