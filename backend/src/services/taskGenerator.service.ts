/**
 * Task Generator Service
 * 
 * Backend service for generating today's tasks based on active milestone
 * and timeline pacing. Implements the same logic as frontend for consistency.
 */

interface Topic {
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed';
  estimatedHours?: number;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  topics: (string | Topic)[];
  estimatedHours: number;
  startDate?: string | Date;
  endDate?: string | Date;
  completed: boolean;
  completedTopics?: number;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  milestone: string;
  milestoneId: string;
  estimatedHours: number;
  startDate?: string | Date;
  endDate?: string | Date;
  order: number;
  roomId?: string;
  roomName?: string;
  roomCode?: string;
}

/**
 * Calculate number of days between two dates
 */
function calculateDaysBetween(startDate: Date | string, endDate: Date | string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Calculate number of days elapsed since start
 */
function calculateDaysElapsed(startDate: Date | string, currentDate: Date = new Date()): number {
  const start = new Date(startDate);
  const current = new Date(currentDate);
  const diffTime = current.getTime() - start.getTime();
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  return diffDays;
}

/**
 * Normalize topic to object format
 */
function normalizeTopic(topic: string | Topic, index: number): Topic {
  if (typeof topic === 'string') {
    return {
      title: topic,
      status: 'pending' as const,
    };
  }
  return topic;
}

/**
 * Find the first active milestone from a roadmap
 */
export function findActiveMilestone(milestones: Milestone[], currentDate: Date = new Date()): Milestone | null {
  if (!milestones || milestones.length === 0) return null;

  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);

  // Find first milestone that:
  // 1. Has not ended yet (endDate >= today)
  // 2. Has uncompleted topics
  const activeMilestone = milestones.find((milestone) => {
    if (!milestone.startDate || !milestone.endDate) return false;
    
    const endDate = new Date(milestone.endDate);
    endDate.setHours(23, 59, 59, 999);
    
    const normalizedTopics = milestone.topics.map((t, i) => normalizeTopic(t, i));
    const hasUncompletedTopics = normalizedTopics.some(
      (topic) => topic.status !== 'completed'
    );
    
    return endDate >= today && hasUncompletedTopics;
  });

  return activeMilestone || null;
}

/**
 * Calculate how many topics should be studied per day
 */
function calculateTopicsPerDay(milestone: Milestone, currentDate: Date = new Date()): number {
  if (!milestone || !milestone.topics || !milestone.startDate || !milestone.endDate) {
    return 0;
  }

  const totalDays = calculateDaysBetween(milestone.startDate, milestone.endDate) || 1;
  const normalizedTopics = milestone.topics.map((t, i) => normalizeTopic(t, i));
  const remainingTopics = normalizedTopics.filter((t) => t.status !== 'completed').length;
  const daysElapsed = calculateDaysElapsed(milestone.startDate, currentDate);
  const remainingDays = Math.max(1, totalDays - daysElapsed);
  
  const topicsPerDay = Math.ceil(remainingTopics / remainingDays);
  
  // Cap at maximum 6 topics per day
  return Math.min(6, Math.max(1, topicsPerDay));
}

/**
 * Generate today's task list from active milestone
 */
export function generateTodaysTasks(milestones: Milestone[], currentDate: Date = new Date()): Task[] {
  if (!milestones || milestones.length === 0) {
    return [];
  }

  // Step 1: Find the first active milestone
  const activeMilestone = findActiveMilestone(milestones, currentDate);
  
  if (!activeMilestone) {
    return []; // No active milestone found
  }

  // Step 2: Calculate how many topics should be studied today
  const topicsPerDay = calculateTopicsPerDay(activeMilestone, currentDate);

  // Step 3: Get all topics and normalize them
  const normalizedTopics = activeMilestone.topics.map((t, i) => normalizeTopic(t, i));
  
  // Get uncompleted topics
  const uncompletedTopics = normalizedTopics.filter(
    (topic) => topic.status !== 'completed'
  );
  
  // Get completed topics (for display)
  const completedTopics = normalizedTopics.filter(
    (topic) => topic.status === 'completed'
  );

  // Step 4: Select today's chunk of uncompleted topics
  const todaysUncompletedTopics = uncompletedTopics.slice(0, topicsPerDay);
  
  // ✨ NEW: Combine completed topics from today with new uncompleted topics
  // Show completed topics that were scheduled for today (strikethrough) + new topics
  const todaysTopics = [...completedTopics.slice(-topicsPerDay), ...todaysUncompletedTopics].slice(0, topicsPerDay);

  // Step 5: Format as task objects
  return todaysTopics.map((topic, index) => ({
    id: `${activeMilestone.id}-topic-${index}`,
    title: topic.title,
    description: topic.description || `Study topic from ${activeMilestone.title}`,
    status: topic.status || 'pending',
    milestone: activeMilestone.title,
    milestoneId: activeMilestone.id,
    estimatedHours: topic.estimatedHours || Math.ceil(activeMilestone.estimatedHours / activeMilestone.topics.length),
    startDate: activeMilestone.startDate,
    endDate: activeMilestone.endDate,
    order: index,
    completed: topic.status === 'completed', // ✨ Add explicit completed flag
  }));
}

