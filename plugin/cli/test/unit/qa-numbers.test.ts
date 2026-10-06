import { describe, expect, it } from 'vitest';

import { buildNumberCorpus, contentTexts, judgeNumber, tokenizeNumbers, unsourcedNumbers } from '../../src/analyze/qa-numbers.js';

const CONTENT = buildNumberCorpus([
  '선발 (3개월) · 예비 과정 (2개월) · 본 과정 (6개월). 제17기 연수생 모집. 수료인원 2,096 명. 10주년 기념. '
  + '전화 02-6933-0701 · 사업자등록번호 116-82-01595 · 우편번호 04156. 공지 2025.09.12',
]);

/** The rendered-text stream the page probe produces for the experiment markup. */
const STREAM = [
  '\n09\nMONTHS\n', // 09<span>MONTHS</span> with a block span
  '\n11 MONTHS\n', // 11<br>MONTHS
  '\n17기\n2,096명\n',
  '\n02-6933-0701 116-82-01595 04156\n',
  '\n10TH ANNIVERSARY\n',
  '\n01\n선발\n02\n예비\n03\n본\n04\n해외\n',
  '\n11기–15기\n',
  '\n2025.09.12\n',
].join('');

describe('unsourced-number tokens', () => {
  // why: these are the exact experiment strings; a regression here re-opens the invented "09 MONTHS"/"11 MONTHS"
  // and the 11기–15기 captions, or turns sourced facts (제17기, 2,096 명, 10주년, phone/postal) into false failures.
  it('flags only the invented numbers in the experiment markup', () => {
    const flagged = unsourcedNumbers(STREAM, CONTENT).map((item) => `${item.token.raw}:${item.severity}`);
    expect(flagged).toEqual(['09 MONTHS:fail', '11 MONTHS:fail', '11기:fail', '15기:fail']);
  });

  // why: unit order decides the class; 개 before 개월 or 주 before 주년 would misclassify every Korean duration.
  it('matches units longest first and classifies them', () => {
    const classes = tokenizeNumbers('3개월 149개사 4개 5만원 2만 10주년 3주 1st 4 TEAMS 88.4 % 19 대 1').map((token) => `${token.raw}|${token.cls}`);
    expect(classes).toEqual([
      '3개월|month', '149개사|company', '4개|count', '5만원|currency', '2만|currency', '10주년|ordinal', '3주|duration',
      '1st|ordinal', '4 TEAMS|count', '88.4 %|percent', '19|unitless', '1|unitless',
    ]);
  });

  // why: a Latin unit glued to a following word ("3 more", "1 step") is not a unit; without the boundary every
  // English sentence with a number becomes a month/ordinal failure.
  it('requires a non-letter after Latin units and a word end after spaced Korean units', () => {
    expect(tokenizeNumbers('3 more 1 step 24h 5 hours').map((token) => token.cls)).toEqual(['unitless', 'unitless', 'duration', 'duration']);
    expect(tokenizeNumbers('01 기업 소개 17기').map((token) => `${token.raw}|${token.cls}`)).toEqual(['01|unitless', '17기|ordinal']);
  });

  // why: identifiers such as H264 or v2 are not claims; URLs, e-mails and registration numbers are masked.
  it('ignores numbers inside identifiers, URLs, e-mails and registration patterns', () => {
    expect(tokenizeNumbers('H264 v2 https://x.example/2024/11 mail team42@example.org 010-1234-5678 123-45-67890')).toEqual([]);
  });

  // why: ordinal and year are compatible and 4-digit years are sourced by presence; count-class misses are only
  // warnings because content often states counts as prose.
  it('applies class compatibility and severities', () => {
    const corpus = buildNumberCorpus(['2024년 설립, 3 projects']);
    const judge = (text: string): string => {
      const verdict = judgeNumber(tokenizeNumbers(text)[0], corpus);
      return verdict.status === 'unsourced' ? `unsourced-${verdict.severity}` : verdict.status;
    };
    expect(judge('2024 years')).toBe('sourced');
    expect(judge('3 teams')).toBe('sourced');
    expect(judge('7 teams')).toBe('unsourced-warn');
    expect(judge('7명')).toBe('unsourced-fail');
    expect(judge('7')).toBe('unsourced-warn');
    expect(judge('2024.09.01')).toBe('unsourced-warn');
  });

  // why: JSON content contributes every string and number value, so a CMS export works as a fact source.
  it('extracts JSON string and number values', () => {
    expect(contentTexts('facts.json', JSON.stringify({ a: '제17기', b: [2096, { c: '3개월' }], d: true }))).toEqual(['제17기', '2096', '3개월']);
    expect(contentTexts('CONTENT.md', '# 17기')).toEqual(['# 17기']);
  });
});
