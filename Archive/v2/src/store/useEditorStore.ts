import { create } from 'zustand';
import { NodeInstance, Connection, Position, NodeDefinition } from '../types';
import commandsConfig from '../config/commands.json';
import dataTypesConfig from '../config/data_types.json';

interface DataType {
    name: string;
    color: string;
    options?: (string | { value: string; label: string })[];
}

// Магнитная сетка
interface MagneticGridConfig {
    commandColumnSpacing: number;  // Расстояние между вертикальными линиями команд (ширина 2 нод + зазор)
    dataColumnOffset: number;      // Смещение вертикали данных влево от команд
    verticalGap: number;           // Зазор между рядами
    dataNodeHeight: number;        // Высота data node
    dataNodeGap: number;           // Зазор между data nodes
    magnetRadius: number;          // Радиус действия магнита
}

// Информация о горизонтальной линии
interface GridRow {
    index: number;              // Номер ряда
    y: number;                  // Y-координата линии
    rowHeight: number; // <--- Новое поле
    maxCommandHeight: number;   // Максимальная высота command node в ряду
    maxDataPorts: number;       // Максимальное количество data портов в ряду
    commandNodeIds: string[];   // ID нод на этой линии
}

interface EditorStore {
    nodes: NodeInstance[];
    connections: Connection[];
    scale: number;
    pan: Position;
    nodeDefinitions: NodeDefinition[];
    dataTypes: DataType[];

    selectedNodeIds: string[];
    linking: {
        fromNodeId: string;
        fromPortId: string;
        fromPortType: 'input' | 'output';
        fromPortTypeStr: string;
        mousePos: Position;
    } | null;

    hoveredType: string | null;
    hoveredNodeId: string | null;
    hoveredSidebarType: string | null;

    // Магнитная сетка
    magneticGridMode: boolean;
    magneticGridConfig: MagneticGridConfig;
    gridRows: GridRow[];           // Кэш горизонтальных линий
    
    // Состояние перетаскивания
    draggingState: {
        nodeId: string;
        originalPosition: Position;
        isMagnetic: boolean;        // Примагничена ли нода
        magneticPosition: Position | null;
    } | null;

    // Actions
    addNode: (node: NodeInstance) => void;
    updateNodePosition: (id: string, position: Position) => void;
    updateNodeData: (id: string, data: any) => void;
    removeNode: (id: string) => void;

    addConnection: (connection: Connection) => void;
    removeConnection: (id: string) => void;

    setPan: (pan: Position) => void;
    setScale: (scale: number) => void;

    selectNode: (id: string, multi?: boolean) => void;
    deselectAll: () => void;

    startLinking: (fromNodeId: string, fromPortId: string, fromPortType: 'input' | 'output', fromPortTypeStr: string, mousePos: Position) => void;
    updateLinking: (mousePos: Position) => void;
    endLinking: () => void;
    completeLinkingToNode: (targetNodeId: string) => void;
    spawnNodeAndConnect: (definitionId: string, type: 'command' | 'data', position: Position) => void;

    setData: (data: { nodes: NodeInstance[], connections: Connection[] }) => void;
    setHoveredType: (type: string | null) => void;
    setHoveredNodeId: (id: string | null) => void;
    setHoveredSidebarType: (type: string | null) => void;

    toggleMagneticGrid: () => void;

	updateNodePositionMagnetic: (nodeId: string, position: Position) => void;
	updateSelectedNodesMagnetic: (leadNodeId: string, magneticPosition: Position) => void;

    // Методы магнитной сетки
    startDragging: (nodeId: string, position: Position) => void;
    updateDragging: (position: Position) => void;
    endDragging: (commit: boolean) => void;  // commit: true = применить, false = отменить
    recalculateGrid: () => void;
    findNearestGridPoint: (position: Position, nodeType: 'command' | 'data') => { point: Position; distance: number; col: number; row: number } | null;
}

const DEFAULT_MAGNETIC_GRID: MagneticGridConfig = {
    commandColumnSpacing: 350,  // 150px node + 150px node + 50px зазор
    dataColumnOffset: 180,      // 150px data node + 30px зазор
    verticalGap: 40,
    dataNodeHeight: 86,
    dataNodeGap: 10,
    magnetRadius: 30
};

