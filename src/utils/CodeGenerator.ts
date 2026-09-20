import { NodeInstance, Connection } from '../types';
import { RawTemplate, compileEmission } from './TemplateSchema';

// Легаси-вход: файл, где nodes/weights уже готовы (руками написанные старые
// шаблоны). Основной путь — RawTemplate из TemplateSchema.ts (единый файл
// шаблона с "commands"), см. compileEmission().
interface LegacyExportConfig {
    id: string;
    extension: string;
    boilerplate: { start: string; end: string };
    nodes: Record<string, string>;
    weights?: Record<string, number>;
    types?: Record<string, string>;
    useLabels?: boolean;
    useHex?: boolean;
}

type ExportConfig = RawTemplate | LegacyExportConfig;

// То, что реально лежит в this.config после конструктора: nodes/weights уже
// гарантированно заполнены (напрямую переданы, либо скомпилированы из "commands").
type CompiledConfig = ExportConfig & { nodes: Record<string, string>; weights: Record<string, number> };

export class CodeGenerator {
    private nodes: NodeInstance[];
    private connections: Connection[];
    private config: CompiledConfig;
    private nodeAddresses: Map<string, number> = new Map();
    private fileCache: Map<string, { nodes: NodeInstance[], connections: Connection[] }> = new Map();
    private loadingFiles: Set<string> = new Set();

    constructor(nodes: NodeInstance[], connections: Connection[], config: ExportConfig) {
        this.nodes = [...nodes];
        this.connections = [...connections];
        if ('commands' in config && config.commands) {
            const compiled = compileEmission(config as RawTemplate);
            this.config = { ...config, nodes: compiled.nodes, weights: compiled.weights };
        } else {
            // Легаси-формат: nodes/weights заданы автором шаблона напрямую.
            this.config = config as CompiledConfig;
        }
    }

    private async loadExternalFile(filePath: string): Promise<{ nodes: NodeInstance[], connections: Connection[] } | null> {
        if (this.fileCache.has(filePath)) {
            return this.fileCache.get(filePath)!;
        }
        if (this.loadingFiles.has(filePath)) {
            console.warn(`[CodeGenerator] Circular import detected: ${filePath}`);
            return null;
        }
        this.loadingFiles.add(filePath);
        try {
            const response = await fetch(`/${filePath}`);
            if (!response.ok) {
                console.error(`[CodeGenerator] Failed to load ${filePath}: ${response.statusText}`);
                this.loadingFiles.delete(filePath);
                return null;
            }
            const data = await response.json();
            const result = { nodes: data.nodes || [], connections: data.connections || [] };
            this.fileCache.set(filePath, result);
            this.loadingFiles.delete(filePath);
            return result;
        } catch (error) {
            console.error(`[CodeGenerator] Error loading ${filePath}:`, error);
            this.loadingFiles.delete(filePath);
            return null;
        }
    }

    private async expandFunctions(): Promise<void> {
        let safety = 0;
        while (safety++ < 100) {
            const funcNode = this.nodes.find(n => n.definitionId === 'cmd_function' && n.data?.file);
            if (!funcNode) break;

            const filePath = funcNode.data!.file as string;
            const externalData = await this.loadExternalFile(filePath);

            if (!externalData) {
                this.nodes = this.nodes.filter(n => n.id !== funcNode.id);
                this.connections = this.connections.filter(
                    c => c.fromNodeId !== funcNode.id && c.toNodeId !== funcNode.id
                );
                continue;
            }

            const idMap = new Map<string, string>();
            const cloneId = (oldId: string): string => {
                if (!idMap.has(oldId)) idMap.set(oldId, `${oldId}__${funcNode.id}`);
                return idMap.get(oldId)!;
            };

            const bodyNodes: NodeInstance[] = externalData.nodes.map(n => ({
                ...n,
                id: cloneId(n.id)
            }));
            const bodyConns: Connection[] = externalData.connections.map(c => ({
                ...c,
                id: cloneId(c.id),
                fromNodeId: cloneId(c.fromNodeId),
                toNodeId: cloneId(c.toNodeId)
            }));

            const beginNode = bodyNodes.find(n =>
                n.definitionId === 'cmd_FunctionStart' || n.definitionId === 'cmd_Begin'
            );
            const endNode = bodyNodes.find(n => n.definitionId === 'cmd_End');

            if (!beginNode) {
                console.warn(`[CodeGenerator] No Begin node found in ${filePath}, skipping`);
                this.nodes = this.nodes.filter(n => n.id !== funcNode.id);
                this.connections = this.connections.filter(
                    c => c.fromNodeId !== funcNode.id && c.toNodeId !== funcNode.id
                );
                continue;
            }

            const execPortIds = ['exec_in', 'exec_out', 'next', 'exec_true', 'true', 'exec_false', 'false'];
            const incomingExec = this.connections.filter(
                c => c.toNodeId === funcNode.id && execPortIds.includes(c.toPortId)
            );
            const outgoingExec = this.connections.filter(
                c => c.fromNodeId === funcNode.id && execPortIds.includes(c.fromPortId)
            );

            const patchedIncoming: Connection[] = incomingExec.map(c => ({
                ...c,
                id: `${c.id}_patched`,
                toNodeId: beginNode.id,
                toPortId: 'exec_in'
            }));

            const exitNode = endNode ?? beginNode;
            const patchedOutgoing: Connection[] = outgoingExec.map(c => ({
                ...c,
                id: `${c.id}_patched`,
                fromNodeId: exitNode.id,
                fromPortId: 'exec_out'
            }));

            this.nodes = this.nodes.filter(n => n.id !== funcNode.id);
            this.connections = this.connections.filter(
                c => c.fromNodeId !== funcNode.id && c.toNodeId !== funcNode.id
            );

            this.nodes.push(...bodyNodes);
            this.connections.push(...bodyConns, ...patchedIncoming, ...patchedOutgoing);
        }
    }

