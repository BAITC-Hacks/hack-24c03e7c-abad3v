# Контракт frontend ↔ backend для MVP AI Sana

Версия: 2.1. Контракт редактора с автосохранением, источниками предложений и отдельной опубликованной версией. Совместим с `lastAnalysis`, метаданными анализа и большими исходными текстами из backend 1.3. Полный план — `../HACKATHON_PLAN.md`. Backend доступен в `../server/`; frontend подключается к описанному API.

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

`breakdown` всегда содержит все семь категорий в этом порядке, `score` равен сумме `earned`. UI показывает `score`, `level`, категории и максимум три ближайшие подсказки из `missing`; сам баллы не считает. `task.previewRating` есть в каждом ответе владельцу, включая загрузку: это полнота текущего рабочего черновика. `task.rating` остаётся последним подтверждённым баллом. PATCH также возвращает `previewRating` на верхнем уровне для совместимости.

`OwnerTask` в `{task}` для бизнеса (типы `Card`, `Rating`, `Question`, `Answer` описаны выше и ниже):

```ts
type OwnerTask = {
  id: string;
  draftText: string;
  topic: "education" | "career" | "operations" | "analytics" | "other";
  workingCard: Card;
  confirmedCard: Card | null;
  publishedCard: Card | null;
  questions: Question[];
  questionHistory: Question[];
  answers: Answer[];
  revision: number;
  confirmedRevision: number | null;
  publishedRevision: number | null;
  hasUnpublishedChanges: boolean;
  manualFields: string[];
  aiResult: AiResult | null;
  lastAnalysis: AiResult | null;
  publicationStatus: "draft" | "published";
  rating: Rating;
  previewRating: Rating;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

После подтверждения `confirmedCard` содержит полный Card и `confirmedRevision === revision`. Только явный `publish` копирует эту версию в `publishedCard` вместе с темой и рейтингом. Правка и даже повторное подтверждение не меняют каталог. `hasUnpublishedChanges` равен true у опубликованной задачи, если рабочая revision отличается от publishedRevision. Повторный publish текущей опубликованной версии безопасен и не меняет дату публикации.

`PublicTask` для команды: `{id, topic, card, rating, publicationStatus:"published", publishedAt}`. Здесь `card` — отдельный **опубликованный снимок**; нет `workingCard`, `answers`, `questions` или `draftText`. `GET /api/tasks/:id` возвращает `{task:OwnerTask}` владельцу и `{task:PublicTask}` команде.

Строка списка `TaskSummary`: `{id,title,topic,rating,previewRating,publicationStatus,publishedAt,applicationCount,pendingApplicationCount,need,result,dataAvailability,deadline,hasUnpublishedChanges,updatedAt}`. `need` и `result` — строка или null; result содержит `result.artifact`. `dataAvailability` — `available|planned|unavailable|null`. `deadline` — дата YYYY-MM-DD, «Гибкий срок» или null. В каталоге все сведения, рейтинг и сортировка берутся из опубликованного снимка, `previewRating === rating`, `hasUnpublishedChanges:false`, `updatedAt === publishedAt`. В списке бизнеса title/topic/need/result/dataAvailability/deadline/previewRating берутся из рабочего черновика; `rating=0` до первого подтверждения. `pendingApplicationCount` используется в бизнес-списке для числа ожидающих решения откликов (в каталоге 0).

`Question`: `{id,field,text,sourceRevision}`. `Answer`: `{questionId,value,skipped}`. При пропуске `value:null, skipped:true`; не превращать пропуск в выдуманный ответ.

ID вопроса стабилен для поля (`q:data.availability`; прежние ID сохраняются для совместимости). `task.questions` содержит только текущую партию вопросов последнего analyze. Compose сохраняет эту партию без изменений. `questionHistory` хранит все известные вопросы, включая текущие и архивные; ответы связываются с полями через эту историю. Повторный анализ не теряет старые ответы. `Question.sourceRevision` — версия создания вопроса, верхнеуровневый `AiResult.sourceRevision` — версия анализируемой карточки. PATCH `answers` обновляет только переданные questionId; остальные ответы сохраняются. Обновлённые ответы перемещаются в конец массива: при нескольких архивных вопросах к одному полю используется последний ответ, включая последний пропуск или очистку — они отменяют прежнее значение. Для очистки передать `{questionId,value:null,skipped:false}`. Ограничение 20 ответов снято; действуют предел 2000 символов на ответ и общий лимит JSON 64 КБ.

```ts
type AiResult = {
  sourceRevision: number;
  operation: 'analyze' | 'compose';
  generatedAt: string;
  stale: boolean;
  mode: 'live' | 'cached' | 'template';
  originMode?: 'live' | 'template';
  inputSnapshot?: { draftText: string; topic: OwnerTask['topic']; answers: Answer[]; manualFields: string[] };
  questions: Question[];
  proposal: Card;
  warnings: string[];
  evidence: Array<{ field: string; sourceId: string; quote: string }>;
};
```

`aiResult` и совместимый alias `lastAnalysis` содержат последнее предложение, включая шаблонное, и восстанавливаются после загрузки. Миграция переносит сохранённое значение из любого из прежних форматов; до первого анализа оба поля null. `operation` показывает тип операции, `generatedAt` — время её выполнения UTC ISO 8601. `stale` вычисляется как `sourceRevision !== task.revision`: после сохранения предложение можно показывать для сравнения, но нельзя применять как актуальное без нового анализа. При live-кэше API отвечает `mode:cached`, а сохранённый снимок сохраняет `mode:live` и исходное `generatedAt`. `AI_MODE=template` никогда не возвращает live-кэш. Новые результаты содержат `originMode: "live" | "template"` и `inputSnapshot: {draftText, topic, answers, manualFields}`. Эти сведения доступны только владельцу задачи. Интерфейс сравнивает исходные сведения и карточку с результатом: применение самого предложения не считается новым изменением входа, хотя увеличивает revision. В старых результатах поля могут отсутствовать; тогда используется прежний признак stale.

`evidence` содержит точные исходные цитаты для AI-предложений, сохраняя исходные пробелы и переносы: `draft` — исходное описание, `answer:<questionId>` — последний ответ к полю, `card:<path>` — существующее поле, использованное как источник другого. Ручные поля не получают искусственную AI-метку; происхождение ранее принятого AI-поля сохраняется, пока цитата актуальна и значение не изменено вручную. Неизвестные сведения остаются null. Локальный шаблон консервативно извлекает сведения из текста и переносит ответы, включая перечисления и дату; это не живая генерация. Для срока ответ может содержать `flexible`, `fixed` или дату YYYY-MM-DD; для доступности данных — `available`, `planned`, `unavailable`. Ответ с проверяемым числом на вопрос `success.metric` также предлагается как `success.target`.

Live-запрос получает всё описание до 6000 символов, по одному актуальному ответу на поле и сохранённые поля без дублирования целой карточки. Полный сериализованный запрос с инструкциями и схемой ограничен 64 КиБ. При превышении возвращаются шаблон и объяснение в `warnings`; весь ввод остаётся сохранённым, внешнего вызова и резервирования бюджета нет. Резерв стоимости вычисляется по размеру подготовленного запроса и уточняется после ответа по usage.

`manualFields` — список путей Card, изменённых пользователем, включая намеренно очищенные. Новый frontend **всегда** отправляет этот список, включая `[]`: PATCH заменяет список защиты и переносит объединение прежних ручных правок с новыми. Для совместимости со старым frontend при отсутствии `manualFields` изменённые поля автоматически считаются ручными; неизменённые пустые поля не блокируются. Backend не перезаписывает защищённые поля при генерации; frontend также объединяет предложение с рабочей карточкой по полям, сохраняя ручные и несохранённые конкурентные правки. Для снятия защиты передать новый список без нужного пути. AI не применяет proposal к workingCard автоматически.

При повторном анализе прежнее AI-поле очищается, если оно не исправлено вручную, совпадает с предыдущим предложением, а его цитата исчезла из описания/ответа. Frontend переносит и такие `null`; объединение только ненулевых значений восстановит устаревший факт. При недоступности происхождения сохранённое значение сохраняется консервативно.

Старый способ применения AI поддерживается через отдельный PATCH `{revision,sourceRevision,cardPatch}`. Backend проверяет обе версии, отклоняет устаревшее предложение с 409, не меняет уже заполненные/защищённые поля. В этом запросе нельзя одновременно менять исходный текст, тему или ответы. Новый редактор использует явный `manualFields` и проверку версии перед объединением предложения; принятые AI-поля не следует помечать ручными. Оба способа требуют отдельного подтверждения перед публикацией.

`Application`: `{id,taskId,teamId,teamName,idea,plan,timeline,prototypeUrl,status,createdAt,decidedAt}`. Общий список дополнительно содержит `taskTitle`: рабочее название для владельца бизнеса и опубликованное название для команды. Пример timeline — «2 недели»; prototypeUrl — ссылка http/https, не файл.

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
| `GET /api/tasks/applications` | `limit` по умолчанию 100 (1–100), `offset` по умолчанию 0 | `{items:(Application & {taskTitle:string})[],total}`; бизнес видит отклики только на свои задачи, команда — только свои отклики на опубликованные задачи |
| `GET /api/tasks/:id` | — | `{task:OwnerTask}` владельцу либо `{task:PublicTask}` команде |
| `PATCH /api/tasks/:id` | `{revision,draftText?,topic?,cardPatch?,answers?,manualFields?,sourceRevision?}` | `{task:OwnerTask,previewRating:Rating}`; сохраняет рабочую версию, увеличивает revision |
| `POST /api/tasks/:id/analyze` | `{revision,mode:"analyze"|"compose"}` | `AiResult`; AI предлагает, сам не сохраняет Card |
| `POST /api/tasks/:id/confirm` | `{revision,confirmed:true}` | `{task:OwnerTask,rating:Rating}`; подтверждает текущий Card и пересчитывает баллы |
| `POST /api/tasks/:id/publish` | `{revision}` | `{task:OwnerTask}`; требуется подтверждённая текущая версия, порога рейтинга нет |
| `POST /api/tasks/:id/applications` | `{idea,plan,timeline,prototypeUrl,clientRequestId}` | 201 `{application:Application}`; предложение текущей команды |
| `GET /api/tasks/:id/applications` | `limit/offset` необязательны | `{items:Application[],total}`; владелец видит все, команда — свои |
| `PATCH /api/applications/:id` | `{status:"selected"|"rejected"}` | `{application:Application}`; действие бизнеса по одному отклику |

`POST /analyze` в режиме `analyze` возвращает **3–5 вопросов**. Frontend показывает их и сохраняет ответы через `PATCH /tasks/:id` в `answers`; каждый ответ `{questionId,value,skipped}`. В режиме `compose` backend читает **уже сохранённые** ответы и возвращает `proposal`, который пользователь проверяет/редактирует. Чтобы применить его, frontend отправляет `cardPatch` через PATCH; затем отдельный confirm. Если AI недоступен, тот же endpoint возвращает `mode:"template"` и вопросы по шаблону; UI честно показывает эту метку.

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
