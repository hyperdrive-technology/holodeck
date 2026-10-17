import { describe, expect, it } from 'vitest';
import { CSV_UTF8_BOM, csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('writes plain text, numbers and booleans as is', () => {
    expect(csvCell('tank-1')).toBe('tank-1');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
    expect(csvCell('')).toBe('');
  });

  it('writes null, undefined and non-finite numbers as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('never prefixes numbers: a negative number is data, not a formula', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(-0.5)).toBe('-0.5');
  });

  it.each([
    ['=1+1', "'=1+1"],
    ['=HYPERLINK("http://evil.example","click")', `"'=HYPERLINK(""http://evil.example"",""click"")"`],
    ['+SUM(A1:A9)', "'+SUM(A1:A9)"],
    ['-2+3', "'-2+3"],
    ['-3', "'-3"],
    ['@SUM(1)', "'@SUM(1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', `"'\r=1"`],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
  ])('defuses formula-like text %j', (text, expected) => {
    expect(csvCell(text)).toBe(expected);
  });

  it('leaves formula characters alone when they are not first', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('pump @ inlet')).toBe('pump @ inlet');
    expect(csvCell(' =1')).toBe(' =1');
  });

  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('cr\rlf')).toBe('"cr\rlf"');
    expect(csvCell('"')).toBe('""""');
  });

  it('keeps unicode text intact', () => {
    expect(csvCell('Würze 64 °C ✓')).toBe('Würze 64 °C ✓');
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF, ends with CRLF, and pads / truncates rows to the header', () => {
    const text = toCsv(['a', 'b', 'c'], [[1, 'x'], [2, 'y', 'z', 'extra'], []]);
    expect(text).toBe('a,b,c\r\n1,x,\r\n2,y,z\r\n,,\r\n');
  });

  it('escapes header cells too', () => {
    expect(toCsv(['=evil', 'ok'], [])).toBe("'=evil,ok\r\n");
  });

  it('round-trips through a strict RFC 4180 parser', () => {
    const rows = [['he said "no", twice', 'multi\nline', '=1+2', -4, null]];
    const text = toCsv(['a', 'b', 'c', 'd', 'e'], rows);
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['he said "no", twice', 'multi\nline', "'=1+2", '-4', ''],
    ]);
  });

  it('exports a BOM constant for Excel', () => {
    expect(CSV_UTF8_BOM).toBe('﻿');
  });
});

/** Minimal RFC 4180 reader for the round-trip test. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  return rows;
}
