import { useEditorStore } from './store/useEditorStore';

// Перевод интерфейса (меню/вкладки/кнопки/подсказки/alert-confirm) — ключом
// служит сам исходный (английский — как есть в коде) текст, а не придуманный
// dot-path id: словарь public/lang/<code>.json выглядит как { "Open": "Открыть",
// ... }. Это сильно проще поддерживать для проекта такого размера, чем заводить
// отдельный id на каждую строку. Отдельно от translations в сторе — там ключ
// это стабильный id команды/группы шаблона, а не текст.
function applyTranslation(dict: Record<string, string>, text: string, args: Array<string | number>): string {
    const translated = dict[text] ?? text;
    // args — подстановка {0}, {1}... для сообщений с динамическими значениями
    // (счётчики, имена файлов) — ключом перевода остаётся статический шаблон
    // строки, а не итоговый текст с уже подставленными числами.
    if (args.length === 0) return translated;
    return args.reduce<string>((acc, arg, i) => acc.split(`{${i}}`).join(String(arg)), translated);
}

export function useTranslate() {
    const uiTranslations = useEditorStore((state) => state.uiTranslations);
    return (text: string, ...args: Array<string | number>) => applyTranslation(uiTranslations, text, args);
}

// Императивный вариант — для мест вне React-рендера (экшны в useEditorStore.ts
// и т.п.), где хук недоступен. Не реактивный: читает текущий словарь один раз
// в момент вызова — нормально для alert()/confirm(), вызываемых по действию
// пользователя, а не во время рендера.
export function translateUi(text: string, ...args: Array<string | number>): string {
    return applyTranslation(useEditorStore.getState().uiTranslations, text, args);
}
