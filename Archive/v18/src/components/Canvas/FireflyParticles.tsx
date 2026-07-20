import React, { useRef, useEffect } from 'react';

export interface FireflyParticle {
    progress: number;
    speed: number;
    size: number;
    opacity: number;
    id: number;
}

export interface FireflyConfig {
    color: string;
    particleCount: number;
    minSpeed: number;
    maxSpeed: number;
    minSize: number;
    maxSize: number;
}

export interface FireflyParticlesProps {
    path: string;
    config: FireflyConfig;
    targetFPS?: number;
    paused?: boolean;
}

export const FireflyParticles: React.FC<FireflyParticlesProps> = ({
    path,
    config,
    targetFPS = 24,
    paused = false
}) => {
    // Если FPS = 0, не рендерим ничего
    if (targetFPS === 0) {
        return null;
    }
    
    const pathRef = useRef<SVGPathElement | null>(null);
    const groupRef = useRef<SVGGElement | null>(null);
    const circlesRef = useRef<SVGCircleElement[]>([]);
    const particlesRef = useRef<FireflyParticle[]>([]);
    const animationRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(0);
    const frameIntervalRef = useRef<number>(1000 / targetFPS);

    // Инициализация частиц
    useEffect(() => {
        if (!groupRef.current) return;

        groupRef.current.innerHTML = '';
        circlesRef.current = [];
        particlesRef.current = [];

        const frameInterval = 1000 / targetFPS;
        frameIntervalRef.current = frameInterval;

        for (let i = 0; i < config.particleCount; i++) {
            const size = config.minSize + Math.random() * (config.maxSize - config.minSize);
            const opacity = 0.6 + Math.random() * 0.4;
            
            particlesRef.current.push({
                progress: i / config.particleCount,
                speed: (config.minSpeed + config.maxSpeed) / 2,
                size,
                opacity,
                id: i
            });

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', String(size));
            circle.setAttribute('fill', config.color);
            circle.setAttribute('fill-opacity', String(opacity));
            circle.setAttribute('filter', `drop-shadow(0 0 ${size}px ${config.color})`);
            
            groupRef.current.appendChild(circle);
            circlesRef.current.push(circle);
        }

        return () => {
            if (groupRef.current) {
                groupRef.current.innerHTML = '';
            }
            circlesRef.current = [];
        };
    }, [path, config.particleCount, config.color, config.minSpeed, config.maxSpeed, config.minSize, config.maxSize, targetFPS]);

    // Анимация
    useEffect(() => {
        if (paused || targetFPS === 0) {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
            return;
        }

        const animate = (timestamp: number) => {
            if (!pathRef.current || particlesRef.current.length === 0) {
                animationRef.current = requestAnimationFrame(animate);
                return;
            }

            const elapsed = timestamp - lastTimeRef.current;
            
            if (elapsed >= frameIntervalRef.current) {
                lastTimeRef.current = timestamp - (elapsed % frameIntervalRef.current);
                
                const pathElement = pathRef.current;
                const pathLength = pathElement.getTotalLength();
                
                if (pathLength > 0) {
                    const deltaTime = 1 / targetFPS;

                    particlesRef.current.forEach((particle, index) => {
                        particle.progress += particle.speed * deltaTime;
                        if (particle.progress > 1) {
                            particle.progress -= 1;
                        }

                        const point = pathElement.getPointAtLength(particle.progress * pathLength);
                        const circle = circlesRef.current[index];
                        
                        if (circle) {
                            circle.setAttribute('cx', String(point.x));
                            circle.setAttribute('cy', String(point.y));
                        }
                    });
                }
            }

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [paused, path, targetFPS]);

    return (
        <g ref={groupRef}>
            <path
                ref={pathRef}
                d={path}
                stroke="none"
                fill="none"
            />
        </g>
    );
};

export const MemoizedFireflyParticles = React.memo(FireflyParticles, (prevProps, nextProps) => {
    return (
        prevProps.path === nextProps.path &&
        prevProps.config.color === nextProps.config.color &&
        prevProps.config.particleCount === nextProps.config.particleCount &&
        prevProps.targetFPS === nextProps.targetFPS &&
        prevProps.paused === nextProps.paused
    );
});
