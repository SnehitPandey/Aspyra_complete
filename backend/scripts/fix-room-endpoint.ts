/**
 * QUICK FIX ENDPOINT
 * Add this temporarily to room.controller.ts for testing
 * 
 * Call from browser: 
 * fetch('http://localhost:5000/api/rooms/YOUR_ROOM_ID/fix-dates', { 
 *   method: 'POST',
 *   headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
 * })
 */

async fixRoomDates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { roomId } = req.params;
    
    if (!roomId || !Types.ObjectId.isValid(roomId)) {
      throw createError('Invalid room ID', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    if (!room.roadmap || !room.roadmap.phases) {
      throw createError('Room has no roadmap', 400);
    }

    // Calculate total days from room dates
    const startDate = room.startDate ? new Date(room.startDate) : new Date();
    const endDate = room.endDate || new Date(startDate.getTime() + (180 * 24 * 60 * 60 * 1000));
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Collect all milestones
    const allMilestones: any[] = [];
    room.roadmap.phases.forEach(phase => {
      if (phase.milestones && Array.isArray(phase.milestones)) {
        phase.milestones.forEach(m => allMilestones.push(m));
      }
    });

    // Calculate total weight
    const totalWeight = allMilestones.reduce((sum, m) => sum + (m.estimatedHours || 1), 0);

    // Distribute dates
    let currentDate = new Date(startDate);
    allMilestones.forEach((milestone, index) => {
      const weight = milestone.estimatedHours || 1;
      const durationDays = Math.max(1, Math.round((weight / totalWeight) * totalDays));

      milestone.startDate = new Date(currentDate);
      milestone.durationDays = durationDays;
      currentDate.setDate(currentDate.getDate() + durationDays);
      milestone.endDate = new Date(currentDate);

      // Initialize completedTopics
      if (typeof milestone.completedTopics !== 'number') {
        milestone.completedTopics = 0;
      }
    });

    // Adjust last milestone
    if (allMilestones.length > 0) {
      const lastMilestone = allMilestones[allMilestones.length - 1];
      lastMilestone.endDate = new Date(endDate);
      const lastDuration = Math.ceil((endDate.getTime() - new Date(lastMilestone.startDate).getTime()) / (1000 * 60 * 60 * 24));
      lastMilestone.durationDays = Math.max(1, lastDuration);
    }

    // Mark modified and save
    room.markModified('roadmap');
    await room.save();

    res.status(200).json({
      success: true,
      message: 'Room dates fixed successfully',
      totalDays,
      milestonesUpdated: allMilestones.length
    });
  } catch (error) {
    next(error);
  }
}

// Add to routes:
// router.post('/:roomId/fix-dates', authenticateToken, roomController.fixRoomDates.bind(roomController));
