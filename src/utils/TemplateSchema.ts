import { NodeDefinition, PortDefinition } from '../types';

// Единый формат файла шаблона (templates/drake_template.json, c_template.json,
// asm_template.json). Один файл описывает ВСЁ для одного "языка": какие ноды
// видны в редакторе (палитра/порты/визуал), какие у них типы данных (вкладка
// DATA), и как каждая команда превращается в код при экспорте. Никаких
// отдельных commands.json/data_types.json больше нет — этот файл самодостаточен.

export interface TemplateField {
    name?: string;                       // подпись порта в UI (если нет — используется portId)
    type: string;                        // 'uint8'|'uint16'|'int32'|'reg'|'enum'|'can_id' (байт-режим) либо уже готовый UI-тип ('string'|'number'|'boolean', легаси-режим)
    dir?: 'in' | 'out' | 'inout' | 'const';
    portId?: string;                     // id порта (обязателен, если dir != 'const' и role != 'address')
    value?: number;                      // значение для dir: 'const'
    role?: 'address';                    // поле — адрес ноды, подключённой к control-порту "of", а не порт с данными
    of?: string;                         // control-порт (exec_out/exec_false/...), см. role: 'address'
}

export interface TemplateCommand {
    name: string;
    nodeType?: string;                   // произвольная категория ('event'|'function'|...), для UI/группировки
    visual?: { color?: string; icon?: string };
    control?: { in?: string | null; out?: string | { true: string; false: string } | null };
    fields?: TemplateField[];
    // Кодогенерация — один из двух режимов на команду:
    opcode?: string;                     // байт-режим: hex-код команды, поля кодируются по typeSizes (см. drake_template.json)
    length?: number;                     // байт-режим: размер команды в байтах, включая опкод; либо editor-only маркер с length:0 без opcode (cmd_End)
    template?: string;                   // легаси-режим: готовая printf-строка с {portId}-плейсхолдерами (см. c_template.json/asm_template.json)
    weight?: number;                     // легаси-режим: вес адреса (по умолчанию 1)
}

export interface DataTypeDef {
    name: string;
    color: string;
    options?: (string | { value: string; label: string })[];
}

export interface RawTemplate {
    id: string;
    name: string;
    extension: string;
    boilerplate: { start: string; end: string };
    useHex?: boolean;
    useLabels?: boolean;
    types?: Record<string, string>;
    typeSizes?: Record<string, number>;   // байт-режим: размер типа поля в байтах
    typeMap?: Record<string, string>;     // байт-режим: тип поля -> UI PortType (напр. "reg" -> "register")
    dataTypes?: DataTypeDef[];
    structures?: { name: string; fields: { name: string; type: string }[] }[];
    commands: Record<string, TemplateCommand>;
}

const CONTROL_LABEL = { in: 'Prev', out: 'Next', true: 'TRUE', false: 'FALSE' };

function hexBytes(value: number, size: number): string {
    const bytes: string[] = [];
    const v = (value ?? 0) >>> 0;
    for (let k = 0; k < size; k++) {
        bytes.unshift('0x' + ((v >> (k * 8)) & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
    }
    return bytes.join(' ');
}

// Компилирует "commands" в те же nodes/weights, которые раньше писались руками:
// байт-режим (opcode+fields) — рендерит printf-строку с адресами/подстановками;
// легаси-режим (template) — используется как есть; editor-only команды (без
// opcode/length/template, напр. cmd_function/cmd_FunctionStart) в вывод не попадают.
export function compileEmission(template: RawTemplate): { nodes: Record<string, string>; weights: Record<string, number> } {
    const nodes: Record<string, string> = {};
    const weights: Record<string, number> = {};
    const typeSizes = template.typeSizes || {};

    for (const [commandId, cmd] of Object.entries(template.commands || {})) {
        if (cmd.template !== undefined) {
            nodes[commandId] = cmd.template;
            weights[commandId] = cmd.weight ?? 1;
            continue;
        }

        if (cmd.opcode === undefined) {
            if (cmd.length === undefined) continue; // чисто editor-only, в кодогене не участвует
            // Маркер без байт (напр. cmd_End) — адрес нужен, но эмитить нечего.
            weights[commandId] = cmd.length;
            nodes[commandId] = `\n{self:hex2} : # ${commandId.replace('cmd_', '')}()\n            `;
            continue;
        }

        weights[commandId] = cmd.length ?? 1;
        const commentParts: string[] = [];
        const byteParts: string[] = [cmd.opcode];

        for (const f of cmd.fields || []) {
            const size = typeSizes[f.type] ?? 1;
            if (f.dir === 'const') {
                commentParts.push(String(f.value ?? 0));
                byteParts.push(hexBytes(f.value ?? 0, size));
                continue;
            }
            if (f.role === 'address') {
                const token = `{${f.of}:address:hex${size}}`;
                commentParts.push(token);
                byteParts.push(token);
                continue;
            }
            const mod = size === 1 ? '' : `:hex${size}`;
            commentParts.push(f.dir === 'out' ? `{${f.portId}}` : `{${f.portId}:dec}`);
            byteParts.push(`{${f.portId}${mod}}`);
        }

        nodes[commandId] = `\n{self:hex2} : # ${commandId.replace('cmd_', '')}(${commentParts.join(', ')})\n            ${byteParts.join(' ')}`;
    }

    return { nodes, weights };
}

// Строит палитру нод (то, что раньше лежало в commands.json) прямо из "commands".
export function compileNodeDefinitions(template: RawTemplate): NodeDefinition[] {
    const typeMap = template.typeMap || {};
    const mapType = (t: string) => typeMap[t] ?? t;

    return Object.entries(template.commands || {}).map(([id, cmd]) => {
        const inputs: PortDefinition[] = [];
        const outputs: PortDefinition[] = [];

        if (cmd.control?.in) {
            inputs.push({ id: cmd.control.in, name: CONTROL_LABEL.in, type: 'execution' });
        }
        if (typeof cmd.control?.out === 'string') {
            outputs.push({ id: cmd.control.out, name: CONTROL_LABEL.out, type: 'execution' });
        } else if (cmd.control?.out) {
            outputs.push({ id: cmd.control.out.true, name: CONTROL_LABEL.true, type: 'execution' });
            outputs.push({ id: cmd.control.out.false, name: CONTROL_LABEL.false, type: 'execution' });
        }

        for (const f of cmd.fields || []) {
            if (!f.portId || f.role === 'address' || f.dir === 'const') continue;
            const uiType = mapType(f.type);
            const port: PortDefinition = { id: f.portId, name: f.name ?? f.portId, type: uiType as PortDefinition['type'] };
            if (f.dir === 'out') outputs.push(port);
            else if (f.dir === 'inout') inputs.push({ ...port, type: `ref:${uiType}` as PortDefinition['type'] });
            else inputs.push(port);
        }

        return {
            id,
            name: cmd.name,
            type: (cmd.nodeType ?? 'function') as NodeDefinition['type'],
            visual: cmd.visual,
            inputs,
            outputs,
        };
    });
}

export function compileDataTypes(template: RawTemplate): DataTypeDef[] {
    return template.dataTypes || [];
}
