import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';

export const MagneticGrid: React.FC = () => {
    const { scale, pan, magneticGridMode, magneticGridConfig, gridRows, draggingState } = useEditorStore();

    if (!magneticGridMode) return null;

    const { commandColumnSpacing, dataColumnOffset, magnetRadius } = magneticGridConfig;

    // Рассчитываем видимую область
    const viewportWidth = window.innerWidth / scale;
    const viewportHeight = window.innerHeight / scale;
    const startX = -pan.x / scale - viewportWidth;
    const startY = -pan.y / scale - viewportHeight;
    const endX = startX + viewportWidth * 3;
    const endY = startY + viewportHeight * 3;

    // Вертикальные линии команд
    const commandColumns: number[] = [];
    const startCol = Math.floor(startX / commandColumnSpacing);
    const endCol = Math.ceil(endX / commandColumnSpacing);

    const draggingType = draggingState?.nodeType;
    const showCommandMagnets = draggingType === 'command';
    const showDataMagnets = draggingType === 'data';

    for (let i = startCol; i <= endCol; i++) {
        commandColumns.push(i * commandColumnSpacing);
    }

    // Вертикальные линии данных (смещены влево)
    const dataColumns = commandColumns.map(x => x - dataColumnOffset);

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
                {/* Вертикальные линии команд */}
                {commandColumns.map((x, i) => (
                    <line
                        key={`cmd-col-${i}`}
                        x1={x}
                        y1={startY}
                        x2={x}
                        y2={endY}
                        stroke="rgba(59, 130, 246, 0.4)"
                        strokeWidth={2}
                        strokeDasharray="10,5"
                    />
                ))}

                {/* Вертикальные линии данных */}
                {dataColumns.map((x, i) => (
                    <line
                        key={`data-col-${i}`}
                        x1={x}
                        y1={startY}
                        x2={x}
                        y2={endY}
                        stroke="rgba(34, 197, 94, 0.4)"
                        strokeWidth={1.5}
                        strokeDasharray="5,5"
                    />
                ))}

                {/* Горизонтальные линии команд (адаптивные) */}
                {gridRows.map((row) => (
				  <g key={`row-group-${row.index}`}>
					{/* Фон ячейки (аналог div с display: block) */}
					<rect
					  x={startX}
					  y={row.y}
					  width={endX - startX}
					  height={row.rowHeight}
					  fill="rgba(156, 163, 175, 0.03)" // Очень бледный фон для визуализации ячейки
					  stroke="rgba(156, 163, 175, 0.2)"
					  strokeWidth={1}
					/>
						<g key={`row-${row.index}`}>
							{/* Основная горизонтальная линия */}
							<line
								x1={startX}
								y1={row.y + (row.rowHeight - row.maxCommandHeight)}
								x2={endX}
								y2={row.y + (row.rowHeight - row.maxCommandHeight)}
								stroke="rgba(156, 163, 175, 0.3)"
								strokeWidth={2}
							/>
							
							{/* Метка высоты ряда */}
							<text
								x={startX + 10}
								y={row.y - 5  + (row.rowHeight - row.maxCommandHeight)}
								fill="rgba(156, 163, 175, 0.5)"
								fontSize="10"
								fontFamily="monospace"
							>
								Row {row.index} (ports: {row.maxDataPorts})
							</text>

							{/* Точки пересечения для команд */}
							{commandColumns.map((x, colIdx) => (
								<g key={`intersection-cmd-${row.index}-${colIdx}`}>
									{/* Зона магнита (если идет перетаскивание) */}
									{showCommandMagnets && draggingState && !draggingState.isMagnetic && (
										<circle
											cx={x}
											cy={row.y + (row.rowHeight - row.maxCommandHeight)}
											r={magnetRadius}
											fill="url(#magnet-glow)"
											opacity={0.9}
										/>
									)}
									
									{/* Точка привязки */}
									<circle
										cx={x}
										cy={row.y + (row.rowHeight - row.maxCommandHeight)}
										r={4}
										fill="rgba(59, 130, 246, 0.6)"
										stroke="white"
										strokeWidth={1}
									/>
									
									{/* Крестик для наглядности */}
									<line
										x1={x - 6}
										y1={row.y + (row.rowHeight - row.maxCommandHeight)}
										x2={x + 6}
										y2={row.y + (row.rowHeight - row.maxCommandHeight)}
										stroke="white"
										strokeWidth={1}
										opacity={0.5}
									/>
									<line
										x1={x}
										y1={row.y - 6 + (row.rowHeight - row.maxCommandHeight)}
										x2={x}
										y2={row.y + 6 + (row.rowHeight - row.maxCommandHeight)}
										stroke="white"
										strokeWidth={1}
										opacity={0.5}
									/>
								</g>
							))}

							{/* Горизонтальные линии данных (под каждой линией команд) */}
							{Array.from({ length: row.maxDataPorts }).map((_, dataRowIdx) => {
								const dataUnitHeight = magneticGridConfig.dataNodeHeight + magneticGridConfig.dataNodeGap;
								const dataY = row.y + (row.rowHeight - row.maxCommandHeight) - (dataRowIdx + 1) * dataUnitHeight;
								//const dataY = row.y + dataRowIdx * (magneticGridConfig.dataNodeHeight + magneticGridConfig.dataNodeGap);
								
								return (
									<g key={`data-row-${row.index}-${dataRowIdx}`}>
										<line
											x1={startX}
											y1={dataY}
											x2={endX}
											y2={dataY}
											stroke="rgba(34, 197, 94, 0.2)"
											strokeWidth={1}
											strokeDasharray="3,3"
										/>
										
										{/* Точки пересечения для данных */}
										{dataColumns.map((x, colIdx) => (
											<g key={`intersection-data-${row.index}-${dataRowIdx}-${colIdx}`}>
												{showDataMagnets && draggingState && !draggingState.isMagnetic && (
													<circle
														cx={x}
														cy={dataY}
														r={magnetRadius}
														fill="url(#magnet-glow)"
														opacity={0.9}
													/>
												)}
												
												<circle
													cx={x}
													cy={dataY}
													r={3}
													fill="rgba(34, 197, 94, 0.5)"
													stroke="white"
													strokeWidth={0.5}
												/>
											</g>
										))}
									</g>
								);
							})}
						</g>
					  </g>
                ))}

                {/* Индикатор магнитного состояния */}
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
