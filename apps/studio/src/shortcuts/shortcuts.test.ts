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

  it('never takes a chord the canvas uses', () => {
    const canvas = new Set(CANVAS_SHORTCUTS.flatMap((c) => c.keys.split(' / ')).map((k) => k.toLowerCase()));
    for (const { hotkey } of STUDIO_SHORTCUTS) expect(canvas.has(hotkey.toLowerCase())).toBe(false);
  });

  it.each(['Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+W', 'Mod+Alt+I'])('avoids browser-reserved %s', (reserved) => {
    expect(STUDIO_SHORTCUTS.map((s) => s.hotkey)).not.toContain(reserved);
  });
});
