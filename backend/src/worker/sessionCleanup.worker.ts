// backend/src/worker/sessionCleanup.worker.ts
/**
 * Session Cleanup Worker
 * Scheduled job to cleanup stale focus sessions (no pulse for 30+ minutes)
 */

import cron from 'node-cron';
import { FocusSession } from '../models/focusSession.model.js';

let cleanupJob: cron.ScheduledTask | null = null;

/**
 * Start the session cleanup cron job
 * Runs every 15 minutes
 */
export const startSessionCleanupJob = (): void => {
  if (cleanupJob) {
    console.log('⚠️ Session cleanup job is already running');
    return;
  }

  // Run every 15 minutes: */15 * * * *
  cleanupJob = cron.schedule('*/15 * * * *', async () => {
    try {
      console.log('🧹 [SessionCleanup] Starting cleanup of stale focus sessions...');
      
      const count = await FocusSession.cleanupStaleSessions();
      
      if (count > 0) {
        console.log(`✅ [SessionCleanup] Cleaned up ${count} stale session(s)`);
      } else {
        console.log('✅ [SessionCleanup] No stale sessions found');
      }
    } catch (error) {
      console.error('❌ [SessionCleanup] Error cleaning up stale sessions:', error);
    }
  });

  console.log('✅ Session cleanup cron job started (runs every 15 minutes)');
};

/**
 * Stop the session cleanup cron job
 */
export const stopSessionCleanupJob = (): void => {
  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
    console.log('🛑 Session cleanup cron job stopped');
  }
};

/**
 * Run cleanup immediately (for testing or manual trigger)
 */
export const runSessionCleanupNow = async (): Promise<number> => {
  try {
    console.log('🧹 [SessionCleanup] Running immediate cleanup...');
    const count = await FocusSession.cleanupStaleSessions();
    console.log(`✅ [SessionCleanup] Cleaned up ${count} stale session(s)`);
    return count;
  } catch (error) {
    console.error('❌ [SessionCleanup] Error during immediate cleanup:', error);
    throw error;
  }
};
