export type NodeType = 'command' | 'data';
export type PortType = 'execution' | 'string' | 'number' | 'boolean' | 'any';

export interface Position {
    x: number;
    y: number;
}

export interface PortDefinition {
    id: string;
    name: string;
    type: PortType;
}

export interface NodeDefinition {
    id: string;
    type: NodeType;
    name: string;
    visual?: {
        color?: string;
        icon?: string;
    };
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
}

export interface NodeInstance {
    id: string;
    definitionId: string; // Refers to the definition (e.g. "cmd_start")
    type: NodeType;
    position: Position;
    data: Record<string, any>; // Internal data (e.g. variable name, constant value)
}

export interface Connection {
    id: string;
    fromNodeId: string;
    fromPortId: string;
    toNodeId: string;
    toPortId: string;
}

export interface EditorState {
    nodes: NodeInstance[];
    connections: Connection[];
    scale: number;
    pan: Position;
}
