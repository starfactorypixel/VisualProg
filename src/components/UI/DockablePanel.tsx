import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { DockSide, PanelLayout, usePanelLayoutStore } from '../../store/usePanelLayoutStore';

const EDGE_THRESHOLD = 48;
const DRAG_START_THRESHOLD = 5;
const DEFAULT_MIN_SIZE = 160;

function detectEdgeDock(x: number, y: number): DockSide | null {
    if (x <= EDGE_THRESHOLD) return 'left';
    if (x >= window.innerWidth - EDGE_THRESHOLD) return 'right';
    if (y <= EDGE_THRESHOLD) return 'top';
    if (y >= window.innerHeight - EDGE_THRESHOLD) return 'bottom';
    return null;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const ResizeHandle: React.FC<{
    dir: ResizeDir;
    className?: string;
    onPointerDown: (dir: ResizeDir, e: React.PointerEvent) => void;
}> = ({ dir, className, onPointerDown }) => (
    <div
        className={clsx('absolute z-10 hover:bg-blue-500/40 transition-colors', className)}
        onPointerDown={(e) => onPointerDown(dir, e)}
    />
);

export const DockZoneOverlay: React.FC = () => {
    const dock = usePanelLayoutStore(s => s.dragPreviewDock);
    if (!dock) return null;

    const style: React.CSSProperties = {
        position: 'fixed',
        zIndex: 9999,
        background: 'rgba(59,130,246,0.2)',
        border: '2px solid rgba(59,130,246,0.6)',
        pointerEvents: 'none',
    };
    if (dock === 'left') Object.assign(style, { left: 0, top: 0, bottom: 0, width: '25vw' });
    if (dock === 'right') Object.assign(style, { right: 0, top: 0, bottom: 0, width: '25vw' });
    if (dock === 'top') Object.assign(style, { left: 0, right: 0, top: 0, height: '25vh' });
    if (dock === 'bottom') Object.assign(style, { left: 0, right: 0, bottom: 0, height: '25vh' });

    return createPortal(<div style={style} />, document.body);
};

interface DockablePanelProps {
    id: string;
    title: string;
    children: React.ReactNode;
    defaultDock: DockSide;
    defaultSize: number;
    defaultFloatSize: { width: number; height: number };
    defaultFloatPos?: { x: number; y: number };
    minSize?: number;
    maxSize?: number;
    className?: string;
}

export const DockablePanel: React.FC<DockablePanelProps> = ({
    id, title, children, defaultDock, defaultSize, defaultFloatSize, defaultFloatPos, minSize = DEFAULT_MIN_SIZE, maxSize, className,
}) => {
    const defaults: PanelLayout = {
        dock: defaultDock,
        size: defaultSize,
        floatPos: defaultFloatPos || { x: 140, y: 140 },
        floatSize: defaultFloatSize,
        zIndex: 100,
    };

    const panel = usePanelLayoutStore(s => s.panels[id]) || defaults;
    const ensurePanel = usePanelLayoutStore(s => s.ensurePanel);
    const setDock = usePanelLayoutStore(s => s.setDock);
    const setSize = usePanelLayoutStore(s => s.setSize);
    const setFloatPos = usePanelLayoutStore(s => s.setFloatPos);
    const setFloatSize = usePanelLayoutStore(s => s.setFloatSize);
    const bringToFront = usePanelLayoutStore(s => s.bringToFront);
    const setDragPreviewDock = usePanelLayoutStore(s => s.setDragPreviewDock);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { ensurePanel(id, defaults); }, [id]);

    const rootRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const clampFloatPos = (x: number, y: number) => ({
        x: Math.min(Math.max(x, -40), window.innerWidth - 80),
        y: Math.min(Math.max(y, 0), window.innerHeight - 32),
    });

    const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        bringToFront(id);

        const startX = e.clientX;
        const startY = e.clientY;
        const startDock = panel.dock;
        const rect = rootRef.current?.getBoundingClientRect();
        const startFloatPos = startDock === 'float'
            ? panel.floatPos
            : { x: rect?.left ?? startX - 20, y: rect?.top ?? startY - 20 };
        const startFloatSize = startDock === 'float'
            ? panel.floatSize
            : { width: rect?.width ?? panel.floatSize.width, height: rect?.height ?? panel.floatSize.height };

        let dragStarted = false;
        let pendingDock: DockSide | null = null;

        const handleMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            if (!dragStarted) {
                if (Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;
                dragStarted = true;
                setIsDragging(true);
                if (startDock !== 'float') {
                    setFloatSize(id, startFloatSize);
                    setDock(id, 'float');
                }
            }

            setFloatPos(id, clampFloatPos(startFloatPos.x + dx, startFloatPos.y + dy));

            const edge = detectEdgeDock(ev.clientX, ev.clientY);
            pendingDock = edge;
            setDragPreviewDock(edge);
        };

        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            setIsDragging(false);
            setDragPreviewDock(null);
            if (dragStarted && pendingDock) {
                setDock(id, pendingDock);
            }
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, panel, bringToFront, setDock, setFloatPos, setFloatSize, setDragPreviewDock]);

    const handleResizePointerDown = useCallback((direction: ResizeDir, e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        bringToFront(id);

        const startX = e.clientX;
        const startY = e.clientY;
        const isFloat = panel.dock === 'float';
        const startSize = panel.size;
        const startFloatPos = panel.floatPos;
        const startFloatSize = panel.floatSize;

        const handleMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            if (!isFloat) {
                let next = startSize;
                if (direction === 'e') next = startSize + dx;
                else if (direction === 'w') next = startSize - dx;
                else if (direction === 's') next = startSize + dy;
                else if (direction === 'n') next = startSize - dy;
                next = Math.max(minSize, maxSize ? Math.min(next, maxSize) : next);
                setSize(id, next);
                return;
            }

            let x = startFloatPos.x;
            let y = startFloatPos.y;
            let width = startFloatSize.width;
            let height = startFloatSize.height;

            if (direction.includes('e')) width = Math.max(minSize, startFloatSize.width + dx);
            if (direction.includes('s')) height = Math.max(minSize, startFloatSize.height + dy);
            if (direction.includes('w')) {
                width = Math.max(minSize, startFloatSize.width - dx);
                x = startFloatPos.x + (startFloatSize.width - width);
            }
            if (direction.includes('n')) {
                height = Math.max(minSize, startFloatSize.height - dy);
                y = startFloatPos.y + (startFloatSize.height - height);
            }

            setFloatSize(id, { width, height });
            if (direction.includes('w') || direction.includes('n')) setFloatPos(id, { x, y });
        };

        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, panel, minSize, maxSize, setSize, setFloatPos, setFloatSize, bringToFront]);

    const isFloat = panel.dock === 'float';

    const style: React.CSSProperties = isFloat
        ? {
            position: 'fixed',
            left: panel.floatPos.x,
            top: panel.floatPos.y,
            width: panel.floatSize.width,
            height: panel.floatSize.height,
            zIndex: panel.zIndex,
        }
        : panel.dock === 'left' || panel.dock === 'right'
            ? { width: panel.size, flex: '1 1 0%', minHeight: 0 }
            : { height: panel.size, flex: '1 1 0%', minWidth: 0 };

    const content = (
        <div
            ref={rootRef}
            className={clsx(
                'relative flex flex-col bg-neutral-900 min-w-0 min-h-0',
                isFloat && 'rounded-lg border border-neutral-700 shadow-2xl overflow-hidden',
                isDragging && 'opacity-60',
                className
            )}
            style={style}
            onPointerDownCapture={() => bringToFront(id)}
        >
            <div
                className="h-7 shrink-0 flex items-center gap-1.5 px-2 bg-neutral-800 border-b border-neutral-700 cursor-grab active:cursor-grabbing select-none"
                onPointerDown={handleHeaderPointerDown}
            >
                <svg className="w-3 h-3 text-neutral-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="8" cy="6" r="1.5" /><circle cx="16" cy="6" r="1.5" />
                    <circle cx="8" cy="12" r="1.5" /><circle cx="16" cy="12" r="1.5" />
                    <circle cx="8" cy="18" r="1.5" /><circle cx="16" cy="18" r="1.5" />
                </svg>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 truncate">{title}</span>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
                {children}
            </div>

            {isFloat ? (
                <>
                    <ResizeHandle dir="e" onPointerDown={handleResizePointerDown} className="top-0 right-0 w-1.5 h-full cursor-ew-resize" />
                    <ResizeHandle dir="w" onPointerDown={handleResizePointerDown} className="top-0 left-0 w-1.5 h-full cursor-ew-resize" />
                    <ResizeHandle dir="s" onPointerDown={handleResizePointerDown} className="bottom-0 left-0 h-1.5 w-full cursor-ns-resize" />
                    <ResizeHandle dir="n" onPointerDown={handleResizePointerDown} className="top-0 left-0 h-1.5 w-full cursor-ns-resize" />
                    <ResizeHandle dir="se" onPointerDown={handleResizePointerDown} className="bottom-0 right-0 w-3 h-3 cursor-nwse-resize" />
                    <ResizeHandle dir="sw" onPointerDown={handleResizePointerDown} className="bottom-0 left-0 w-3 h-3 cursor-nesw-resize" />
                    <ResizeHandle dir="ne" onPointerDown={handleResizePointerDown} className="top-0 right-0 w-3 h-3 cursor-nesw-resize" />
                    <ResizeHandle dir="nw" onPointerDown={handleResizePointerDown} className="top-0 left-0 w-3 h-3 cursor-nwse-resize" />
                </>
            ) : panel.dock === 'left' ? (
                <ResizeHandle dir="e" onPointerDown={handleResizePointerDown} className="top-0 right-0 w-1.5 h-full cursor-ew-resize" />
            ) : panel.dock === 'right' ? (
                <ResizeHandle dir="w" onPointerDown={handleResizePointerDown} className="top-0 left-0 w-1.5 h-full cursor-ew-resize" />
            ) : panel.dock === 'top' ? (
                <ResizeHandle dir="s" onPointerDown={handleResizePointerDown} className="bottom-0 left-0 h-1.5 w-full cursor-ns-resize" />
            ) : (
                <ResizeHandle dir="n" onPointerDown={handleResizePointerDown} className="top-0 left-0 h-1.5 w-full cursor-ns-resize" />
            )}
        </div>
    );

    if (isFloat) {
        return createPortal(content, document.body);
    }
    return content;
};
