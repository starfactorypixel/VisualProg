import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DockSide = 'left' | 'right' | 'top' | 'bottom' | 'float';

export interface PanelLayout {
    dock: DockSide;
    size: number;                                  // ширина (left/right) или высота (top/bottom) в доке
    floatPos: { x: number; y: number };
    floatSize: { width: number; height: number };
    zIndex: number;
}

interface PanelLayoutState {
    panels: Record<string, PanelLayout>;
    topZIndex: number;
    dragPreviewDock: DockSide | null;

    ensurePanel: (id: string, defaults: PanelLayout) => void;
    setDock: (id: string, dock: DockSide) => void;
    setSize: (id: string, size: number) => void;
    setFloatPos: (id: string, pos: { x: number; y: number }) => void;
    setFloatSize: (id: string, size: { width: number; height: number }) => void;
    bringToFront: (id: string) => void;
    setDragPreviewDock: (dock: DockSide | null) => void;
}

export const usePanelLayoutStore = create<PanelLayoutState>()(
    persist(
        (set, get) => ({
            panels: {},
            topZIndex: 100,
            dragPreviewDock: null,

            ensurePanel: (id, defaults) => {
                if (get().panels[id]) return;
                set(state => ({ panels: { ...state.panels, [id]: defaults } }));
            },

            setDock: (id, dock) => set(state => {
                const panel = state.panels[id];
                if (!panel) return state;
                return { panels: { ...state.panels, [id]: { ...panel, dock } } };
            }),

            setSize: (id, size) => set(state => {
                const panel = state.panels[id];
                if (!panel) return state;
                return { panels: { ...state.panels, [id]: { ...panel, size } } };
            }),

            setFloatPos: (id, floatPos) => set(state => {
                const panel = state.panels[id];
                if (!panel) return state;
                return { panels: { ...state.panels, [id]: { ...panel, floatPos } } };
            }),

            setFloatSize: (id, floatSize) => set(state => {
                const panel = state.panels[id];
                if (!panel) return state;
                return { panels: { ...state.panels, [id]: { ...panel, floatSize } } };
            }),

            bringToFront: (id) => set(state => {
                const panel = state.panels[id];
                if (!panel) return state;
                const topZIndex = state.topZIndex + 1;
                return { topZIndex, panels: { ...state.panels, [id]: { ...panel, zIndex: topZIndex } } };
            }),

            setDragPreviewDock: (dock) => set({ dragPreviewDock: dock }),
        }),
        { name: 'visualprog-panel-layout' }
    )
);
