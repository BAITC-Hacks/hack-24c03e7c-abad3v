# Контракт frontend ↔ backend для MVP AI Sana

Версия: 1.3. Обратно совместимые дополнения: `lastAnalysis` в ответах владельцу, `evidence`, `operation`, `generatedAt` и `stale` в AI-ответе. Сохраняются `previewRating`, `questionHistory`, применение AI через `sourceRevision` в PATCH и прежний смысл `rating`. Этот файл можно отправить Нурдаулету и использовать как общий источник истины. Полный план — `../HACKATHON_PLAN.md`. Backend доступен в `../server/`; frontend подключается к описанному API.

## Общие правила

- Все запросы идут на `/api`. Frontend в разработке проксирует `/api` на Express; при сборке frontend и API работают с одного origin.
- JSON использует `camelCase`. Даты в ответах — строки UTC ISO 8601.
- После выбора демо-профиля браузер отправляет cookie. Для `fetch` указать `credentials: "include"`.
- Автор действия берётся из серверной демо-сессии. Не передавать `businessId` и `teamId` в POST/PATCH.
- Неизвестные значения карточки — `null`. Пустые строки backend нормализует в `null`. `cardPatch` содержит только изменённые поля; `null` явно очищает поле.
- `revision` защищает от перезаписи новой версии старой формой или AI-ответом. При 409 перечитать задачу.
- Статус публикации: `draft` или `published`. Уровень рейтинга — отдельное поле: `needs_clarification` (0–39), `workable` (40–69), `ready` (70–89), `priority` (90–100).
- **Любой подтверждённый черновик можно опубликовать при любом балле**, включая 0. После публикации на него можно откликаться.
- Бизнес принимает решение по каждому отклику отдельно: `pending`, `selected`, `rejected`. Допустимы несколько `selected` и ноль `selected`.

## Поля задачи

`topic`: один из `education`, `career`, `operations`, `analytics`, `other`. Подписи на UI свободны: «Образование», «Карьера», «Операции», «Аналитика», «Другое».

`draftText`: исходный свободный текст. `card` — редактируемая структурированная карточка:

```json
{
  "title": null,
  "context": null,
  "need": null,
  "users": null,
  "data": {
    "availability": null,
    "source": null
  },
  "result": {
    "artifact": null,
    "scope": null
  },
  "success": {
    "metric": null,
    "target": null
  },
  "constraints": {
    "deadlineMode": null,
    "deadlineDate": null,
    "technologyAccess": null
  },
  "contact": {
    "channel": null,
    "consultation": null,
    "feedback": null
  }
}
```

| Поле | Подпись / значение для формы |
|---|---|
| `title` | Название задачи; 3–120 символов требуется при публикации |
| `context` | Что происходит сейчас? |
| `need` | Что нужно изменить и зачем? |
| `users` | Для кого решение? |
| `data.availability` | `available` / `planned` / `unavailable` / `null` = есть / планируем / нет / неизвестно |
| `data.source` | Какие материалы доступны либо как их получить? |
| `result.artifact` | Что команда сдаст? |
| `result.scope` | Границы результата или прототипа |
| `success.metric` | Что можно проверить? |
| `success.target` | При каком результате бизнес примет работу? |
| `constraints.deadlineMode` | `fixed` / `flexible` / `null` = срок задан / жёсткого срока нет / неизвестно |
| `constraints.deadlineDate` | `YYYY-MM-DD` или `null`; нужен при `fixed` |
| `constraints.technologyAccess` | Технологии, доступы или явное отсутствие ограничений |
| `contact.channel` | Рабочий контакт, email или URL |
| `contact.consultation` | Как команда консультируется с бизнесом? |
| `contact.feedback` | Как и когда бизнес даёт обратную связь? |

В рейтинге участвуют только валидные поля подтверждённой карточки. Название и тема нужны для интерфейса и публикации, но не добавляют баллов. Вес категорий: контекст + потребность 20; данные 20; результат 15; критерии успеха 15; ограничения 10; пользователи 10; контакт и взаимодействие 10. **Баллы рассчитывает backend.**

## Типы ответов, на которые опирается UI

`Rating`:

