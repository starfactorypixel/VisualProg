import { useRef, useEffect } from 'react';
import { Canvas } from './components/Canvas/Canvas';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopMenu } from './components/UI/TopMenu';
import { VariablesBar } from './components/UI/VariablesBar';
import { useEditorStore } from './store/useEditorStore';

function App() {
    const { addNode, scale, pan, setData } = useEditorStore();
    const canvasWrapperRef = useRef<HTMLDivElement>(null);

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
        const type = e.dataTransfer.getData('application/reactflow/type');
        const id = e.dataTransfer.getData('application/reactflow/id'); // defId or dataType

        if (canvasWrapperRef.current) {
            // Calculate Drop Position
            const rect = canvasWrapperRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const worldX = (mouseX - pan.x) / scale;
            const worldY = (mouseY - pan.y) / scale;

            if (type === 'command') {
                addNode({
                    id: crypto.randomUUID(),
                    definitionId: id,
                    type: 'command',
                    position: { x: worldX - 75, y: worldY - 20 },
                    data: {}
                });
            }
            else if (type === 'data') {
                addNode({
                    id: crypto.randomUUID(),
                    definitionId: id, // Temporarily storing type name as defId for simplicity, or we make a virtual definition
                    type: 'data',
                    position: { x: worldX - 75, y: worldY - 20 },
                    data: { value: '' } // Default value
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
