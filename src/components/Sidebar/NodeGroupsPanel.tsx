import React, { useMemo, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { NodeGroupDef } from '../../utils/TemplateSchema';
import clsx from 'clsx';

// ─── Tree types ───────────────────────────────────────────────────────────────
// Каждый step группы — это один уровень дерева. Если у ветки остаётся ровно
// один потомок-лист (типичный случай "операция -> единственный вариант
// операндов"), ветка схлопывается в этот лист под своей же подписью — чтобы не
// заставлять пользователя раскрывать бессмысленный промежуточный уровень.

interface TreeBranch {
    type: 'branch';
    id: string;
    label: string;
    description?: string;
    color: string;
    children: TreeNode[];
}

interface TreeLeaf {
    type: 'leaf';
    id: string;
    label: string;
    color: string;
    commandId: string;
}

type TreeNode = TreeBranch | TreeLeaf;

function buildOptionTree(group: NodeGroupDef, priorTags: string[], stepIdx: number, idPrefix: string): TreeNode[] {
    if (stepIdx >= group.steps.length) {
        return group.nodes
            .filter(n => priorTags.every(tag => n.tags.includes(tag)))
            .map(n => ({ type: 'leaf', id: `${idPrefix}>${n.commandId}`, label: n.label, color: group.color, commandId: n.commandId }));
    }

    const step = group.steps[stepIdx];
    const survivors = group.nodes.filter(n => priorTags.every(tag => n.tags.includes(tag)));
    const relevantOptions = step.options.filter(opt => survivors.some(n => n.tags.includes(opt.id)));

    // Этот шаг не затрагивает ни один из выживших узлов (напр. у унарных
    // операций нет типа операндов) — пропускаем уровень, идём к следующему шагу.
    if (relevantOptions.length === 0) {
        return buildOptionTree(group, priorTags, stepIdx + 1, idPrefix);
    }

    return relevantOptions.map(opt => {
        const nodeId = `${idPrefix}>${opt.id}`;
        const children = buildOptionTree(group, [...priorTags, opt.id], stepIdx + 1, nodeId);

        if (children.length === 1 && children[0].type === 'leaf') {
            return { ...children[0], id: nodeId, label: opt.label };
        }

        return { type: 'branch', id: nodeId, label: opt.label, description: opt.description, color: group.color, children };
    });
}

function buildGroupTree(groups: NodeGroupDef[]): TreeNode[] {
    return groups.map(group => {
        const children = buildOptionTree(group, [], 0, group.id);
        if (children.length === 1 && children[0].type === 'leaf') {
            return { ...children[0], id: group.id, label: group.label };
        }
        return { type: 'branch', id: group.id, label: group.label, description: group.description, color: group.color, children };
    });
}

function countLeaves(node: TreeNode): number {
    return node.type === 'leaf' ? 1 : node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const NodeGroupsPanel: React.FC = () => {
    const { nodeDefinitions, nodeGroups } = useEditorStore();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const tree = useMemo(() => buildGroupTree(nodeGroups), [nodeGroups]);

    const toggle = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleDragStart = (e: React.DragEvent, commandId: string) => {
        e.dataTransfer.setData('application/reactflow/type', 'command');
        e.dataTransfer.setData('application/reactflow/id', commandId);
        e.dataTransfer.effectAllowed = 'move';
    };

    if (nodeGroups.length === 0) {
        return (
            <div className="text-center py-8 text-neutral-600 text-xs italic px-3">
                У этого шаблона нет групп команд
            </div>
        );
    }

    const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
        const indent = 8 + depth * 14;

        if (node.type === 'leaf') {
            const def = nodeDefinitions.find(d => d.id === node.commandId);
            return (
                <div
                    key={node.id}
                    className="flex items-center gap-1.5 py-0.5 pr-2 rounded cursor-grab active:cursor-grabbing hover:bg-neutral-800 transition-colors"
                    style={{ paddingLeft: indent }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, node.commandId)}
                >
                    <span className="w-3 h-3 shrink-0" />
                    <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: def?.visual?.color || node.color }}
                    />
                    <span className="text-xs text-neutral-300 truncate flex-1">{node.label}</span>
                    {!def && (
                        <span className="text-[9px] text-yellow-600 shrink-0">не найдена</span>
                    )}
                </div>
            );
        }

        const isOpen = expanded.has(node.id);
        const leafCount = countLeaves(node);

        return (
            <div key={node.id}>
                <button
                    className={clsx(
                        'w-full flex items-center gap-1.5 py-0.5 pr-2 rounded text-left hover:bg-neutral-800 transition-colors',
                        isOpen && 'bg-neutral-800/60'
                    )}
                    style={{ paddingLeft: indent }}
                    onClick={() => toggle(node.id)}
                    title={node.description}
                >
                    <svg
                        className={clsx('w-3 h-3 text-neutral-500 shrink-0 transition-transform duration-150', isOpen && 'rotate-90')}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
                    <span className="text-xs font-medium text-neutral-200 truncate flex-1">{node.label}</span>
                    <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                        style={{ backgroundColor: node.color + '22', color: node.color }}
                    >
                        {leafCount}
                    </span>
                </button>

                {isOpen && node.children.map(child => renderNode(child, depth + 1))}
            </div>
        );
    };

    return (
        <div className="flex flex-col py-1">
            {tree.map(node => renderNode(node, 0))}
        </div>
    );
};