```json
{
  "score": 40,
  "level": "workable",
  "breakdown": [
    {
      "key": "contextNeed",
      "label": "Контекст и потребность",
      "earned": 20,
      "max": 20,
      "missing": []
    },
    {
      "key": "data",
      "label": "Данные и материалы",
      "earned": 0,
      "max": 20,
      "missing": ["Укажите доступность данных", "Назовите источник или план получения"]
    },
    {
      "key": "result",
      "label": "Ожидаемый результат",
      "earned": 10,
      "max": 15,
      "missing": ["Уточните границы результата"]
    },
    {
      "key": "success",
      "label": "Критерии успеха",
      "earned": 0,
      "max": 15,
      "missing": ["Укажите проверяемый показатель", "Опишите условие приёмки"]
    },
    {
      "key": "constraints",
      "label": "Ограничения",
      "earned": 0,
      "max": 10,
      "missing": ["Укажите срок", "Опишите технологии или доступы"]
    },
    {
      "key": "users",
      "label": "Пользователи",
      "earned": 10,
      "max": 10,
      "missing": []
    },
    {
      "key": "contact",
      "label": "Связь с бизнесом",
      "earned": 0,
      "max": 10,
      "missing": ["Укажите рабочий контакт", "Формат консультаций", "Порядок обратной связи"]
    }
  ],
  "missingFields": ["data.availability", "data.source", "result.scope", "success.metric", "success.target", "constraints.deadlineMode", "constraints.technologyAccess", "contact.channel", "contact.consultation", "contact.feedback"],
  "scoringVersion": "v1"
}
```

`breakdown` всегда содержит все семь категорий в этом порядке, `score` равен сумме `earned`. UI показывает `score`, `level`, категории и максимум три ближайшие подсказки из `missing`; сам баллы не считает.

- `task.previewRating` — предварительный балл сохранённого `workingCard`, включая категории и подсказки. Backend вычисляет его при каждом ответе владельцу, в том числе при `GET /api/tasks/:id` после перезагрузки страницы. Правка может как повысить, так и понизить этот балл. Только исходный текст, ответы или ещё не применённое предложение AI не добавляют баллы в рабочую карточку.
- `task.rating` — последний подтверждённый балл, до первого подтверждения равен 0. Изменение черновика не меняет его; каталог использует только этот рейтинг.
- После `confirm` оба рейтинга совпадают; `confirmedRevision === revision` означает, что сохранённая рабочая версия подтверждена. Несохранённые изменения frontend учитывает отдельно.
- `PATCH /api/tasks/:id` дополнительно сохраняет прежнее поле `previewRating` на верхнем уровне ответа для совместимости; оно равно `task.previewRating`.

`OwnerTask` в `{task}` для бизнеса (типы `Card`, `Rating`, `Question`, `Answer` описаны выше и ниже):

