import { NodeInstance, Connection } from '../types';

interface ExportConfig {
    id: string;
    extension: string;
    boilerplate: { start: string; end: string };
    nodes: Record<string, string>;
    weights?: Record<string, number>;
    types?: Record<string, string>;
    useLabels?: boolean;
    useHex?: boolean;
}

interface InlinedFunction {
    beginNodeId: string;
    endNodeId: string | undefined;
    nodes: NodeInstance[];
    connections: Connection[];
}

export class CodeGenerator {
    private nodes: NodeInstance[];
    private connections: Connection[];
    private config: ExportConfig;
    private nodeAddresses: Map<string, number> = new Map();
    private loadedFiles: Set<string> = new Set();
    private inlinedFunctions: Map<string, InlinedFunction> = new Map();

    constructor(nodes: NodeInstance[], connections: Connection[], config: ExportConfig) {
        this.nodes = nodes;
        this.connections = connections;
        this.config = config;
    }

    private async loadExternalFile(filePath: string): Promise<{ nodes: NodeInstance[], connections: Connection[] } | null> {
        if (this.loadedFiles.has(filePath)) {
            console.warn(`[CodeGenerator] Circular import detected: ${filePath}`);
            return null;
        }

        this.loadedFiles.add(filePath);

        try {
            const response = await fetch(`/${filePath}`);
            if (!response.ok) {
                console.error(`[CodeGenerator] Failed to load ${filePath}: ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            return {
                nodes: data.nodes || [],
                connections: data.connections || []
            };
        } catch (error) {
            console.error(`[CodeGenerator] Error loading ${filePath}:`, error);
            return null;
        }
    }

    private async preloadExternalFiles(): Promise<void> {
        const functionNodes = this.nodes.filter(n =>
            n.definitionId === 'cmd_function' && n.data?.file
        );

        for (const funcNode of functionNodes) {
            const filePath = funcNode.data!.file as string;

            const externalData = await this.loadExternalFile(filePath);
            if (!externalData) continue;

            const beginNode = externalData.nodes.find(n =>
                n.definitionId === 'cmd_FunctionStart' || n.definitionId === 'cmd_Begin'
            );
            const endNode = externalData.nodes.find(n => n.definitionId === 'cmd_End');

            if (!beginNode) {
                console.warn(`[CodeGenerator] No Begin node found in ${filePath}`);
                continue;
            }

            const chainNodes: NodeInstance[] = [];
            const chainConnections: Connection[] = [];
            const visited = new Set<string>();

            let current: NodeInstance | undefined = beginNode;
            const execPortIds = ['exec_out', 'next'];

            while (current && !visited.has(current.id)) {
                visited.add(current.id);
                chainNodes.push(current);

                if (current.id === endNode?.id) break;

                const conn = externalData.connections.find(c =>
                    c.fromNodeId === current!.id &&
                    execPortIds.includes(c.fromPortId)
                );

                if (!conn) break;

                chainConnections.push(conn);
                current = externalData.nodes.find(n => n.id === conn.toNodeId);
            }

            const dataNodes = externalData.nodes.filter(n => n.type === 'data');
            chainNodes.push(...dataNodes);

            const dataConnections = externalData.connections.filter(c =>
                !execPortIds.includes(c.fromPortId)
            );
            chainConnections.push(...dataConnections);

            this.inlinedFunctions.set(funcNode.id, {
                beginNodeId: beginNode.id,
                endNodeId: endNode?.id,
                nodes: chainNodes,
                connections: chainConnections
            });
        }
    }

    private getNextNode(currentNode: NodeInstance, visited: Set<string>): NodeInstance | undefined {
        const execPortIds = ['exec_out', 'next', 'true', 'false', 'exec_true', 'exec_false'];

        // Check if current node is a function call - INLINE IT
        if (currentNode.definitionId === 'cmd_function') {
            const inlined = this.inlinedFunctions.get(currentNode.id);
            if (inlined) {
                const beginNode = inlined.nodes.find(n => n.id === inlined.beginNodeId);
                return beginNode;
            }
        }

        // Check if current node is an End node - RETURN FROM FUNCTION
        for (const [funcNodeId, inlined] of this.inlinedFunctions.entries()) {
            if (currentNode.id === inlined.endNodeId) {
                const outConn = this.connections.find(c =>
                    c.fromNodeId === funcNodeId &&
                    execPortIds.includes(c.fromPortId)
                );

                if (outConn) {
                    for (const inlinedData of this.inlinedFunctions.values()) {
                        const nextNode = inlinedData.nodes.find(n => n.id === outConn.toNodeId);
                        if (nextNode) return nextNode;
                    }

                    return this.nodes.find(n => n.id === outConn.toNodeId);
                }
                return undefined;
            }
        }

        // Normal flow - get ALL outgoing connections
        const outConns = this.connections.filter(c =>
            c.fromNodeId === currentNode.id &&
            execPortIds.includes(c.fromPortId)
        );

        for (const inlined of this.inlinedFunctions.values()) {
            const inlinedConns = inlined.connections.filter(c =>
                c.fromNodeId === currentNode.id &&
                execPortIds.includes(c.fromPortId)
            );
            outConns.push(...inlinedConns);
        }

        if (outConns.length === 0) return undefined;

        // Use FIRST connection (main path)
        const [mainNext] = outConns;

        for (const inlined of this.inlinedFunctions.values()) {
            const nextNode = inlined.nodes.find(n => n.id === mainNext.toNodeId);
            if (nextNode) return nextNode;
        }

        return this.nodes.find(n => n.id === mainNext.toNodeId);
    }

    private shouldIncludeNode(node: NodeInstance): boolean {
        if (node.definitionId === 'cmd_function') return false;
        return this.config.nodes[node.definitionId] !== undefined;
    }

    private getAllNodes(): NodeInstance[] {
        const allNodes = [...this.nodes];
        for (const inlined of this.inlinedFunctions.values()) {
            allNodes.push(...inlined.nodes);
        }
        return allNodes;
    }

    private getAllConnections(): Connection[] {
        const allConnections = [...this.connections];
        for (const inlined of this.inlinedFunctions.values()) {
            allConnections.push(...inlined.connections);
        }
        return allConnections;
    }

    /**
     * Process a single execution chain starting from a node
     * This handles function inlining during traversal
     */
    private processChain(
        startNode: NodeInstance,
        globalSequence: NodeInstance[],
        visited: Set<string>,
        currentAddress: { value: number }
    ): void {
        let current: NodeInstance | undefined = startNode;

        while (current && !visited.has(current.id)) {
            visited.add(current.id);

            if (this.shouldIncludeNode(current)) {
                globalSequence.push(current);
                this.nodeAddresses.set(current.id, currentAddress.value);

                const weight = this.config.weights?.[current.definitionId] ?? 1;
                currentAddress.value += weight;
            }

            current = this.getNextNode(current, visited);
        }
    }

    public async generate(): Promise<string> {
        await this.preloadExternalFiles();

        const allNodes = this.getAllNodes();
        const allConnections = this.getAllConnections();

        const entryPointIds = ['cmd_start', 'cmd_ScriptInit'];
        const entryPointNodes = this.nodes.filter(n => entryPointIds.includes(n.definitionId));

        const globalSequence: NodeInstance[] = [];
        const visited = new Set<string>();
        const currentAddress = { value: 0 };

        // PHASE 1: Entry Points with Branch Exploration
        entryPointNodes.forEach(startNode => {
            if (visited.has(startNode.id)) return;

            // Process main chain
            let current: NodeInstance | undefined = startNode;

            while (current && !visited.has(current.id)) {
                visited.add(current.id);

                if (this.shouldIncludeNode(current)) {
                    globalSequence.push(current);
                    this.nodeAddresses.set(current.id, currentAddress.value);

                    const weight = this.config.weights?.[current.definitionId] ?? 1;
                    currentAddress.value += weight;
                }

                // Check if this node has multiple branches (like conditionals)
                const execPortIds = ['exec_out', 'next', 'true', 'false', 'exec_true', 'exec_false'];
                const outConns = this.connections.filter(c =>
                    c.fromNodeId === current!.id &&
                    execPortIds.includes(c.fromPortId)
                );

                // If node has multiple branches, process them all
                if (outConns.length > 1) {
                    // Process secondary branches (skip first, it's the main path)
                    for (let i = 1; i < outConns.length; i++) {
                        const conn = outConns[i];

                        let branchNode = this.nodes.find(n => n.id === conn.toNodeId);

                        if (!branchNode) {
                            for (const inlined of this.inlinedFunctions.values()) {
                                branchNode = inlined.nodes.find(n => n.id === conn.toNodeId);
                                if (branchNode) break;
                            }
                        }

                        if (branchNode && !visited.has(branchNode.id)) {
                            this.processChain(branchNode, globalSequence, visited, currentAddress);
                        }
                    }
                }

                current = this.getNextNode(current, visited);
            }
        });

        // PHASE 2: Remaining Nodes
        const remainingNodes = allNodes.filter(n => !visited.has(n.id) && this.shouldIncludeNode(n));

        remainingNodes.forEach(startNode => {
            this.processChain(startNode, globalSequence, visited, currentAddress);
        });

        if (globalSequence.length === 0) {
            return this.config.boilerplate.start + "\n    // No executable nodes found\n" + this.config.boilerplate.end;
        }

        let output = this.config.boilerplate.start;
        globalSequence.forEach(node => {
            const addr = this.nodeAddresses.get(node.id) ?? 0;
            const line = this.processNode(node, addr, allNodes, allConnections);
            if (line !== undefined && line.trim() !== "") {
                output += line + "\n";
            }
        });
        output += this.config.boilerplate.end;

        return output;
    }

    private processNode(node: NodeInstance, currentAddress: number, allNodes: NodeInstance[], allConnections: Connection[]): string {
        const template = this.config.nodes[node.definitionId];
        if (template === undefined) return `    // No template for ${node.definitionId}`;

        let code = template;

        code = code.replace(/{(\w+)(?::(\w+)(?::(\w+))?)?}/g, (match, param, mod1, mod2) => {
            const modifiers = [mod1, mod2].filter(Boolean);
			
			// Извлекаем количество байт из модификатора hex (например, hex2, hex4)
			let hexBytes = 1; // По умолчанию 1 байт (0x00)
			let isHex = false;
			
			for (const mod of modifiers) {
				if (mod.startsWith('hex')) {
					isHex = true;
					const bytesMatch = mod.match(/^hex(\d+)$/);
					if (bytesMatch) {
						hexBytes = parseInt(bytesMatch[1]);
					}
				}
			}
			
			// Если просто hex без числа, но useHex в конфиге
			if (!isHex && this.config.useHex && !modifiers.includes('dec')) {
				isHex = true;
			}
			
            //const isHex = modifiers.includes('hex') || (this.config.useHex && !modifiers.includes('dec'));
            let mode: 'auto' | 'value' | 'label' | 'address' | 'delta' = 'auto';
            if (modifiers.includes('value')) mode = 'value';
            else if (modifiers.includes('label')) mode = 'label';
            else if (modifiers.includes('address')) mode = 'address';
            else if (modifiers.includes('delta')) mode = 'delta';

            const wrapHex = (val: string) => {
                if (!isHex) return val;
                const num = parseInt(val);
                if (isNaN(num)) return val;
				// Разбиваем число на байты
				const bytes: string[] = [];
				for (let i = 0; i < hexBytes; i++) {
					const byte = (num >> (i * 8)) & 0xFF;
					bytes.unshift('0x' + byte.toString(16).toUpperCase().padStart(2, '0'));
				}
				
				return bytes.join(' ');
            };

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