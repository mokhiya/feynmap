import { createContext, useContext } from 'react';

export type Lang = 'ru' | 'en' | 'uz';

export const LANGS: { code: Lang; native: string; flag: string }[] = [
  { code: 'ru', native: 'Русский', flag: '🇷🇺' },
  { code: 'en', native: 'English', flag: '🇬🇧' },
  { code: 'uz', native: "O'zbek", flag: '🇺🇿' },
];

export interface Dict {
  appTitle: string;
  appTagline: string;
  topicPlaceholder: string;
  startBtn: string;
  startBtnBusy: string;
  reset: string;
  topic: string;
  finish: string;
  studentFirstQuestion: string;
  studentThinking: string;
  composerPlaceholder: string;
  send: string;
  expertLabel: string;
  studentLabel: string;
  finishDisabledHint: string;
  competencyMap: string;
  overall: string;
  assessing: string;
  emptyAssessment: string;
  nextFocus: string;
  levelLabel: string;
  reportTitle: string;
  newTopic: string;
  notEnoughData: string;
  notEnoughDataHint: string;
  gaps: string;
  noGaps: string;
  strengths: string;
  toImprove: string;
  recAllGood: string;
  recGap: (name: string) => string;
  errAssessor: string;
  sampleTopics: string[];
  langLabel: string;
}

const ru: Dict = {
  appTitle: 'Учусь, объясняя',
  appTagline:
    'Выберите тему — попробуйте объяснить её наивному ИИ-студенту. Параллельно ассессор построит живую карту ваших компетенций.',
  topicPlaceholder: 'Например: TCP handshake',
  startBtn: 'Начать объяснять →',
  startBtnBusy: 'Запускаем…',
  reset: '← сбросить',
  topic: 'Тема',
  finish: 'Завершить →',
  studentFirstQuestion: 'Студент сейчас задаст первый вопрос…',
  studentThinking: 'Студент думает…',
  composerPlaceholder: 'Объясните студенту… (Cmd/Ctrl+Enter — отправить)',
  send: 'Отправить',
  expertLabel: 'Вы (эксперт)',
  studentLabel: 'Студент',
  finishDisabledHint: 'Нужен хотя бы один ваш ответ',
  competencyMap: 'Карта компетенций',
  overall: 'Общий уровень',
  assessing: 'оценка…',
  emptyAssessment: 'Ассессор соберёт компетенции после первого ответа эксперта.',
  nextFocus: 'Следующий фокус',
  levelLabel: 'Уровень',
  reportTitle: 'Итоговый отчёт',
  newTopic: '← Новая тема',
  notEnoughData: 'Недостаточно данных для построения карты.',
  notEnoughDataHint: 'Объясните тему хотя бы 2–3 ходами и завершите снова.',
  gaps: 'Пробелы',
  noGaps: 'Явных пробелов не выявлено 🎯',
  strengths: 'Сильные стороны',
  toImprove: 'Что подтянуть',
  recAllGood:
    'Закрепить материал, объяснив тему второму «студенту» с более глубокими вопросами.',
  recGap: (name) =>
    `Разобрать «${name}»: подобрать 1–2 примера и попробовать объяснить ребёнку 10 лет.`,
  errAssessor:
    'Ассессор пока не собрал компетенции — объясните тему ещё 1–2 ходами и попробуйте снова.',
  sampleTopics: [
    'TCP handshake',
    'Энтропия в термодинамике',
    'Как работает индекс в SQL',
    'Принцип неопределённости Гейзенберга',
  ],
  langLabel: 'Язык',
};

