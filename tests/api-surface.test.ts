import { describe, it, expect } from 'vitest';
import * as Lyra from '../dist/index.js';

describe('Public API Surface', () => {
  it('exports exactly the expected runtime API', () => {
    const actual = Object.keys(Lyra).sort();
    const expected = ['LyraBundle', 'buildOpenAiTool', 'buildQuerySchema', 'createBundle'].sort();

    expect(actual).toEqual(expected);
  });

  it('exports createBundle as a function', () => {
    expect(typeof Lyra.createBundle).toBe('function');
  });

  it('exports LyraBundle as a class', () => {
    expect(Lyra.LyraBundle).toBeDefined();
    expect(typeof Lyra.LyraBundle).toBe('function');
    expect(Lyra.LyraBundle.prototype).toBeDefined();
  });

  it('exports buildQuerySchema as a function', () => {
    expect(typeof Lyra.buildQuerySchema).toBe('function');
  });

  it('exports buildOpenAiTool as a function', () => {
    expect(typeof Lyra.buildOpenAiTool).toBe('function');
  });
});

