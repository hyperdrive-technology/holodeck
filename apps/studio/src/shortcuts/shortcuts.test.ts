import { matchShortcut } from '@holodeck/editor-2.5d-react';
import { parseHotkey } from '@tanstack/react-hotkeys';
import { describe, expect, it } from 'vitest';
import { CANVAS_SHORTCUTS, STUDIO_SHORTCUTS } from './shortcuts';

describe('shortcuts', () => {
  it('has one chord per command, no duplicates', () => {
    const commands = STUDIO_SHORTCUTS.map((s) => s.command);
    const chords = STUDIO_SHORTCUTS.map((s) => s.hotkey.toLowerCase());
    expect(new Set(commands).size).toBe(commands.length);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('every chord parses and carries a modifier (bare keys belong to the canvas)', () => {
    for (const { hotkey } of STUDIO_SHORTCUTS) {
      const parsed = parseHotkey(hotkey);
      expect(parsed.key, hotkey).toBeTruthy();
      expect(parsed.ctrl || parsed.meta || parsed.alt, hotkey).toBe(true);
    }
  });

  it('never takes a chord the canvas binds (checked with the engine matcher, Ctrl and Cmd)', () => {
    expect(CANVAS_SHORTCUTS.length).toBeGreaterThan(5);
    for (const { hotkey } of STUDIO_SHORTCUTS) {
      const parsed = parseHotkey(hotkey);
      const key = String(parsed.key ?? '');
      for (const platformMod of ['ctrlKey', 'metaKey'] as const) {
        const event = {
          key: key.length === 1 ? key.toLowerCase() : key,
          code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key,
          ctrlKey: platformMod === 'ctrlKey' && (parsed.ctrl || parsed.meta),
          metaKey: platformMod === 'metaKey' && (parsed.ctrl || parsed.meta),
          shiftKey: parsed.shift,
          altKey: parsed.alt,
        };
        expect(matchShortcut(event), `${hotkey} (${platformMod})`).toBeNull();
      }
    }
  });

  it('the conflict check would catch a clash (sanity)', () => {
    expect(matchShortcut({ key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe('undo');
  });

  it.each(['Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+W', 'Mod+Alt+I'])('avoids browser-reserved %s', (reserved) => {
    expect(STUDIO_SHORTCUTS.map((s) => s.hotkey)).not.toContain(reserved);
  });
});
