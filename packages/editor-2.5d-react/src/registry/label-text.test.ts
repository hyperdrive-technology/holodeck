import { describe, expect, it } from 'vitest';
import { formatLabelText } from './label-text';

describe('formatLabelText', () => {
  it('shows static text untouched when no value is bound', () => {
    expect(formatLabelText({ text: 'Mash tun' })).toBe('Mash tun');
    expect(formatLabelText({})).toBe('');
    expect(formatLabelText({ text: 'Total {value}' })).toBe('Total {value}');
  });
  it('appends a one-decimal reading with unit', () => {
    expect(formatLabelText({ text: 'Mash', value: 64.24, unit: '°C' })).toBe('Mash 64.2 °C');
    expect(formatLabelText({ text: '', value: 3, unit: '%' })).toBe('3.0 %');
  });
  it('fills an explicit {value} slot anywhere in the template', () => {
    expect(formatLabelText({ text: '{value} now', value: 1.26 })).toBe('1.3 now');
  });
  it('supports integer format', () => {
    expect(formatLabelText({ text: 'Rpm', value: 59.6, format: 'int', unit: 'rpm' })).toBe('Rpm 60 rpm');
  });
  it('maps booleans and onoff format to ON/OFF without a unit', () => {
    expect(formatLabelText({ text: 'Pump', value: true, unit: 'x' })).toBe('Pump ON');
    expect(formatLabelText({ text: 'Pump', value: false })).toBe('Pump OFF');
    expect(formatLabelText({ text: 'Pump', value: 1, format: 'onoff' })).toBe('Pump ON');
    expect(formatLabelText({ text: 'Pump', value: 0, format: 'onoff' })).toBe('Pump OFF');
  });
  it('maps states through labels (object or "k=v" string), falling back to a number', () => {
    const labels = { '0': 'HeatHLT', '2': 'Mash' };
    expect(formatLabelText({ text: 'Step', value: 2, labels })).toBe('Step Mash');
    expect(formatLabelText({ text: 'Step', value: 5, labels })).toBe('Step 5.0');
    expect(formatLabelText({ text: 'FV1', value: 2, labels: '0=Idle, 2=Fermenting' })).toBe('FV1 Fermenting');
  });
  it('shows -- for missing or non-finite readings', () => {
    expect(formatLabelText({ text: 'T', value: null })).toBe('T --');
    expect(formatLabelText({ text: 'T', value: NaN })).toBe('T --');
  });
  it('passes non-numeric strings through', () => {
    expect(formatLabelText({ text: 'Mode', value: 'AUTO' })).toBe('Mode AUTO');
  });
});
