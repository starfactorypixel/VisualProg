import { NodeInstance, Connection } from '../types';
import { RawTemplate, TemplateCommand, TemplateField } from './TemplateSchema';

// Обратный парсер (дизассемблер) для "байт-режимных" шаблонов (opcode+fields+
// typeSizes, см. compileEmission в TemplateSchema.ts). Формат экспортируемого
// файла нигде отдельно не описан — он целиком выведен из compileEmission: на
// каждую байт-команду эмитятся ровно 2 строки:
//   {адрес-hex} : # commandId(комментарий с расшифровкой операндов)
//               0xAA 0xBB 0xCC ...
// Вторая строка (после подстановки {portId}-плейсхолдеров) состоит ИСКЛЮЧИТЕЛЬНО
// из hex-токенов — этого достаточно, чтобы восстановить поток байт, не трогая
// комментарии/boilerplate. Поэтому дизассемблер работает для ЛЮБОГО шаблона в
// байт-режиме "из коробки", без единого нового поля в схеме шаблона — не только
// для drake_template.json. Легаси-шаблоны (команда описана printf-строкой
// "template", напр. c_template.json/asm_template.json) этим движком принципиально
// не парсятся — под них нужен отдельный дизассемблер (см. canDisassemble).

export interface DisassemblyResult {
    nodes: NodeInstance[];
    connections: Connection[];
    warnings: string[];
}

interface DecodedInstruction {
    address: number;
    length: number;
    commandId: string;
    cmd: TemplateCommand;
    node: NodeInstance;
    branchTargets: Record<string, number>; // control-порт (of) -> целевой байт-адрес
}

const COLUMN_SPACING = 350;
const ROW_SPACING = 220;
const ORIGIN = { x: 100, y: 100 };

export function canDisassemble(template: RawTemplate | null | undefined): boolean {
    if (!template?.commands) return false;
    return Object.values(template.commands).some(cmd => cmd.opcode !== undefined);
}

function extractByteStream(source: string): number[] {
    const bytes: number[] = [];
    const pureHexLine = /^\s*(?:0x[0-9a-f]{1,2}\s*)+$/i;
    const tokenRe = /0x[0-9a-f]{1,2}/gi;
    for (const line of source.split(/\r?\n/)) {
        if (!pureHexLine.test(line)) continue;
        for (const token of line.match(tokenRe) || []) bytes.push(parseInt(token, 16));
    }
    return bytes;
}

function readUint(bytes: number[], offset: number, size: number): number {
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + (bytes[offset + i] ?? 0);
    return v >>> 0;
}

function toSigned(v: number, size: number): number {
    const bits = size * 8;
    if (bits >= 32) return v | 0;
    const max = 2 ** bits;
    return v >= max / 2 ? v - max : v;
}

// Значения с вариантами (register/boolean и т.п.) форматируются в тот же
// hex-вид, что лежит в dataTypes[].options — иначе выпадающий список на ноде
// после импорта не подсветит нужный пункт (см. Node.tsx: <select value=...>).
function formatFieldValue(raw: number, field: TemplateField, template: RawTemplate, size: number): string {
    const uiType = (template.typeMap?.[field.type] ?? field.type).toLowerCase();
    const dt = template.dataTypes?.find(d => d.name.toLowerCase() === uiType);
    if (dt?.options?.length) {
        const hex = '0x' + raw.toString(16).toUpperCase().padStart(2, '0');
        const match = dt.options.find(o => (typeof o === 'string' ? o : o.value).toLowerCase() === hex.toLowerCase());
        return match ? (typeof match === 'string' ? match : match.value) : hex;
    }
    const value = field.type.toLowerCase().startsWith('int') ? toSigned(raw, size) : raw;
    return String(value);
}

function targetAddrOf(instr: DecodedInstruction, out: { portId: string; addressField?: TemplateField }): number {
    return out.addressField ? instr.branchTargets[out.portId] : instr.address + instr.length;
}

