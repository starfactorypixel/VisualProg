/**
 * AnimationManager — единый менеджер тиков для всех бегущих огоньков.
 *
 * Вместо того чтобы каждый SVG-элемент крутил свой animateMotion/requestAnimationFrame,
 * этот синглтон:
 *  - Держит один rAF-цикл на всё приложение
 *  - Обновляет глобальный `tick` с заданным FPS (по умолчанию 30)
 *  - Все подписчики получают один и тот же `tick` — синхронно
 *  - FPS можно снизить до 10-15 для экономии ресурсов
 */

type TickCallback = (tick: number) => void;

class AnimationManagerClass {
    private listeners = new Map<string, TickCallback>();
    private rafId: number | null = null;
    private lastTime = 0;
    private tick = 0;

    /** Текущий FPS (кадров в секунду для огоньков) */
    fps = 30;

    /** Длительность одного цикла огонька в мс */
    cycleDuration = 2000;

    subscribe(id: string, cb: TickCallback): () => void {
        this.listeners.set(id, cb);
        if (this.listeners.size === 1) {
            this.start();
        }
        return () => this.unsubscribe(id);
    }

    unsubscribe(id: string) {
        this.listeners.delete(id);
        if (this.listeners.size === 0) {
            this.stop();
        }
    }

    private start() {
        this.lastTime = performance.now();
        const loop = (now: number) => {
            this.rafId = requestAnimationFrame(loop);
            const interval = 1000 / this.fps;
            if (now - this.lastTime < interval) return;
            this.lastTime = now - ((now - this.lastTime) % interval);

            // tick = [0..1) нормализованное время цикла
            this.tick = (now % this.cycleDuration) / this.cycleDuration;

            this.listeners.forEach(cb => cb(this.tick));
        };
        this.rafId = requestAnimationFrame(loop);
    }

    private stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /** Текущий tick без подписки (для чтения снаружи) */
    getTick() {
        return this.tick;
    }
}

export const AnimationManager = new AnimationManagerClass();