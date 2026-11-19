import { useRef, useEffect } from 'react';
import { Canvas } from './components/Canvas/Canvas';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopMenu } from './components/UI/TopMenu';
import { VariablesBar } from './components/UI/VariablesBar';
import { DockablePanel, DockZoneOverlay } from './components/UI/DockablePanel';
import { DockSide, usePanelLayoutStore } from './store/usePanelLayoutStore';
import { useEditorStore, UI_LANGUAGE_STORAGE_KEY } from './store/useEditorStore';
import { genId } from './utils/id';
import { useTranslate } from './i18n';

function App() {
    const t = useTranslate();
    const { addNode, scale, pan, setData, loadTemplate, setActiveLanguage, undo, redo, removeSelectedNodes, copySelectedNodes, duplicateSelectedNodes, pasteNodes } = useEditorStore();
    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const lastMousePos = useRef<{ x: number; y: number } | null>(null);

    const sidebarDock = usePanelLayoutStore(s => s.panels['sidebar']?.dock ?? 'left');
    const variablesDock = usePanelLayoutStore(s => s.panels['variablesBar']?.dock ?? 'top');

    // Disable browser context menu on canvas
    useEffect(() => {
        const disableContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            return false;
        };

        document.addEventListener('contextmenu', disableContextMenu);
        return () => document.removeEventListener('contextmenu', disableContextMenu);
    }, []);

    // Текущая позиция курсора — нужна для Ctrl+V (вставка под мышь, а не в центр
    // экрана или в точку последнего правого клика, который мог быть совсем не там)
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            lastMousePos.current = { x: e.clientX, y: e.clientY };
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Горячие клавиши для Undo/Redo и Copy/Paste
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            const isCtrlOrMeta = e.ctrlKey || e.metaKey;

            // e.code — это физическая клавиша (её положение на клавиатуре),
            // в отличие от e.key, который зависит от текущей раскладки. При
            // не-латинской раскладке (например русской) физическая "Z" отдаёт
            // в e.key совсем другой символ ('я' в ЙЦУКЕН), и сравнение с 'z'
            // просто никогда не срабатывает — отсюда и неработающие хоткеи.
            if (isCtrlOrMeta && e.code === 'KeyZ') {
                e.preventDefault();
                undo();
            }
            else if (isCtrlOrMeta && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
                e.preventDefault();
                redo();
            }
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeSelectedNodes();
            }
            else if (isCtrlOrMeta && e.code === 'KeyC') {
                e.preventDefault();
                copySelectedNodes();
            }
            else if (isCtrlOrMeta && e.code === 'KeyD') {
                e.preventDefault();
                duplicateSelectedNodes();
            }
            else if (isCtrlOrMeta && e.code === 'KeyV') {
                e.preventDefault();
                const rect = canvasWrapperRef.current?.getBoundingClientRect();
                const pastePos = (rect && lastMousePos.current)
                    ? {
                        x: (lastMousePos.current.x - rect.left - pan.x) / scale,
                        y: (lastMousePos.current.y - rect.top - pan.y) / scale
                    }
                    : {
                        x: (-pan.x + window.innerWidth / 2) / scale,
                        y: (-pan.y + window.innerHeight / 2) / scale
                    };
                pasteNodes(pastePos);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, removeSelectedNodes, copySelectedNodes, duplicateSelectedNodes, pasteNodes, pan, scale]);

    // Загружаем шаблон по умолчанию (DrakeScript) — палитра нод и типы данных
    // берутся из него, а не из отдельных статических конфигов.
    useEffect(() => {
        fetch('/templates/drake_template.json')
            .then(res => {
                if (!res.ok) throw new Error('Template not found');
                return res.json();
            })
            .then(template => {
                loadTemplate(template);
                // Восстанавливаем выбор языка ПОСЛЕ загрузки шаблона — иначе
                // setActiveLanguage ещё не увидит activeTemplate.languages и
                // молча пропустит перевод команд/групп, даже если файл для
                // этого языка у шаблона есть (см. комментарий в setActiveLanguage).
                const savedLanguage = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
                if (savedLanguage) setActiveLanguage(savedLanguage);
            })
            .catch(err => {
                console.error('Failed to load default template:', err);
                alert(t('Failed to load templates/drake_template.json — the node palette will be empty.'));
            });
    }, [loadTemplate, setActiveLanguage]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const fileParam = params.get('file');

        if (fileParam) {
            console.log('Loading file from URL:', fileParam);
            // no-store — файл функции может быть только что переписан напрямую
            // на диске (File System Access, мимо HTTP), и закэшированный ответ
            // открыл бы устаревшую версию без недавно добавленных пинов.
            fetch(fileParam, { cache: 'no-store' })
                .then(res => {
                    if (!res.ok) throw new Error('File not found');
                    return res.json();
                })
                .then(data => {
                    if (data.nodes && data.connections) {
                        setData(data, data.signature, fileParam);
                    } else {
                        console.error('Invalid file format');
                        alert(t('Invalid file format loaded from URL'));
                    }
                })
                .catch(err => {
                    console.error('Failed to load file:', err);
                    alert(t('Failed to load file: {0}\nMake sure it exists in the public directory.', fileParam));
                });
        }
    }, [setData]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const type   = e.dataTransfer.getData('application/reactflow/type');
        const id     = e.dataTransfer.getData('application/reactflow/id');
        // Дополнительные поля от FunctionsPanel
        const fnFile = e.dataTransfer.getData('application/reactflow/fnfile');
        const fnName = e.dataTransfer.getData('application/reactflow/fnname');

        if (canvasWrapperRef.current) {
            const rect   = canvasWrapperRef.current.getBoundingClientRect();
            const worldX = (e.clientX - rect.left - pan.x) / scale;
            const worldY = (e.clientY - rect.top  - pan.y) / scale;

            if (type === 'command') {
                addNode({
                    id: genId(),
                    definitionId: id,
                    type: 'command',
                    position: { x: worldX - 75, y: worldY - 20 },
                    // Если дроп из FunctionsPanel — сразу заполняем file и label
                    data: fnFile ? { file: fnFile, label: fnName || fnFile } : {}
                });
            }
            else if (type === 'data') {
                addNode({
                    id: genId(),
                    definitionId: id,
                    type: 'data',
                    position: { x: worldX - 75, y: worldY - 20 },
                    data: { value: '' }
                });
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const sidebarPanel = (
        <DockablePanel
            key="sidebar"
            id="sidebar"
            title={t('Commands')}
            defaultDock="left"
            defaultSize={256}
            defaultFloatSize={{ width: 288, height: 520 }}
            minSize={220}
            maxSize={480}
        >
            <Sidebar />
        </DockablePanel>
    );

    const variablesPanel = (
        <DockablePanel
            key="variablesBar"
            id="variablesBar"
            title={t('Variables')}
            defaultDock="top"
            defaultSize={64}
            defaultFloatSize={{ width: 560, height: 180 }}
            defaultFloatPos={{ x: 160, y: 120 }}
            minSize={48}
            maxSize={400}
        >
            <VariablesBar />
        </DockablePanel>
    );

    const groups: Record<Exclude<DockSide, 'float'>, React.ReactNode[]> = { top: [], bottom: [], left: [], right: [] };
    if (sidebarDock !== 'float') groups[sidebarDock].push(sidebarPanel);
    if (variablesDock !== 'float') groups[variablesDock].push(variablesPanel);

    return (
        <div className="w-screen h-screen flex flex-col bg-background text-foreground">
            <TopMenu />

            {groups.top.length > 0 && <div className="flex flex-row shrink-0">{groups.top}</div>}

            <div className="flex-1 flex overflow-hidden">
                {groups.left.length > 0 && <div className="flex flex-col shrink-0">{groups.left}</div>}

                <div
                    ref={canvasWrapperRef}
                    className="flex-1 relative min-w-0"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <Canvas />
                </div>

                {groups.right.length > 0 && <div className="flex flex-col shrink-0">{groups.right}</div>}
            </div>

            {groups.bottom.length > 0 && <div className="flex flex-row shrink-0">{groups.bottom}</div>}

            {sidebarDock === 'float' && sidebarPanel}
            {variablesDock === 'float' && variablesPanel}

            <DockZoneOverlay />
        </div>
    );
}

export default App;