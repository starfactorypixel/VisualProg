import React, { useEffect, useRef } from 'react';

interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    items: { label: string; action: () => void; danger?: boolean }[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, items }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="fixed z-50 bg-neutral-800 border border-neutral-700 shadow-xl rounded py-1 min-w-[120px]"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item, i) => (
                <div
                    key={i}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-neutral-700 ${item.danger ? 'text-red-400' : 'text-neutral-200'}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        item.action();
                        onClose();
                    }}
                >
                    {item.label}
                </div>
            ))}
        </div>
    );
};
