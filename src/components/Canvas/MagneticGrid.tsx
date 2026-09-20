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
    // Сколько data-портов у переносимой command-ноды — используется, чтобы точка
    // и линия ряда сразу показывали место, которое реально резервируется под неё
    const draggingPortCount = showCommandMagnets ? (draggingState?.dataPortCount ?? 0) : 0;
    const dataUnitHeight = magneticGridConfig.dataNodeHeight + magneticGridConfig.dataNodeGap;
    // Пока тащим command-ноду — рисуем сетку так, будто она уже покинула свой исходный
    // ряд (иначе исходный ряд визуально остаётся старого, "растянутого из-за неё" размера,
    // хотя после drop он схлопнется и всё ниже сдвинется)
    const displayRows = (showCommandMagnets && draggingState?.previewGridRows)
        ? draggingState.previewGridRows
        : gridRows;

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
                {displayRows.map((row) => {
					// Если тащим command-ноду — ряд должен резервировать место под её
					// data-порты тоже, даже если сейчас в ряду их меньше (или совсем нет)
					const effectiveMaxDataPorts = Math.max(row.maxDataPorts, draggingPortCount);
					const extraPorts = effectiveMaxDataPorts - row.maxDataPorts;
					const intersectionY = row.y + effectiveMaxDataPorts * dataUnitHeight;
					const previewRowHeight = row.rowHeight + extraPorts * dataUnitHeight;

					return (
					<g key={`row-group-${row.index}`}>
					{/* Фон ячейки (аналог div с display: block) */}
					<rect
					  x={startX}
					  y={row.y}
					  width={endX - startX}
					  height={previewRowHeight}
					  fill="rgba(156, 163, 175, 0.03)" // Очень бледный фон для визуализации ячейки
					  stroke="rgba(156, 163, 175, 0.2)"
					  strokeWidth={1}
					/>
						<g key={`row-${row.index}`}>
							{/* Основная горизонтальная линия */}
							<line
								x1={startX}
								y1={intersectionY}
								x2={endX}
								y2={intersectionY}
								stroke="rgba(156, 163, 175, 0.3)"
								strokeWidth={2}
							/>

							{/* Метка высоты ряда */}
							<text
								x={startX + 10}
								y={intersectionY - 5}
								fill="rgba(156, 163, 175, 0.5)"
								fontSize="10"
								fontFamily="monospace"
							>
								Row {row.index} (ports: {row.maxDataPorts}{extraPorts > 0 ? ` → ${effectiveMaxDataPorts}` : ''})
							</text>

							{/* Точки пересечения для команд */}
							{commandColumns.map((x, colIdx) => (
								<g key={`intersection-cmd-${row.index}-${colIdx}`}>
									{/* Зона магнита (если идет перетаскивание) */}
									{showCommandMagnets && draggingState && !draggingState.isMagnetic && (
										<circle
											cx={x}
											cy={intersectionY}
											r={magnetRadius}
											fill="url(#magnet-glow)"
											opacity={0.9}
										/>
									)}

									{/* Точка привязки */}
									<circle
										cx={x}
										cy={intersectionY}
										r={4}
										fill="rgba(59, 130, 246, 0.6)"
										stroke="white"
										strokeWidth={1}
									/>

									{/* Крестик для наглядности */}
									<line
										x1={x - 6}
										y1={intersectionY}
										x2={x + 6}
										y2={intersectionY}
										stroke="white"
										strokeWidth={1}
										opacity={0.5}
									/>
									<line
										x1={x}
										y1={intersectionY - 6}
										x2={x}
										y2={intersectionY + 6}
										stroke="white"
										strokeWidth={1}
										opacity={0.5}
									/>
								</g>
							))}

							{/* Горизонтальные линии данных (под каждой линией команд) */}
							{Array.from({ length: effectiveMaxDataPorts }).map((_, dataRowIdx) => {
								const dataY = intersectionY - (dataRowIdx + 1) * dataUnitHeight;
								// Слоты сверх row.maxDataPorts существуют только потому, что их требует
								// переносимая нода — подсвечиваем их отдельно как «превью»
								const isPreviewSlot = dataRowIdx >= row.maxDataPorts;

								return (
									<g key={`data-row-${row.index}-${dataRowIdx}`}>
										<line
											x1={startX}
											y1={dataY}
											x2={endX}
											y2={dataY}
											stroke={isPreviewSlot ? "rgba(59, 130, 246, 0.35)" : "rgba(34, 197, 94, 0.2)"}
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
