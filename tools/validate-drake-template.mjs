// tools/validate-drake-template.mjs
//
// Проверяет файлы шаблонов (templates/*.json) в едином формате — команда
// описывает СРАЗУ и то, как нода выглядит в редакторе (name/visual/control/
// fields[].portId), и как она компилируется в код (opcode+length, либо
// легаси template-строка). Никакого отдельного commands.json/data_types.json
// больше нет — единственный источник истины на файл.
//
// Запуск: node tools/validate-drake-template.mjs   (код возврата 1 при ошибках)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

const TEMPLATE_FILES = [
    'templates/drake_template.json',
    'templates/c_template.json',
    'templates/asm_template.json',
];

const nodeGroups = readJson('src/config/node_groups.json');

let totalErrors = 0;
let totalWarnings = 0;

for (const rel of TEMPLATE_FILES) {
    const errors = [];
    const warnings = [];
    const err = (m) => errors.push(m);
    const warn = (m) => warnings.push(m);

    let template;
    try {
        template = readJson(rel);
    } catch (e) {
        console.error(`\n=== ${rel} ===`);
        console.error('[error] не удалось прочитать/распарсить файл:', e.message);
        totalErrors++;
        continue;
    }

    const typeSizes = template.typeSizes || {};
    const commands = template.commands || {};

    for (const [commandId, cmd] of Object.entries(commands)) {
        const controlPorts = new Set();
        if (cmd.control?.in) controlPorts.add(cmd.control.in);
        if (typeof cmd.control?.out === 'string') controlPorts.add(cmd.control.out);
        else if (cmd.control?.out) { controlPorts.add(cmd.control.out.true); controlPorts.add(cmd.control.out.false); }

        // Байт-режим: length должен совпадать с 1(опкод) + сумма размеров полей
        if (cmd.opcode !== undefined) {
            let sum = 1;
            let unknown = false;
            for (const f of cmd.fields || []) {
                const size = typeSizes[f.type];
                if (size === undefined) { warn(`${commandId}: неизвестный тип поля "${f.type}" (${f.name ?? '?'})`); unknown = true; continue; }
                sum += size;
            }
            if (!unknown && sum !== cmd.length) {
                err(`${commandId}: length=${cmd.length}, а по полям сумма=${sum} байт`);
            }
        }

        // Поля-адреса должны ссылаться на реальный control-порт этой же команды
        for (const f of cmd.fields || []) {
            if (f.role === 'address') {
                if (!controlPorts.has(f.of)) err(`${commandId}: поле "${f.name ?? '?'}" ссылается на control-порт "${f.of}", которого нет в control этой команды`);
                continue;
            }
            if (f.dir === 'const') continue;
            if (!f.portId) err(`${commandId}: поле "${f.name ?? '?'}" (dir=${f.dir ?? 'in'}) без portId`);
        }

        // Легаси-режим (template-строка) и байт-режим (opcode) взаимоисключающие
        if (cmd.opcode !== undefined && cmd.template !== undefined) {
            warn(`${commandId}: заданы и "opcode", и "template" одновременно — используется opcode, template игнорируется`);
        }
    }

    // node_groups.json ссылается на команды только DrakeScript-шаблона (это его wizard)
    if (rel === 'templates/drake_template.json') {
        for (const g of nodeGroups.groups || []) {
            for (const n of g.nodes || []) {
                if (!(n.commandId in commands)) err(`node_groups.json: группа "${g.id}" ссылается на несуществующий commandId "${n.commandId}"`);
            }
        }
    }

    console.log(`\n=== ${rel} ===`);
    for (const w of warnings) console.warn('[warn]', w);
    for (const e of errors) console.error('[error]', e);
    console.log(`Команд: ${Object.keys(commands).length}. Предупреждений: ${warnings.length}, ошибок: ${errors.length}.`);

    totalErrors += errors.length;
    totalWarnings += warnings.length;
}

console.log(`\nИтого предупреждений: ${totalWarnings}, ошибок: ${totalErrors}.`);
process.exit(totalErrors > 0 ? 1 : 0);
