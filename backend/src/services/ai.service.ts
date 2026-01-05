import { geminiService } from './gemini.service.js';
import { createError } from '../middleware/errorHandler.js';
import type { IRoadmap, IRoadmapPhase, IRoadmapMilestone } from '../models/room.model.js';

export interface RoadmapInput {
  goal: string;
  tags: string[];
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  durationWeeks?: number;
}

export interface QuizInput {
  topic: string;
  currentMilestone?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  count?: number;
  userProgress?: {
    completedTopics?: string[];
    currentPhase?: number;
  };
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  difficulty: string;
}

export interface QuizResponse {
  topic: string;
  difficulty: string;
  items: QuizQuestion[];
}

class AIService {
  /**
   * Generate a learning roadmap using Gemini AI
   */
  async generateRoadmap(input: RoadmapInput): Promise<IRoadmap> {
    if (!geminiService.isConfigured()) {
      throw createError('Gemini AI is not configured. Please add GEMINI_API_KEY to your environment.', 503);
    }

    try {
      // Build comprehensive prompt for roadmap generation
      const prompt = this.buildRoadmapPrompt(input);

      // Generate roadmap using Gemini with controlled token limit
      const response = await geminiService.generateJSON<{
        goal: string;
        skillLevel: string;
        phases: Array<{
          phase: number;
          title: string;
          description: string;
          duration: string;
          milestones: Array<{
            id: string;
            title: string;
            description: string;
            topics: string[];
            estimatedHours: number;
          }>;
        }>;
        totalDuration: string;
      }>(prompt, {
        maxOutputTokens: 8192,
        temperature: 0.9, // High creativity to avoid generic responses
      });

      // Debug: Log the response structure
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 GEMINI RESPONSE STRUCTURE');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Response type:', typeof response);
      console.log('Response keys:', response ? Object.keys(response) : 'null/undefined');
      console.log('Has phases?:', response && 'phases' in response);
      console.log('Phases type:', response?.phases ? typeof response.phases : 'undefined');
      console.log('Is phases array?:', Array.isArray(response?.phases));
      console.log('Phases length:', response?.phases ? response.phases.length : 0);
      if (response?.phases && Array.isArray(response.phases) && response.phases.length > 0) {
        console.log('First phase structure:', JSON.stringify(response.phases[0], null, 2));
      }
      console.log('Full response preview:', JSON.stringify(response, null, 2).substring(0, 500));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Transform response to match IRoadmap interface
      const roadmap: IRoadmap = {
        goal: input.goal,
        tags: input.tags,
        skillLevel: input.skillLevel,
        phases: response.phases.map((phase): IRoadmapPhase => ({
          phase: phase.phase,
          title: phase.title,
          description: phase.description,
          duration: phase.duration,
          milestones: phase.milestones.map((milestone): IRoadmapMilestone => ({
            id: milestone.id,
            title: milestone.title,
            description: milestone.description,
            topics: milestone.topics,
            estimatedHours: milestone.estimatedHours,
            completed: false,
          })),
        })),
        totalDuration: response.totalDuration,
        generatedAt: new Date(),
      };

      return roadmap;
    } catch (error: any) {
      console.error('Roadmap generation error:', error);
      throw createError(`Failed to generate roadmap: ${error.message}`, error.statusCode || 500);
    }
  }

  /**
   * Generate quiz questions using Gemini AI
   */
  async generateQuiz(input: QuizInput): Promise<QuizResponse> {
    if (!geminiService.isConfigured()) {
      throw createError('Gemini AI is not configured. Please add GEMINI_API_KEY to your environment.', 503);
    }

    try {
      const difficulty = input.difficulty || 'Medium';
      const count = input.count || 5;

      // Build quiz generation prompt
      const prompt = this.buildQuizPrompt(input, difficulty, count);

      // Generate quiz using Gemini
      const response = await geminiService.generateJSON<{
        topic: string;
        difficulty: string;
        questions: Array<{
          question: string;
          options: string[];
          correctAnswer: number;
          explanation: string;
        }>;
      }>(prompt);

      // Transform to QuizResponse format
      const quiz: QuizResponse = {
        topic: input.topic,
        difficulty,
        items: response.questions.map((q) => ({
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          difficulty,
        })),
      };

      return quiz;
    } catch (error: any) {
      console.error('Quiz generation error:', error);
      throw createError(`Failed to generate quiz: ${error.message}`, error.statusCode || 500);
    }
  }

  /**
   * Build roadmap generation prompt
   */
  private buildRoadmapPrompt(input: RoadmapInput): string {
    const { goal, tags, skillLevel, durationWeeks = 12 } = input;
    const tagsStr = tags.join(', ');

    // Define persona based on skill level
    let persona = "You are a friendly and encouraging mentor helping a beginner build their first real project.";
    let focus = "Focus on quick wins, visual results, and 'learning by doing'. Avoid heavy theory initially.";
    
    if (skillLevel === 'Intermediate') {
      persona = "You are a Senior Engineer mentoring a junior developer to reach mid-level.";
      focus = "Focus on best practices, design patterns, clean code, and 'why' things work, not just 'how'.";
    } else if (skillLevel === 'Advanced') {
      persona = "You are a Staff Engineer or Architect designing a mastery path.";
      focus = "Focus on performance, scalability, security, edge cases, and deep internal mechanics.";
    }

    return `ROLE: ${persona}
    
TASK: Create a highly specific, project-driven learning roadmap.
CONTEXT:
- Goal: ${goal}
- Tech Stack: ${tagsStr}
- Level: ${skillLevel}
- Duration: ${durationWeeks} weeks
- Strategy: ${focus}

⛔ FORBIDDEN WORDS (DO NOT USE IN TITLES):
- "Introduction", "Basics", "Fundamentals", "Overview", "Getting Started", "Setup", "Conclusion"
- "Advanced", "Intermediate", "Mastering" (unless followed by a specific concept)

✅ REQUIRED STYLE:
- Titles must be ACTION-ORIENTED and CONCISE (3-6 words max).
- NEVER list multiple technologies in a title (e.g., "Using HTML, CSS, and JS" -> "Frontend Fundamentals").
- Topics must be GRANULAR TASKS (e.g., "Configure JWT expiration" instead of "Auth").
- Every milestone must feel like a mini-project or a concrete achievement.

STRUCTURE:
- 2 phases total
- 4 milestones per phase (8 total)
- 8-9 topics per milestone (be specific!)
- estimatedHours: 10-15

FORMAT:
Return ONLY valid JSON matching this structure.

{
  "goal": "${goal}",
  "skillLevel": "${skillLevel}",
  "phases": [
    {
      "phase": 1,
      "title": "Phase 1: [Creative Phase Name]",
      "description": "Specific description of what will be built/achieved.",
      "duration": "X weeks",
      "milestones": [
        {
          "id": "p1m1",
          "title": "[Action-Oriented Title]",
          "description": "Specific outcome of this week.",
          "topics": [
            "Specific task 1",
            "Specific task 2",
            "Specific task 3"
          ],
          "estimatedHours": 12
        }
      ]
    }
  ],
  "totalDuration": "${durationWeeks} weeks"
}`;
  }

  /**
   * Build quiz generation prompt
   */
  private buildQuizPrompt(input: QuizInput, difficulty: string, count: number): string {
    const { topic, currentMilestone, userProgress } = input;
    
    let contextStr = '';
    if (currentMilestone) {
      contextStr += `\n**Current Milestone:** ${currentMilestone}`;
    }
    if (userProgress?.completedTopics && userProgress.completedTopics.length > 0) {
      contextStr += `\n**Completed Topics:** ${userProgress.completedTopics.join(', ')}`;
    }

    return `ROLE: Expert Technical Interviewer & Senior Developer.
TASK: Create ${count} challenging, scenario-based quiz questions.

CONTEXT:
- Topic: ${topic}
- Difficulty: ${difficulty}
${contextStr}

⛔ FORBIDDEN:
- "What is X?" style definitions.
- Questions that can be answered by just knowing the acronym.
- Generic questions that apply to any language/framework.

✅ REQUIRED STYLE:
- Use CODE SNIPPETS for at least 50% of questions (if applicable to the topic).
- Use "SCENARIOS": "You are building X, and Y happens. What is the best solution?"
- Focus on "Why", "When to use", "Trade-offs", and "Common Pitfalls".
- Explanations must be educational, explaining WHY the correct answer is right AND why others are wrong.

FORMAT:
Return ONLY valid JSON.

\`\`\`json
{
  "topic": "${topic}",
  "difficulty": "${difficulty}",
  "questions": [
    {
      "question": "Scenario or Code Snippet here...",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": 0,
      "explanation": "Detailed breakdown..."
    }
  ]
}
\`\`\`

Generate now:`;
  }

  /**
   * Generate AI summary and feedback for room creation
   */
  async generateRoomSummary(input: {
    roomTitle: string;
    description?: string;
    topics: string[];
    durationDays: number;
    skillLevel: string;
    dailyTime: string;
    goal?: string;
  }): Promise<{
    summary: string;
    feedback: string;
    estimatedCompletion: string;
    intensityLevel: string;
    recommendations: string[];
  }> {
    if (!geminiService.isConfigured()) {
      throw createError('Gemini AI is not configured. Please add GEMINI_API_KEY to your environment.', 503);
    }

    try {
      const prompt = this.buildRoomSummaryPrompt(input);
      
      const response = await geminiService.generateJSON<{
        summary: string;
        feedback: string;
        estimatedCompletion: string;
        intensityLevel: string;
        recommendations: string[];
      }>(prompt, {
        maxOutputTokens: 1024, // Increased token limit for complete response
        temperature: 0.7,
      });

      return response;
    } catch (error: any) {
      console.error('Room summary generation error:', error);
      throw createError(`Failed to generate room summary: ${error.message}`, error.statusCode || 500);
    }
  }

  /**
   * Generate simple text response for chat/conversations
   */
  async generateSimpleText(prompt: string, maxTokens?: number): Promise<string> {
    if (!geminiService.isConfigured()) {
      console.error('❌ Gemini AI is not configured');
      throw createError('Gemini AI is not configured. Please add GEMINI_API_KEY to your environment.', 503);
    }

    try {
      console.log('🚀 Calling Gemini API...');
      console.log('📊 Token limit:', maxTokens || 1000);
      console.log('📝 Prompt preview:', prompt.substring(0, 100) + '...');
      const response = await geminiService.generateText(prompt, {
        maxOutputTokens: maxTokens || 1000, // Increased default from 500 to 1000
        temperature: 0.7,
      });
      console.log('✅ Gemini API responded successfully');
      console.log('📝 Response length:', response.length);
      console.log('📝 Response preview:', response.substring(0, 100));

      return response;
    } catch (error: any) {
      console.error('❌ Simple text generation error:', error);
      console.error('Error details:', {
        message: error.message,
        statusCode: error.statusCode,
        stack: error.stack
      });
      throw createError(`Failed to generate text: ${error.message}`, error.statusCode || 500);
    }
  }

  /**
   * Build prompt for room summary generation
   */
  private buildRoomSummaryPrompt(input: {
    roomTitle: string;
    description?: string;
    topics: string[];
    durationDays: number;
    skillLevel: string;
    dailyTime: string;
    goal?: string;
  }): string {
    const durationWeeks = Math.ceil(input.durationDays / 7);
    const dailyTimeMap: { [key: string]: number } = {
      '30min': 0.5,
      '1hr': 1,
      '2hrs': 2,
      '3hrs+': 3
    };
    const dailyHours = dailyTimeMap[input.dailyTime] || 1;
    const totalHours = input.durationDays * dailyHours;

    return `ROLE: Experienced Learning Advisor & Career Coach.
TASK: Analyze this learning plan and provide a personalized assessment.

CONTEXT:
- Title: ${input.roomTitle}
- Goal: ${input.goal || input.roomTitle}
- Topics: ${input.topics.join(', ')}
- Level: ${input.skillLevel}
- Duration: ${input.durationDays} days (${durationWeeks} weeks)
- Daily Commitment: ${input.dailyTime} (${dailyHours}h/day)
- Total Hours: ${totalHours}h

INSTRUCTIONS:
1. **Summary**: Be encouraging but professional. Focus on the *outcome* (e.g., "This plan will take you from zero to deploying a full-stack app").
2. **Feedback**: Be brutally honest about the timeline. Is ${totalHours} hours enough for ${input.topics.length} topics? If not, say so!
3. **Recommendations**: Give 3 specific tips related to the *specific tech stack* (e.g., "Focus on React Hooks before Redux", not just "Practice daily").

FORMAT:
Return ONLY valid JSON.

\`\`\`json
{
  "summary": "...",
  "feedback": "...",
  "estimatedCompletion": "X-Y%",
  "intensityLevel": "Light/Moderate/Intensive/Extreme",
  "recommendations": ["Tip 1", "Tip 2", "Tip 3"]
}
\`\`\`

Generate analysis:`;
  }
}

export const aiService = new AIService();
