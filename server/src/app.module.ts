import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AuthModule } from './auth/auth.module'
import { validateEnvironment } from './config/environment'
import { DatabaseModule } from './database/database.module'
import { DeviceModule } from './devices/device.module'
import { HealthModule } from './health/health.module'
import { PointModule } from './points/point.module'
import { QuestModule } from './quests/quest.module'
import { SessionModule } from './sessions/session.module'
import { StatisticsModule } from './statistics/statistics.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    DeviceModule,
    SessionModule,
    QuestModule,
    PointModule,
    StatisticsModule,
    HealthModule,
  ],
})
export class AppModule {}
