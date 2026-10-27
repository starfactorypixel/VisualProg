// Короткий непрозрачный id для NodeInstance/Connection — формат нигде в коде
// не разбирается (просто string-ключ для fromNodeId/toNodeId), важна только
// уникальность в пределах одного проекта. crypto.randomUUID() (36 символов)
// избыточен для этой цели — раздувает сохранённые .json без всякой пользы.
export function genId(): string {
    return Math.random().toString(36).slice(2, 11);
}