    private shouldIncludeNode(node: NodeInstance): boolean {
        // cmd_function, cmd_FunctionStart, cmd_Begin не генерируют код
        const skipIds = ['cmd_function', 'cmd_FunctionStart', 'cmd_Begin'];
        if (skipIds.includes(node.definitionId)) return false;
        return this.config.nodes[node.definitionId] !== undefined;
    }

    /**
     * Нода должна получить адрес в nodeAddresses даже если не генерирует код.
     * Это нужно для корректной адресации Goto → cmd_End.
     */
    private shouldTrackAddress(node: NodeInstance): boolean {
        // cmd_End не генерирует код, но адрес нужен для Goto и аналогичных нод
        if (node.definitionId === 'cmd_End') return true;
        return this.shouldIncludeNode(node);
    }

    private findNode(nodeId: string): NodeInstance | undefined {
        return this.nodes.find(n => n.id === nodeId);
    }

    private getExecConnections(nodeId: string): Connection[] {
        const execPortOrder = ['exec_out', 'next', 'exec_true', 'true', 'exec_false', 'false'];
        return this.connections
            .filter(c => c.fromNodeId === nodeId && execPortOrder.includes(c.fromPortId))
            .sort((a, b) => execPortOrder.indexOf(a.fromPortId) - execPortOrder.indexOf(b.fromPortId));
    }

    private traverseChain(
        startNode: NodeInstance,
        globalSequence: NodeInstance[],
        visited: Set<string>,
        currentAddress: { value: number }
    ): void {
        const pendingFalseBranches: NodeInstance[] = [];

        let current: NodeInstance | undefined = startNode;

        while (true) {
            while (current && !visited.has(current.id)) {
                visited.add(current.id);

                if (this.shouldTrackAddress(current)) {
                    // Всегда регистрируем адрес (нужен для Goto → cmd_End и т.п.)
                    this.nodeAddresses.set(current.id, currentAddress.value);

                    if (this.shouldIncludeNode(current)) {
                        // Только ноды с шаблоном попадают в последовательность вывода
                        globalSequence.push(current);
                        const weight = this.config.weights?.[current.definitionId] ?? 1;
                        currentAddress.value += weight;
                    }
                }

                const outConns = this.getExecConnections(current.id);

                if (outConns.length === 0) {
                    current = undefined;
                    break;
                }

                if (outConns.length > 1) {
                    const falseNode = this.findNode(outConns[1].toNodeId);
                    if (falseNode && !visited.has(falseNode.id)) {
                        pendingFalseBranches.push(falseNode);
                    }
                }

                const trueNode = this.findNode(outConns[0].toNodeId);
                current = (trueNode && !visited.has(trueNode.id)) ? trueNode : undefined;
            }

            if (pendingFalseBranches.length === 0) break;
            current = pendingFalseBranches.pop();
        }
    }

