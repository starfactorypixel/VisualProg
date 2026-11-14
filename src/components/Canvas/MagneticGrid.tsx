import React from 'react';
import { useEditorStore, GridRow, MagneticGridConfig } from '../../store/useEditorStore';

interface StaticGridProps {
    pan: { x: number; y: number };
    scale: number;
    config: MagneticGridConfig;
    displayRows: GridRow[];
    showCommandMagnets: boolean;
    showDataMagnets: boolean;
    draggingPortCount: number;
    isMagnetic: boolean;
}

// Тяжёлая часть сетки (линии/точки/подписи) — на крупном графе это может быть
// несколько тысяч SVG-узлов. Вынесена в memo, чтобы НЕ пересобираться на каждый
// mousemove во время драга: единственное, что реально меняется на каждый тик —
// это isMagnetic (вкл/выкл подсветки точек-кандидатов) и позиция кольца SNAP
// (рисуется отдельно, вне этого компонента, в MagneticGrid). Ряды/колонки/конфиг
// стабильны на протяжении всего перетаскивания, поэтому React.memo гасит
// перерисовку на подавляющем большинстве тиков.
const StaticMagneticGrid = React.memo<StaticGridProps>(({
    pan, scale, config, displayRows, showCommandMagnets, showDataMagnets, draggingPortCount, isMagnetic
}) => {
    const { commandColumnSpacing, dataColumnOffset, magnetRadius } = config;

    const viewportWidth = window.innerWidth / scale;
    const viewportHeight = window.innerHeight / scale;
    const startX = -pan.x / scale - viewportWidth;
    const startY = -pan.y / scale - viewportHeight;
    const endX = startX + viewportWidth * 3;
    const endY = startY + viewportHeight * 3;

    const commandColumns: number[] = [];
    const startCol = Math.floor(startX / commandColumnSpacing);
    const endCol = Math.ceil(endX / commandColumnSpacing);
    for (let i = startCol; i <= endCol; i++) {
        commandColumns.push(i * commandColumnSpacing);
    }
    const dataColumns = commandColumns.map(x => x - dataColumnOffset);
    const dataUnitHeight = config.dataNodeHeight + config.dataNodeGap;

    return (
        <>
            {/* Вертикальные линии команд */}
            {commandColumns.map((x, i) => (
                <line
                    key={`cmd-col-${i}`}
                    x1={x} y1={startY} x2={x} y2={endY}
                    stroke="rgba(59, 130, 246, 0.4)"
                    strokeWidth={2}
                    strokeDasharray="10,5"
                />
            ))}

            {/* Вертикальные линии данных */}
            {dataColumns.map((x, i) => (
                <line
                    key={`data-col-${i}`}
                    x1={x} y1={startY} x2={x} y2={endY}
                    stroke="rgba(34, 197, 94, 0.4)"
                    strokeWidth={1.5}
                    strokeDasharray="5,5"
                />
            ))}

            {/* Горизонтальные линии команд (адаптивные) */}
            {displayRows.map((row) => {
                const effectiveMaxDataPorts = Math.max(row.maxDataPorts, draggingPortCount);
                const extraPorts = effectiveMaxDataPorts - row.maxDataPorts;
                const intersectionY = row.y + effectiveMaxDataPorts * dataUnitHeight;
                const previewRowHeight = row.rowHeight + extraPorts * dataUnitHeight;

                return (
                    <g key={`row-group-${row.index}`}>
                        <rect
                            x={startX}
                            y={row.y}
                            width={endX - startX}
                            height={previewRowHeight}
                            fill="rgba(156, 163, 175, 0.03)"
                            stroke="rgba(156, 163, 175, 0.2)"
                            strokeWidth={1}
                        />
                        <g key={`row-${row.index}`}>
                            <line
                                x1={startX} y1={intersectionY} x2={endX} y2={intersectionY}
                                stroke="rgba(156, 163, 175, 0.3)"
                                strokeWidth={2}
                            />

                            <text
                                x={startX + 10}
                                y={intersectionY - 5}
                                fill="rgba(156, 163, 175, 0.5)"
                                fontSize="10"
                                fontFamily="monospace"
                            >
                                Row {row.index} (ports: {row.maxDataPorts}{extraPorts > 0 ? ` → ${effectiveMaxDataPorts}` : ''})
                            </text>

                            {commandColumns.map((x, colIdx) => (
                                <g key={`intersection-cmd-${row.index}-${colIdx}`}>
                                    {showCommandMagnets && !isMagnetic && (
                                        <circle
                                            cx={x} cy={intersectionY}
                                            r={magnetRadius}
                                            fill="url(#magnet-glow)"
                                            opacity={0.9}
                                        />
                                    )}

                                    <circle
                                        cx={x} cy={intersectionY}
                                        r={4}
                                        fill="rgba(59, 130, 246, 0.6)"
                                        stroke="white"
                                        strokeWidth={1}
                                    />

                                    <line x1={x - 6} y1={intersectionY} x2={x + 6} y2={intersectionY} stroke="white" strokeWidth={1} opacity={0.5} />
                                    <line x1={x} y1={intersectionY - 6} x2={x} y2={intersectionY + 6} stroke="white" strokeWidth={1} opacity={0.5} />
                                </g>
                            ))}

                            {Array.from({ length: effectiveMaxDataPorts }).map((_, dataRowIdx) => {
                                const dataY = intersectionY - (dataRowIdx + 1) * dataUnitHeight;
                                const isPreviewSlot = dataRowIdx >= row.maxDataPorts;

                                return (
                                    <g key={`data-row-${row.index}-${dataRowIdx}`}>
                                        <line
                                            x1={startX} y1={dataY} x2={endX} y2={dataY}
                                            stroke={isPreviewSlot ? "rgba(59, 130, 246, 0.35)" : "rgba(34, 197, 94, 0.2)"}
                                            strokeWidth={1}
                                            strokeDasharray="3,3"
                                        />

                                        {dataColumns.map((x, colIdx) => (
                                            <g key={`intersection-data-${row.index}-${dataRowIdx}-${colIdx}`}>
                                                {showDataMagnets && !isMagnetic && (
                                                    <circle
                                                        cx={x} cy={dataY}
                                                        r={magnetRadius}
                                                        fill="url(#magnet-glow)"
                                                        opacity={0.9}
                                                    />
                                                )}

                                                <circle
                                                    cx={x} cy={dataY}
                                                    r={3}
                                                    fill={isPreviewSlot ? "rgba(59, 130, 246, 0.6)" : "rgba(34, 197, 94, 0.5)"}
                                                    stroke="white"
                                                    strokeWidth={0.5}
                                                    strokeDasharray={isPreviewSlot ? "2,1" : undefined}
                                                />
                                            </g>
                                        ))}
                                    </g>
                                );
                            })}
                        </g>
                    </g>
                );
            })}
        </>
    );
});
StaticMagneticGrid.displayName = 'StaticMagneticGrid';

