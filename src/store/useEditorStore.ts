import { create } from 'zustand';
import { NodeInstance, Connection, Position, NodeDefinition } from '../types';
import { RawTemplate, DataTypeDef, NodeGroupDef, compileNodeDefinitions, compileDataTypes, compileNodeGroups } from '../utils/TemplateSchema';

type DataType = DataTypeDef;

// Магнитная сетка
export interface MagneticGridConfig {
    commandColumnSpacing: number;  // Расстояние между вертикальными линиями команд (ширина 2 нод + зазор)
    dataColumnOffset: number;      // Смещение вертикали данных влево от команд
    verticalGap: number;           // Зазор между рядами
    dataNodeHeight: number;        // Высота data node
    dataNodeGap: number;           // Зазор между data nodes
    magnetRadius: number;          // Радиус действия магнита
}

// Информация о горизонтальной линии
export interface GridRow {
    index: number;              // Номер ряда
    y: number;                  // Y-координата линии
    rowHeight: number; // <--- Новое поле
    maxCommandHeight: number;   // Максимальная высота command node в ряду
    maxDataPorts: number;       // Максимальное количество data портов в ряду
    commandNodeIds: string[];   // ID нод на этой линии
}

interface EditorStateSnapshot {
    nodes: NodeInstance[];
    connections: Connection[];
}

interface ClipboardData {
    nodes: NodeInstance[];
    connections: Connection[];
    copyOffset: Position;  // Offset for pasting relative to original positions
}

interface EditorStore {
    nodes: NodeInstance[];
    connections: Connection[];
    scale: number;
    pan: Position;
    nodeDefinitions: NodeDefinition[];
    dataTypes: DataType[];
    nodeGroups: NodeGroupDef[];           // группы для вкладки GRP, компилируются из activeTemplate.nodeGroups
    activeTemplate: RawTemplate | null;  // текущий загруженный шаблон (drake/c/asm/пользовательский) — палитра + правила экспорта

    selectedNodeIds: string[];
    // Click-based connection: first port selected, showing temporary line to mouse
    selectedPort: {
        fromNodeId: string;
        fromPortId: string;
        fromPortType: 'input' | 'output';
        fromPortTypeStr: string;
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
        originalPositions: Map<string, Position>;  // Оригинальные позиции всех выбранных нод
        isMagnetic: boolean;        // Примагничена ли нода
        magneticPosition: Position | null;
        nodeType?: 'command' | 'data';
        dataPortCount?: number;     // Кол-во data-портов переносимой command-ноды — учитывается при расчёте линии ряда
        previewGridRows?: GridRow[]; // Сетка без переносимой ноды (её исходный ряд уже пересчитан так, будто она ушла)
        magneticTargetRowIds?: string[]; // Ноды, уже стоящие в целевом ряду — их тоже нужно подтянуть на линию при drop
        snapshot?: EditorStateSnapshot;  // Снимок состояния до перемещения
    } | null;

    // История для undo/redo
    past: EditorStateSnapshot[];
    future: EditorStateSnapshot[];
    historyLimit: number;

    // Clipboard for copy/paste
    clipboard: ClipboardData | null;

    // Actions
    addNode: (node: NodeInstance) => void;
    updateNodePosition: (id: string, position: Position) => void;
    updateNodeData: (id: string, data: any) => void;
    removeNode: (id: string) => void;
    removeSelectedNodes: () => void;

    addConnection: (connection: Connection) => void;
    removeConnection: (id: string) => void;

    setPan: (pan: Position) => void;
    setScale: (scale: number) => void;

    selectNode: (id: string, multi?: boolean) => void;
    deselectAll: () => void;
    selectNodesInRect: (rect: { x1: number; y1: number; x2: number; y2: number }) => void;

    startLinking: (fromNodeId: string, fromPortId: string, fromPortType: 'input' | 'output', fromPortTypeStr: string) => void;
    cancelLinking: () => void;
    completeLinking: (targetNodeId: string, targetPortId: string, targetPortType: 'input' | 'output') => void;
    spawnNodeAndConnect: (definitionId: string, type: 'command' | 'data', position: Position, portId: string, portType: 'input' | 'output') => void;

    setData: (data: { nodes: NodeInstance[], connections: Connection[] }) => void;
    loadTemplate: (template: RawTemplate) => void;  // переключает палитру нод + типы данных на другой язык/шаблон
    setHoveredType: (type: string | null) => void;
    setHoveredNodeId: (id: string | null) => void;
    setHoveredSidebarType: (type: string | null) => void;

    toggleMagneticGrid: () => void;

	updateNodePositionMagnetic: (nodeId: string, position: Position) => void;
	updateSelectedNodesMagnetic: (leadNodeId: string, magneticPosition: Position) => void;
    updateNodesPosition: (delta: Position) => void;  // Для группового перемещения в обычном режиме

