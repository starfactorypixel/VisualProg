# TrueScript Visual Editor (VisualProg)

Визуальный нодовый редактор (в духе Blueprints/Node-RED), который позволяет собирать
скрипт-программу перетаскиванием блоков-команд и связей между ними, а затем
компилировать граф в текстовый байт-код скриптового языка **DrakeScript** (`.drk`)
для игрового движка/устройства **Pixel**. Есть также экспериментальные,
незавершённые заготовки экспортёров в C и x86 ASM.

> Файл создан автоматически для быстрого ввода в контекст при следующих подключениях
> нейросетей-ассистентов. Держите его в актуальном состоянии при значимых изменениях
> архитектуры.

## Технологический стек

- React 18 + TypeScript, сборка через Vite 5
- Состояние — Zustand (`create`), без middleware, ручной undo/redo стек в самом сторе
- Tailwind CSS + `clsx` / `tailwind-merge` для стилей
- `lucide-react` — иконки, `framer-motion` — анимации (используется частично)
- Нет тестов, нет бэкенда — чисто клиентское SPA, все данные — JSON-файлы

Команды (`package.json`):
```
npm run dev         # vite dev server
npm run build       # tsc && vite build
npm run lint        # eslint
npm run preview     # предпросмотр production-сборки
npm run drake:check # валидация всех файлов templates/*.json (см. ниже)
```

## Ключевая идея: язык = один файл шаблона

**Здесь нет отдельного `commands.json`/`data_types.json`.** Всё, что описывает
"язык" — какие ноды доступны в сайдбаре, их порты и визуал, типы данных
(вкладка DATA) и правила компиляции графа в код — лежит в ОДНОМ JSON-файле в
`templates/` (`drake_template.json`, `c_template.json`, `asm_template.json`).
Палитра нод в редакторе — это не статический конфиг, а результат загрузки
такого файла (см. `loadTemplate` в сторе и `TemplateSchema.ts` ниже).

- При старте приложения (`App.tsx`) само по себе через `fetch('/templates/
  drake_template.json')` подгружается DrakeScript-шаблон — это язык по
  умолчанию.
- В меню **File → Load Template...** можно выбрать с диска любой другой файл
  в этом же формате (`c_template.json`, `asm_template.json`, свой) — палитра
  нод (CMD) и типы данных (DATA) в сайдбаре тут же переключаются на него.
  Текущий граф на канвасе не стирается — ноды, которых нет в новой палитре,
  просто перестают находить своё определение (ожидаемо при смене языка).
- **File → Export** берёт текущий загруженный шаблон (что бы ни было
  активно — Drake/C/ASM/свой) и компилирует текущий граф в код по его
  правилам, скачивает `program.<extension>`.

## Формат файла шаблона (`src/utils/TemplateSchema.ts`)

Один файл — `{ id, name, extension, boilerplate, dataTypes, commands }`.
`commands` — по одной записи на каждый тип ноды, объединяющей UI-описание и
правило компиляции:

```json
"cmd_IfRegValEqu": {
    "name": "If (Reg = Val)",
    "nodeType": "function",
    "visual": { "color": "#f59e0b" },
    "control": { "in": "exec_in", "out": { "true": "exec_true", "false": "exec_false" } },
    "fields": [
        { "name": "Register", "type": "reg",    "dir": "in", "portId": "op1" },
        { "name": "Value",    "type": "int32",  "dir": "in", "portId": "op2" },
        { "name": "jump",     "type": "uint16", "role": "address", "of": "exec_false" }
    ],
    "opcode": "0x10",
    "length": 8
}
```

- `name`/`nodeType`/`visual` — как раньше в `commands.json`: подпись ноды,
  произвольная категория, цвет/иконка.
- `control` — exec-порты (вход и выход, либо `{true, false}` для ветвлений);
  подписи портов ("Prev"/"Next"/"TRUE"/"FALSE") — фиксированная конвенция,
  простановлены компилятором автоматически, в файле не хранятся.
- `fields[]` — порты с данными: `name` (подпись в UI), `type`, `dir`
  (`in`/`out`/`inout`/`const`), `portId`. `dir: "inout"` даёт входной порт с
  типом `ref:<type>` (регистр читается и перезаписывается на месте — как
  `IncReg`/`AndRegVal` и т.п.). `role: "address"` — поле не порт, а адрес
  ноды, подключённой к control-порту `of` (переходы/ветвления).
