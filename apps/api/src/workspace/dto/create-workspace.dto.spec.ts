import { acceptedDto, dtoFields, rejectedDto } from '../../common/validation/dto-test-helpers';
import { CreateWorkspaceDto } from './create-workspace.dto';

/**
 * This DTO was not exercised by any unit test before this file (the audit's `src/workspace/dto`
 * 0% finding) — only indirectly by e2e, so a rule dropped from a decorator here would only
 * surface as a slug-format regression days later, not at the point the decorator was touched.
 */
describe('CreateWorkspaceDto', () => {
  it('accepts a well-formed name and slug', async () => {
    const dto = await acceptedDto<CreateWorkspaceDto>(CreateWorkspaceDto, {
      name: 'Acme Inc',
      slug: 'acme-inc',
    });

    expect(dto).toMatchObject({ name: 'Acme Inc', slug: 'acme-inc' });
  });

  it('rejects a missing name', async () => {
    const { statusCode, details } = await rejectedDto(CreateWorkspaceDto, { slug: 'acme' });

    expect(statusCode).toBe(400);
    expect(dtoFields(details)).toContain('name');
  });

  it('rejects a name over 80 characters', async () => {
    const { details } = await rejectedDto(CreateWorkspaceDto, {
      name: 'a'.repeat(81),
      slug: 'acme',
    });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'name', constraint: 'maxLength' }),
    );
  });

  it.each(['Acme', 'acme_inc', 'acme inc', 'a', '-acme', 'acme-', 'ACME-INC'])(
    'rejects the slug %j — not lowercase alphanumeric-with-hyphens',
    async (slug) => {
      const { details } = await rejectedDto(CreateWorkspaceDto, { name: 'Acme', slug });

      expect(details).toContainEqual(expect.objectContaining({ field: 'slug' }));
    },
  );

  it('accepts a two-character slug — the shortest the pattern allows', async () => {
    const dto = await acceptedDto<CreateWorkspaceDto>(CreateWorkspaceDto, {
      name: 'Acme',
      slug: 'ab',
    });

    expect(dto.slug).toBe('ab');
  });

  it('rejects a slug over 48 characters', async () => {
    const { details } = await rejectedDto(CreateWorkspaceDto, {
      name: 'Acme',
      slug: 'a'.repeat(49),
    });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'slug', constraint: 'maxLength' }),
    );
  });

  it('rejects an unlisted field — @Body() must not become an open door to arbitrary columns', async () => {
    const { statusCode } = await rejectedDto(CreateWorkspaceDto, {
      name: 'Acme',
      slug: 'acme',
      ownerId: 'usr_1',
    });

    expect(statusCode).toBe(400);
  });
});
