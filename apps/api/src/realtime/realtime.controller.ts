import { Controller } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

@Controller()
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}
}
