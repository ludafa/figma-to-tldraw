// See apps/docs/skia-engine/tech.md §3.3.

export type IndexKey = string & { __brand: 'indexKey' };

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SMALLEST_INTEGER = 'A00000000000000000000000000';
const ZERO = 'a0';

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') {
    return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  }
  if (head >= 'A' && head <= 'Z') {
    return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  }
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0]);
  if (len > key.length) {
    throw new Error(`invalid order key: ${key}`);
  }
  return key.slice(0, len);
}

function validate(key: string) {
  if (key === SMALLEST_INTEGER) {
    throw new Error(`invalid order key: ${key}`);
  }
  const i = integerPart(key);
  const f = key.slice(i.length);
  if (f.endsWith('0')) {
    throw new Error(`invalid order key: ${key}`);
  }
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`${a} >= ${b}`);
  }
  if (a.endsWith('0') || (b && b.endsWith('0'))) {
    throw new Error('trailing zero');
  }
  if (b) {
    let n = 0;
    while ((a[n] || '0') === b[n]) {
      n++;
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  if (b && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) {
      digs[i] = '0';
    } else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') {
      return 'a0';
    }
    if (head === 'z') {
      return null;
    }
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > 'a') {
      digs.push('0');
    } else {
      digs.pop();
    }
    return h + digs.join('');
  }
  return head + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) {
      digs[i] = DIGITS[DIGITS.length - 1];
    } else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') {
      return 'Z' + DIGITS[DIGITS.length - 1];
    }
    if (head === 'A') {
      return null;
    }
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < 'Z') {
      digs.push(DIGITS[DIGITS.length - 1]);
    } else {
      digs.pop();
    }
    return h + digs.join('');
  }
  return head + digs.join('');
}

function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) {
    validate(a);
  }
  if (b !== null) {
    validate(b);
  }
  if (a !== null && b !== null && a >= b) {
    throw new Error(`${a} >= ${b}`);
  }
  if (a === null) {
    if (b === null) {
      return ZERO;
    }
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) {
      return ib + midpoint('', fb);
    }
    if (ib < b) {
      return ib;
    }
    const res = decrementInteger(ib);
    if (res === null) {
      throw new Error('cannot decrement any more');
    }
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) {
    return ia + midpoint(fa, fb);
  }
  const i = incrementInteger(ia);
  if (i === null) {
    throw new Error('cannot increment any more');
  }
  if (i < b) {
    return i;
  }
  return ia + midpoint(fa, null);
}

function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [keyBetween(a, b)];
  }
  if (b === null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(c, b);
      out.push(c);
    }
    return out;
  }
  if (a === null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(a, c);
      out.push(c);
    }
    return out.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

export function getIndexBetween(
  below?: IndexKey | string | null,
  above?: IndexKey | string | null,
): IndexKey {
  return keyBetween(below ?? null, above ?? null) as IndexKey;
}

export function getIndicesBetween(
  below: IndexKey | string | null | undefined,
  above: IndexKey | string | null | undefined,
  n: number,
): IndexKey[] {
  return keysBetween(below ?? null, above ?? null, n) as IndexKey[];
}

export function getIndexAbove(below?: IndexKey | string | null): IndexKey {
  return getIndexBetween(below, null);
}

export function getIndexBelow(above?: IndexKey | string | null): IndexKey {
  return getIndexBetween(null, above);
}

/** `n` increasing indices, starting at `start`. */
export function getIndices(n: number, start = 'a1'): IndexKey[] {
  if (n <= 0) {
    return [];
  }
  return [
    start as IndexKey,
    ...(keysBetween(start, null, n - 1) as IndexKey[]),
  ];
}

export function sortByIndex<T extends { index: IndexKey | string }>(
  a: T,
  b: T,
): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : 0;
}

export const ZERO_INDEX_KEY = 'a0' as IndexKey;
