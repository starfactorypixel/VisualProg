import { useCallback, useEffect, useState } from 'react';
import {
    isDirectoryPickerSupported, pickProjectDirectory,
    queryHandlePermission, requestHandlePermission,
    saveHandle, loadHandle,
} from '../../utils/fileSystemAccess';

export type ProjectDirStatus = 'unsupported' | 'disconnected' | 'needs-permission' | 'connected';

const DIR_HANDLE_KEY = 'project_root_dir';

// Хендл корневой папки проекта — нужен, чтобы новые файлы функций ложились
// туда же, откуда их фетчит dev-сервер (иначе кнопка "Открыть" и подстановка
// функции в код их не найдут). Тот же connect/needs-permission/reconnect цикл,
// что уже используется для файла реестра функций в FunctionsPanel.tsx, просто
// для директории вместо файла.
export function useProjectDirectory() {
    const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const [status, setStatus] = useState<ProjectDirStatus>(isDirectoryPickerSupported() ? 'disconnected' : 'unsupported');

    useEffect(() => {
        if (!isDirectoryPickerSupported()) return;
        (async () => {
            const handle = await loadHandle<FileSystemDirectoryHandle>(DIR_HANDLE_KEY);
            if (!handle) return;
            setDirHandle(handle);
            const perm = await queryHandlePermission(handle);
            setStatus(perm === 'granted' ? 'connected' : 'needs-permission');
        })();
    }, []);

    const connect = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
        const handle = await pickProjectDirectory();
        if (!handle) return null;
        await saveHandle(DIR_HANDLE_KEY, handle);
        setDirHandle(handle);
        setStatus('connected');
        return handle;
    }, []);

    const reconnect = useCallback(async (): Promise<boolean> => {
        if (!dirHandle) return false;
        const perm = await requestHandlePermission(dirHandle);
        if (perm === 'granted') {
            setStatus('connected');
            return true;
        }
        return false;
    }, [dirHandle]);

    return { dirHandle, status, connect, reconnect };
}
