import { useRef, useEffect } from 'react';
import { Canvas } from './components/Canvas/Canvas';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopMenu } from './components/UI/TopMenu';
import { VariablesBar } from './components/UI/VariablesBar';
import { useEditorStore } from './store/useEditorStore';

function App() {
    const { addNode, scale, pan, setData, undo, redo, removeSelectedNodes, copySelectedNodes, duplicateSelectedNodes, pasteNodes } = useEditorStore();
    const canvasWrapperRef = useRef<HTMLDivElement>(null);
    const lastRightClickPos = useRef<{ x: number; y: number } | null>(null);

    // Disable browser context menu on canvas
    useEffect(() => {
        const disableContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            return false;
        };

        document.addEventListener('contextmenu', disableContextMenu);
        return () => document.removeEventListener('contextmenu', disableContextMenu);
    }, []);

    // Store last right-click position for paste
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            const rect = canvasWrapperRef.current?.getBoundingClientRect();
            if (rect) {
                const worldX = (e.clientX - rect.left - pan.x) / scale;
                const worldY = (e.clientY - rect.top - pan.y) / scale;
                lastRightClickPos.current = { x: worldX, y: worldY };
            }
        };

        window.addEventListener('contextmenu', handleContextMenu);
        return () => window.removeEventListener('contextmenu', handleContextMenu);
    }, [pan, scale]);

    // Горячие клавиши для Undo/Redo и Copy/Paste
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            const isCtrlOrMeta = e.ctrlKey || e.metaKey;

            if (isCtrlOrMeta && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo();
            }
            else if (isCtrlOrMeta && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault();
                redo();
            }
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeSelectedNodes();
            }
            else if (isCtrlOrMeta && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                copySelectedNodes();
            }
            else if (isCtrlOrMeta && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                duplicateSelectedNodes();
            }
            else if (isCtrlOrMeta && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                const pastePos = lastRightClickPos.current || {
                    x: (-pan.x + window.innerWidth / 2) / scale,
                    y: (-pan.y + window.innerHeight / 2) / scale
                };
                pasteNodes(pastePos);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, removeSelectedNodes, copySelectedNodes, duplicateSelectedNodes, pasteNodes, pan, scale]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const fileParam = params.get('file');

        if (fileParam) {
            console.log('Loading file from URL:', fileParam);
            fetch(fileParam)
                .then(res => {
                    if (!res.ok) throw new Error('File not found');
                    return res.json();
                })
                .then(data => {
                    if (data.nodes && data.connections) {
                        setData(data);
                    } else {
                        console.error('Invalid file format');
                        alert('Invalid file format loaded from URL');
                    }
                })
                .catch(err => {
                    console.error('Failed to load file:', err);
                    alert('Failed to load file: ' + fileParam + '\nMake sure it exists in the public directory.');
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
                    id: crypto.randomUUID(),
                    definitionId: id,
                    type: 'command',
                    position: { x: worldX - 75, y: worldY - 20 },
                    // Если дроп из FunctionsPanel — сразу заполняем file и label
                    data: fnFile ? { file: fnFile, label: fnName || fnFile } : {}
                });
            }
            else if (type === 'data') {
                addNode({
                    id: crypto.randomUUID(),
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

    return (
        <div className="w-screen h-screen flex flex-col bg-background text-foreground">
            <TopMenu />
            <VariablesBar />

            <div className="flex-1 flex overflow-hidden">
                <Sidebar />

                <div
                    ref={canvasWrapperRef}
                    className="flex-1 relative"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
                    <Canvas />
                </div>
            </div>
        </div>
    );
}

export default App;