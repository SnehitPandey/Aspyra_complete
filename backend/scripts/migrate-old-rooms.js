/**
 * ONE-TIME MIGRATION SCRIPT
 * Run this to fix old rooms without milestone dates
 * 
 * Usage:
 * 1. Open MongoDB shell or Compass
 * 2. Run this script against your database
 * 3. Refresh the room page
 */

// Update all rooms that have roadmaps but milestones without dates
db.rooms.find({
  'roadmap.phases.milestones': { $exists: true }
}).forEach(function(room) {
  let modified = false;
  
  if (!room.roadmap || !room.roadmap.phases) {
    return;
  }
  
  // Calculate total days from room dates
  const startDate = room.startDate ? new Date(room.startDate) : new Date();
  const endDate = room.endDate || new Date(startDate.getTime() + (180 * 24 * 60 * 60 * 1000)); // Default 180 days
  
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Collect all milestones
  let allMilestones = [];
  room.roadmap.phases.forEach(phase => {
    if (phase.milestones) {
      phase.milestones.forEach(m => {
        allMilestones.push({
          phase: phase,
          milestone: m
        });
      });
    }
  });
  
  // Calculate total weight
  const totalWeight = allMilestones.reduce((sum, item) => {
    return sum + (item.milestone.estimatedHours || 1);
  }, 0);
  
  // Distribute dates
  let currentDate = new Date(startDate);
  
  allMilestones.forEach((item, index) => {
    const milestone = item.milestone;
    
    // Check if milestone needs dates
    if (!milestone.startDate || !milestone.endDate) {
      const weight = milestone.estimatedHours || 1;
      const durationDays = Math.max(1, Math.round((weight / totalWeight) * totalDays));
      
      milestone.startDate = new Date(currentDate);
      milestone.durationDays = durationDays;
      currentDate.setDate(currentDate.getDate() + durationDays);
      milestone.endDate = new Date(currentDate);
      
      modified = true;
    }
    
    // Initialize completedTopics if missing
    if (typeof milestone.completedTopics !== 'number') {
      milestone.completedTopics = 0;
      modified = true;
    }
  });
  
  // Adjust last milestone to match exact end date
  if (allMilestones.length > 0) {
    const lastMilestone = allMilestones[allMilestones.length - 1].milestone;
    if (lastMilestone.startDate) {
      lastMilestone.endDate = new Date(endDate);
      const lastDuration = Math.ceil((endDate.getTime() - new Date(lastMilestone.startDate).getTime()) / (1000 * 60 * 60 * 24));
      lastMilestone.durationDays = Math.max(1, lastDuration);
      modified = true;
    }
  }
  
  // Save if modified
  if (modified) {
    db.rooms.updateOne(
      { _id: room._id },
      { $set: { roadmap: room.roadmap } }
    );
    print('Updated room: ' + room.title + ' (ID: ' + room._id + ')');
  }
});

print('Migration complete!');
