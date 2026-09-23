# Контракт frontend ↔ backend для MVP AI Sana

Версия: 1.1. Обратно совместимое дополнение: `previewRating` доступен в `OwnerTask` и строках списка `scope=mine`; существующий `rating` сохраняет свой смысл. Этот файл можно отправить Нурдаулету и использовать как общий источник истины. Полный план — `../HACKATHON_PLAN.md`. Backend доступен в `../server/`; frontend подключается к описанному API.

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
  answers: Answer[];
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

`PublicTask` для команды: `{id, topic, card, rating, publicationStatus:"published", publishedAt}`. Здесь `card` — **только подтверждённая** версия; нет `workingCard`, `answers`, `questions`, `draftText` или `previewRating`. `GET /api/tasks/:id` возвращает `{task:OwnerTask}` владельцу и `{task:PublicTask}` команде.

Строка списка `TaskSummary`: `{id,title,topic,rating,publicationStatus,publishedAt,applicationCount,previewRating?}`. В каталоге title/topic/rating берутся из подтверждённой версии, `previewRating` отсутствует даже при запросе владельца. В списке бизнеса (`scope=mine`) title — рабочий `title` или первые 60 символов `draftText`, topic — рабочая тема, `rating` — подтверждённый балл (0 до первого подтверждения), `previewRating` — балл сохранённого черновика. Поэтому общий frontend-тип `TaskSummary` использует `previewRating?: Rating`, а `OwnerTask` — обязательное `previewRating: Rating`.

### Подключение предварительного рейтинга на frontend

При создании, открытии, сохранении, подтверждении и публикации задачи владельцу возвращается `OwnerTask` с обоими рейтингами. Для редактора используйте `task.previewRating`, для каталога — `task.rating`. В рабочем списке бизнеса можно показывать `item.previewRating` с подписью «Полнота черновика».

```ts
// Одинаково после GET и PATCH; не подменять предварительный балл на task.rating.
setPreviewRating(response.task.previewRating);
// Подпись «Подтверждённый балл» допустима только для актуальной сохранённой версии.
const confirmed = response.task.confirmedRevision === response.task.revision && !dirty;
```

Например: после сохранения полной карточки `previewRating.score=100`, а `rating.score=0`. Повторный GET сохраняет это различие. После подтверждения оба равны 100. Если очистить поле в опубликованной задаче, предварительный балл снизится, а публичный рейтинг сохранится до следующего подтверждения. Изменений схемы SQLite или повторного seed не требуется.

`Question`: `{id,field,text,sourceRevision}`. `Answer`: `{questionId,value,skipped}`. При пропуске `value:null, skipped:true`; не превращать пропуск в выдуманный ответ.

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
| `PATCH /api/tasks/:id` | `{revision,draftText?,topic?,cardPatch?,answers?}` | `{task:OwnerTask,previewRating:Rating}`; сохраняет рабочую версию, увеличивает revision |
| `POST /api/tasks/:id/analyze` | `{revision,mode:"analyze"|"compose"}` | `{sourceRevision,questions:Question[],proposal:Card,warnings:string[],mode:"live"|"cached"|"template"}`; AI предлагает, сам не сохраняет Card |
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