```ts
type OwnerTask = {
  id: string;
  draftText: string;
  topic: "education" | "career" | "operations" | "analytics" | "other";
  workingCard: Card;
  confirmedCard: Card | null;
  questions: Question[];
  questionHistory: Question[];
  answers: Answer[];
  lastAnalysis: LastAnalysis | null;
  revision: number;
  confirmedRevision: number | null;
  publicationStatus: "draft" | "published";
  rating: Rating;
  previewRating: Rating;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

После подтверждения `confirmedCard` содержит полный Card и `confirmedRevision === revision`. При изменении опубликованной задачи `workingCard` может быть новее `confirmedCard`; в каталоге остаётся предыдущая подтверждённая версия до следующего подтверждения.

`PublicTask` для команды: `{id, topic, card, rating, publicationStatus:"published", publishedAt}`. Здесь `card` — **только подтверждённая** версия; нет `workingCard`, `answers`, `questions`, `questionHistory`, `draftText`, `previewRating`, `lastAnalysis` или `evidence`. `GET /api/tasks/:id` возвращает `{task:OwnerTask}` владельцу и `{task:PublicTask}` команде.

Строка списка `TaskSummary`: `{id,title,topic,rating,publicationStatus,publishedAt,applicationCount,previewRating?}`. В каталоге title/topic/rating берутся из подтверждённой версии, `previewRating` отсутствует даже при запросе владельца. В списке бизнеса (`scope=mine`) title — рабочий `title` или первые 60 символов `draftText`, topic — рабочая тема, `rating` — подтверждённый балл (0 до первого подтверждения), `previewRating` — балл сохранённого черновика. Поэтому общий frontend-тип `TaskSummary` использует `previewRating?: Rating`, а `OwnerTask` — обязательное `previewRating: Rating`.

### Подключение предварительного рейтинга на frontend

При создании, открытии, сохранении, подтверждении и публикации задачи владельцу возвращается `OwnerTask` с обоими рейтингами. Для редактора используйте `task.previewRating`, для каталога — `task.rating`. В рабочем списке бизнеса можно показывать `item.previewRating` с подписью «Полнота черновика».

```ts
// Одинаково после GET и PATCH; не подменять предварительный балл на task.rating.
setPreviewRating(response.task.previewRating);
// Подпись «Подтверждённый балл» допустима только для актуальной сохранённой версии.
const confirmed = response.task.confirmedRevision === response.task.revision && !dirty;
```

Например: после сохранения полной карточки `previewRating.score=100`, а `rating.score=0`. Повторный GET сохраняет это различие. После подтверждения оба равны 100. Если очистить поле в опубликованной задаче, предварительный балл снизится, а публичный рейтинг сохранится до следующего подтверждения. Для предварительного рейтинга отдельной миграции или повторного seed не требуется.

`Question`: `{id,field,text,sourceRevision}`. `Answer`: `{questionId,value,skipped}`. При пропуске `value:null, skipped:true`; не превращать пропуск в выдуманный ответ.

`questions` — текущая партия вопросов, `questionHistory` — архив вопросов, включая текущие. Повторный анализ не удаляет связь старых ответов с исходным вопросом. ID переиспользуется только при совпадении поля и текста; новая формулировка получает новый ID. `Question.sourceRevision` остаётся версией создания вопроса; при применении предложения используйте верхнеуровневый `sourceRevision` AI-ответа. Ответы из истории сохраняются и участвуют в сборке карточки. Эти данные доступны только владельцу.

`answers` в PATCH заменяет весь массив ответов: сохраняйте предыдущие ответы и добавляйте изменённый ответ в конец массива. Оба режима используют последний непропущенный непустой ответ, если несколько вопросов относятся к одному полю; остальные ответы остаются в истории. Пропуск нового вопроса не удаляет предыдущий ответ на то же поле. Максимум одного значения на `questionId`, длина ответа до 2000 символов; общий JSON-запрос ограничен 64 КБ.

### Сохранённое предложение и его источники

```ts
type Evidence = {
  field: string; // путь из Card, например "data.source"
  sourceId: string; // "draft", "answer:<questionId>" или "card:<field>"
  quote: string; // точная цитата из источника на момент анализа
};

type LastAnalysis = {
  operation: "analyze" | "compose";
  sourceRevision: number;
  generatedAt: string; // UTC ISO 8601
  mode: "live" | "template";
  questions: Question[];
  proposal: Card;
  warnings: string[];
  evidence: Evidence[];
  stale: boolean;
};

