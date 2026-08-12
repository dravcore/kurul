import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  let service: LocaleService;

  beforeEach(async () => {
    findUnique.mockReset();
    update.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocaleService,
        { provide: PrismaService, useValue: { user: { findUnique, update } } },
      ],
    }).compile();

    service = moduleRef.get(LocaleService);
  });

  describe('read', () => {
    it('returns the stored preference', async () => {
      findUnique.mockResolvedValue({ locale: 'en' });

      await expect(service.read('user-1')).resolves.toBe('en');
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { locale: true },
      });
    });

    it('returns null when the user never chose', async () => {
      findUnique.mockResolvedValue({ locale: null });

      await expect(service.read('user-1')).resolves.toBeNull();
    });

    it('returns null when the user row is gone', async () => {
      // A session can outlive its user by the length of the cookie cache.
      findUnique.mockResolvedValue(null);

      await expect(service.read('user-1')).resolves.toBeNull();
    });

    it('ignores a stored tag that is no longer supported', async () => {
      // Dropping a language from SUPPORTED_LOCALES must not leave those users on a catalog
      // that no longer exists — they fall back through the rest of the chain instead.
      findUnique.mockResolvedValue({ locale: 'zz' });

      await expect(service.read('user-1')).resolves.toBeNull();
    });

    it('widens a stored region subtag to the language it ships', async () => {
      findUnique.mockResolvedValue({ locale: 'en-GB' });

      await expect(service.read('user-1')).resolves.toBe('en');
    });
  });

  describe('write', () => {
    it('stores the chosen locale and returns it', async () => {
      update.mockResolvedValue({ locale: 'en' });

      await expect(service.write('user-1', 'en')).resolves.toBe('en');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { locale: 'en' },
        select: { locale: true },
      });
    });

    it('clears the preference back to "follow the browser"', async () => {
      // Null is a reachable choice, not just an initial state: a user who set English on a
      // Turkish machine may want to go back to following the browser.
      update.mockResolvedValue({ locale: null });

      await expect(service.write('user-1', null)).resolves.toBeNull();
      expect(update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { locale: null },
        select: { locale: true },
      });
    });
  });

  describe('resolve', () => {
    it('prefers the stored preference over the header', async () => {
      findUnique.mockResolvedValue({ locale: 'en' });

      await expect(service.resolve('user-1', 'zz,yy')).resolves.toBe('en');
    });

    it('falls back to Accept-Language when nothing is stored', async () => {
      findUnique.mockResolvedValue({ locale: null });

      await expect(service.resolve('user-1', 'en-GB,en;q=0.9')).resolves.toBe('en');
    });

    it('falls back to English when neither the preference nor the header resolves', async () => {
      findUnique.mockResolvedValue({ locale: null });

      await expect(service.resolve('user-1', 'zz')).resolves.toBe('en');
      await expect(service.resolve('user-1', undefined)).resolves.toBe('en');
    });

    it('resolves without a user when there is nobody signed in', async () => {
      // Nothing seeds a board anonymously today, but outbound mail to an invited address
      // has no user row to read yet.
      await expect(service.resolve(null, 'en')).resolves.toBe('en');
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('degrades to the header when the preference read fails', async () => {
      // Seeding a board in the wrong language beats failing to create the board.
      findUnique.mockRejectedValue(new Error('connection lost'));

      await expect(service.resolve('user-1', 'en')).resolves.toBe('en');
    });
  });
});