export const useEditorStore = create<EditorStore>((set, get) => ({
    nodes: [],
    connections: [],
    scale: 1,
    pan: { x: 0, y: 0 },
    nodeDefinitions: commandsConfig as NodeDefinition[],
    dataTypes: dataTypesConfig.types,
    selectedNodeIds: [],
    linking: null,
    hoveredType: null,
    hoveredNodeId: null,
    hoveredSidebarType: null,
    
    magneticGridMode: false,
    magneticGridConfig: DEFAULT_MAGNETIC_GRID,
    gridRows: [],
    draggingState: null,

    addNode: (node) => set((state) => {
        const newNodes = [...state.nodes, node];
        return {
            nodes: newNodes,
            gridRows: state.magneticGridMode ? recalculateGridRows(newNodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : state.gridRows
        };
    }),

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

	  selectNodesInRect: (rect) => set((state) => {
		const { x1, y1, x2, y2 } = rect;
		
		// Фильтруем ноды, которые попадают в границы рамки выделения
		const selectedIds = state.nodes
		  .filter(node => 
			node.position.x >= x1 && 
			node.position.x <= x2 && 
			node.position.y >= y1 && 
			node.position.y <= y2
		  )
		  .map(node => node.id);

		return { selectedNodeIds: selectedIds };
	  }),

    deselectAll: () => set({ selectedNodeIds: [] }),
    
    toggleMagneticGrid: () => set((state) => {
        const newMode = !state.magneticGridMode;
        if (newMode) {
            const rows = recalculateGridRows(state.nodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes);
            return { magneticGridMode: newMode, gridRows: rows };
        }
        return { magneticGridMode: newMode, gridRows: [] };
    }),

    startDragging: (nodeId, position) => set((state) => {
        const node = state.nodes.find(n => n.id === nodeId);
        if (!node) return state;
        
        const nodeType = node.type;

        return {
            draggingState: {
                nodeId,
                nodeType,
                originalPosition: { ...node.position },
                isMagnetic: false,
                magneticPosition: null
            }
        };
    }),


	moveSelectedNodes: (dx, dy) => set((state) => ({
	  nodes: state.nodes.map((n) => 
		state.selectedNodeIds.includes(n.id) 
		  ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
		  : n
	  )
	})),

    updateDragging: (position) => set((state) => {
        if (!state.draggingState || !state.magneticGridMode) return state;
        
        const node = state.nodes.find(n => n.id === state.draggingState!.nodeId);
        if (!node) return state;

        // Ищем ближайшую точку сетки
        const nearest = findNearestGridPoint(
            position, 
            node.type, 
            state.gridRows, 
            state.magneticGridConfig
        );

        if (nearest && nearest.distance <= state.magneticGridConfig.magnetRadius) {
            // Примагничиваем
            return {
                draggingState: {
                    ...state.draggingState,
                    isMagnetic: true,
                    magneticPosition: nearest.point
                },
                nodes: state.nodes.map(n => 
                    n.id === state.draggingState!.nodeId 
                        ? { ...n, position: nearest.point }
                        : n
                )
            };
        } else {
            // Следуем за курсором
            return {
                draggingState: {
                    ...state.draggingState,
                    isMagnetic: false,
                    magneticPosition: null
                },
                nodes: state.nodes.map(n => 
                    n.id === state.draggingState!.nodeId 
                        ? { ...n, position }
                        : n
                )
            };
        }
    }),

	updateNodePositionMagnetic: (nodeId, position) => set((state) => ({
		nodes: state.nodes.map(node => 
			node.id === nodeId ? { ...node, position } : node
		)
	})),

	updateSelectedNodesMagnetic: (leadNodeId, magneticPosition) => set((state) => {
		const leadNode = state.nodes.find(n => n.id === leadNodeId);
		if (!leadNode) return state;

		const deltaX = magneticPosition.x - leadNode.position.x;
		const deltaY = magneticPosition.y - leadNode.position.y;

		return {
			nodes: state.nodes.map(node => {
				if (state.selectedNodeIds.includes(node.id)) {
					return {
						...node,
						position: {
							x: node.position.x + deltaX,
							y: node.position.y + deltaY
						}
					};
				}
				return node;
			})
		};
	}),

    endDragging: (commit) => set((state) => {
        if (!state.draggingState) return state;

        if (commit && state.draggingState.isMagnetic) {
            // Применяем магнитную позицию
            const newNodes = state.nodes;
            const newRows = recalculateGridRows(newNodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes);
            return {
                draggingState: null,
                gridRows: newRows
            };
        } else {
            // Возвращаем в исходную позицию
            return {
                draggingState: null,
                nodes: state.nodes.map(n => 
                    n.id === state.draggingState!.nodeId 
                        ? { ...n, position: state.draggingState!.originalPosition }
                        : n
                )
            };
        }
    }),

    recalculateGrid: () => set((state) => ({
        gridRows: recalculateGridRows(state.nodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes)
    })),

    findNearestGridPoint: (position, nodeType) => {
        const state = get();
        return findNearestGridPoint(position, nodeType, state.gridRows, state.magneticGridConfig);
    },

    updateNodePosition: (id, position) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, position } : n)
    })),

    updateNodeData: (id, data) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, data: { ...n.data, ...data } } : n)
    })),

    removeNode: (id) => set((state) => {
        const newNodes = state.nodes.filter((n) => n.id !== id);
        const newConnections = state.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id);
        return {
            nodes: newNodes,
            connections: newConnections,
            selectedNodeIds: state.selectedNodeIds.filter(idx => idx !== id),
            gridRows: state.magneticGridMode ? recalculateGridRows(newNodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : state.gridRows
        };
    }),

    addConnection: (connection) => set((state) => {
        const exists = state.connections.some(c =>
            c.fromNodeId === connection.fromNodeId &&
            c.fromPortId === connection.fromPortId &&
            c.toNodeId === connection.toNodeId &&
            c.toPortId === connection.toPortId
        );
        if (exists) return state;
        
        const newConnections = [...state.connections, connection];
        return { 
            connections: newConnections,
            gridRows: state.magneticGridMode ? recalculateGridRows(state.nodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : state.gridRows
        };
    }),

    removeConnection: (id) => set((state) => {
        const newConnections = state.connections.filter((c) => c.id !== id);
        return {
            connections: newConnections,
            gridRows: state.magneticGridMode ? recalculateGridRows(state.nodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : state.gridRows
        };
    }),

    setPan: (pan) => set({ pan }),
    setScale: (scale) => set({ scale }),

    startLinking: (fromNodeId, fromPortId, fromPortType, fromPortTypeStr, mousePos) => set({
        linking: { fromNodeId, fromPortId, fromPortType, fromPortTypeStr, mousePos }
    }),
    updateLinking: (mousePos) => set((state) => (
        state.linking ? { linking: { ...state.linking, mousePos } } : {}
    )),
    endLinking: () => set({ linking: null }),

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

    setData: (data) => set((state) => ({
        nodes: data.nodes,
        connections: data.connections,
        gridRows: state.magneticGridMode ? recalculateGridRows(data.nodes, data.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : []
    })),
}));