    // Методы магнитной сетки
    startDragging: (nodeId: string, position: Position, nodeType?: 'command' | 'data') => void;
    updateDragging: (position: Position) => void;
    endDragging: (commit: boolean, finalPositions?: Array<{ id: string; position: Position }>) => void;  // commit: true = применить, false = отменить
    recalculateGrid: () => void;
    findNearestGridPoint: (position: Position, nodeType: 'command' | 'data') => { point: Position; distance: number; col: number; row: number; rowCommandNodeIds: string[] } | null;

    // Copy/Paste/Duplicate
    copySelectedNodes: () => void;
    duplicateSelectedNodes: () => void;
    pasteNodes: (position: Position) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
}

const DEFAULT_MAGNETIC_GRID: MagneticGridConfig = {
    commandColumnSpacing: 350,  // 150px node + 150px node + 50px зазор
    dataColumnOffset: 180,      // 150px data node + 30px зазор
    verticalGap: 40,
    dataNodeHeight: 86,
    dataNodeGap: 10,
    magnetRadius: 30
};

const HISTORY_LIMIT = 50;

// Вспомогательная функция для создания снимка состояния
const createSnapshot = (state: EditorStore): EditorStateSnapshot => {
    // Создаём глубокую копию через structuredClone или JSON
    try {
        return {
            nodes: structuredClone(state.nodes),
            connections: structuredClone(state.connections)
        };
    } catch {
        // Fallback для старых браузеров
        return {
            nodes: JSON.parse(JSON.stringify(state.nodes)),
            connections: JSON.parse(JSON.stringify(state.connections))
        };
    }
};

