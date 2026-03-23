import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameActionPayload, RoomConfigUpdatePayload } from '../shared/game';
import { RoomsService } from './rooms.service';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RoomsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(@Inject(RoomsService) private readonly roomsService: RoomsService) {
    this.roomsService.attachBroadcaster((packets) => {
      for (const packet of packets) {
        this.server.to(packet.socketId).emit(packet.event, packet.data);
      }
    });
  }

  handleDisconnect(client: Socket) {
    this.roomsService.handleDisconnect(client.id);
  }

  @SubscribeMessage('room:subscribe')
  subscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: { playerToken: string }) {
    try {
      this.roomsService.attachSocket(payload.playerToken, client.id);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('room:leave')
  leaveRoom(@ConnectedSocket() client: Socket) {
    try {
      this.roomsService.leaveBySocket(client.id);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('room:update-config')
  updateConfig(@ConnectedSocket() client: Socket, @MessageBody() payload: RoomConfigUpdatePayload) {
    try {
      this.roomsService.updateConfigBySocket(client.id, payload.config);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('room:add-bot')
  addBot(@ConnectedSocket() client: Socket, @MessageBody() payload: { seat: number }) {
    try {
      this.roomsService.addBotBySocket(client.id, payload.seat);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('room:remove-bot')
  removeBot(@ConnectedSocket() client: Socket, @MessageBody() payload: { playerId: string }) {
    try {
      this.roomsService.removeBotBySocket(client.id, payload.playerId);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('game:start')
  startGame(@ConnectedSocket() client: Socket) {
    try {
      this.roomsService.startGameBySocket(client.id);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }

  @SubscribeMessage('game:action')
  gameAction(@ConnectedSocket() client: Socket, @MessageBody() payload: GameActionPayload) {
    try {
      this.roomsService.playerActionBySocket(client.id, payload);
    } catch (error) {
      client.emit('room:error', { message: toMessage(error) });
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown room error.';
}
