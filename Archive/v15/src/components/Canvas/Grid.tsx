import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';

const GRID_SIZE = 20;

export const Grid: React.FC = () => {
    const { scale, pan } = useEditorStore();

    // Calculate grid coverage based on viewport (simplified for now)
    // We'll trust CSS translate to handle the visual movement, 
    // but the pattern needs to be infinite. 
    // SVG patterns are great for this.

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
            <defs>
                <pattern
                    id="grid-pattern"
                    width={GRID_SIZE * scale}
                    height={GRID_SIZE * scale}
                    patternUnits="userSpaceOnUse"
                    x={pan.x % (GRID_SIZE * scale)}
                    y={pan.y % (GRID_SIZE * scale)}
                >
                    <path
                        d={`M ${GRID_SIZE * scale} 0 L 0 0 0 ${GRID_SIZE * scale}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1}
                    />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-pattern)" />
        </svg>
    );
};
