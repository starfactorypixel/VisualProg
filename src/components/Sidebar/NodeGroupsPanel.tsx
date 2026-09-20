import React, { useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { NodeGroupDef, NodeGroupEntry } from '../../utils/TemplateSchema';
import clsx from 'clsx';

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeGroup = NodeGroupDef;
type NodeEntry = NodeGroupEntry;

// ─── Component ────────────────────────────────────────────────────────────────

export const NodeGroupsPanel: React.FC = () => {
    const { nodeDefinitions, nodeGroups } = useEditorStore();

    // Which group is expanded in accordion
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

    // Per-group: map of stepId -> selected optionId
    const [selections, setSelections] = useState<Record<string, Record<string, string>>>({});

    const groups: NodeGroup[] = nodeGroups;

    const handleGroupToggle = (groupId: string) => {
        setExpandedGroup(prev => prev === groupId ? null : groupId);
    };

    const handleSelect = (groupId: string, stepId: string, optionId: string) => {
        setSelections(prev => {
            const groupSel = { ...(prev[groupId] || {}) };

            // Find the step index to reset all subsequent steps
            const group = groups.find(g => g.id === groupId)!;
            const stepIdx = group.steps.findIndex(s => s.id === stepId);
            group.steps.forEach((s, i) => {
                if (i > stepIdx) delete groupSel[s.id];
            });

            groupSel[stepId] = optionId;
            return { ...prev, [groupId]: groupSel };
        });
    };

    const handleReset = (groupId: string) => {
        setSelections(prev => ({ ...prev, [groupId]: {} }));
    };

    // Filter nodes by all currently selected tags
    const getMatchingNodes = (group: NodeGroup, groupSel: Record<string, string>): NodeEntry[] => {
        const selectedTags = Object.values(groupSel);
        if (selectedTags.length === 0) return [];
        return group.nodes.filter(node =>
            selectedTags.every(tag => node.tags.includes(tag))
        );
    };

    // Check how many steps are answered
    const getCompletedSteps = (group: NodeGroup, groupSel: Record<string, string>): number => {
        return group.steps.filter(s => groupSel[s.id]).length;
    };

    // Returns false if none of the surviving nodes (after prior selections)
    // carry any tag from this step — meaning the step is irrelevant and can be hidden.
    const stepHasRelevantNodes = (
        group: NodeGroup,
        stepIdx: number,
        groupSel: Record<string, string>
    ): boolean => {
        const step = group.steps[stepIdx];
        const priorTags = group.steps
            .slice(0, stepIdx)
            .map(s => groupSel[s.id])
            .filter(Boolean);
        const survivors = group.nodes.filter(node =>
            priorTags.every(tag => node.tags.includes(tag))
        );
        const stepOptionIds = step.options.map(o => o.id);
        return survivors.some(node =>
            node.tags.some(t => stepOptionIds.includes(t))
        );
    };

    const handleDragStart = (e: React.DragEvent, commandId: string) => {
        e.dataTransfer.setData('application/reactflow/type', 'command');
        e.dataTransfer.setData('application/reactflow/id', commandId);
        e.dataTransfer.effectAllowed = 'move';
    };

    if (groups.length === 0) {
        return (
            <div className="text-center py-8 text-neutral-600 text-xs italic px-3">
                У этого шаблона нет групп команд
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {groups.map(group => {
                const isOpen = expandedGroup === group.id;
                const groupSel = selections[group.id] || {};
                const completedSteps = getCompletedSteps(group, groupSel);
                const matchingNodes = getMatchingNodes(group, groupSel);
                const visibleSteps = group.steps.filter((_, idx) => stepHasRelevantNodes(group, idx, groupSel));
                const allStepsDone = visibleSteps.length > 0 && completedSteps > 0 && visibleSteps.every(s => !!groupSel[s.id]);

                return (
                    <div key={group.id} className="border-b border-neutral-800">
                        {/* Group Header */}
                        <button
                            className={clsx(
                                "w-full flex items-center justify-between px-3 py-2.5 hover:bg-neutral-800 transition-colors text-left",
                                isOpen && "bg-neutral-800"
                            )}
                            onClick={() => handleGroupToggle(group.id)}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: group.color }}
                                />
                                <span className="text-sm font-medium text-neutral-200 truncate">
                                    {group.label}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                {completedSteps > 0 && (
                                    <span
                                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                                        style={{
                                            backgroundColor: group.color + '33',
                                            color: group.color
                                        }}
                                    >
                                        {completedSteps}/{group.steps.length}
                                    </span>
                                )}
                                <svg
                                    className={clsx(
                                        "w-3.5 h-3.5 text-neutral-500 transition-transform duration-200",
                                        isOpen && "rotate-180"
                                    )}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </button>

                        {/* Expanded Body */}
                        {isOpen && (
                            <div className="bg-neutral-850 pb-2">
                                {/* Steps — only render steps that have relevant nodes */}
                                {group.steps.map((step, stepIdx) => {
                                    // Hide step entirely if no surviving nodes use its tags
                                    if (!stepHasRelevantNodes(group, stepIdx, groupSel)) return null;

                                    // Active = all previous visible steps are answered
                                    const prevVisibleStep = visibleSteps
                                        .slice(0, visibleSteps.findIndex(s => s.id === step.id))
                                        .at(-1);
                                    const isStepActive = prevVisibleStep
                                        ? !!groupSel[prevVisibleStep.id]
                                        : true;
                                    const selectedOption = groupSel[step.id];

                                    return (
                                        <div
                                            key={step.id}
                                            className={clsx(
                                                "mx-2 mt-2 rounded-md overflow-hidden transition-opacity duration-200",
                                                !isStepActive && "opacity-40 pointer-events-none"
                                            )}
                                        >
                                            {/* Step question */}
                                            <div className="px-2 py-1.5 bg-neutral-800 rounded-t-md">
                                                <p className="text-[11px] text-neutral-400 leading-tight">
                                                    <span
                                                        className="inline-block w-4 h-4 rounded-full text-[9px] font-bold text-center leading-4 mr-1 shrink-0"
                                                        style={{
                                                            backgroundColor: group.color + '44',
                                                            color: group.color
                                                        }}
                                                    >
                                                        {stepIdx + 1}
                                                    </span>
                                                    {step.question}
                                                </p>
                                            </div>

                                            {/* Options */}
                                            <div className="bg-neutral-900 rounded-b-md p-1 space-y-0.5">
                                                {step.options.map(opt => {
                                                    const isSelected = selectedOption === opt.id;
                                                    return (
                                                        <button
                                                            key={opt.id}
                                                            className={clsx(
                                                                "w-full text-left px-2 py-1.5 rounded text-xs transition-all",
                                                                isSelected
                                                                    ? "text-white font-medium"
                                                                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                                                            )}
                                                            style={isSelected ? {
                                                                backgroundColor: group.color + '33',
                                                                color: group.color,
                                                                outline: `1px solid ${group.color}66`
                                                            } : {}}
                                                            onClick={() => handleSelect(group.id, step.id, opt.id)}
                                                        >
                                                            <span>{opt.label}</span>
                                                            {opt.description && (
                                                                <span className="block text-[10px] text-neutral-500 mt-0.5">
                                                                    {opt.description}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Result Area — shown as soon as any step is answered */}
                                {completedSteps > 0 && (
                                    <div className="mx-2 mt-2">
                                        {/* Header with counts */}
                                        <div className="flex items-center justify-between px-1 mb-1">
                                            <p className="text-[10px] text-neutral-500 uppercase tracking-wider">
                                                {matchingNodes.length > 0
                                                    ? `${matchingNodes.length} нод${matchingNodes.length === 1 ? 'а' : matchingNodes.length < 5 ? 'ы' : ''}`
                                                    : 'Нет совпадений'}
                                            </p>
                                            {!allStepsDone && matchingNodes.length > 0 && (
                                                <p className="text-[10px]" style={{ color: group.color + 'aa' }}>
                                                    уточните выбор ↑
                                                </p>
                                            )}
                                            {allStepsDone && matchingNodes.length > 0 && (
                                                <p className="text-[10px] text-neutral-600">
                                                    перетащите на холст
                                                </p>
                                            )}
                                        </div>

                                        <div className="space-y-1">
                                            {matchingNodes.map(nodeEntry => {
                                                const def = nodeDefinitions.find(d => d.id === nodeEntry.commandId);
                                                // Dim nodes when not all steps done — they're available but partial match
                                                const isPartial = !allStepsDone;
                                                return (
                                                    <div
                                                        key={nodeEntry.commandId}
                                                        className={clsx(
                                                            "flex items-center gap-2 p-2 rounded border cursor-grab active:cursor-grabbing transition-all",
                                                            isPartial
                                                                ? "hover:brightness-125 opacity-70 hover:opacity-100"
                                                                : "hover:brightness-110"
                                                        )}
                                                        style={{
                                                            backgroundColor: group.color + (isPartial ? '0a' : '11'),
                                                            borderColor: group.color + (isPartial ? '2a' : '44')
                                                        }}
                                                        draggable
                                                        onDragStart={(e) => handleDragStart(e, nodeEntry.commandId)}
                                                    >
                                                        <div
                                                            className="w-2 h-2 rounded-full shrink-0"
                                                            style={{ backgroundColor: def?.visual?.color || group.color }}
                                                        />
                                                        <span className="text-xs text-neutral-200 font-medium truncate flex-1">
                                                            {nodeEntry.label}
                                                        </span>
                                                        {!def && (
                                                            <span className="text-[9px] text-yellow-600 shrink-0">
                                                                не найдена
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {matchingNodes.length === 0 && (
                                                <div className="text-center py-2 text-[11px] text-neutral-600 italic">
                                                    Нет нод для этой комбинации
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Reset button */}
                                {completedSteps > 0 && (
                                    <button
                                        className="mx-2 mt-2 w-[calc(100%-1rem)] text-[10px] text-neutral-600 hover:text-neutral-400 py-1 text-center transition-colors"
                                        onClick={() => handleReset(group.id)}
                                    >
                                        ↺ Сбросить выбор
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};