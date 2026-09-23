// Match whole placeholder replies, never a negative statement or a substring of
// a useful answer (for example, "Данных нет, используем синтетику"). Keep this
// predicate shared by scoring, the editor, and AI source selection.
const unknownReply = /^(?:(?:пока|пока что|еще) )?(?:не знаю(?: точно)?|не знаем(?: точно)?|неизвестно|не известно|не определено|не определились|нет информации|информации нет|нет ответа|ответа нет|не уверен(?:а|ы)?|затрудняюсь ответить|затрудняемся ответить|не могу сказать|не можем сказать)$/u;
const deferredReply = /^(?:потом|позже|позднее|(?:обсудим|уточним|уточню|узнаю|узнаем|решим|определимся)(?: (?:потом|позже|позднее))?)$/u;
const placeholders = new Set(['тест', 'unknown', 'not sure', "i don't know", 'i do not know', "we don't know", 'n/a', 'n\\a', 'tbd', 'todo']);

export function isUnknownValue(value) {
  if (typeof value !== 'string') return true;
  const text = value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е')
    .replace(/[’‘]/gu, "'").replace(/\s+/gu, ' ').trim()
    .replace(/^[\s"'«»„“”()[\]{}.,!?…:;—–-]+|[\s"'«»„“”()[\]{}.,!?…:;—–-]+$/gu, '');
  if (!text || placeholders.has(text)) return true;
  // "Не знаю, уточню позднее" is still unknown. A clause with facts, however,
  // prevents the entire reply from being discarded.
  return text.split(/\s*[,;.!?…]+\s*/u).every((part) => unknownReply.test(part) || deferredReply.test(part));
}

export function hasMeaningfulValue(value) {
  return typeof value === 'string' && !isUnknownValue(value);
}

export function normalizeKnownValue(value) {
  return hasMeaningfulValue(value) ? value.trim() : null;
}