// Helper функции

/**
 * Пересчитывает горизонтальные линии сетки
 */
function recalculateGridRows(
    nodes: NodeInstance[] = [],                  // защита от undefined nodes
    connections: Connection[] = [],
    config: MagneticGridConfig,
    nodeDefinitions: NodeDefinition[] = [],
    dataTypes: DataType[] = []
): GridRow[] {
    // Защита от некорректного config
    const safeConfig = {
        dataNodeHeight: Number(config?.dataNodeHeight) || 86,
        dataNodeGap: Number(config?.dataNodeGap) || 12,
        verticalGap: Number(config?.verticalGap) || 50,
        ...config
    };

    const commandNodes = Array.isArray(nodes) 
        ? nodes.filter(n => n?.type === 'command' && n?.position?.y != null)
        : [];

    if (commandNodes.length === 0) {
        return []; // или вернуть пустые строки, если нужно
    }

    const rowGroups = new Map<number, NodeInstance[]>();
    const TOLERANCE = 50;

    commandNodes.forEach(node => {
        if (!node?.position?.y) return; // пропускаем битые ноды

        let foundRow = false;
        for (const [rowY, rowNodes] of rowGroups.entries()) {
            if (Math.abs(node.position.y - rowY) < TOLERANCE) {
                rowNodes.push(node);
                foundRow = true;
                break;
            }
        }
        if (!foundRow) {
            rowGroups.set(node.position.y, [node]);
        }
    });

    const sortedRows = Array.from(rowGroups.entries()).sort((a, b) => a[0] - b[0]);

    const gridRows: GridRow[] = [];
    let currentY = 100;

    sortedRows.forEach(([_, rowNodes], index) => {
        // Защита от пустой группы
        if (!Array.isArray(rowNodes) || rowNodes.length === 0) return;

        let maxDataPorts = 0;
        rowNodes.forEach(cmdNode => {
            const count = getDataPortCount(cmdNode?.id, nodes, connections, nodeDefinitions, dataTypes);
            // Защита от NaN / undefined в getDataPortCount
            if (typeof count === 'number' && !isNaN(count)) {
                maxDataPorts = Math.max(maxDataPorts, count);
            }
        });

        // Явное вычисление с защитой
        const maxCommandHeight = 80 + (maxDataPorts + 1) * 25;
        const dataSpaceNeeded = maxDataPorts * (safeConfig.dataNodeHeight + safeConfig.dataNodeGap);
        
        // Итоговая высота с fallback
        const rowHeight = Number.isFinite(maxCommandHeight + dataSpaceNeeded)
            ? maxCommandHeight + dataSpaceNeeded
            : 100; // минимальная разумная высота

        // Пропускаем строку, если высота некорректна
        if (!Number.isFinite(rowHeight) || !Number.isFinite(currentY)) {
            console.warn("Пропущена строка — некорректные значения", { maxDataPorts, currentY, rowHeight });
            return;
        }

        gridRows.push({
            index,
            y: currentY,
            rowHeight,
            maxCommandHeight,
            maxDataPorts,
            commandNodeIds: rowNodes.map(n => n?.id).filter(Boolean) as string[]
        });

        currentY += rowHeight + safeConfig.verticalGap;
    });

    // Пустые строки в конце
    const emptyRowsToShow = commandNodes.length === 0 ? 1 : 1;
    const startIdx = gridRows.length;

    for (let i = 0; i < emptyRowsToShow; i++) {
        if (!Number.isFinite(currentY)) break;

        gridRows.push({
            index: startIdx + i,
            y: currentY,
            maxCommandHeight: 100,
            maxDataPorts: 0,
            commandNodeIds: [],
            rowHeight: 100
        });

        currentY += 100 + safeConfig.verticalGap;
    }

    return gridRows;
}