function getControlOuts(cmd: TemplateCommand): { portId: string; addressField?: TemplateField }[] {
    if (!cmd.control?.out) return [];
    const addressFieldFor = (portId: string) => cmd.fields?.find(f => f.role === 'address' && f.of === portId);
    if (typeof cmd.control.out === 'string') {
        const portId = cmd.control.out;
        return [{ portId, addressField: addressFieldFor(portId) }];
    }
    const { true: t, false: f } = cmd.control.out;
    return [
        { portId: t, addressField: addressFieldFor(t) },
        { portId: f, addressField: addressFieldFor(f) },
    ];
}

export class Disassembler {
    private template: RawTemplate;
    private opcodeMap = new Map<number, { commandId: string; cmd: TemplateCommand }>();
    private markerCommand: { commandId: string; cmd: TemplateCommand } | null = null;
    private warnings: string[] = [];

    constructor(template: RawTemplate) {
        this.template = template;
        for (const [commandId, cmd] of Object.entries(template.commands || {})) {
            if (cmd.opcode !== undefined) {
                this.opcodeMap.set(parseInt(cmd.opcode, 16), { commandId, cmd });
            } else if (cmd.length === 0 && !this.markerCommand) {
                // "Немая" метка без байт в потоке (напр. cmd_End) — нужна, чтобы было куда
                // подключить jump, у которого в потоке нет реальной инструкции-адресата.
                this.markerCommand = { commandId, cmd };
            }
        }
    }

    disassemble(source: string): DisassemblyResult {
        this.warnings = [];
        const bytes = extractByteStream(source);
        if (bytes.length === 0) {
            throw new Error('Не найдено ни одной строки с hex-байткодом. Импорт поддерживает только шаблоны в байт-режиме (opcode) — для legacy/printf-шаблонов нужен отдельный дизассемблер.');
        }

        const instrByAddr = new Map<number, DecodedInstruction>();
        const order: number[] = [];
        let address = 0;

        while (address < bytes.length) {
            const opcodeByte = bytes[address];
            const found = this.opcodeMap.get(opcodeByte);
            if (!found) {
                this.warnings.push(`Неизвестный opcode 0x${opcodeByte.toString(16).toUpperCase().padStart(2, '0')} по адресу 0x${address.toString(16).toUpperCase()} — разбор остановлен.`);
                break;
            }
            const { commandId, cmd } = found;
            const length = cmd.length ?? 1;
            if (address + length > bytes.length) {
                this.warnings.push(`Инструкция ${commandId} по адресу 0x${address.toString(16).toUpperCase()} обрезана концом файла.`);
                break;
            }

            const data: Record<string, any> = {};
            const branchTargets: Record<string, number> = {};
            let cursor = 1;
            for (const field of cmd.fields || []) {
                const size = this.template.typeSizes?.[field.type] ?? 1;
                const raw = readUint(bytes, address + cursor, size);
                if (field.dir === 'const') {
                    if (raw !== (field.value ?? 0)) {
                        this.warnings.push(`${commandId} (0x${address.toString(16).toUpperCase()}): константное поле = 0x${raw.toString(16)}, ожидалось ${field.value ?? 0} — возможна рассинхронизация разбора.`);
                    }
                } else if (field.role === 'address' && field.of) {
                    branchTargets[field.of] = raw;
                } else if (field.portId) {
                    data[field.portId] = formatFieldValue(raw, field, this.template, size);
                }
                cursor += size;
            }

            const node: NodeInstance = {
                id: `d_${address}`,
                definitionId: commandId,
                type: 'command',
                position: { x: 0, y: 0 },
                data,
            };

            instrByAddr.set(address, { address, length, commandId, cmd, node, branchTargets });
            order.push(address);
            address += length;
        }

        if (order.length === 0) {
            throw new Error(this.warnings[0] ?? 'Не удалось разобрать ни одной инструкции.');
        }

        this.synthesizeMarkers(instrByAddr, order);
        const connections = this.buildConnections(instrByAddr);
        this.layout(instrByAddr, order);

        return {
            nodes: order.map(addr => instrByAddr.get(addr)!.node),
            connections,
            warnings: this.warnings,
        };
    }

