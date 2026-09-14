import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, formatNumber, tokenize } from '../public/js/lib/calc-engine.js';

// 정상 계산 케이스: [수식, 기대값]
const CASES = [
  ['1+1', 2],
  ['2-5', -3],
  ['6*7', 42],
  ['10/4', 2.5],
  ['2+3*4', 14],                 // 연산자 우선순위
  ['(2+3)*4', 20],               // 괄호
  ['2*(3+4)*(1+1)', 28],
  ['-5', -5],                    // 단항 마이너스
  ['-5+3', -2],
  ['2*-3', -6],                  // 이항 뒤 단항
  ['-(2+3)', -5],                // 괄호 앞 단항
  ['--3', 3],                    // 이중 단항
  ['10-2-3', 5],                 // 좌결합
  ['100/5/2', 10],
  ['0.1+0.2', 0.3],              // 부동소수점 오차 보정
  ['1.5*2', 3],
  ['50%', 0.5],                  // 후위 퍼센트
  ['200*15%', 30],
  ['1e3', 1000],                 // 지수 표기
  ['2.5e-2', 0.025],
  ['3.14159*2', 6.28318],
  ['((1+2)*(3+4))/7', 3],
  ['0*5', 0],
  ['-0.5*2', -1],
];

test('정상 수식 계산', () => {
  for (const [expr, expected] of CASES) {
    assert.equal(evaluate(expr), expected, `${expr} 의 결과가 ${expected} 이어야 합니다`);
  }
});

test('표시 기호(×, ÷, −) 정규화', () => {
  assert.equal(evaluate('6×7'), 42);
  assert.equal(evaluate('10÷4'), 2.5);
  assert.equal(evaluate('5−3'), 2);
  assert.equal(evaluate('1,000+1'), 1001);
  assert.equal(evaluate(' 1 + 1 '), 2);
});

// 예외가 발생해야 하는 케이스
const ERROR_CASES = [
  ['1/0', /0으로 나눌 수 없습니다/],
  ['(1+2', /괄호/],
  ['1+2)', /괄호/],
  ['1..2', /잘못된 숫자/],
  ['1+', /수식이 올바르지 않습니다/],
  ['*5', /숫자가 필요합니다/],
  ['', /비어 있습니다/],
  ['1+$2', /사용할 수 없는 문자/],
  ['%5', /% 앞에 숫자가 필요합니다/],
  ['()', /수식이 올바르지 않습니다/],
  ['1++', /수식이 올바르지 않습니다/],
];

test('잘못된 수식은 예외를 던짐', () => {
  for (const [expr, pattern] of ERROR_CASES) {
    assert.throws(() => evaluate(expr), pattern, `${expr} 는 예외가 발생해야 합니다`);
  }
});

test('0 나누기는 어떤 위치에서도 예외', () => {
  assert.throws(() => evaluate('5/(3-3)'), /0으로 나눌 수 없습니다/);
  assert.throws(() => evaluate('0/0'), /0으로 나눌 수 없습니다/);
});

test('암묵적 곱셈 해석', () => {
  assert.equal(evaluate('2(3+4)'), 14);     // 값 뒤 여는 괄호
  assert.equal(evaluate('(1+2)3'), 9);      // 닫는 괄호 뒤 숫자
  assert.equal(evaluate('(1+2)(3+4)'), 21); // 괄호끼리
  assert.equal(evaluate('1 2'), 12);        // 공백은 제거되므로 하나의 숫자
  assert.equal(evaluate('2(3)(4)'), 24);
});

test('숫자 포맷', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(1234.5678), '1,234.5678');
  assert.equal(formatNumber(-9876543.21), '-9,876,543.21');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(0.5), '0.5');
  assert.equal(formatNumber(-0.25), '-0.25');
  assert.equal(formatNumber(100), '100');
});

test('-0 은 0 으로 정규화', () => {
  assert.equal(Object.is(evaluate('0*-1'), 0), true);
});

test('큰 수/작은 수는 지수표기로 표시', () => {
  assert.match(formatNumber(1e20), /e\+/);
  assert.match(formatNumber(1e-12), /e-/);
});

test('토크나이저가 토큰 개수를 정확히 산출', () => {
  assert.equal(tokenize('1+2').length, 3);
  assert.equal(tokenize('(1+2)*3').length, 7);
});
