/**
 * The one symbol this API imports from multer.
 *
 * multer 2.2.0 ships no types and `@types/multer` is not a dependency here. Declaring the single
 * factory we call is the same call `multer-file.ts` makes about the file object: describe the
 * narrow surface actually used rather than pull a whole `@types` package in for it.
 *
 * `unknown` is enough because `MulterOptions.storage` is typed `any` upstream
 * (`@nestjs/platform-express/multer/interfaces/multer-options.interface.d.ts`); nothing in this
 * codebase inspects a storage engine, it only hands one to the module.
 */
declare module 'multer' {
  export function memoryStorage(): unknown;
}
