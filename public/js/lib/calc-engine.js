/**
 * calc-engine.js
 * 계산기 수식 파서/평가기. eval() 을 쓰지 않고 Shunting-yard 알고리즘으로 직접 구현합니다.
 * 지원: + - * / ( ) 소수점, 단항 부호(-5), 후위 퍼센트(50% -> 0.5), 지수표기(1e3)
 */

// 연산자 우선순위와 결합 방향 정의
const OPERATORS = {
  '+': { precedence: 1, assoc: 'left', apply: (a, b) => a + b },
  '-': { precedence: 1, assoc: 'left', apply: (a, b) => a - b },
  '*': { precedence: 2, assoc: 'left', apply: (a, b) => a * b },
  '/': { precedence: 2, assoc: 'left', apply: (a, b) => a / b },
};

// 표시용 기호를 내부 연산자로 정규화
export function normalize(expression) {
  return String(expression)
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
}

/**
 * 수식 문자열을 토큰 배열로 분해합니다.
 * @throws {Error} 허용되지 않은 문자가 있을 때
 */
export function tokenize(expression) {
  const src = normalize(expression);
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // 숫자 (소수점, 지수표기 포함)
    if (/[0-9.]/.test(ch)) {
      let numText = '';
      let dotSeen = false;
      while (i < src.length && /[0-9.]/.test(src[i])) {
        if (src[i] === '.') {
          // 소수점이 두 번 나오면 잘못된 숫자
          if (dotSeen) throw new Error('잘못된 숫자 형식입니다');
          dotSeen = true;
        }
        numText += src[i];
        i += 1;
      }
      // 지수표기: 1e3, 2.5e-4
      if (i < src.length && /[eE]/.test(src[i])) {
        const save = i;
        let expText = src[i];
        i += 1;
        if (i < src.length && /[+-]/.test(src[i])) { expText += src[i]; i += 1; }
        if (i < src.length && /[0-9]/.test(src[i])) {
          while (i < src.length && /[0-9]/.test(src[i])) { expText += src[i]; i += 1; }
          numText += expText;
        } else {
          i = save; // 지수부가 불완전하면 되돌림
        }
      }
      const value = Number(numText);
      if (!Number.isFinite(value)) throw new Error('잘못된 숫자 형식입니다');
      tokens.push({ type: 'number', value });
      continue;
    }

    if (ch in OPERATORS) { tokens.push({ type: 'op', value: ch }); i += 1; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue; }
    if (ch === '%') { tokens.push({ type: 'percent' }); i += 1; continue; }

    throw new Error(`사용할 수 없는 문자입니다: ${ch}`);
  }
  return tokens;
}

/**
 * 토큰 배열을 후위표기(RPN)로 변환합니다.
 * 단항 부호는 'u-' / 'u+' 로 표시하여 이항 연산자와 구분합니다.
 */
export function toRPN(tokens) {
  const output = [];
  const stack = [];
  // 직전 토큰이 피연산자(숫자/닫는괄호/퍼센트)였는지 여부 -> 단항 및 암묵적 곱셈 판별에 사용
  let prevWasValue = false;

  // 이항 연산자를 우선순위 규칙에 따라 스택에 밀어 넣습니다.
  const pushBinaryOp = (opChar) => {
    const o1 = OPERATORS[opChar];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.type === 'unary') { output.push(stack.pop()); continue; }
      if (top.type !== 'op') break;
      const o2 = OPERATORS[top.value];
      const shouldPop = o2.precedence > o1.precedence
        || (o2.precedence === o1.precedence && o1.assoc === 'left');
      if (!shouldPop) break;
      output.push(stack.pop());
    }
    stack.push({ type: 'op', value: opChar });
  };

  for (const token of tokens) {
    if (token.type === 'number') {
      // 2(3+4) 뒤의 숫자처럼 값이 연속되면 곱셈으로 해석합니다. 예: (1+2)3 -> (1+2)*3
      if (prevWasValue) pushBinaryOp('*');
      output.push(token);
      prevWasValue = true;
    } else if (token.type === 'percent') {
      if (!prevWasValue) throw new Error('% 앞에 숫자가 필요합니다');
      output.push({ type: 'percent' });
      prevWasValue = true;
    } else if (token.type === 'op') {
      if (!prevWasValue) {
        // 단항 연산자: -5, +3, 2*(-3)
        if (token.value === '-') stack.push({ type: 'unary', value: 'u-' });
        else if (token.value === '+') stack.push({ type: 'unary', value: 'u+' });
        else throw new Error(`연산자 ${token.value} 앞에 숫자가 필요합니다`);
      } else {
        pushBinaryOp(token.value);
      }
      prevWasValue = false;
    } else if (token.type === 'lparen') {
      // 2(3+4) 처럼 값 뒤에 여는 괄호가 오면 곱셈으로 해석합니다.
      if (prevWasValue) pushBinaryOp('*');
      stack.push(token);
      prevWasValue = false;
    } else if (token.type === 'rparen') {
      let found = false;
      while (stack.length) {
        const top = stack.pop();
        if (top.type === 'lparen') { found = true; break; }
        output.push(top);
      }
      if (!found) throw new Error('괄호의 짝이 맞지 않습니다');
      // 괄호 바로 앞에 붙어 있던 단항 연산자를 꺼냄
      while (stack.length && stack[stack.length - 1].type === 'unary') output.push(stack.pop());
      prevWasValue = true;
    }
  }

  while (stack.length) {
    const top = stack.pop();
    if (top.type === 'lparen') throw new Error('괄호의 짝이 맞지 않습니다');
    output.push(top);
  }
  return output;
}

/** 후위표기 토큰열을 계산합니다. */
export function evalRPN(rpn) {
  const stack = [];
  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'percent') {
      if (stack.length < 1) throw new Error('수식이 올바르지 않습니다');
      stack.push(stack.pop() / 100);
    } else if (token.type === 'unary') {
      if (stack.length < 1) throw new Error('수식이 올바르지 않습니다');
      const v = stack.pop();
      stack.push(token.value === 'u-' ? -v : v);
    } else if (token.type === 'op') {
      if (stack.length < 2) throw new Error('수식이 올바르지 않습니다');
      const b = stack.pop();
      const a = stack.pop();
      if (token.value === '/' && b === 0) throw new Error('0으로 나눌 수 없습니다');
      stack.push(OPERATORS[token.value].apply(a, b));
    }
  }
  if (stack.length !== 1) throw new Error('수식이 올바르지 않습니다');
  const result = stack[0];
  if (!Number.isFinite(result)) throw new Error('계산할 수 없는 값입니다');
  return result;
}

/**
 * 부동소수점 오차를 제거합니다. (0.1 + 0.2 -> 0.3)
 * 유효숫자 12자리로 반올림한 뒤 불필요한 0을 제거합니다.
 */
export function roundResult(value) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 수식 문자열을 계산하여 숫자를 반환합니다. */
export function evaluate(expression) {
  const text = normalize(expression);
  if (!text) throw new Error('수식이 비어 있습니다');
  return roundResult(evalRPN(toRPN(tokenize(text))));
}

/** 결과를 천단위 구분 기호가 들어간 문자열로 포맷합니다. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  // 너무 크거나 작은 값은 지수표기로
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return value.toExponential(6).replace(/e([+-])/, 'e$1');
  const [intPart, decPart] = String(value).split('.');
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${withComma}.${decPart}` : withComma;
}

/** 입력 중인 수식이 계산 가능한 상태인지 가볍게 검사합니다. */
export function isEvaluable(expression) {
  try { evaluate(expression); return true; } catch { return false; }
}
