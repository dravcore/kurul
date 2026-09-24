import { echoedName } from './echoed-name';

describe('echoedName', () => {
  it('repeats a name of 64 characters or fewer exactly as it came', () => {
    const name = `${'a'.repeat(61)}[1]`;

    expect(name).toHaveLength(64);
    expect(echoedName(name)).toBe(name);
    expect(echoedName('')).toBe('');
  });

  it('cuts a longer one after 64 characters and says how many more there were', () => {
    expect(echoedName('a'.repeat(65))).toBe(`${'a'.repeat(64)}[+1 more]`);
    // The longest a 16 KiB multipart part-header block holds (measured through `FileInterceptor`).
    expect(echoedName('a'.repeat(16_340))).toBe(`${'a'.repeat(64)}[+16276 more]`);
  });

  it('never ends on half of a surrogate pair', () => {
    // U+1F600 is two UTF-16 code units, the 64th and 65th here. Cutting between them would leave
    // a lone `\ud83d`, which `JSON.stringify` writes out as an escape no decoder can pair.
    expect(echoedName(`${'a'.repeat(63)}\u{1F600}b`)).toBe(`${'a'.repeat(63)}[+3 more]`);
    // A pair that ends at the 64th unit is kept whole.
    expect(echoedName(`${'a'.repeat(62)}\u{1F600}b`)).toBe(`${'a'.repeat(62)}\u{1F600}[+1 more]`);
  });
});