    private synthesizeMarkers(instrByAddr: Map<number, DecodedInstruction>, order: number[]) {
        if (!this.markerCommand) return;
        const { commandId, cmd } = this.markerCommand;

        // Дырка может возникнуть и на явном jump, и на обычном fallthrough — напр.
        // если ветка "false" не сливается обратно, а просто утыкается в конец
        // потока байт (там, где в исходном графе стоял cmd_End нулевой длины).
        const danglingTargets = new Set<number>();
        for (const addr of order) {
            const instr = instrByAddr.get(addr)!;
            for (const out of getControlOuts(instr.cmd)) {
                const target = targetAddrOf(instr, out);
                if (target !== undefined && !instrByAddr.has(target)) danglingTargets.add(target);
            }
        }

        for (const addr of danglingTargets) {
            const node: NodeInstance = {
                id: `d_end_${addr}`,
                definitionId: commandId,
                type: 'command',
                position: { x: 0, y: 0 },
                data: {},
            };
            instrByAddr.set(addr, { address: addr, length: 0, commandId, cmd, node, branchTargets: {} });
            order.push(addr);
        }
        order.sort((a, b) => a - b);
    }

    private buildConnections(instrByAddr: Map<number, DecodedInstruction>): Connection[] {
        const connections: Connection[] = [];
        for (const instr of instrByAddr.values()) {
            for (const out of getControlOuts(instr.cmd)) {
                const targetAddr = targetAddrOf(instr, out);
                const target = instrByAddr.get(targetAddr);
                if (!target) {
                    this.warnings.push(`${instr.commandId} (0x${instr.address.toString(16).toUpperCase()}): переход на несуществующий адрес 0x${targetAddr.toString(16).toUpperCase()} — связь пропущена.`);
                    continue;
                }
                connections.push({
                    id: `c_${instr.address}_${out.portId}`,
                    fromNodeId: instr.node.id,
                    fromPortId: out.portId,
                    toNodeId: target.node.id,
                    toPortId: target.cmd.control?.in ?? 'exec_in',
                });
            }
        }
        return connections;
    }

    // Раскладка: основная (fallthrough/"true") ветка продолжается в текущей
    // строке; второй выбор развилки ("false"/иной путь) уходит на новую строку
    // ниже — так разные варианты видно на разных линиях, а не друг на друге.
    private layout(instrByAddr: Map<number, DecodedInstruction>, order: number[]) {
        const visited = new Set<number>();
        let nextRow = 0;

        const walkChain = (startAddr: number, row: number, startCol: number = 0) => {
            const branchQueue: { addr: number; row: number; startCol: number }[] = [];
            let curAddr: number | undefined = startAddr;
            let col = startCol;
            while (curAddr !== undefined && !visited.has(curAddr)) {
                const instr = instrByAddr.get(curAddr);
                if (!instr) break;
                visited.add(curAddr);
                instr.node.position = { x: ORIGIN.x + col * COLUMN_SPACING, y: ORIGIN.y + row * ROW_SPACING };
                col++;

                const outs = getControlOuts(instr.cmd);
                const targets = outs.map(out => targetAddrOf(instr, out));

                if (targets.length > 1 && targets[1] !== undefined && !visited.has(targets[1]) && instrByAddr.has(targets[1])) {
                    // Новая строка начинается не с нулевой колонки, а сразу после ноды,
                    // из которой вышла развилка — так видно, на каком шаге разошлись пути.
                    branchQueue.push({ addr: targets[1], row: nextRow++, startCol: col });
                }

                const primary = targets[0];
                curAddr = primary !== undefined && !visited.has(primary) && instrByAddr.has(primary) ? primary : undefined;
            }
            for (const b of branchQueue) walkChain(b.addr, b.row, b.startCol);
        };

        const entryAddrs = order.filter(addr => instrByAddr.get(addr)!.cmd.nodeType === 'event');
        for (const addr of entryAddrs.length ? entryAddrs : [order[0]]) {
            if (!visited.has(addr)) walkChain(addr, nextRow++);
        }
        for (const addr of order) {
            if (!visited.has(addr)) walkChain(addr, nextRow++);
        }
    }
}