- Компиляция в код — **один из двух режимов на команду**:
  - **байт-режим** (`opcode` + `length`) — для VM/байт-код языков вроде
    DrakeScript. Байтовый размер каждого поля берётся из `type` через
    словарь `typeSizes` (`{"uint8":1,"uint16":2,"int32":4,"reg":1,"enum":1,
    "can_id":2}`), UI-тип порта — из `typeMap` (`{"reg":"register", ...}`,
    приводит байтовый `type` к `PortType` для рендера/проверки совместимости
    портов). `length` обязан равняться `1 + Σ размеров полей` — это
    проверяет `tools/validate-drake-template.mjs`.
  - **легаси-режим** (`template`: готовая printf-строка с `{portId}`-
    плейсхолдерами, опционально `weight`) — для C/ASM и вообще любого
    текстового вывода, где не нужен точный байтовый layout. `type` полей в
    этом режиме — уже готовый `PortType` (`string`/`number`/`boolean`), а не
    байтовый тип.
  - Ни `opcode`, ни `template` — команда чисто editor-only (`cmd_function`,
    `cmd_FunctionStart`): есть как нода в палитре, но не участвует в
    кодогенерации вообще.
- `compileNodeDefinitions()`/`compileDataTypes()`/`compileEmission()`
  (`TemplateSchema.ts`) — три чистые функции, превращающие сырой JSON в то,
  что нужно стору (палитра/типы) и `CodeGenerator`у (`nodes`/`weights` — те
  же, что раньше писались руками).

## Точка входа и структура UI

`src/main.tsx` → `src/App.tsx`: при монтировании фетчит дефолтный шаблон
(см. выше) и монтирует три зоны:

