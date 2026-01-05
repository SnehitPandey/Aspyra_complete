import { Request, Response } from 'express';
import { contentGeneratorService } from '../services/contentGenerator.service.js';

export const contentController = {
  /**
   * Generate content for a specific topic
   * POST /api/content/generate
   */
  async generateContent(req: Request, res: Response) {
    try {
      const { topicTitle, roadmapContext } = req.body;

      if (!topicTitle) {
        return res.status(400).json({ 
          success: false, 
          message: 'Topic title is required' 
        });
      }

      console.log(`📚 Generating content for topic: ${topicTitle}`);

      const content = await contentGeneratorService.generateTopicContent(
        topicTitle,
        roadmapContext
      );

      return res.json({
        success: true,
        data: content,
      });
    } catch (error: any) {
      console.error('Content generation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate content',
        error: error.message,
      });
    }
  },
};