    public async generate(): Promise<string> {
        await this.expandFunctions();

        const entryPointIds = ['cmd_start', 'cmd_ScriptInit'];
        const entryPointNodes = this.nodes.filter(n => entryPointIds.includes(n.definitionId));

        const globalSequence: NodeInstance[] = [];
        const visited = new Set<string>();
        const currentAddress = { value: 0 };

        for (const startNode of entryPointNodes) {
            if (!visited.has(startNode.id)) {
                this.traverseChain(startNode, globalSequence, visited, currentAddress);
            }
        }

        for (const node of this.nodes) {
            if (!visited.has(node.id) && this.shouldIncludeNode(node)) {
                this.traverseChain(node, globalSequence, visited, currentAddress);
            }
        }

        if (globalSequence.length === 0) {
            return this.config.boilerplate.start + "\n    // No executable nodes found\n" + this.config.boilerplate.end;
        }

        let output = this.config.boilerplate.start;
        for (const node of globalSequence) {
            const addr = this.nodeAddresses.get(node.id) ?? 0;
            const line = this.processNode(node, addr, this.nodes, this.connections);
            if (line !== undefined && line.trim() !== "") {
                output += line + "\n";
            }
        }
        output += this.config.boilerplate.end;

        return output;
    }

    private processNode(node: NodeInstance, currentAddress: number, allNodes: NodeInstance[], allConnections: Connection[]): string {
        const template = this.config.nodes[node.definitionId];
        if (template === undefined) return `    // No template for ${node.definitionId}`;

        let code = template;
/*
		// вывод текущего адреса {self}
		code = code.replace(/{self(?::(\w+))?}/g, (_, mod) => {
			if (this.config.useHex || mod === 'hex') {
				return '0x' + currentAddress.toString(16).toUpperCase().padStart(2, '0');
			}
			return currentAddress.toString();
		});
*/
        code = code.replace(/{(\w+)(?::(\w+)(?::(\w+))?)?}/g, (match, param, mod1, mod2) => {
            const modifiers = [mod1, mod2].filter(Boolean);

            let hexBytes = 1;
            let isHex = false;
            for (const mod of modifiers) {
                if (mod.startsWith('hex')) {
                    isHex = true;
                    const bytesMatch = mod.match(/^hex(\d+)$/);
                    if (bytesMatch) hexBytes = parseInt(bytesMatch[1]);
                }
            }
            // :dec имеет абсолютный приоритет — отменяет и явный :hex, и глобальный useHex
            if (modifiers.includes('dec')) {
                isHex = false;
            } else if (!isHex && this.config.useHex) {
                isHex = true;
            }

            let mode: 'auto' | 'value' | 'label' | 'address' | 'delta' = 'auto';
            if (modifiers.includes('value')) mode = 'value';
            else if (modifiers.includes('label')) mode = 'label';
            else if (modifiers.includes('address')) mode = 'address';
            else if (modifiers.includes('delta')) mode = 'delta';

            const wrapHex = (val: string) => {
                if (!isHex) return val;
                const num = parseInt(val);
                if (isNaN(num)) return val;
                const bytes: string[] = [];
                for (let i = 0; i < hexBytes; i++) {
                    const byte = (num >> (i * 8)) & 0xFF;
                    bytes.unshift('0x' + byte.toString(16).toUpperCase().padStart(2, '0'));
                }
                return bytes.join(' ');
            };

            // Специальный параметр {self} — адрес текущей ноды
            if (param === 'self') {
                return wrapHex(currentAddress.toString());
            }


            const connTo = allConnections.find(c => c.toNodeId === node.id && c.toPortId === param);
            if (connTo) {
                const src = allNodes.find(n => n.id === connTo.fromNodeId);
                if (src) return wrapHex(this.resolveValue(src, mode, currentAddress, connTo.fromPortId));
            }

            const connFrom = allConnections.find(c => c.fromNodeId === node.id && c.fromPortId === param);
            if (connFrom) {
                const target = allNodes.find(n => n.id === connFrom.toNodeId);
                if (target) return wrapHex(this.resolveValue(target, mode, currentAddress, connFrom.toPortId));
            }

            if (node.data && node.data[param] !== undefined) return wrapHex(node.data[param]);

            return match;
        });

        return code;
    }

    private resolveValue(node: NodeInstance, mode: 'auto' | 'value' | 'label' | 'address' | 'delta' = 'auto', currentAddress: number = 0, portId?: string): string {
        if (mode === 'address') {
            const addr = this.nodeAddresses.get(node.id);
            return addr !== undefined ? addr.toString() : `/*Addr of ${node.definitionId} not in flow*/`;
        }

        if (mode === 'delta') {
            const targetAddr = this.nodeAddresses.get(node.id);
            if (targetAddr !== undefined) {
                return (targetAddr - currentAddress).toString();
            }
            return `/*Delta of ${node.definitionId} not in flow*/`;
        }

        if (node.type === 'data') {
            const label = node.data.label;
            const value = node.data.value || '0';

            if (mode === 'label') return label || value;
            if (mode === 'value') return value;

            return this.config.useLabels ? (label || value) : (value || label);
        }

        const addr = this.nodeAddresses.get(node.id);
        if (addr !== undefined) return addr.toString();

        return `/*Result of ${node.definitionId}.${portId}*/`;
    }
}