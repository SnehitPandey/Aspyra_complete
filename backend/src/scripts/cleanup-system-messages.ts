/**
 * Cleanup Script: Remove System Join/Leave Messages from Database
 * 
 * Run this script to clean up old system messages that were mistakenly persisted to the database.
 * These messages should only be shown in real-time, not stored permanently.
 */

import mongoose from 'mongoose';
import { ChatMessage } from '../models/chatMessage.model.js';
import { env } from '../config/env.js';

async function cleanupSystemMessages() {
  try {
    // Connect to MongoDB
    await mongoose.connect(env.DATABASE_URL);
    console.log('✅ Connected to MongoDB');

    // Find all system messages with "joined the room" or "left the room"
    const result = await ChatMessage.deleteMany({
      type: 'SYSTEM',
      $or: [
        { content: { $regex: 'joined the room', $options: 'i' } },
        { content: { $regex: 'left the room', $options: 'i' } }
      ]
    });

    console.log(`🗑️  Deleted ${result.deletedCount} system join/leave messages`);

    // Show remaining system messages (if any)
    const remainingSystemMessages = await ChatMessage.countDocuments({ type: 'SYSTEM' });
    console.log(`📊 Remaining system messages: ${remainingSystemMessages}`);

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cleaning up system messages:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanupSystemMessages();
