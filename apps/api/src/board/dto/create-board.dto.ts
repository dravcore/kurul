import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BOARD_TEMPLATE_SLUGS, type BoardTemplateSlug } from '../../common/board-templates';
import { MAX_BOARD_DESCRIPTION_LENGTH, MAX_BOARD_NAME_LENGTH } from './board-limits';

export class CreateBoardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BOARD_NAME_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_BOARD_DESCRIPTION_LENGTH)
  description?: string;

  /**
   * Which starting shape to write, by slug. Omit and the board gets the default seed columns
   * and no labels — the pre-template behaviour, which is what every existing client relies on.
   *
   * Validated against the catalog itself rather than a list repeated here, so a template can
   * never exist and be rejected (or the reverse). An unknown slug is a `400` in the standard
   * envelope with `constraint: "isIn"`, not a silently ignored field: a client that asked for
   * a triage board and got a plain one has no way to notice.
   */
  @IsOptional()
  @IsIn(BOARD_TEMPLATE_SLUGS)
  template?: BoardTemplateSlug;
}
