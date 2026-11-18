import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';

const ICON_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg'];

interface TemplateIconProps {
    // Стабильный id команды (NodeDefinition.id, напр. "cmd_ScriptInit") или
    // группы (NodeGroupDef.id, напр. "grp_compare") — НЕ пользовательское label/
    // name, т.к. то произвольный текст для отображения и может меняться/содержать
    // что угодно. Картинка необязательна и лежит в templates/<id шаблона>/<id>.<ext>;
    // если файла нет (ни под одним из ICON_EXTENSIONS), рендерится fallback.
    id: string;
    size?: number;
    className?: string;
    fallback?: React.ReactNode;
}

export const TemplateIcon: React.FC<TemplateIconProps> = ({ id, size = 16, className, fallback = null }) => {
    const activeTemplateId = useEditorStore((state) => state.activeTemplate?.id);
    const [extIdx, setExtIdx] = useState(0);

    // Если пока компонент жив сменился id (другая команда/группа) или активный
    // шаблон — перебор расширений должен начаться заново.
    useEffect(() => {
        setExtIdx(0);
    }, [id, activeTemplateId]);

    if (!activeTemplateId || extIdx >= ICON_EXTENSIONS.length) {
        return <>{fallback}</>;
    }

    return (
        <img
            key={`${activeTemplateId}/${id}`}
            src={`/templates/${encodeURIComponent(activeTemplateId)}/${encodeURIComponent(id)}.${ICON_EXTENSIONS[extIdx]}`}
            alt=""
            style={{ width: size, height: size }}
            className={className}
            onError={() => setExtIdx((i) => i + 1)}
        />
    );
};
