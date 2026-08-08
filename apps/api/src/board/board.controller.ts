import { Controller } from '@nestjs/common';
import { BoardService } from './board.service';

@Controller('boards')
export class BoardController {
  constructor(private readonly boardService: BoardService) {}
}
