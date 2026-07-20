/**
 * DragManager — единый координатор ghost-перетаскивания нод.
 *
 * Проблема которую решает:
 *   mousemove стреляет ~60-120 раз/сек. Каждый вызов делал:
 *   - document.querySelector (дорого)
 *   - store.nodes.find() в цикле (O(n²))
 *   - setAttribute на каждый path (форсирует layout)
 *
 * Решение:
 *   - mousemove только пишет координаты в переменную (O(1))
 *   - requestAnimationFrame читает их и делает все DOM-мутации за один проход
 *   - DOM-элементы кешируются на старте drag, не ищутся каждый тик
 *   - Если мышь не двигалась с прошлого кадра — DOM не трогается вовсе
 */

import { useEditorStore } from '../../store/useEditorStore';

type CalcPathFn = (
    conn: { fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string },
    fromPos: { x: number; y: number },
    toPos:   { x: number; y: number },
    fromNode: { type: string; definitionId: string },
    toNode:   { type: string; definitionId: string },
    nodeDefs: any[],
    dataTypes: any[]
) => string | null;

interface DragSession {
    leadNodeId: string;
    movingIds: Set<string>;
    startPos: { x: number; y: number };
    nodeEls: Map<string, HTMLElement>;
    connPaths: Map<string, {
        el: SVGPathElement;
        conn: { fromNodeId: string; fromPortId: string; toNodeId: string; toPortId: string };
        fromNode: { type: string; definitionId: string; position: { x: number; y: number } };
        toNode:   { type: string; definitionId: string; position: { x: number; y: number } };
        fromMoving: boolean;
        toMoving:   boolean;
    }>;
    calcPath: CalcPathFn | null;
}

class DragManagerClass {
    private session: DragSession | null = null;
    private rafId: number | null = null;

    private pendingDx = 0;
    private pendingDy = 0;
    private appliedDx = 0;
    private appliedDy = 0;

    // Устанавливается из Node.tsx перед start() для магнитного snap
    onMove: ((rawDx: number, rawDy: number) => { dx: number; dy: number; isMagnetic: boolean }) | null = null;

    // Регистрируются из ConnectionLayer один раз при маунте
    pathRefs: Map<string, SVGPathElement> = new Map();
    calcPath: CalcPathFn | null = null;

    /**
     * Вызывается из Node.tsx при начале drag.
     * pathRefs и calcPath опциональны — берутся из свойств если не переданы явно.
     */
    start(
        leadNodeId: string,
        movingIds: string[],
        startPos: { x: number; y: number },
        pathRefsArg?: Map<string, SVGPathElement>,
        calcPathArg?: CalcPathFn
    ) {
        this.stop();

        const resolvedPathRefs = pathRefsArg ?? this.pathRefs;
        const resolvedCalcPath = calcPathArg ?? this.calcPath;

        const store = useEditorStore.getState();
        const movingSet = new Set(movingIds);

        // Кешируем DOM-элементы нод
        const nodeEls = new Map<string, HTMLElement>();
        movingIds.forEach(id => {
            const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
            if (el) nodeEls.set(id, el);
        });

        // Кешируем только затронутые связи
        type ConnEntry = DragSession['connPaths'] extends Map<string, infer V> ? V : never;
        const connPaths = new Map<string, ConnEntry>();
        store.connections.forEach(conn => {
            const fromMoving = movingSet.has(conn.fromNodeId);
            const toMoving   = movingSet.has(conn.toNodeId);
            if (!fromMoving && !toMoving) return;

            const el = resolvedPathRefs.get(conn.id);
            if (!el) return;

            const fromNode = store.nodes.find(n => n.id === conn.fromNodeId);
            const toNode   = store.nodes.find(n => n.id === conn.toNodeId);
            if (!fromNode || !toNode) return;

            connPaths.set(conn.id, { el, conn, fromNode, toNode, fromMoving, toMoving });
        });

        this.session = {
            leadNodeId, movingIds: movingSet, startPos,
            nodeEls, connPaths, calcPath: resolvedCalcPath
        };
        this.pendingDx = 0;
        this.pendingDy = 0;
        this.appliedDx = 0;
        this.appliedDy = 0;

        this.rafId = requestAnimationFrame(this.loop);
    }

    /**
     * Вызывается из mousemove — только пишет данные, никаких DOM-мутаций
     */
    update(rawDx: number, rawDy: number) {
        if (!this.session) return;

        if (this.onMove) {
            const snapped = this.onMove(rawDx, rawDy);
            this.pendingDx = snapped.dx;
            this.pendingDy = snapped.dy;
        } else {
            this.pendingDx = rawDx;
            this.pendingDy = rawDy;
        }
    }

    /**
     * rAF-цикл: применяет pending смещение если оно изменилось
     */
    private loop = () => {
        if (!this.session) return;

        if (this.pendingDx !== this.appliedDx || this.pendingDy !== this.appliedDy) {
            const dx = this.pendingDx;
            const dy = this.pendingDy;
            this.appliedDx = dx;
            this.appliedDy = dy;

            const store = useEditorStore.getState();
            const transform = `translate(${dx}px, ${dy}px)`;

            // Двигаем ноды
            this.session.nodeEls.forEach(el => {
                el.style.transform = transform;
            });

            // Двигаем связи
            if (this.session.calcPath) {
                this.session.connPaths.forEach(({ el, conn, fromNode, toNode, fromMoving, toMoving }) => {
                    const fromPos = fromMoving
                        ? { x: fromNode.position.x + dx, y: fromNode.position.y + dy }
                        : fromNode.position;
                    const toPos = toMoving
                        ? { x: toNode.position.x + dx, y: toNode.position.y + dy }
                        : toNode.position;

                    const d = this.session!.calcPath!(
                        conn, fromPos, toPos, fromNode, toNode,
                        store.nodeDefinitions, store.dataTypes
                    );
                    if (d) el.setAttribute('d', d);
                });
            }
        }

        this.rafId = requestAnimationFrame(this.loop);
    };

    /**
     * Вызывается на mouseup — останавливает RAF, сбрасывает transform, возвращает финальное смещение
     */
    stop(): { dx: number; dy: number } {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.session) {
            // Сбрасываем transform нод
            this.session.nodeEls.forEach(el => {
                el.style.transform = '';
            });

            // Сбрасываем path связей в оригинальные позиции (dx=0, dy=0).
            // Это нужно чтобы React не обнаружил расхождение между DOM и vDOM
            // и правильно применил новый d после commit в store.
            if (this.session.calcPath) {
                this.session.connPaths.forEach(({ el, conn, fromNode, toNode }) => {
                    const d = this.session!.calcPath!(
                        conn,
                        fromNode.position,
                        toNode.position,
                        fromNode, toNode,
                        useEditorStore.getState().nodeDefinitions,
                        useEditorStore.getState().dataTypes
                    );
                    if (d) el.setAttribute('d', d);
                });
            }
        }

        // Возвращаем pendingDx/pendingDy — последнее ЖЕЛАЕМОЕ смещение.
        // appliedDx/appliedDy могли отстать если rAF не успел до mouseup.
        const result = { dx: this.pendingDx, dy: this.pendingDy };
        this.session = null;
        this.onMove = null;
        return result;
    }

    isActive() {
        return this.session !== null;
    }

    getCurrentOffset() {
        return { dx: this.appliedDx, dy: this.appliedDy };
    }
}

export const DragManager = new DragManagerClass();