/**
 * Подсчитывает количество data портов у команды
 */
function getDataPortCount(
    commandId: string,
    nodes: NodeInstance[],
    connections: Connection[],
    nodeDefinitions: NodeDefinition[],
    dataTypes: DataType[]
): number {
    const commandNode = nodes.find(n => n.id === commandId);
    if (!commandNode) return 0;

    const def = nodeDefinitions.find(d => d.id === commandNode.definitionId);
    if (!def) return 0;

    // Считаем data порты (не execution)
    const inputDataPorts = (def.inputs || []).filter(p => p.type.toLowerCase() !== 'execution').length;
    const outputDataPorts = (def.outputs || []).filter(p => p.type.toLowerCase() !== 'execution').length;

    return Math.max(inputDataPorts, outputDataPorts);
}

/**
 * Находит ближайшую точку сетки
 */
function findNearestGridPoint(
    position: Position,
    nodeType: 'command' | 'data',
    gridRows: GridRow[],
    config: MagneticGridConfig
): { point: Position; distance: number; col: number; row: number } | null {
    if (gridRows.length === 0) return null;

    let nearest: { point: Position; distance: number; col: number; row: number } | null = null;

    if (nodeType === 'command') {
        // Для команд: привязка к пересечениям вертикальных и горизонтальных линий
        // Центр верха node привязывается к точке пересечения

        // Вертикальные колонки: 0, 350, 700, 1050, ...
        const columns = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => i * config.commandColumnSpacing);

        gridRows.forEach((row, rowIndex) => {
            columns.forEach((colX, colIndex) => {
                // Точка пересечения
                const intersectionX = colX;
                const intersectionY = row.y + (row.rowHeight - row.maxCommandHeight);

                // Вычисляем расстояние от центра верха node до точки пересечения
                // Центр верха node = position.x + 75, position.y (если node width = 150)
                const nodeCenterTopX = position.x + 75;
                const nodeCenterTopY = position.y;

                const dx = nodeCenterTopX - intersectionX;
                const dy = nodeCenterTopY - intersectionY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (!nearest || distance < nearest.distance) {
                    // Позиция node такая, чтобы центр верха был в точке пересечения
                    const nodeX = intersectionX - 75; // -75 = половина ширины
                    const nodeY = intersectionY;

                    nearest = {
                        point: { x: nodeX, y: nodeY },
                        distance,
                        col: colIndex,
                        row: rowIndex
                    };
                }
            });
        });
    } else {
        // Для данных: сетка смещена влево, привязка такая же
        const dataColumns = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => i * config.commandColumnSpacing - config.dataColumnOffset);

        gridRows.forEach((row, rowIndex) => {
            // Для каждого ряда создаем горизонтальные линии данных
            const dataRowsCount = row.maxDataPorts;
            
            for (let dataRowIdx = 0; dataRowIdx < dataRowsCount; dataRowIdx++) {
                const dataY = row.y + dataRowIdx * (config.dataNodeHeight + config.dataNodeGap);

                dataColumns.forEach((colX, colIndex) => {
                    const nodeCenterTopX = position.x + 75;
                    const nodeCenterTopY = position.y;

                    const dx = nodeCenterTopX - colX;
                    const dy = nodeCenterTopY - dataY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (!nearest || distance < nearest.distance) {
                        const nodeX = colX - 75;
                        const nodeY = dataY;

                        nearest = {
                            point: { x: nodeX, y: nodeY },
                            distance,
                            col: colIndex,
                            row: rowIndex
                        };
                    }
                });
            }
        });
    }

    return nearest;
}