/**
 * Generate today's tasks for a specific room
 */
export function generateRoomTodaysTasks(room: any, currentDate: Date = new Date()): Task[] {
  if (!room) {
    return [];
  }

  // Extract all milestones from phases or customRoadmap
  let allMilestones: Milestone[] = [];
  
  if (room.roadmap?.phases && Array.isArray(room.roadmap.phases)) {
    room.roadmap.phases.forEach((phase: any) => {
      if (phase.milestones && Array.isArray(phase.milestones)) {
        allMilestones = allMilestones.concat(phase.milestones);
      }
    });
  } else if (room.customRoadmap && Array.isArray(room.customRoadmap)) {
    // Handle flat roadmap structure (customRoadmap)
    allMilestones = room.customRoadmap;
  }

  // Generate today's tasks
  const tasks = generateTodaysTasks(allMilestones, currentDate);

  // Add room context to each task
  return tasks.map((task) => ({
    ...task,
    roomId: room._id?.toString() || room.id,
    roomName: room.title,
    roomCode: room.code,
  }));
}

/**
 * Generate today's tasks from multiple rooms
 */
export function generateMultiRoomTodaysTasks(rooms: any[], currentDate: Date = new Date(), limit: number = 10): Task[] {
  if (!rooms || rooms.length === 0) {
    return [];
  }

  let allTasks: Task[] = [];

  // Generate tasks from each room
  rooms.forEach((room) => {
    const roomTasks = generateRoomTodaysTasks(room, currentDate);
    allTasks = allTasks.concat(roomTasks);
  });

  // Sort by milestone start date (earliest first)
  allTasks.sort((a, b) => {
    const dateA = new Date(a.startDate || 0);
    const dateB = new Date(b.startDate || 0);
    return dateA.getTime() - dateB.getTime();
  });

  // Apply limit
  return allTasks.slice(0, limit);
}

/**
 * Get milestone progress summary
 */
export function getMilestoneProgress(milestone: Milestone): {
  total: number;
  completed: number;
  remaining: number;
  percentage: number;
  isComplete: boolean;
} {
  if (!milestone || !milestone.topics) {
    return {
      total: 0,
      completed: 0,
      remaining: 0,
      percentage: 0,
      isComplete: false,
    };
  }

  const normalizedTopics = milestone.topics.map((t, i) => normalizeTopic(t, i));
  const total = normalizedTopics.length;
  const completed = normalizedTopics.filter((t) => t.status === 'completed').length;
  const remaining = total - completed;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    remaining,
    percentage,
    isComplete: completed === total && total > 0,
  };
}

/**
 * Get overall roadmap progress
 */
export function getRoadmapProgress(milestones: Milestone[]): {
  totalMilestones: number;
  completedMilestones: number;
  currentMilestone: string | null;
  overallPercentage: number;
} {
  if (!milestones || milestones.length === 0) {
    return {
      totalMilestones: 0,
      completedMilestones: 0,
      currentMilestone: null,
      overallPercentage: 0,
    };
  }

  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter((m) => m.completed).length;
  const currentMilestone = findActiveMilestone(milestones);
  
  // Calculate overall percentage based on completed milestones
  const overallPercentage = Math.round((completedMilestones / totalMilestones) * 100);

  return {
    totalMilestones,
    completedMilestones,
    currentMilestone: currentMilestone ? currentMilestone.title : null,
    overallPercentage,
  };
}
