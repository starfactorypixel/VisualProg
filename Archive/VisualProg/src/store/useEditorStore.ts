import { create } from 'zustand';
import { NodeInstance, Connection, Position, NodeDefinition } from '../types';
import commandsConfig from '../config/commands.json';
import dataTypesConfig from '../config/data_types.json';

interface DataType {
    name: string;
    color: string;
    options?: string[];
}

interface EditorStore {
    nodes: NodeInstance[];
    connections: Connection[];
    scale: number;
    pan: Position;
    nodeDefinitions: NodeDefinition[];
    dataTypes: DataType[];

    // Selection State
    selectedNodeIds: string[];

    // Linking State
    linking: {
        fromNodeId: string;
        fromPortId: string;
        fromPortType: 'input' | 'output';
        fromPortTypeStr: string;
        mousePos: Position;
    } | null;

    // Hover State
    hoveredType: string | null;
    hoveredNodeId: string | null;
    hoveredSidebarType: string | null;

    // Actions
    addNode: (node: NodeInstance) => void;
    updateNodePosition: (id: string, position: Position) => void;
    updateNodesPosition: (delta: { x: number, y: number }) => void;
    updateNodeData: (id: string, data: any) => void;
    removeNode: (id: string) => void;

    addConnection: (connection: Connection) => void;
    removeConnection: (id: string) => void;

    setPan: (pan: Position) => void;
    setScale: (scale: number) => void;

    selectNode: (id: string, multi?: boolean) => void;
    deselectAll: () => void;
    selectNodesInRect: (rect: { x1: number, y1: number, x2: number, y2: number }) => void;

    startLinking: (fromNodeId: string, fromPortId: string, fromPortType: 'input' | 'output', fromPortTypeStr: string, mousePos: Position) => void;
    updateLinking: (mousePos: Position) => void;
    endLinking: () => void;
    completeLinkingToNode: (targetNodeId: string) => void;
    spawnNodeAndConnect: (definitionId: string, type: 'command' | 'data', position: Position) => void;

    setData: (data: { nodes: NodeInstance[], connections: Connection[] }) => void;
    setHoveredType: (type: string | null) => void;
    setHoveredNodeId: (id: string | null) => void;
    setHoveredSidebarType: (type: string | null) => void;

    // Grid Settings
    snapToGrid: boolean;
    toggleSnapToGrid: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
    nodes: [],
    connections: [],
    snapToGrid: true, // Enabled by default
    scale: 1,
    pan: { x: 0, y: 0 },
    nodeDefinitions: commandsConfig as NodeDefinition[],
    dataTypes: dataTypesConfig.types,
    selectedNodeIds: [],
    linking: null,
    hoveredType: null,
    hoveredNodeId: null,
    hoveredSidebarType: null,

    addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),

    setHoveredType: (type) => set({ hoveredType: type }),
    setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
    setHoveredSidebarType: (type) => set({ hoveredSidebarType: type }),

    selectNode: (id, multi) => set((state) => {
        if (multi) {
            const isSelected = state.selectedNodeIds.includes(id);
            return {
                selectedNodeIds: isSelected
                    ? state.selectedNodeIds.filter(idx => idx !== id)
                    : [...state.selectedNodeIds, id]
            };
        }
        return { selectedNodeIds: [id] };
    }),

    deselectAll: () => set({ selectedNodeIds: [] }),
    toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),

    selectNodesInRect: (rect) => set((state) => {
        const selectedIds = state.nodes.filter(node => {
            const nodeWidth = 150;
            const nodeHeight = node.type === 'data' ? 86 : 100; // Rough estimates
            return (
                node.position.x < rect.x2 &&
                node.position.x + nodeWidth > rect.x1 &&
                node.position.y < rect.y2 &&
                node.position.y + nodeHeight > rect.y1
            );
        }).map(n => n.id);
        return { selectedNodeIds: selectedIds };
    }),

    updateNodesPosition: (delta) => set((state) => ({
        nodes: state.nodes.map(node => {
            if (state.selectedNodeIds.includes(node.id)) {
                return {
                    ...node,
                    position: {
                        x: node.position.x + delta.x,
                        y: node.position.y + delta.y
                    }
                };
            }
            return node;
        })
    })),

    completeLinkingToNode: (targetNodeId) => set((state) => {
        if (!state.linking) return state;
        const { fromNodeId, fromPortId, fromPortType } = state.linking;
        if (fromNodeId === targetNodeId) return { ...state, linking: null };

        const sourceNode = state.nodes.find(n => n.id === (fromPortType === 'output' ? fromNodeId : targetNodeId));
        const targetNode = state.nodes.find(n => n.id === (fromPortType === 'output' ? targetNodeId : fromNodeId));

        if (!sourceNode || !targetNode) return { ...state, linking: null };

        const getDef = (node: NodeInstance) => {
            if (node.type === 'command') return state.nodeDefinitions.find(d => d.id === node.definitionId);
            const dt = state.dataTypes.find(t => t.name === node.definitionId);
            if (!dt) return undefined;
            return {
                id: node.definitionId, type: 'data', name: dt.name,
                inputs: [{ id: 'left', name: '', type: node.definitionId }, { id: 'right', name: '', type: node.definitionId }, { id: 'top', name: '', type: node.definitionId }, { id: 'bottom', name: '', type: node.definitionId }],
                outputs: [{ id: 'left', name: '', type: node.definitionId }, { id: 'right', name: '', type: node.definitionId }, { id: 'top', name: '', type: node.definitionId }, { id: 'bottom', name: '', type: node.definitionId }]
            } as unknown as NodeDefinition;
        };

        const sourceDef = getDef(sourceNode);
        const targetDef = getDef(targetNode);
        if (!sourceDef || !targetDef) return { ...state, linking: null };

        let sourcePortId: string | null = fromPortType === 'output' ? fromPortId : null;
        let targetPortId: string | null = fromPortType === 'input' ? fromPortId : null;

        const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();

        if (fromPortType === 'output') {
            const srcPort = (sourceDef.outputs || []).find(op => op.id === fromPortId);
            const bt1 = getBaseType(srcPort?.type || '');
            const matchingInput = (targetDef.inputs || []).find(p => {
                const bt2 = getBaseType(p.type || '');
                return bt1 === bt2 || bt1 === 'any' || bt2 === 'any';
            });
            if (matchingInput) targetPortId = matchingInput.id;
            else if (targetNode.type === 'data') targetPortId = 'left';
        } else {
            const tgtPort = (targetDef.inputs || []).find(ip => ip.id === fromPortId);
            const bt2 = getBaseType(tgtPort?.type || '');
            const matchingOutput = (sourceDef.outputs || []).find(p => {
                const bt1 = getBaseType(p.type || '');
                return bt1 === bt2 || bt1 === 'any' || bt2 === 'any';
            });
            if (matchingOutput) sourcePortId = matchingOutput.id;
            else if (sourceNode.type === 'data') sourcePortId = 'right';
        }

        if (!sourcePortId || !targetPortId) return { ...state, linking: null };

        const isExec = getBaseType((sourceDef.outputs || []).find(p => p.id === sourcePortId)?.type || '') === 'execution';
        const connections = state.connections.filter(c => {
            if (!isExec && c.toNodeId === targetNode.id && c.toPortId === targetPortId) return false;
            if (isExec && c.fromNodeId === sourceNode.id && c.fromPortId === sourcePortId) return false;
            return true;
        });

        const newConnection: Connection = {
            id: Math.random().toString(36).substr(2, 9),
            fromNodeId: sourceNode.id,
            fromPortId: sourcePortId,
            toNodeId: targetNode.id,
            toPortId: targetPortId
        };

        return {
            ...state,
            connections: [...connections, newConnection],
            linking: null
        };
    }),

    spawnNodeAndConnect: (definitionId, type, position) => set((state) => {
        const GRID_SIZE = 20;
        const snappedPos = state.snapToGrid
            ? { x: Math.round(position.x / GRID_SIZE) * GRID_SIZE, y: Math.round(position.y / GRID_SIZE) * GRID_SIZE }
            : position;

        const newNodeId = crypto.randomUUID();
        const newNode: NodeInstance = {
            id: newNodeId,
            definitionId,
            type,
            position: snappedPos,
            data: type === 'data' ? { value: '' } : {}
        };

        const newState = { ...state, nodes: [...state.nodes, newNode], selectedNodeIds: [newNodeId] };

        if (state.linking) {
            const { fromNodeId, fromPortId, fromPortType } = state.linking;
            const sourceNode = newState.nodes.find(n => n.id === (fromPortType === 'output' ? fromNodeId : newNodeId));
            const targetNode = newState.nodes.find(n => n.id === (fromPortType === 'output' ? newNodeId : fromNodeId));

            if (sourceNode && targetNode) {
                const getDef = (node: NodeInstance) => {
                    if (node.type === 'command') return newState.nodeDefinitions.find(d => d.id === node.definitionId);
                    const dt = newState.dataTypes.find(t => t.name === node.definitionId);
                    if (!dt) return undefined;
                    return {
                        id: node.definitionId, type: 'data', name: dt.name,
                        inputs: [{ id: 'left', name: '', type: node.definitionId }, { id: 'right', name: '', type: node.definitionId }, { id: 'top', name: '', type: node.definitionId }, { id: 'bottom', name: '', type: node.definitionId }],
                        outputs: [{ id: 'left', name: '', type: node.definitionId }, { id: 'right', name: '', type: node.definitionId }, { id: 'top', name: '', type: node.definitionId }, { id: 'bottom', name: '', type: node.definitionId }]
                    } as unknown as NodeDefinition;
                };

                const sourceDef = getDef(sourceNode);
                const targetDef = getDef(targetNode);

                if (sourceDef && targetDef) {
                    let sourcePortId: string | null = fromPortType === 'output' ? fromPortId : null;
                    let targetPortId: string | null = fromPortType === 'input' ? fromPortId : null;
                    const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();

                    if (fromPortType === 'output') {
                        const matchingInput = (targetDef.inputs || []).find(p => {
                            const bt1 = getBaseType((sourceDef.outputs || []).find(op => op.id === fromPortId)?.type || '');
                            const bt2 = getBaseType(p.type || '');
                            return bt1 === bt2 || bt1 === 'any' || bt2 === 'any';
                        });
                        if (matchingInput) targetPortId = matchingInput.id;
                        else if (targetNode.type === 'data') targetPortId = 'left';
                    } else {
                        const matchingOutput = (sourceDef.outputs || []).find(p => {
                            const bt1 = getBaseType(p.type || '');
                            const bt2 = getBaseType((targetDef.inputs || []).find(ip => ip.id === fromPortId)?.type || '');
                            return bt1 === bt2 || bt1 === 'any' || bt2 === 'any';
                        });
                        if (matchingOutput) sourcePortId = matchingOutput.id;
                        else if (sourceNode.type === 'data') sourcePortId = 'right';
                    }

                    if (sourcePortId && targetPortId) {
                        const newConnection: Connection = {
                            id: Math.random().toString(36).substr(2, 9),
                            fromNodeId: sourceNode.id,
                            fromPortId: sourcePortId,
                            toNodeId: targetNode.id,
                            toPortId: targetPortId
                        };
                        return { ...newState, connections: [...newState.connections, newConnection], linking: null };
                    }
                }
            }
        }

        return { ...newState, linking: null };
    }),

    updateNodePosition: (id, position) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, position } : n)
    })),

    updateNodeData: (id, data) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, data: { ...n.data, ...data } } : n)
    })),

    removeNode: (id) => set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== id),
        connections: state.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id),
        selectedNodeIds: state.selectedNodeIds.filter(idx => idx !== id)
    })),

    addConnection: (connection) => set((state) => {
        const exists = state.connections.some(c =>
            c.fromNodeId === connection.fromNodeId &&
            c.fromPortId === connection.fromPortId &&
            c.toNodeId === connection.toNodeId &&
            c.toPortId === connection.toPortId
        );
        if (exists) return state;
        return { connections: [...state.connections, connection] };
    }),

    removeConnection: (id) => set((state) => ({
        connections: state.connections.filter((c) => c.id !== id)
    })),

    setPan: (pan) => set({ pan }),
    setScale: (scale) => set({ scale }),

    startLinking: (fromNodeId, fromPortId, fromPortType, fromPortTypeStr, mousePos) => set({
        linking: { fromNodeId, fromPortId, fromPortType, fromPortTypeStr, mousePos }
    }),
    updateLinking: (mousePos) => set((state) => (
        state.linking ? { linking: { ...state.linking, mousePos } } : {}
    )),
    endLinking: () => set({ linking: null }),

    setData: (data) => set({ nodes: data.nodes, connections: data.connections }),
}));