export const useEditorStore = create<EditorStore>((set, get) => ({
    nodes: [],
    connections: [],
    scale: 1,
    pan: { x: 0, y: 0 },
    nodeDefinitions: [],  // заполняется loadTemplate() при старте приложения (см. App.tsx)
    dataTypes: [],
    nodeGroups: [],
    activeTemplate: null,
    selectedNodeIds: [],
    selectedPort: null,
    hoveredType: null,
    hoveredNodeId: null,
    hoveredSidebarType: null,

    magneticGridMode: false,
    magneticGridConfig: DEFAULT_MAGNETIC_GRID,
    gridRows: [],
    draggingState: null,

    past: [],
    future: [],
    historyLimit: HISTORY_LIMIT,

    clipboard: null,

    addNode: (node) => set((state) => {
        const snapshot = createSnapshot(state);
        const newNodes = [...state.nodes, node];
        if (state.magneticGridMode) {
            const { gridRows, nodes: snapped } = recalculateAndSnap(newNodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            return { 
                nodes: snapped, 
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }
        return { 
            nodes: newNodes, 
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
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

    startDragging: (nodeId, position, nodeType) => set((state) => {
        const node = state.nodes.find(n => n.id === nodeId);
        if (!node) return state;

        // Сохраняем снимок состояния ДО начала перемещения
        const snapshot = createSnapshot(state);

        // Сохраняем оригинальные позиции всех выбранных нод для группового перемещения
        const originalPositions = new Map<string, Position>();
        const hasSelection = state.selectedNodeIds.length > 1 && state.selectedNodeIds.includes(nodeId);

        if (hasSelection) {
            state.selectedNodeIds.forEach(id => {
                const selectedNode = state.nodes.find(n => n.id === id);
                if (selectedNode) {
                    originalPositions.set(id, { ...selectedNode.position });
                }
            });
        } else {
            originalPositions.set(nodeId, { ...position });
        }

        // Сколько data-портов у переносимой команды — чтобы точка примагничивания
        // сразу резервировала под неё место, а не только под уже стоящие в ряду ноды
        const dataPortCount = nodeType === 'command'
            ? getDataPortCount(nodeId, state.nodes, state.connections, state.nodeDefinitions, state.dataTypes)
            : 0;

        // Гипотетическая сетка «как если бы нода уже покинула свой исходный ряд».
        // Без этого исходный ряд (который мог быть растянут именно из-за этой ноды)
        // на превью остаётся старого размера, а после реального пересчёта на drop
        // сжимается и сдвигает все нижележащие ряды — нода в итоге примагничивается
        // не туда, где реально осядет.
        const previewGridRows = nodeType === 'command'
            ? recalculateGridRows(
                state.nodes.filter(n => n.id !== nodeId),
                state.connections,
                state.magneticGridConfig,
                state.nodeDefinitions,
                state.dataTypes
              )
            : state.gridRows;

        return {
            draggingState: {
                nodeId,
                nodeType,
                dataPortCount,
                previewGridRows,
                originalPosition: { ...node.position },
                originalPositions,
                isMagnetic: false,
                magneticPosition: null,
                snapshot  // Сохраняем снимок для использования в endDragging
            }
        };
    }),

	updateNodesPosition: (delta) => set((state) => ({
	  nodes: state.nodes.map((n) =>
		state.selectedNodeIds.includes(n.id)
		  ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } }
		  : n
	  )
	})),

    updateDragging: (position) => set((state) => {
        if (!state.draggingState || !state.magneticGridMode) return state;

        const leadNode = state.nodes.find(n => n.id === state.draggingState!.nodeId);
        if (!leadNode) return state;

        // Ищем ближайшую точку сетки для ведущей ноды
        const nearest = findNearestGridPoint(
            position,
            leadNode.type,
            state.gridRows,
            state.magneticGridConfig
        );

        // Вычисляем смещение для всех выбранных нод
        let newLeadPosition = position;
        let isMagnetic = false;
        let magneticPosition: Position | null = null;

        if (nearest && nearest.distance <= state.magneticGridConfig.magnetRadius) {
            // Примагничиваем ведущую ноду
            newLeadPosition = nearest.point;
            isMagnetic = true;
            magneticPosition = nearest.point;
        }

        // Вычисляем дельту перемещения относительно оригинальной позиции ведущей ноды
        const deltaX = newLeadPosition.x - state.draggingState.originalPosition.x;
        const deltaY = newLeadPosition.y - state.draggingState.originalPosition.y;

        // Перемещаем все выбранные ноды вместе с ведущей
        const hasSelection = state.selectedNodeIds.length > 1 && state.selectedNodeIds.includes(state.draggingState.nodeId);
        
        return {
            draggingState: {
                ...state.draggingState,
                isMagnetic,
                magneticPosition
            },
            nodes: state.nodes.map(n => {
                if (hasSelection && state.selectedNodeIds.includes(n.id)) {
                    // Групповое перемещение: используем сохранённые оригинальные позиции
                    const originalPos = state.draggingState!.originalPositions.get(n.id);
                    if (originalPos) {
                        return {
                            ...n,
                            position: {
                                x: originalPos.x + deltaX,
                                y: originalPos.y + deltaY
                            }
                        };
                    }
                } else if (n.id === state.draggingState!.nodeId) {
                    // Одиночное перемещение ведущей ноды
                    return { ...n, position: newLeadPosition };
                }
                return n;
            })
        };
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

    endDragging: (commit, finalPositions) => set((state) => {
        if (!state.draggingState) return state;

        // Обычное перемещение (не магнитное) с переданными финальными позициями
        if (commit && finalPositions && finalPositions.length > 0) {
            // Сохраняем снимок состояния ДО перемещения
            const snapshot = state.draggingState.snapshot || createSnapshot(state);
            
            // Возвращаем draggingState в null и сохраняем историю
            return {
                draggingState: null,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }

        if (commit && state.draggingState.isMagnetic) {
            // Применяем магнитную позицию и синхронизируем остальные примагниченные ноды
            const { gridRows, nodes: snapped } = recalculateAndSnap(state.nodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            
            // Сохраняем историю только после успешного завершения перемещения
            const snapshot = state.draggingState.snapshot;
            if (snapshot) {
                return {
                    draggingState: null,
                    nodes: snapped,
                    gridRows,
                    past: [...state.past, snapshot].slice(-state.historyLimit),
                    future: []
                };
            }
            return {
                draggingState: null,
                nodes: snapped,
                gridRows
            };
        } else {
            // Возвращаем все выбранные ноды в исходную позицию (отмена перемещения)
            const hasSelection = state.selectedNodeIds.length > 1 && state.selectedNodeIds.includes(state.draggingState.nodeId);

            if (hasSelection) {
                return {
                    draggingState: null,
                    nodes: state.nodes.map(n => {
                        if (state.selectedNodeIds.includes(n.id)) {
                            const originalPos = state.draggingState!.originalPositions.get(n.id);
                            if (originalPos) {
                                return { ...n, position: originalPos };
                            }
                        }
                        return n;
                    })
                };
            } else {
                // Возвращаем только ведущую ноду
                return {
                    draggingState: null,
                    nodes: state.nodes.map(n =>
                        n.id === state.draggingState!.nodeId
                            ? { ...n, position: state.draggingState!.originalPosition }
                            : n
                    )
                };
            }
        }
    }),

    recalculateGrid: () => set((state) => {
        const { gridRows, nodes: snapped } = recalculateAndSnap(state.nodes, state.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
        return { gridRows, nodes: snapped };
    }),

    findNearestGridPoint: (position, nodeType) => {
        const state = get();
        const draggedPortCount = nodeType === 'command' ? (state.draggingState?.dataPortCount ?? 0) : 0;
        // Пока идёт command-драг — ищем точку по сетке, где исходный ряд уже "освобождён"
        const rows = nodeType === 'command' && state.draggingState?.previewGridRows
            ? state.draggingState.previewGridRows
            : state.gridRows;
        return findNearestGridPoint(position, nodeType, rows, state.magneticGridConfig, draggedPortCount);
    },

    updateNodePosition: (id, position) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, position } : n)
    })),

    updateNodeData: (id, data) => set((state) => ({
        nodes: state.nodes.map((n) => n.id === id ? { ...n, data: { ...n.data, ...data } } : n)
    })),

    removeNode: (id) => set((state) => {
        const snapshot = createSnapshot(state);
        const newNodes = state.nodes.filter((n) => n.id !== id);
        const newConnections = state.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id);
        if (state.magneticGridMode) {
            const { gridRows, nodes: snapped } = recalculateAndSnap(newNodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            return {
                nodes: snapped,
                connections: newConnections,
                selectedNodeIds: state.selectedNodeIds.filter(idx => idx !== id),
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }
        return {
            nodes: newNodes,
            connections: newConnections,
            selectedNodeIds: state.selectedNodeIds.filter(idx => idx !== id),
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    removeSelectedNodes: () => set((state) => {
        if (state.selectedNodeIds.length === 0) return state;

        const snapshot = createSnapshot(state);
        const idsToDelete = new Set(state.selectedNodeIds);
        const newNodes = state.nodes.filter((n) => !idsToDelete.has(n.id));
        const newConnections = state.connections.filter((c) => !idsToDelete.has(c.fromNodeId) && !idsToDelete.has(c.toNodeId));

        if (state.magneticGridMode) {
            const { gridRows, nodes: snapped } = recalculateAndSnap(newNodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            return {
                nodes: snapped,
                connections: newConnections,
                selectedNodeIds: [],
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }
        return {
            nodes: newNodes,
            connections: newConnections,
            selectedNodeIds: [],
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    copySelectedNodes: () => set((state) => {
        if (state.selectedNodeIds.length === 0) return state;

        const selectedNodes = state.nodes.filter(n => state.selectedNodeIds.includes(n.id));
        const selectedIds = new Set(state.selectedNodeIds);
        const selectedConnections = state.connections.filter(
            c => selectedIds.has(c.fromNodeId) && selectedIds.has(c.toNodeId)
        );

        // Calculate the bounding box to determine copy offset
        const minX = Math.min(...selectedNodes.map(n => n.position.x));
        const minY = Math.min(...selectedNodes.map(n => n.position.y));

        return {
            clipboard: {
                nodes: selectedNodes,
                connections: selectedConnections,
                copyOffset: { x: minX, y: minY }
            }
        };
    }),

    duplicateSelectedNodes: () => set((state) => {
        if (state.selectedNodeIds.length === 0) return state;

        const snapshot = createSnapshot(state);
        const selectedNodes = state.nodes.filter(n => state.selectedNodeIds.includes(n.id));
        const selectedIds = new Set(state.selectedNodeIds);
        const selectedConnections = state.connections.filter(
            c => selectedIds.has(c.fromNodeId) && selectedIds.has(c.toNodeId)
        );

        // Create ID mapping for connections
        const idMap = new Map<string, string>();
        const newNodes = selectedNodes.map(node => {
            const newId = crypto.randomUUID();
            idMap.set(node.id, newId);
            return {
                ...node,
                id: newId,
                position: {
                    x: node.position.x + 30,
                    y: node.position.y + 30
                },
                data: { ...node.data }
            };
        });

        const newConnections = selectedConnections.map(conn => ({
            id: crypto.randomUUID(),
            fromNodeId: idMap.get(conn.fromNodeId)!,
            fromPortId: conn.fromPortId,
            toNodeId: idMap.get(conn.toNodeId)!,
            toPortId: conn.toPortId
        }));

        const newSelectedIds = newNodes.map(n => n.id);

        if (state.magneticGridMode) {
            const allNodes = [...state.nodes, ...newNodes];
            const allConnections = [...state.connections, ...newConnections];
            const { gridRows, nodes: snapped } = recalculateAndSnap(
                allNodes, allConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows
            );
            return {
                nodes: snapped,
                connections: allConnections,
                selectedNodeIds: newSelectedIds,
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }

        return {
            nodes: [...state.nodes, ...newNodes],
            connections: [...state.connections, ...newConnections],
            selectedNodeIds: newSelectedIds,
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    pasteNodes: (position) => set((state) => {
        if (!state.clipboard) return state;

        const snapshot = createSnapshot(state);
        const { nodes: clipboardNodes, connections: clipboardConnections, copyOffset } = state.clipboard;

        // Calculate offset from clipboard position to paste position
        const offsetX = position.x - copyOffset.x;
        const offsetY = position.y - copyOffset.y;

        // Create ID mapping
        const idMap = new Map<string, string>();
        const newNodes = clipboardNodes.map(node => {
            const newId = crypto.randomUUID();
            idMap.set(node.id, newId);
            return {
                ...node,
                id: newId,
                position: {
                    x: node.position.x + offsetX,
                    y: node.position.y + offsetY
                },
                data: { ...node.data }
            };
        });

        const newConnections = clipboardConnections.map(conn => ({
            id: crypto.randomUUID(),
            fromNodeId: idMap.get(conn.fromNodeId)!,
            fromPortId: conn.fromPortId,
            toNodeId: idMap.get(conn.toNodeId)!,
            toPortId: conn.toPortId
        }));

        const newSelectedIds = newNodes.map(n => n.id);

        if (state.magneticGridMode) {
            const allNodes = [...state.nodes, ...newNodes];
            const allConnections = [...state.connections, ...newConnections];
            const { gridRows, nodes: snapped } = recalculateAndSnap(
                allNodes, allConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows
            );
            return {
                nodes: snapped,
                connections: allConnections,
                selectedNodeIds: newSelectedIds,
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }

        return {
            nodes: [...state.nodes, ...newNodes],
            connections: [...state.connections, ...newConnections],
            selectedNodeIds: newSelectedIds,
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
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

        const snapshot = createSnapshot(state);
        const newConnections = [...state.connections, connection];
        if (state.magneticGridMode) {
            const { gridRows, nodes: snapped } = recalculateAndSnap(state.nodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            return { 
                connections: newConnections, 
                nodes: snapped, 
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }
        return { 
            connections: newConnections, 
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    removeConnection: (id) => set((state) => {
        const snapshot = createSnapshot(state);
        const newConnections = state.connections.filter((c) => c.id !== id);
        if (state.magneticGridMode) {
            const { gridRows, nodes: snapped } = recalculateAndSnap(state.nodes, newConnections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes, state.gridRows);
            return { 
                connections: newConnections, 
                nodes: snapped, 
                gridRows,
                past: [...state.past, snapshot].slice(-state.historyLimit),
                future: []
            };
        }
        return { 
            connections: newConnections, 
            gridRows: state.gridRows,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    setPan: (pan) => set({ pan }),
    setScale: (scale) => set({ scale }),

    startLinking: (fromNodeId, fromPortId, fromPortType, fromPortTypeStr) => set({
        selectedPort: { fromNodeId, fromPortId, fromPortType, fromPortTypeStr }
    }),
    cancelLinking: () => set({ selectedPort: null }),

    completeLinking: (targetNodeId, targetPortId, _targetPortType) => set((state) => {
        if (!state.selectedPort) return state;
        const { fromNodeId, fromPortId, fromPortType } = state.selectedPort;

        // Can't connect to same node
        if (fromNodeId === targetNodeId) return { ...state, selectedPort: null };

        // Determine source and target based on port types
        let sourceNodeId: string, sourcePortId: string, targetNodeIdFinal: string, targetPortIdFinal: string;

        if (fromPortType === 'output') {
            sourceNodeId = fromNodeId;
            sourcePortId = fromPortId;
            targetNodeIdFinal = targetNodeId;
            targetPortIdFinal = targetPortId;
        } else {
            sourceNodeId = targetNodeId;
            sourcePortId = targetPortId;
            targetNodeIdFinal = fromNodeId;
            targetPortIdFinal = fromPortId;
        }

        const sourceNode = state.nodes.find(n => n.id === sourceNodeId);
        const targetNode = state.nodes.find(n => n.id === targetNodeIdFinal);

        if (!sourceNode || !targetNode) return { ...state, selectedPort: null };

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
        if (!sourceDef || !targetDef) return { ...state, selectedPort: null };

        const getBaseType = (t: string) => t.toLowerCase().startsWith('ref:') ? t.toLowerCase().slice(4) : t.toLowerCase();

        // Validate type compatibility
        const sourcePort = (sourceDef.outputs || []).find(p => p.id === sourcePortId);
        const targetPort = (targetDef.inputs || []).find(p => p.id === targetPortIdFinal);

        if (!sourcePort || !targetPort) return { ...state, selectedPort: null };

        const btSource = getBaseType(sourcePort.type || '');
        const btTarget = getBaseType(targetPort.type || '');

        if (btSource !== btTarget && btSource !== 'any' && btTarget !== 'any') {
            return { ...state, selectedPort: null };
        }

        // Remove conflicting connections
        const isExec = getBaseType(sourcePort.type || '') === 'execution';
        const connections = state.connections.filter(c => {
            if (!isExec && c.toNodeId === targetNode.id && c.toPortId === targetPortIdFinal) return false;
            if (isExec && c.fromNodeId === sourceNode.id && c.fromPortId === sourcePortId) return false;
            return true;
        });

        const newConnection: Connection = {
            id: Math.random().toString(36).substr(2, 9),
            fromNodeId: sourceNode.id,
            fromPortId: sourcePortId,
            toNodeId: targetNode.id,
            toPortId: targetPortIdFinal
        };

        const snapshot = createSnapshot(state);

        return {
            ...state,
            connections: [...connections, newConnection],
            selectedPort: null,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    spawnNodeAndConnect: (definitionId, type, position, portId, _portType) => set((state) => {
        const GRID_SIZE = 20;
        const snappedPos = { x: Math.round(position.x / GRID_SIZE) * GRID_SIZE, y: Math.round(position.y / GRID_SIZE) * GRID_SIZE };

        const newNodeId = crypto.randomUUID();
        const newNode: NodeInstance = {
            id: newNodeId,
            definitionId,
            type,
            position: snappedPos,
            data: type === 'data' ? { value: '' } : {}
        };

        const snapshot = createSnapshot(state);
        const newState = { ...state, nodes: [...state.nodes, newNode], selectedNodeIds: [newNodeId] };

        if (state.selectedPort) {
            const { fromNodeId, fromPortId, fromPortType } = state.selectedPort;
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
                    let sourcePortId: string = fromPortType === 'output' ? fromPortId : portId;
                    let targetPortId: string = fromPortType === 'input' ? fromPortId : portId;

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
                        return {
                            ...newState,
                            connections: [...newState.connections, newConnection],
                            selectedPort: null,
                            past: [...state.past, snapshot].slice(-state.historyLimit),
                            future: []
                        };
                    }
                }
            }
        }

        return {
            ...newState,
            selectedPort: null,
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    setData: (data) => set((state) => {
        // Сохраняем текущее состояние в историю перед заменой данных
        const snapshot = createSnapshot(state);
        return {
            nodes: data.nodes,
            connections: data.connections,
            gridRows: state.magneticGridMode ? recalculateGridRows(data.nodes, data.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes) : [],
            past: [...state.past, snapshot].slice(-state.historyLimit),
            future: []
        };
    }),

    // Переключает активный шаблон/язык: палитра нод (сайдбар CMD) и типы данных
    // (сайдбар DATA) пересобираются из template.commands/template.dataTypes.
    // Текущий граф на канвасе не трогаем — ноды с definitionId, которых нет в
    // новой палитре, просто перестанут находить своё определение (ожидаемо
    // при смене языка).
    loadTemplate: (template) => set({
        nodeDefinitions: compileNodeDefinitions(template),
        dataTypes: compileDataTypes(template),
        nodeGroups: compileNodeGroups(template),
        activeTemplate: template,
    }),

    // Undo/Redo actions
    undo: () => set((state) => {
        if (state.past.length === 0) return state;
        
        const previous = state.past[state.past.length - 1];
        const newPast = state.past.slice(0, -1);
        const currentSnapshot = createSnapshot(state);
        
        // Восстанавливаем состояние из предыдущего снимка
        const newState = {
            ...state,
            nodes: previous.nodes,
            connections: previous.connections,
            past: newPast,
            future: [currentSnapshot, ...state.future].slice(0, state.historyLimit),
            gridRows: state.magneticGridMode 
                ? recalculateGridRows(previous.nodes, previous.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes)
                : state.gridRows
        };
        
        return newState;
    }),

    redo: () => set((state) => {
        if (state.future.length === 0) return state;
        
        const next = state.future[0];
        const newFuture = state.future.slice(1);
        const currentSnapshot = createSnapshot(state);
        
        // Восстанавливаем состояние из следующего снимка
        const newState = {
            ...state,
            nodes: next.nodes,
            connections: next.connections,
            past: [...state.past, currentSnapshot].slice(-state.historyLimit),
            future: newFuture,
            gridRows: state.magneticGridMode
                ? recalculateGridRows(next.nodes, next.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes)
                : state.gridRows
        };
        
        return newState;
    }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
}));

// Helper функции

/**
 * Пересчитывает горизонтальные линии сетки
 */
/**
 * После пересчёта gridRows обновляет позиции нод, которые уже примагничены к сетке.
 * Логика: если нода лежит точно (с допуском SNAP_TOLERANCE) на магнитной точке
 * старых строк — переставить её на соответствующую точку новых строк.
 */
function snapMagneticNodes(
    nodes: NodeInstance[],
    oldRows: GridRow[],
    newRows: GridRow[],
    config: MagneticGridConfig
): NodeInstance[] {
    if (oldRows.length === 0 || newRows.length === 0) return nodes;

    const SNAP_TOLERANCE = 2; // пикселей

    // Строим маппинг: старый rowIndex → новый row.y
    // Совпадение по commandNodeIds — самый надёжный способ найти «тот же ряд»
    const oldRowByIndex = new Map<number, GridRow>();
    const newRowByIndex = new Map<number, GridRow>();
    oldRows.forEach(r => oldRowByIndex.set(r.index, r));
    newRows.forEach(r => newRowByIndex.set(r.index, r));

    // Также строим маппинг по commandNodeIds для надёжного сопоставления
    const newRowByNodeId = new Map<string, GridRow>();
    newRows.forEach(row => {
        row.commandNodeIds.forEach(id => newRowByNodeId.set(id, row));
    });

    return nodes.map(node => {
        // Ищем, к какому старому ряду была примагничена нода
        const oldRow = oldRows.find(row => {
            if (node.type === 'command') {
                const intersectionY = row.y + (row.rowHeight - row.maxCommandHeight);
                return Math.abs(node.position.y - intersectionY) <= SNAP_TOLERANCE;
            } else {
                // data nodes: проверяем все слоты данных
                const dataUnitHeight = config.dataNodeHeight + config.dataNodeGap;
                for (let dataRowIdx = 0; dataRowIdx < row.maxDataPorts; dataRowIdx++) {
                    const dataY = row.y + (row.rowHeight - row.maxCommandHeight) - (dataRowIdx + 1) * dataUnitHeight;
                    if (Math.abs(node.position.y - dataY) <= SNAP_TOLERANCE) {
                        return true;
                    }
                }
                return false;
            }
        });

        if (!oldRow) return node; // нода не примагничена — не трогаем

        // Ищем соответствующий новый ряд
        // Приоритет: по commandNodeIds (если нода-команда сама в ряду)
        let newRow: GridRow | undefined;
        if (node.type === 'command') {
            newRow = newRowByNodeId.get(node.id);
        }
        // Запасной вариант: по индексу
        if (!newRow) {
            newRow = newRowByIndex.get(oldRow.index);
        }

        if (!newRow) return node;

        if (node.type === 'command') {
            const newIntersectionY = newRow.y + (newRow.rowHeight - newRow.maxCommandHeight);
            return { ...node, position: { ...node.position, y: newIntersectionY } };
        } else {
            // Для data node — определяем номер слота в старом ряду
            const dataUnitHeight = config.dataNodeHeight + config.dataNodeGap;
            for (let dataRowIdx = 0; dataRowIdx < oldRow.maxDataPorts; dataRowIdx++) {
                const oldDataY = oldRow.y + (oldRow.rowHeight - oldRow.maxCommandHeight) - (dataRowIdx + 1) * dataUnitHeight;
                if (Math.abs(node.position.y - oldDataY) <= SNAP_TOLERANCE) {
                    // Тот же слот в новом ряду
                    const newDataY = newRow.y + (newRow.rowHeight - newRow.maxCommandHeight) - (dataRowIdx + 1) * dataUnitHeight;
                    return { ...node, position: { ...node.position, y: newDataY } };
                }
            }
            return node;
        }
    });
}

/**
 * Пересчитывает строки сетки и синхронно обновляет позиции примагниченных нод
 */
function recalculateAndSnap(
    nodes: NodeInstance[],
    connections: Connection[],
    config: MagneticGridConfig,
    nodeDefinitions: NodeDefinition[],
    dataTypes: DataType[],
    oldRows: GridRow[]
): { gridRows: GridRow[]; nodes: NodeInstance[] } {
    const newRows = recalculateGridRows(nodes, connections, config, nodeDefinitions, dataTypes);
    const snappedNodes = snapMagneticNodes(nodes, oldRows, newRows, config);
    // Пересчитываем строки ещё раз с обновлёнными позициями нод (на случай если command node сдвинулась в другую группу)
    const midRows = recalculateGridRows(snappedNodes, connections, config, nodeDefinitions, dataTypes);

    // Гарантия: у каждой command-ноды и так уже точно известно, в каком ряду она
    // состоит (commandNodeIds), поэтому дожимаем её ровно на линию этого ряда —
    // без этого нода, для которой snapMagneticNodes не нашёл совпадения со старым
    // рядом (например, только что перекинутая в пересчитанный/сдвинувшийся ряд),
    // так и осталась бы "подвешенной" между линиями.
    const rowByNodeId = new Map<string, GridRow>();
    midRows.forEach(row => row.commandNodeIds.forEach(id => rowByNodeId.set(id, row)));
    const alignedNodes = snappedNodes.map(node => {
        if (node.type !== 'command') return node;
        const row = rowByNodeId.get(node.id);
        if (!row) return node;
        const intersectionY = row.y + (row.rowHeight - row.maxCommandHeight);
        return node.position.y === intersectionY ? node : { ...node, position: { ...node.position, y: intersectionY } };
    });

    const finalRows = recalculateGridRows(alignedNodes, connections, config, nodeDefinitions, dataTypes);
    return { gridRows: finalRows, nodes: alignedNodes };
}

function recalculateGridRows(
    nodes: NodeInstance[] = [],                  // защита от undefined nodes
    connections: Connection[] = [],
    config: MagneticGridConfig,
    nodeDefinitions: NodeDefinition[] = [],
    _dataTypes?: DataType[]
): GridRow[] {
    // Защита от некорректного config
    const safeConfig = {
        ...config,
        dataNodeHeight: Number(config?.dataNodeHeight) || 86,
        dataNodeGap: Number(config?.dataNodeGap) || 12,
        verticalGap: Number(config?.verticalGap) || 50
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
            const count = getDataPortCount(cmdNode?.id, nodes, connections, nodeDefinitions, _dataTypes || []);
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
 * Раскладывает произвольные ноды (напр. только что импортированные дизассемблером)
 * по реальным линиям магнитной сетки — тем же rowY/columnX, что использует ручное
 * перетаскивание (findNearestGridPoint), учитывая фактическую высоту ряда (кол-во
 * data-портов у команд в нём). Row-группировка нод сохраняется (кластеризация по Y
 * с допуском 50px в recalculateGridRows), меняются только точные координаты.
 */
export function snapNodesToMagneticGrid(
    nodes: NodeInstance[],
    connections: Connection[],
    config: MagneticGridConfig,
    nodeDefinitions: NodeDefinition[],
    dataTypes: DataType[]
): NodeInstance[] {
    const rows = recalculateGridRows(nodes, connections, config, nodeDefinitions, dataTypes);
    const rowByNodeId = new Map<string, GridRow>();
    rows.forEach(row => row.commandNodeIds.forEach(id => rowByNodeId.set(id, row)));

    return nodes.map(node => {
        if (node.type !== 'command') return node;
        const row = rowByNodeId.get(node.id);
        if (!row) return node;

        const y = row.y + (row.rowHeight - row.maxCommandHeight);
        const nearestCol = Math.round((node.position.x + 75) / config.commandColumnSpacing);
        const x = nearestCol * config.commandColumnSpacing - 75;

        return { ...node, position: { x, y } };
    });
}

/**
 * Подсчитывает количество data портов у команды
 */
function getDataPortCount(
    commandId: string,
    nodes: NodeInstance[],
    _connections: Connection[],
    nodeDefinitions: NodeDefinition[],
    _dataTypes: DataType[]
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
    config: MagneticGridConfig,
    draggedPortCount: number = 0
): { point: Position; distance: number; col: number; row: number; rowCommandNodeIds: string[] } | null {
    if (gridRows.length === 0) return null;

    let nearest: { point: Position; distance: number; col: number; row: number; rowCommandNodeIds: string[] } | null = null;
    const dataUnitHeight = config.dataNodeHeight + config.dataNodeGap;

    if (nodeType === 'command') {
        // Для команд: привязка к пересечениям вертикальных и горизонтальных линий
        // Центр верха node привязывается к точке пересечения

        // Вертикальные колонки: 0, 350, 700, 1050, ...
        const columns = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => i * config.commandColumnSpacing);

        gridRows.forEach((row, rowIndex) => {
            // Ряд должен резервировать место под data-порты и уже стоящих там нод,
            // и переносимой — иначе после commit/recalculateGrid() линия уедет ниже
            // той точки, к которой нода примагнитилась во время перетаскивания.
            const effectiveMaxDataPorts = Math.max(row.maxDataPorts, draggedPortCount);
            const intersectionY = row.y + effectiveMaxDataPorts * dataUnitHeight;

            columns.forEach((colX, colIndex) => {
                // Точка пересечения
                const intersectionX = colX;

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
                        row: rowIndex,
                        // Ноды, уже стоящие в этом ряду (без переносимой — gridRows тут это уже
                        // previewGridRows). На drop их нужно подтянуть на ту же линию, иначе
                        // кластеризация по 50px допуску их не объединит с переносимой нодой.
                        rowCommandNodeIds: row.commandNodeIds
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
                            row: rowIndex,
                            rowCommandNodeIds: []
                        };
                    }
                });
            }
        });
    }

    return nearest;
}