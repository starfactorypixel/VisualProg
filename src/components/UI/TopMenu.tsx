import React, { useState, useRef } from 'react';
import logo from '../../../img/logo.png';
import menuConfig from '../../config/menu.json';
import { useEditorStore, snapNodesToMagneticGrid } from '../../store/useEditorStore';
import { CodeGenerator } from '../../utils/CodeGenerator';
import { Disassembler, canDisassemble } from '../../utils/Disassembler';
import { useTranslate } from '../../i18n';

// Коды языков, для которых есть читаемое название в меню — остальные (есть
// в template.languages, но не в этом списке) просто показываются как есть
// (код в верхнем регистре).
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    zh: '中文',
    ja: '日本語',
};

// Переводы ИНТЕРФЕЙСА (public/lang/<code>.json, см. i18n.ts) не привязаны к
// шаблону — список доступных для них языков задаётся здесь же, отдельно от
// template.languages (который только про перевод name/label команд и групп
// КОНКРЕТНОГО шаблона). Меню показывает объединение обоих списков; какой
// словарь реально подтянется для выбранного кода — решает useEditorStore.setActiveLanguage.
const UI_LANGUAGES = ['ru'];

export const TopMenu: React.FC = () => {
    const t = useTranslate();
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const {
        nodes, connections, setData, loadTemplate, magneticGridMode, toggleMagneticGrid: _toggleMagneticGrid,
        undo, redo, canUndo, canRedo, activeTemplate, activeLanguage, setActiveLanguage
    } = useEditorStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadType, setUploadType] = useState<'project' | 'template' | 'import'>('project');

    const handleExport = async () => {
        const template = useEditorStore.getState().activeTemplate;
        if (!template) {
            alert(t('First load a language template: File → Load Template...'));
            return;
        }
        const generator = new CodeGenerator(nodes, connections, template);
        const code = await generator.generate();

        const warnings = generator.getWarnings();
        if (warnings.length) {
            const proceed = confirm(t('Unfilled fields will be exported as 0:\n\n{0}\n\nContinue export?', warnings.join('\n')));
            if (!proceed) return;
        }

        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `program.${template.extension || 'txt'}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleAction = (action: string) => {
        console.log('handleAction called with:', action);
        if (!action) return;

        if (action === 'file:new') {
            if (confirm(t('Are you sure you want to create a new project? Unsaved changes will be lost.'))) {
                setData({ nodes: [], connections: [] });
            }
        }
        else if (action === 'file:save') {
            const state = useEditorStore.getState();
            // currentFileSignature сохраняем обратно — иначе у открытого через
            // ?file=... тела функции это "Save" стирало бы signature (а с ней —
            // и пины на ноде вызова), если результат руками положить поверх
            // исходного файла функции, ведь другого способа перезаписать его
            // пока нет.
            const data: Record<string, unknown> = {
                nodes: state.nodes,
                connections: state.connections,
            };
            if (state.currentFileSignature) data.signature = state.currentFileSignature;

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Подсказываем исходное имя файла, если это открытая функция — чтобы
            // проще было положить скачанное обратно на то же место.
            a.download = state.currentFilePath ? state.currentFilePath.split('/').pop()! : 'project.json';
            a.click();
            URL.revokeObjectURL(url);
        }
        else if (action === 'file:open') {
            setUploadType('project');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'file:load_template') {
            setUploadType('template');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'file:export') {
            handleExport();
        }
        else if (action === 'file:import_program') {
            const template = useEditorStore.getState().activeTemplate;
            if (!template) {
                alert(t('First load a language template: File → Load Template...'));
                return;
            }
            if (!canDisassemble(template)) {
                alert(t('Import (disassembly) is only supported for byte-mode templates (opcode). This template needs a separate disassembler.'));
                return;
            }
            setUploadType('import');
            setTimeout(() => fileInputRef.current?.click(), 0);
        }
        else if (action === 'view:toggle_magnetic_grid') {
            const store = useEditorStore.getState();
            if ((store as any).toggleMagneticGrid) {
                (store as any).toggleMagneticGrid();
            }
        }
        else if (action.startsWith('lang:set:')) {
            const code = action.slice('lang:set:'.length);
            setActiveLanguage(code || null);
        }
    };

    const mergedMenu = {
        items: [
            ...menuConfig.items.map(item => {
                if (item.label === 'File') {
                    return {
                        ...item,
                        children: [
                            ...(item.children || []),
                            { label: '---', action: 'none' },
                            { label: 'Load Template...', action: 'file:load_template' },
                            { label: 'Import Program... (disassemble)', action: 'file:import_program' },
                            { label: 'Export', action: 'file:export' }
                        ]
                    };
                }
                if (item.label === 'View') {
                    return {
                        ...item,
                        children: [
                            ...(item.children || []),
                            { label: '---', action: 'none' },
                            { label: 'Magnetic Grid Mode', action: 'view:toggle_magnetic_grid', checked: magneticGridMode }
                        ]
                    };
                }
                return item;
            }),
            // Объединение языков перевода команд шаблона (template.languages) и
            // языков перевода интерфейса (UI_LANGUAGES, см. выше) — пользователю
            // без разницы, какой из двух словарей реально нашёлся для кода.
            ...((() => {
                const codes = Array.from(new Set([...(activeTemplate?.languages ?? []), ...UI_LANGUAGES]));
                if (codes.length === 0) return [];
                return [{
                    label: 'Language',
                    children: [
                        { label: 'Original', action: 'lang:set:', checked: !activeLanguage },
                        ...codes.map(code => ({
                            // Автоним языка (его название на нём самом) — не переводится,
                            // иначе пользователь не найдёт свой язык в чужом интерфейсе.
                            label: LANGUAGE_DISPLAY_NAMES[code] ?? code.toUpperCase(),
                            action: `lang:set:${code}`,
                            checked: activeLanguage === code,
                            noTranslate: true,
                        })),
                    ],
                }];
            })()),
        ]
    };

    const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const content = ev.target?.result as string;

                if (uploadType === 'import') {
                    const template = useEditorStore.getState().activeTemplate;
                    if (!template) {
                        alert(t('First load a language template: File → Load Template...'));
                        return;
                    }
                    const result = new Disassembler(template).disassemble(content);
                    const state = useEditorStore.getState();
                    const gridNodes = snapNodesToMagneticGrid(result.nodes, result.connections, state.magneticGridConfig, state.nodeDefinitions, state.dataTypes);
                    setData({ nodes: gridNodes, connections: result.connections });
                    const summary = t('Imported: {0} nodes, {1} connections.', result.nodes.length, result.connections.length);
                    alert(result.warnings.length ? `${summary}\n\n${t('Warnings:')}\n${result.warnings.join('\n')}` : summary);
                    return;
                }

                const data = JSON.parse(content);

                if (uploadType === 'project') {
                    if (data.nodes && data.connections) {
                        setData(data, data.signature, file.name);
                    } else {
                        alert(t('Invalid project file format'));
                    }
                } else if (uploadType === 'template') {
                    if (data.boilerplate && (data.commands || data.nodes)) {
                        loadTemplate(data);
                    } else {
                        alert(t('Invalid template format'));
                    }
                }

            } catch (err) {
                alert(t('Failed to parse file: {0}', (err as any).message));
                console.error(err);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="h-8 bg-neutral-900 border-b border-neutral-800 flex items-center select-none z-50">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept={uploadType === 'import' ? `.${useEditorStore.getState().activeTemplate?.extension || 'txt'},.txt` : '.json'}
                onChange={handleFileLoad}
            />
            
            <img src={logo} alt="" className="h-5 w-5 ml-2 shrink-0" />

            <div className="flex items-center px-2">
                {mergedMenu.items.map(item => (
                    <div
                        key={item.label}
                        className="relative px-3 py-1 hover:bg-neutral-800 cursor-pointer text-sm text-neutral-300"
                        onMouseEnter={() => activeMenu && setActiveMenu(item.label)}
                        onClick={() => setActiveMenu(activeMenu === item.label ? null : item.label)}
                    >
                        {t(item.label)}

                        {activeMenu === item.label && (
                            <div className="absolute top-full left-0 w-56 bg-neutral-800 border border-neutral-700 shadow-xl py-1 z-50">
                                {item.children?.map((child, idx) => {
                                    if (child.label === '---') {
                                        return <div key={idx} className="h-px bg-neutral-700 my-1" />;
                                    }
                                    return (
                                        <div
                                            key={child.label + idx}
                                            className="px-4 py-2 hover:bg-neutral-700 text-neutral-200 cursor-pointer flex justify-between items-center"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const action = (child as any).action;
                                                if (action && action !== 'none') handleAction(action);
                                                setActiveMenu(null);
                                            }}
                                        >
                                            <span>{(child as any).noTranslate ? child.label : t(child.label)}</span>
                                            {(child as any).checked && <span className="text-blue-400">✓</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex-1" />
            <div className="flex items-center gap-2 px-4">
                {/* Undo/Redo buttons */}
                <div className="flex items-center gap-1 mr-4">
                    <button
                        onClick={undo}
                        disabled={!canUndo()}
                        className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-all ${
                            canUndo()
                                ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                                : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                        }`}
                        title={t('Undo (Ctrl+Z)')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7v6h6"/>
                            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                        </svg>
                        <span>{t('Undo')}</span>
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo()}
                        className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-all ${
                            canRedo()
                                ? 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                                : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                        }`}
                        title={t('Redo (Ctrl+Y)')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 7v6h-6"/>
                            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/>
                        </svg>
                        <span>{t('Redo')}</span>
                    </button>
                </div>

                <button
                    onClick={() => {
                        const store = useEditorStore.getState();
                        if ((store as any).toggleMagneticGrid) {
                            (store as any).toggleMagneticGrid();
                        }
                    }}
                    className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-medium transition-all ${
                        magneticGridMode
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50'
                            : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                    }`}
                    title={t('Toggle Magnetic Grid Layout Mode')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <span>{t('Magnetic Grid')}</span>
                    {magneticGridMode && <span className="text-xs opacity-75">{t('ON')}</span>}
                </button>
            </div>

            {activeMenu && (
                <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setActiveMenu(null)}
                />
            )}
        </div>
    );
};