export const MagneticGrid: React.FC = () => {
    const { scale, pan, magneticGridMode, magneticGridConfig, gridRows, draggingState } = useEditorStore();

    if (!magneticGridMode) return null;

    const { magnetRadius } = magneticGridConfig;

    const draggingType = draggingState?.nodeType;
    const showCommandMagnets = draggingType === 'command';
    const showDataMagnets = draggingType === 'data';
    // Сколько data-портов у переносимой command-ноды — используется, чтобы точка
    // и линия ряда сразу показывали место, которое реально резервируется под неё
    const draggingPortCount = showCommandMagnets ? (draggingState?.dataPortCount ?? 0) : 0;
    // Пока тащим command-ноду — рисуем сетку так, будто она уже покинула свой исходный
    // ряд (иначе исходный ряд визуально остаётся старого, "растянутого из-за неё" размера,
    // хотя после drop он схлопнется и всё ниже сдвинется)
    const displayRows = (showCommandMagnets && draggingState?.previewGridRows)
        ? draggingState.previewGridRows
        : gridRows;
    const isMagnetic = !!draggingState?.isMagnetic;

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
                {/* Градиент для зоны магнита */}
                <radialGradient id="magnet-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(59, 130, 246, 0.3)" />
                    <stop offset="70%" stopColor="rgba(59, 130, 246, 0.1)" />
                    <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                </radialGradient>
            </defs>

            <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                <StaticMagneticGrid
                    pan={pan}
                    scale={scale}
                    config={magneticGridConfig}
                    displayRows={displayRows}
                    showCommandMagnets={showCommandMagnets}
                    showDataMagnets={showDataMagnets}
                    draggingPortCount={draggingPortCount}
                    isMagnetic={isMagnetic}
                />

                {/* Индикатор магнитного состояния — лёгкий, обновляется каждый тик отдельно от статики выше */}
                {draggingState && draggingState.isMagnetic && draggingState.magneticPosition && (
                    <g>
                        {/* Пульсирующее кольцо */}
                        <circle
                            cx={draggingState.magneticPosition.x + 75}
                            cy={draggingState.magneticPosition.y}
                            r={magnetRadius}
                            fill="none"
                            stroke="rgba(59, 130, 246, 0.8)"
                            strokeWidth={3}
                        >
                            <animate
                                attributeName="r"
                                values={`${magnetRadius};${magnetRadius + 10};${magnetRadius}`}
                                dur="1s"
                                repeatCount="indefinite"
                            />
                            <animate
                                attributeName="opacity"
                                values="0.8;0.3;0.8"
                                dur="1s"
                                repeatCount="indefinite"
                            />
                        </circle>

                        {/* Индикатор "примагничено" */}
                        <text
                            x={draggingState.magneticPosition.x + 75}
                            y={draggingState.magneticPosition.y - magnetRadius - 10}
                            fill="rgba(59, 130, 246, 1)"
                            fontSize="12"
                            fontWeight="bold"
                            textAnchor="middle"
                        >
                            SNAP
                        </text>
                    </g>
                )}
            </g>
        </svg>
    );
};
