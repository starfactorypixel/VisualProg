import React, { useMemo } from 'react';
import { useEditorStore } from '../../store/useEditorStore';

const VIEWPORT_MARGIN = 200;

export const MagneticGrid: React.FC = () => {
    const { scale, pan, magneticGridMode, magneticGridConfig, gridRows, draggingState } = useEditorStore();

    if (!magneticGridMode) return null;

    const { commandColumnSpacing, dataColumnOffset } = magneticGridConfig;

    // Рассчитываем видимую область с запасом
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const visibleBounds = useMemo(() => {
        const worldLeft = -pan.x / scale - VIEWPORT_MARGIN / scale;
        const worldTop = -pan.y / scale - VIEWPORT_MARGIN / scale;
        const worldRight = (viewportWidth - pan.x) / scale + VIEWPORT_MARGIN / scale;
        const worldBottom = (viewportHeight - pan.y) / scale + VIEWPORT_MARGIN / scale;
        return { x1: worldLeft, y1: worldTop, x2: worldRight, y2: worldBottom };
    }, [pan, scale, viewportWidth, viewportHeight]);

    const draggingType = draggingState?.nodeType;
    const showCommandMagnets = draggingType === 'command';
    const showDataMagnets = draggingType === 'data';

    // Вертикальные линии команд - только видимые
    const visibleCommandColumns = useMemo(() => {
        const columns: number[] = [];
        const startCol = Math.floor(visibleBounds.x1 / commandColumnSpacing);
        const endCol = Math.ceil(visibleBounds.x2 / commandColumnSpacing);
        for (let i = startCol; i <= endCol; i++) {
            columns.push(i * commandColumnSpacing);
        }
        return columns;
    }, [visibleBounds.x1, visibleBounds.x2, commandColumnSpacing]);

    // Вертикальные линии данных - только видимые
    const visibleDataColumns = useMemo(() => {
        return visibleCommandColumns.map(x => x - dataColumnOffset);
    }, [visibleCommandColumns, dataColumnOffset]);

    // Видимые ряды - только те, что попадают в viewport
    const visibleRows = useMemo(() => {
        return gridRows.filter(row => {
            const rowTop = row.y;
            const rowBottom = row.y + row.rowHeight;
            return rowBottom >= visibleBounds.y1 && rowTop <= visibleBounds.y2;
        });
    }, [gridRows, visibleBounds.y1, visibleBounds.y2]);

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                {/* Вертикальные линии команд - только видимые */}
                {visibleCommandColumns.map((x, i) => (
                    <line
                        key={`cmd-col-${i}`}
                        x1={x}
                        y1={visibleBounds.y1}
                        x2={x}
                        y2={visibleBounds.y2}
                        stroke="rgba(59, 130, 246, 0.3)"
                        strokeWidth={1}
                        strokeDasharray="8,4"
                    />
                ))}

                {/* Вертикальные линии данных - только видимые */}
                {visibleDataColumns.map((x, i) => (
                    <line
                        key={`data-col-${i}`}
                        x1={x}
                        y1={visibleBounds.y1}
                        x2={x}
                        y2={visibleBounds.y2}
                        stroke="rgba(34, 197, 94, 0.25)"
                        strokeWidth={1}
                        strokeDasharray="4,4"
                    />
                ))}

                {/* Горизонтальные линии команд - только видимые ряды */}
                {visibleRows.map((row) => (
                  <g key={`row-group-${row.index}`}>
						<g key={`row-${row.index}`}>
							{/* Основная горизонтальная линия */}
							<line
								x1={visibleBounds.x1}
								y1={row.y + (row.rowHeight - row.maxCommandHeight)}
								x2={visibleBounds.x2}
								y2={row.y + (row.rowHeight - row.maxCommandHeight)}
								stroke="rgba(156, 163, 175, 0.25)"
								strokeWidth={1.5}
							/>

							{/* Метка высоты ряда - только если не перетаскиваем */}
							{!draggingState && (
								<text
									x={visibleBounds.x1 + 10}
									y={row.y - 5 + (row.rowHeight - row.maxCommandHeight)}
									fill="rgba(156, 163, 175, 0.4)"
									fontSize="10"
									fontFamily="monospace"
								>
									Row {row.index}
								</text>
							)}

							{/* Точки пересечения для команд - только при перетаскивании */}
							{showCommandMagnets && visibleCommandColumns.map((x, colIdx) => (
								<g key={`intersection-cmd-${row.index}-${colIdx}`}>
									{/* Точка привязки */}
									<circle
										cx={x}
										cy={row.y + (row.rowHeight - row.maxCommandHeight)}
										r={3}
										fill="rgba(59, 130, 246, 0.5)"
									/>
								</g>
							))}

							{/* Горизонтальные линии данных (под каждой линией команд) - только видимые */}
							{row.maxDataPorts > 0 && Array.from({ length: row.maxDataPorts }).map((_, dataRowIdx) => {
								const dataUnitHeight = magneticGridConfig.dataNodeHeight + magneticGridConfig.dataNodeGap;
								const dataY = row.y + (row.rowHeight - row.maxCommandHeight) - (dataRowIdx + 1) * dataUnitHeight;

								// Пропускаем невидимые линии данных
								if (dataY < visibleBounds.y1 || dataY > visibleBounds.y2) return null;

								return (
									<g key={`data-row-${row.index}-${dataRowIdx}`}>
										<line
											x1={visibleBounds.x1}
											y1={dataY}
											x2={visibleBounds.x2}
											y2={dataY}
											stroke="rgba(34, 197, 94, 0.15)"
											strokeWidth={1}
											strokeDasharray="4,4"
										/>

										{/* Точки пересечения для данных - только при перетаскивании */}
										{showDataMagnets && visibleDataColumns.map((x, colIdx) => (
											<g key={`intersection-data-${row.index}-${dataRowIdx}-${colIdx}`}>
												<circle
													cx={x}
													cy={dataY}
													r={2.5}
													fill="rgba(34, 197, 94, 0.4)"
												/>
											</g>
										))}
									</g>
								);
							})}
						</g>
					  </g>
                ))}

                {/* Индикатор магнитного состояния - упрощённый */}
                {draggingState && draggingState.isMagnetic && draggingState.magneticPosition && (
                    <g>
                        {/* Индикатор "примагничено" */}
                        <text
                            x={draggingState.magneticPosition.x + 75}
                            y={draggingState.magneticPosition.y - 10}
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
