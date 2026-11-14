import { NodeDefinition, NodeInstance, PortDefinition } from '../types';
import { FunctionSignature, FunctionFileData, PinDef } from '../types/function';
import { genId } from './id';

// Единая точка правды для раскладки пинов функции в порты ноды вызова —
// используется и стором, и Node.tsx, и ConnectionLayer.tsx, и CodeGenerator.ts.
// Если эту логику продублировать в каждом месте по отдельности, они неизбежно
// разойдутся (как уже разошлись исходные формулы оффсета cmd_function в
// Node.tsx и ConnectionLayer.tsx).

export function pinPortId(pinId: string): string {
    return `pin_${pinId}`;
}

export function buildPinPortDefs(signature: FunctionSignature): { inputs: PortDefinition[]; outputs: PortDefinition[] } {
    const inputs: PortDefinition[] = [];
    const outputs: PortDefinition[] = [];

    for (const pin of signature.pins) {
        const id = pinPortId(pin.id);
        if (pin.dir === 'out') {
            outputs.push({ id, name: pin.name, type: pin.dataType as PortDefinition['type'] });
        } else if (pin.dir === 'inout') {
            // Как и везде в приложении, ref:-порты только входные (sink) —
            // двунаправленность рисуется отдельной overlay-логикой, а не вторым портом.
            inputs.push({ id, name: pin.name, type: `ref:${pin.dataType}` as PortDefinition['type'] });
        } else {
            inputs.push({ id, name: pin.name, type: pin.dataType as PortDefinition['type'] });
        }
    }

    return { inputs, outputs };
}

interface MinimalFunctionNode {
    definitionId: string;
    data?: { file?: string } | null;
}

// Возвращает обычное статическое определение ноды, а для cmd_function с
// загруженной сигнатурой — то же определение, дополненное портами пинов
// конкретно этого файла. Разные инстансы cmd_function с разными файлами
// получают разные порты, хотя definitionId у них один и тот же.
export function resolveNodeDefinition(
    node: MinimalFunctionNode,
    nodeDefinitions: NodeDefinition[],
    functionSignatures: Record<string, FunctionSignature | null | undefined>
): NodeDefinition | undefined {
    const def = nodeDefinitions.find(d => d.id === node.definitionId);
    if (!def) return undefined;
    if (node.definitionId !== 'cmd_function') return def;

    const file = node.data?.file;
    const signature = file ? functionSignatures[file] : null;
    if (!signature || signature.pins.length === 0) return def;

    const pinPorts = buildPinPortDefs(signature);
    return {
        ...def,
        inputs: [...(def.inputs || []), ...pinPorts.inputs],
        outputs: [...(def.outputs || []), ...pinPorts.outputs],
    };
}

export function slugifyPinName(name: string, index: number): string {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return base || `pin${index}`;
}

// Применяет отредактированный список пинов к уже существующему файлу функции:
// обновляет/добавляет/удаляет только пин-плейсхолдеры (data.isPin), остальное
// тело (и всё, что пользователь уже нарисовал в нём) не трогает. Используется
// и конструктором (на пустом файле), и формой редактирования существующей
// функции в FunctionsPanel.
export function applyPinEdits(file: FunctionFileData, pins: PinDef[]): FunctionFileData {
    const keepIds = new Set(pins.map(p => p.id));
    const existingPinIds = new Set(
        file.nodes.filter(n => n.data?.isPin).map(n => n.data!.pinId)
    );

    const survivingNodes = file.nodes.filter(n => !(n.data?.isPin && !keepIds.has(n.data.pinId)));
    const updatedNodes: NodeInstance[] = survivingNodes.map(n => {
        if (!n.data?.isPin) return n;
        const pin = pins.find(p => p.id === n.data!.pinId)!;
        return { ...n, definitionId: pin.dataType, data: { ...n.data, label: pin.name, pinDir: pin.dir } };
    });

    let nextY = 40 + existingPinIds.size * 110;
    for (const pin of pins) {
        if (existingPinIds.has(pin.id)) continue;
        updatedNodes.push({
            id: genId(),
            definitionId: pin.dataType,
            type: 'data',
            position: { x: 40, y: nextY },
            data: { isPin: true, pinId: pin.id, pinDir: pin.dir, label: pin.name, value: '' },
        });
        nextY += 110;
    }

    const removedNodeIds = new Set(
        file.nodes.filter(n => n.data?.isPin && !keepIds.has(n.data.pinId)).map(n => n.id)
    );
    const updatedConnections = file.connections.filter(
        c => !removedNodeIds.has(c.fromNodeId) && !removedNodeIds.has(c.toNodeId)
    );

    return { nodes: updatedNodes, connections: updatedConnections, signature: { pins } };
}