const en: Dict = {
  appTitle: 'Learn by explaining',
  appTagline:
    'Pick a topic and try to explain it to a naive AI student. In parallel, the assessor builds a live map of your competencies.',
  topicPlaceholder: 'e.g. TCP handshake',
  startBtn: 'Start explaining →',
  startBtnBusy: 'Starting…',
  reset: '← reset',
  topic: 'Topic',
  finish: 'Finish →',
  studentFirstQuestion: 'The student is about to ask the first question…',
  studentThinking: 'Student is thinking…',
  composerPlaceholder: 'Explain to the student… (Cmd/Ctrl+Enter to send)',
  send: 'Send',
  expertLabel: 'You (expert)',
  studentLabel: 'Student',
  finishDisabledHint: 'You need at least one reply',
  competencyMap: 'Competency map',
  overall: 'Overall level',
  assessing: 'assessing…',
  emptyAssessment: 'The assessor will gather competencies after your first reply.',
  nextFocus: 'Next focus',
  levelLabel: 'Level',
  reportTitle: 'Final report',
  newTopic: '← New topic',
  notEnoughData: 'Not enough data to build the map.',
  notEnoughDataHint: 'Explain the topic in at least 2–3 turns and finish again.',
  gaps: 'Gaps',
  noGaps: 'No clear gaps detected 🎯',
  strengths: 'Strengths',
  toImprove: 'What to improve',
  recAllGood:
    'Lock in the material by explaining the topic to a second student with deeper questions.',
  recGap: (name) =>
    `Work on "${name}": pick 1–2 examples and try to explain it to a 10-year-old.`,
  errAssessor:
    'The assessor has not gathered competencies yet — explain the topic in 1–2 more turns and try again.',
  sampleTopics: [
    'TCP handshake',
    'Entropy in thermodynamics',
    'How a SQL index works',
    'Heisenberg uncertainty principle',
  ],
  langLabel: 'Language',
};

const uz: Dict = {
  appTitle: 'Tushuntirib o\u2019rganaman',
  appTagline:
    'Mavzu tanlang va uni sodda AI-talabaga tushuntirib ko\u2019ring. Parallel ravishda assessor sizning kompetensiyalaringizning jonli xaritasini quradi.',
  topicPlaceholder: 'Masalan: TCP handshake',
  startBtn: 'Tushuntirishni boshlash \u2192',
  startBtnBusy: 'Ishga tushyapti\u2026',
  reset: '\u2190 tozalash',
  topic: 'Mavzu',
  finish: 'Yakunlash \u2192',
  studentFirstQuestion: 'Talaba hozir birinchi savolni beradi\u2026',
  studentThinking: 'Talaba o\u2019ylayapti\u2026',
  composerPlaceholder: 'Talabaga tushuntiring\u2026 (Cmd/Ctrl+Enter \u2014 yuborish)',
  send: 'Yuborish',
  expertLabel: 'Siz (ekspert)',
  studentLabel: 'Talaba',
  finishDisabledHint: 'Kamida bitta javobingiz kerak',
  competencyMap: 'Kompetensiyalar xaritasi',
  overall: 'Umumiy daraja',
  assessing: 'baholanmoqda\u2026',
  emptyAssessment: 'Assessor sizning birinchi javobingizdan keyin kompetensiyalarni yig\u2019adi.',
  nextFocus: 'Keyingi fokus',
  levelLabel: 'Daraja',
  reportTitle: 'Yakuniy hisobot',
  newTopic: '\u2190 Yangi mavzu',
  notEnoughData: 'Xarita qurish uchun ma\u2019lumot yetarli emas.',
  notEnoughDataHint: 'Mavzuni kamida 2\u20133 marta tushuntirib, qaytadan yakunlang.',
  gaps: 'Bo\u2019shliqlar',
  noGaps: 'Aniq bo\u2019shliqlar aniqlanmadi 🎯',
  strengths: 'Kuchli tomonlar',
  toImprove: 'Nimani yaxshilash kerak',
  recAllGood:
    'Mavzuni mustahkamlash uchun uni boshqa "talaba"ga chuqurroq savollar bilan tushuntirib bering.',
  recGap: (name) =>
    `\u00AB${name}\u00BB ustida ishlang: 1\u20132 ta misol topib, 10 yoshli bolaga tushuntirishga harakat qiling.`,
  errAssessor:
    'Assessor hali kompetensiyalarni yig\u2019madi \u2014 mavzuni yana 1\u20132 marta tushuntirib, qayta urinib ko\u2019ring.',
  sampleTopics: [
    'TCP handshake',
    'Termodinamikada entropiya',
    'SQL indeks qanday ishlaydi',
    'Geyzenberg noaniqlik prinsipi',
  ],
  langLabel: 'Til',
};

export const translations: Record<Lang, Dict> = { ru, en, uz };

export const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: 'ru', setLang: () => {} });

export function useLang() {
  return useContext(LangContext);
}
export function useT(): Dict {
  return translations[useLang().lang];
}