type AiResult = Omit<LastAnalysis, "mode"> & {
  mode: "live" | "cached" | "template";
};
```

`OwnerTask.lastAnalysis` — последний завершённый результат analyze или compose, в том числе шаблонный. До первого анализа он равен `null`. Сервер сохраняет результат отдельно от `workingCard`; генерация не увеличивает `revision` и не подтверждает сведения. Новый завершённый анализ заменяет предыдущий; ошибка 409/429 не стирает сохранённый результат.

После обычного сохранения или применения предложения `lastAnalysis.stale` становится `true`, поскольку `sourceRevision !== task.revision`. Устаревший результат можно показывать для сравнения, но применять нельзя. Локальные несохранённые правки проверяйте отдельно через `dirty`. При повторном использовании кэша AI-ответ имеет `mode:"cached"`, а сохранённый результат — исходный `mode:"live"` и прежний `generatedAt`; повторного вызова модели нет. `AI_MODE=template` принудительно использует шаблон и не возвращает live-кэш.

`evidence` описывает только новые значения, добавленные предложением. Сохранённым или защищённым полям AI-происхождение не приписывается. Цитата из `draft` относится к исходному описанию; `answer:<id>` — к ответу на вопрос из `questionHistory`; `card:<field>` — к сохранённому полю, использованному как источник другого поля. Цитаты сохраняются в снимке результата, поэтому их можно прочитать даже после изменения исходного текста. Совпадение цитаты с источником не доказывает правильность вывода AI: человек всё равно проверяет предлагаемое значение. В каталоге и публичной карточке эти данные не возвращаются.

Подключение при открытии редактора:

```ts
const { task } = await api.getTask(taskId);
setCard(task.workingCard);
setQuestions(task.questions); // compose возвращает questions: [], но активные вопросы сохранены
setAnswers(task.answers);
setAiResult(task.lastAnalysis); // null скрывает блок предложения
const canApply = !!task.lastAnalysis && !task.lastAnalysis.stale && !dirty;
// У поля: lastAnalysis.evidence.find(item => item.field === "data.source")?.quote
```

Предложение не подставлять в редактируемую карточку при загрузке: пользователь применяет его отдельным PATCH с `sourceRevision`, как в примере ниже. После успешного PATCH показывайте возвращённый `task`, включая новый признак `lastAnalysis.stale`.

`Application`: `{id,taskId,teamId,teamName,idea,plan,timeline,prototypeUrl,status,createdAt,decidedAt}`. Пример timeline — «2 недели»; prototypeUrl — ссылка http/https, не файл.

## API для разработки

Все ответы обёрнуты в объект. Запросы с body — JSON. Авторизацию после выбора профиля обеспечивает cookie.

| Метод и путь | Request | Response / экран |
|---|---|---|
| `GET /api/health` | — | `{status:"ok",db:"ok"}`; проверка запуска |
| `GET /api/demo/actors` | — | `{items:[{id,kind:"business"|"team",name,profile}]}`; переключатель демо-ролей |
| `POST /api/demo/session` | `{actorId}` | `{actor}` + cookie; выбор роли и профиля |
| `POST /api/tasks` | `{draftText,topic}` | 201 `{task:OwnerTask}`; начать редактор |
| `GET /api/tasks?scope=mine` | — | `{items:TaskSummary[],total}`; рабочая область бизнеса |
| `GET /api/tasks?scope=catalog&topic=education&level=ready` | фильтры необязательны; `limit/offset` необязательны | `{items:TaskSummary[],total}`; только опубликованные, сортировка `score DESC, publishedAt DESC` |
| `GET /api/tasks/:id` | — | `{task:OwnerTask}` владельцу либо `{task:PublicTask}` команде |
| `PATCH /api/tasks/:id` | `{revision,draftText?,topic?,cardPatch?,answers?,sourceRevision?}` | `{task:OwnerTask,previewRating:Rating}`; сохраняет рабочую версию, увеличивает revision; `sourceRevision` передаётся при применении AI |
| `POST /api/tasks/:id/analyze` | `{revision,mode:"analyze"|"compose"}` | `AiResult` (тип выше); предложение сохраняется в `lastAnalysis`, рабочий Card не меняется |
| `POST /api/tasks/:id/confirm` | `{revision,confirmed:true}` | `{task:OwnerTask,rating:Rating}`; подтверждает текущий Card и пересчитывает баллы |
| `POST /api/tasks/:id/publish` | `{revision}` | `{task:OwnerTask}`; требуется подтверждённая текущая версия, порога рейтинга нет |
| `POST /api/tasks/:id/applications` | `{idea,plan,timeline,prototypeUrl,clientRequestId}` | 201 `{application:Application}`; предложение текущей команды |
| `GET /api/tasks/:id/applications` | `limit/offset` необязательны | `{items:Application[],total}`; владелец видит все, команда — свои |
| `PATCH /api/applications/:id` | `{status:"selected"|"rejected"}` | `{application:Application}`; действие бизнеса по одному отклику |

`POST /analyze` в режиме `analyze` возвращает **3–5 вопросов**. Frontend показывает их и сохраняет ответы через `PATCH /tasks/:id` в `answers`; каждый ответ `{questionId,value,skipped}`. В обоих режимах backend использует исходный текст и **уже сохранённые** ответы, в том числе на архивные вопросы. `compose` работает и без предварительного применения результата `analyze`.

Предложение заполняет только незаполненные поля. Непустые сохранённые значения и поля, явно изменённые пользователем (в том числе очищенные до `null`), защищены от автоматической замены. Отправка полной карточки не защищает неизменённые пустые поля. Принятые и сохранённые предложения также становятся частью пользовательской карточки. Шаблонный режим извлекает только явно распознаваемые сведения; неизвестные значения остаются `null`, неоднозначные ответы требуют ручной проверки. AI сам не изменяет `workingCard`, подтверждённый рейтинг или публикацию.

Для применения предложения frontend отправляет отдельный PATCH только с `revision`, `cardPatch` и `sourceRevision` из AI-ответа; изменения текста, темы и ответов сохраняются заранее обычным PATCH. Затем пользователь отдельно подтверждает сведения. Backend отклоняет устаревшее предложение с 409 и защищает уже заполненные/очищенные поля даже при передаче полной карточки. Пример:

```ts
// Нельзя заменять локальные несохранённые правки старым предложением.
if (dirty || task.revision !== aiResult.sourceRevision) {
  // Сохранить правки и получить новое предложение; показать объяснение пользователю.
  return;
}
const response = await api.patchTask(task.id, {
  revision: task.revision,
  sourceRevision: aiResult.sourceRevision,
  cardPatch: aiResult.proposal,
});
// Показать response.task. При 409 сохранить локальный ввод и предложить обновить анализ.
```

Без `sourceRevision` PATCH остаётся обычным ручным редактированием и может менять ранее заполненные поля. Если AI недоступен, тот же endpoint возвращает `mode:"template"`; UI честно показывает эту метку. Сервер автоматически добавляет служебные колонки SQLite для защищённых полей, истории вопросов и последнего предложения при запуске; повторный seed не требуется. Старые задачи получают `lastAnalysis:null` до следующего анализа.

Исходное описание до 6000 символов целиком передаётся в live-запрос. Карточка не дублируется в источниках, а повторные ответы на одно поле заменяются актуальным. Полный запрос к AI, включая инструкции и схему, ограничен 64 КиБ; если накопленных данных больше, сервер возвращает шаблон и объяснение в `warnings`, сохраняя весь пользовательский ввод. Такая проверка выполняется до внешнего вызова и резервирования бюджета. Резерв стоимости остальных запросов учитывает фактический размер подготовленного запроса с запасом, а после ответа уточняется по usage.

Пример изменения вложенного поля:

```json
{
  "revision": 2,
  "cardPatch": {
    "data": {"availability": "planned", "source": "20 обезличенных вакансий"},
    "success": {"metric": "Проверка сценариев", "target": "8 из 10"}
  }
}
```

`cardPatch` — **глубокое объединение только известных полей Card**, а не замена всего Card. При конфликте revision сервер возвращает 409, фронтенд загружает актуальную задачу. Временный результат AI не может перезаписать изменённый пользователем Card: сверяем `sourceRevision`.

Общая форма ошибки:

```json
{"error":{"code":"REVISION_CONFLICT","message":"Задача изменилась. Обновите страницу.","fields":{}}}
```

Обычные HTTP-коды: 400 неверный JSON, 401 демо-профиль не выбран, 403 действие другой роли/владельца, 404 задача не найдена, 409 устаревшая версия или неподтверждённая правка, 422 ошибка поля, 429 лимит AI, 503 сбой БД. Ошибку показывать около действия; введённые пользователем данные не очищать.

## Что Нурдаулет может начать сразу

1. Четыре экрана: задачи бизнеса, редактор, каталог с detail/form drawer, отклики бизнеса.
2. Макеты объектов выше как временные данные. Одна функция API client с `credentials: "include"`.
3. Редактор из полей `Card`, блок 3–5 вопросов и `Rating` с расшифровкой. Отдельные состояния «сохраняется», «AI думает», «шаблонный режим», «ошибка».
4. Каталог на `TaskSummary`: сортировку выполняет backend; frontend отправляет `topic` и `level` и показывает возвращённый порядок.
5. Подключить реальные `POST /tasks` и `GET /tasks/:id` в первый час; остальные действия подключать по мере готовности backend.

Если нужно изменить имя поля или форму ответа, сначала правим этот контракт и пример, затем backend и frontend. Это не мешает параллельной работе и позволяет ловить несовпадения рано.
