import cron from 'node-cron';
import { duoStreakService } from './duoStreak.service.js';
import type { Logger } from 'pino';
import type { Server as SocketIOServer } from 'socket.io';

export class StreakCronService {
  private readonly logger: Logger | null;
  private readonly io: SocketIOServer;
  private cronJob: cron.ScheduledTask | null = null;

  constructor(io: SocketIOServer, logger?: Logger) {
    this.io = io;
    this.logger = logger ?? null;
  }

  /**
   * Start the cron job to check streaks daily at midnight
   * Runs at 00:05 (5 minutes after midnight) to allow for any delayed task completions
   */
  start(): void {
    if (this.cronJob) {
      this.logger?.warn('Streak cron job already running');
      return;
    }

    // Schedule: "5 0 * * *" = Every day at 00:05 (5 minutes after midnight)
    this.cronJob = cron.schedule('5 0 * * *', async () => {
      this.logger?.info('🕐 Running daily streak check (midnight cron)');
      await this.checkAndResetStreaks();
    });

    this.logger?.info('✅ Streak cron job started (runs daily at 00:05)');
  }

  /**
   * Stop the cron job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      this.logger?.info('⏹️ Streak cron job stopped');
    }
  }

  /**
   * Check all duo streaks and reset if conditions not met
   */
  private async checkAndResetStreaks(): Promise<void> {
    try {
      const today: string = new Date().toISOString().split('T')[0]!;
      const yesterday: string = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

      // Get all duo streaks
      const allStreaks = await duoStreakService.getAllDuoStreaks();

      this.logger?.info({
        totalStreaks: allStreaks.length,
        date: today,
      }, '📊 Checking all duo streaks');

      let resetsCount = 0;

      for (const duoStreak of allStreaks) {
        const shouldReset = await duoStreakService.shouldResetStreak(duoStreak);

        if (shouldReset) {
          // Reset streak to 0 and mark yesterday as missed
          const user1Id = duoStreak.user1Id.toString();
          const user2Id = duoStreak.user2Id.toString();

          await duoStreakService.resetStreak(user1Id, user2Id, yesterday);

          // Emit duo:streakBroken event to both users via Socket.IO
          const payload = {
            streak: 0,
            date: yesterday,
            calendar: Object.fromEntries(duoStreak.calendar),
          };

          this.io.to(user1Id).emit('duo:streakBroken', payload);
          this.io.to(user2Id).emit('duo:streakBroken', payload);

          this.logger?.info({
            user1Id,
            user2Id,
            previousStreak: duoStreak.streak,
            date: yesterday,
          }, '💔 Duo streak reset due to missed day');

          resetsCount++;
        }
      }

      this.logger?.info({
        totalChecked: allStreaks.length,
        resetsCount,
      }, '✅ Daily streak check complete');

    } catch (error) {
      this.logger?.error({ error }, '❌ Error during daily streak check');
    }
  }

  /**
   * Manually trigger streak check (for testing)
   */
  async manualCheck(): Promise<void> {
    this.logger?.info('🔧 Manual streak check triggered');
    await this.checkAndResetStreaks();
  }
}

let streakCronInstance: StreakCronService | null = null;

/**
 * Initialize the streak cron service
 */
export function initializeStreakCron(io: SocketIOServer, logger?: Logger): StreakCronService {
  if (streakCronInstance) {
    return streakCronInstance;
  }

  streakCronInstance = new StreakCronService(io, logger);
  streakCronInstance.start();

  return streakCronInstance;
}

/**
 * Get the streak cron service instance
 */
export function getStreakCron(): StreakCronService | null {
  return streakCronInstance;
}
