import { NodeInstance, Connection } from './index';

export type PinDirection = 'in' | 'out' | 'inout';

export interface PinDef {
    id: string;
    name: string;
    dir: PinDirection;
    dataType: string;
}

export interface FunctionSignature {
    pins: PinDef[];
}

// Формат файла функции — тот же {nodes, connections}, что у любого сохранения
// программы, плюс необязательная сигнатура пинов. Файлы без signature
// (btn_fun.json, SAVE_FUNCTION.json и т.п.) остаются валидными — просто 0 пинов.
export interface FunctionFileData {
    nodes: NodeInstance[];
    connections: Connection[];
    signature?: FunctionSignature;
}
