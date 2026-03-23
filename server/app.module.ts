import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RoomsController } from './rooms.controller';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';

@Module({
  controllers: [RoomsController],
  providers: [DatabaseService, RoomsService, RoomsGateway],
})
export class AppModule {}