- `TopMenu` (`src/components/UI/TopMenu.tsx`) — меню File/Edit/View (базовая
  структура из `src/config/menu.json`, плюс вручную добавленные пункты
  Undo/Redo, Magnetic Grid, **Load Template...**/**Export**), кнопки
  Undo/Redo, переключатель Magnetic Grid.
- `Sidebar` (`src/components/Sidebar/Sidebar.tsx`) — 4 вкладки, всё из
  активного шаблона (стор):
  - **CMD** — список всех команд `activeTemplate.commands` (drag-and-drop на канвас)
  - **GRP** — `NodeGroupsPanel`, пошаговый мастер выбора ноды по параметрам
    (конфиг `src/config/node_groups.json`, например "выбери оператор
    сравнения → тип операндов → получи готовую ноду `cmd_IfRegValEqu`").
    Работает только для DrakeScript-шаблона (жёстко ссылается на его
    `commandId`), для C/ASM ничего не показывает.
  - **DATA** — типы данных `activeTemplate.dataTypes`
  - **FN** — `FunctionsPanel`, реестр переиспользуемых под-графов (функций),
    хранится в `localStorage` (`fn_registry_v1`), с фолбэком на
    `src/config/functions_registry.json`. Функция — это отдельный
    `SAVE_*.json`-файл графа, который при генерации кода инлайнится
    (см. ниже).
- `Canvas` (`src/components/Canvas/Canvas.tsx`) — рабочая область: пан/зум,
  рамка выделения, drag&drop нод, контекстное меню (`ConnectionLayer.tsx` рисует
  связи/провода, `Node.tsx` — рендер ноды и её портов, `MagneticGrid.tsx` —
  визуализация магнитной сетки, `FireflyParticles.tsx`/`AnimationManager.ts` —
  декоративные "светлячки"-частицы на связях).
- `VariablesBar` (`src/components/UI/VariablesBar.tsx`) — полоса переменных.

## Модель данных графа (`src/types/index.ts`)

- `NodeDefinition` — статическое описание типа ноды (теперь строится из
  активного шаблона через `compileNodeDefinitions()`, а не читается из файла
  напрямую): id, `type`, цвет/иконка, `inputs`/`outputs` (порты с `PortType:
  'execution' | 'string' | 'number' | 'boolean' | 'any'` — плюс на практике
  `'register'`/`'ref:register'` для DrakeScript, формально не входящие в этот
  union, как и раньше).
- `NodeInstance` — экземпляр на канвасе: `id`, `definitionId` (ссылка на
  `NodeDefinition` активного шаблона, либо на один из `dataTypes` для
  нод-данных), `position`, произвольные `data` (значения констант,
  привязанный файл функции и т.п.).
- `Connection` — связь `fromNodeId/fromPortId → toNodeId/toPortId`.
- Порты execution формируют поток управления (аналог exec-пинов в Blueprints),
  остальные типы — поток данных.

## Стор (`src/store/useEditorStore.ts`)

Один большой Zustand-стор, отвечает за:
- **`nodeDefinitions`/`dataTypes`/`activeTemplate`** — палитра и типы данных
  активного языка. Изначально пустые, заполняются вызовом `loadTemplate()`
  (из `App.tsx` при старте, либо из `TopMenu` при "Load Template...").
  `activeTemplate` — сырой JSON, его же использует `TopMenu`/`CodeGenerator`
  при "Export".
- CRUD нод/связей, выделение (одиночное/мультивыбор/рамкой), copy/duplicate/paste
- **Undo/Redo** — ручной стек `past`/`future` со снапшотами
  (`structuredClone`), лимит 50 шагов. Хоткеи в `App.tsx`: Ctrl+Z/Y,
  Ctrl+C/D/V, Delete.
- **Magnetic Grid** — опциональный режим авто-выравнивания нод по сетке
  строк/колонок (`recalculateGridRows`, `findNearestGridPoint`,
  `snapMagneticNodes`) — сложная геометрическая логика, при правках сначала
  разберитесь в `GridRow`/`MagneticGridConfig`.
- Валидацию совместимости портов при соединении (`completeLinking`,
  `spawnNodeAndConnect`) по базовому типу (с учётом префикса `ref:`).

⚠️ Есть неиспользуемый файл `src/store/useHistoryStore.ts` — альтернативный,
незаконченный undo-стор (ссылается на несуществующие `uuid()` и
`readExistingFile()`, нигде не импортируется). Не путать с рабочим undo/redo
из `useEditorStore`. Кандидат на удаление.

`src/hooks/` — пустая директория (зарезервирована, ничего не содержит).

## Генерация кода (`src/utils/CodeGenerator.ts`)

Ядро экспорта, не знает о формате шаблона — работает с уже скомпилированными
`nodes`/`weights` (см. `TemplateSchema.compileEmission()` выше). На входе —
`nodes`, `connections` и `ExportConfig` (весь загруженный шаблон, либо
легаси-объект с готовыми `nodes`/`weights`). Алгоритм:

1. **`expandFunctions()`** — рекурсивно инлайнит ноды `cmd_function`: подгружает
   внешний JSON-граф по `node.data.file` через `fetch('/'+filePath)` (файл
   должен лежать в корне проекта/`public/`), клонирует id (`oldId__funcNodeId`),
   находит `cmd_FunctionStart`/`cmd_Begin` и `cmd_End`, перепатчивает
   входящие/исходящие execution-связи на них. Есть защита от циклического
   импорта и лимит 100 итераций.
2. Обход исполняемого потока от точек входа (`cmd_start`/`cmd_ScriptInit`)
   через execution-связи (`traverseChain`), с поддержкой ветвления true/false
   (порты `exec_true/true` и `exec_false/false`) — false-ветка кладётся в стек
   `pendingFalseBranches` и обходится после основной цепочки.
3. Каждой ноде присваивается **адрес** (`nodeAddresses`), инкрементируемый на
   `weights[definitionId]`. `cmd_End` не генерирует байт, но получает адрес
   (нужен для `Goto`).
4. Рендер шаблона строки: подстановка `{param}` из `node.data`, либо из
   значения подключённой ноды через порт с тем же id. Модификаторы:
   `:hexN` (N байт, big-endian, `0x..` через пробел), `:dec` (форс-декатив,
   приоритетнее `useHex`), `:value`/`:label`/`:address`/`:delta`, спецпараметр
   `{self}` — адрес текущей ноды.

## Файлы `templates/*.json`

| Файл | Режим | Статус |
|---|---|---|
| `drake_template.json` (`id: DrakeScript`) | байт-режим | **основной, рабочий**, 48 команд |
| `c_template.json` (`id: c`) | легаси/`template` | черновой, 11 команд, минимальный набор |
| `asm_template.json` (`id: asm`) | легаси/`template` | черновой, 11 команд, минимальный набор |

`templates/old_drake_template_main.json` и `templates/drake_template - Copy.json`
— бэкапы совсем старых версий DrakeScript-шаблона (ещё до слияния с
командами и до структурной переделки байт-режима), `templates/
drake_template.json.bak_pre_isa_migration` — снимок живого файла прямо перед
сменой опкодов. Все untracked, оставлены для истории/отката, можно удалить,
когда не будут нужны.

`src/config/commands.json`, `data_types.json`, `export_templates.json`
**удалены** — их содержимое перенесено внутрь `templates/*.json` (см. выше).
Если где-то в старых заметках/памяти встречается ссылка на них — она устарела.

## Конфиги (`src/config/*.json`), которые остались отдельно

- **`node_groups.json`** — декларативные мастера подбора ноды (вкладка GRP):
  группа → шаги с вопросами/вариантами → таблица нод с тегами. Ссылается на
  `commandId` из `drake_template.json` напрямую (не универсален для других
  шаблонов).
- **`functions_registry.json`** — стартовый список функций для `FunctionsPanel`
  (реальные данные пользователь хранит в `localStorage`).
- **`menu.json`** — базовое описание верхнего меню File/Edit/View (TopMenu
  дополняет его вручную парой пунктов, см. выше).

## Формат опкодов DrakeScript — источник истины

- **`Скриптовый язык.xlsx`** (корень проекта, отслеживается git) — таблица
  команд движка Pixel: ID (hex), название, описание, байты параметров 1..10.
  Это внешняя спецификация, по которой изначально писались опкоды.
- **`scripts_table_fixed.tsv`** (в корне, untracked) — тот же реестр,
  выгруженный/поправленный в TSV для удобного парсинга/сверки.
- **`import/drake_script.json`** — более строгий, структурированный пример
  той же ISA (типизированные поля, `registers`, `enums`). Это референс/
  пример, приложение его не читает — но именно из него взяты текущие
  значения опкодов в `drake_template.json` (см. ниже).
- При добавлении новой команды: сверьтесь с xlsx/tsv/`import/drake_script.json`
  → добавьте запись прямо в `templates/drake_template.json` (`commands.
  cmd_Xxx`) → проверьте `npm run drake:check`.

## `tools/validate-drake-template.mjs` (`npm run drake:check`)

Проверяет все три файла `templates/*.json` напрямую, без промежуточных
конфигов:
1. Самосогласованность байт-режима: `length` == (1, если есть `opcode`) +
   Σ размеров полей из `typeSizes`.
2. Поля с `role: "address"` ссылаются на реальный control-порт той же команды.
3. Поля без `dir: "const"`/`role: "address"` обязаны иметь `portId`.
4. `node_groups.json` (только для `drake_template.json`) не ссылается на
   несуществующий `commandId`.

## История: миграция на новую ISA и слияние с `commands.json`

Раньше DrakeScript-шаблон был плоским набором printf-строк (`nodes: {commandId:
"0x06 {op1} {op2:hex4} ..."}`), а список нод/портов/визуала жил отдельно в
`commands.json`, типы данных — в `data_types.json`. Это уже приводило к
реальным багам из-за ручной синхронизации трёх файлов:

- `IfRegRegNeq` хранился под опечатанным ключом `cmd_IfRegReglNeq` (лишняя
  "l") в шаблоне — нода **молча выпадала** из любого экспорта.
- Шаблоны `AddRegReg`/`SubRegReg`/`MulRegReg`/`DivRegReg` использовали
  плейсхолдеры `{inR}`/`{inC}`, а реальные порты этих команд назывались
  `inR1`/`inR2` — в вывод попадали буквальные `{inR}`/`{inC}` вместо чисел.
- `cmd_SetScriptArgReg32` имел вес 8 байт, хотя реально занимает 4 — сдвигал
  все адреса/переходы после себя.
- `node_groups.json` ссылался на несуществующие `cmd_IfRegValGrt`/
  `cmd_IfRegRegGrt` вместо `...Gtr`.

Все четыре бага исправлены. Заодно: числа опкодов сменились на значения из
`import/drake_script.json` (например `IfRegValEqu`: было `0x06`, стало
`0x10`; `Goto`: `0x27` → `0x80`) — **это меняет бинарный вывод для
устройства/прошивки Pixel**, синхронизируйте с прошивкой, если она где-то
жёстко знает старые коды. Добавлены 5 новых команд из той же ISA (`NegReg`
`0x42`, `ModRegVal` `0x4B`, `ModRegReg` `0x4C`, `XorRegVal` `0x65`,
`XorRegReg` `0x66`) — они уже полноценные ноды в CMD, но не заведены в мастере
GRP (`node_groups.json` не трогали для них).

Не перенесено (осознанно): **`Run`** — в `import/drake_script.json` заявлен
`length: 7`, но описанные поля дают только 3 байта; формат непонятен,
добавлять нельзя, пока не уточнён у источника ISA.

Затем формат шаблона слили с `commands.json`/`data_types.json` в единый файл
(см. разделы выше) — это было отдельным решением уже после миграции ISA:
изначальный "гибрид" ISA+bindings жил в отдельной папке `import/`, которую
приложение не читало во время работы — по факту это был только офлайн-
генератор, а не runtime-интеграция. Финальная версия удаляет эту прослойку
и делает `templates/*.json` самодостаточными и загружаемыми в рантайме
(`loadTemplate`).

## Тестовые/примерные файлы в корне

`program.drk`, `program.c`, `program.asm`, `funk.drk`, `program2.drk`,
`program3.drk` — примеры сгенерированного вывода (результаты ручного
экспорта СО СТАРЫМИ опкодами/до слияния форматов, не генерируются
автоматически при сборке — не использовать как эталон для сверки байтов).
`SAVE_EXAMPLE.json`, `SAVE_FUNCTION.json`, `SAVE_STAGE.json`, `btn_fun.json`,
`button_sec2.json`, `button_sec3.json` — сохранённые графы проекта/функций
(формат `{ nodes, connections }`, как в `EditorState`), использовались как
демо/фикстуры при разработке функций и загрузке через `?file=...` в URL
(см. `App.tsx`, эффект с `URLSearchParams`).
`index_prototype.html` — более ранний HTML-прототип интерфейса до переезда на
React.

## `Archive/` — история версий (не трогать без необходимости)

Содержит полные снапшоты проекта на разных стадиях разработки:
`v1`…`v26`, `v25_`, `New`, `VisualProg`, плюс zip-бэкапы
(`VisualProg*.zip`, имена вида `VisualProg_2602081230.zip` = дата/время
`26-02-08 12:30`). `Archive/ReadMe.txt` — журнал изменений по версиям на
русском (например: "24 - ghost перемещение нод и связей", "20 - добавлена
работа с функциями" и т.д.) — полезен, чтобы понять, в какой версии какая
фича появилась.

⚠️ **Замечено**: `Archive/v26/` содержит собственные `.git/` и `.vite/` —
это вложенный git-репозиторий/рабочая копия внутри основного репо (отсюда
`?? Archive/v26/` в `git status`). Это не submodule, git его просто не видит
как содержимое. Перед коммитом файлов из `Archive/v26` стоит уточнить у
пользователя, не потеряются ли там несохранённые изменения.

## Известные особенности / технический долг

- `src/store/useHistoryStore.ts` — мёртвый, нерабочий код (см. выше), нигде не
  импортируется.
- Комментарии и UI-тексты — смесь русского и английского, придерживайтесь
  существующего стиля рядом с местом правки.
- Нет автотестов и CI — проверка изменений: `npm run drake:check` +
  `npx tsc --noEmit` на затронутых файлах + ручной прогон в браузере
  (`npm run dev`, см. ниже).
- `npm run build` (а именно `tsc`-часть) **падает независимо от задач этой
  сессии** на нескольких файлах, не связанных с шаблонами/кодогеном:
  `Sidebar.tsx` (обращение к несуществующему `linking` в `EditorStore`,
  лишний аргумент у `spawnNodeAndConnect`), `NodeGroupsPanel.tsx`
  (`Array.at`, нужен `lib: es2022`), `FunctionsPanel.tsx` (`require` без
  Node-типов), `ConnectionLayer.tsx` (неиспользуемая переменная), плюс
  всё тот же мёртвый `useHistoryStore.ts`. Проект в разработке гоняют через
  `npm run dev` (Vite/esbuild не проверяет типы), поэтому это долго
  оставалось незамеченным. Чинить `npm run build` рано или поздно придётся
  отдельно.
- `c_template.json`/`asm_template.json` — заведомо неполные (11 команд-
  заглушек каждый, унаследованы от черновиков, существовавших ещё до
  унификации формата), не рассчитывайте на них как на рабочий экспорт,
  только на `DrakeScript`.
- `NodeGroupsPanel`/`node_groups.json` жёстко привязаны к DrakeScript —
  при активном C/ASM-шаблоне вкладка GRP не показывает ничего осмысленного
  (сами команды по-прежнему доступны через вкладку CMD).
- Файл `Скриптовый язык.xlsx` может расходиться с `templates/drake_template.json`
  при добавлении новых опкодов — сверяйтесь вручную, `npm run drake:check`
  этого файла не касается.
