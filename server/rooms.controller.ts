import { Body, Controller, Inject, Post } from '@nestjs/common';
import { EnterRoomPayload, ReconnectRoomPayload } from '../shared/game';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly roomsService: RoomsService) {}

  @Post('enter')
  enterRoom(@Body() payload: EnterRoomPayload) {
    return this.roomsService.enterRoom(payload);
  }

  @Post('reconnect')
  reconnect(@Body() payload: ReconnectRoomPayload) {
    return this.roomsService.reconnect(payload.playerToken);
  }
}
