import { echoedName, echoedPath } from './echoed-name';

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

describe('echoedPath', () => {
  it('drops the query string, and a fragment, whichever comes first', () => {
    expect(echoedPath('/workspaces/w_1/tasks?q=salary%20review')).toBe('/workspaces/w_1/tasks');
    expect(echoedPath('/auth/verify-email?token=s3cr3t')).toBe('/auth/verify-email');
    expect(echoedPath('/probe#frag?x=1')).toBe('/probe');
    expect(echoedPath('/probe?x=1#frag')).toBe('/probe');
    expect(echoedPath('/probe?')).toBe('/probe');
  });

  it('repeats every path this API routes exactly as it came', () => {
    // The longest route in `apps/api/openapi.json`, with its three UUIDs filled in.
    const id = '0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d';
    const longest = `/workspaces/${id}/tasks/${id}/checklist-items/${id}/position`;

    expect(longest).toHaveLength(153);
    expect(echoedPath(longest)).toBe(longest);
    expect(echoedPath('/')).toBe('/');
    expect(echoedPath('*')).toBe('*');
  });

  it('cuts a path longer than 256 characters as a name is cut, and says how many more', () => {
    const path = `/${'p'.repeat(255)}`;

    expect(echoedPath(path)).toBe(path);
    expect(echoedPath(`${path}q`)).toBe(`${path}[+1 more]`);
    // A 16,000-character segment, the size of path Node's 16 KiB head limit still lets through.
    expect(echoedPath(`/nope/${'p'.repeat(16_000)}?x=1`)).toBe(
      `/nope/${'p'.repeat(250)}[+15750 more]`,
    );
  });
});
