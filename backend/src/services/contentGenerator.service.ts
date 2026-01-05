import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export interface TopicContent {
  content: string;
  codeExample: string;
  studyResources: {
    title: string;
    url?: string;
    type: 'documentation' | 'video' | 'interactive';
  }[];
}

export const contentGeneratorService = {
  /**
   * Generate comprehensive learning content for a specific topic
   */
  async generateTopicContent(topicTitle: string, roadmapContext?: string): Promise<TopicContent> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        const model = genAI.getGenerativeModel({ 
          model: env.GEMINI_MODEL,
          generationConfig: {
            temperature: 0.7 + (attempts * 0.1), // Increase temperature slightly on retries
            maxOutputTokens: 4096,
          },
        });

        const prompt = `ROLE: Technical Educator.
TASK: Create concise study content for: "${topicTitle}".
${roadmapContext ? `CONTEXT: Part of "${roadmapContext}".` : ''}

✅ REQUIREMENTS:
1. **Content**: 150-200 words explaining what "${topicTitle}" is, why it matters, and basic use cases.
2. **Code Example**: Simple, clear code snippet (8-12 lines) showing basic usage of "${topicTitle}".
3. **Resources**: 2-3 REAL links to official docs or trusted sources about "${topicTitle}".

JSON FORMAT:
{
  "content": "Explanation of ${topicTitle}",
  "codeExample": "// Code demonstrating ${topicTitle}",
  "studyResources": [
    {"type": "documentation", "title": "Resource name", "url": "https://real-url.com"}
  ]
}

Generate content specifically for "${topicTitle}":`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Robust JSON extraction: Find the first '{' and last '}'
        let jsonText = text;
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonText = text.substring(firstBrace, lastBrace + 1);
        } else {
          // Fallback to regex if braces method fails (unlikely for valid JSON)
          const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch && jsonMatch[1]) {
            jsonText = jsonMatch[1];
          }
        }

        let content;
        try {
          content = JSON.parse(jsonText);
        } catch (parseError) {
          console.error('JSON Parse Error. Raw text:', text);
          console.error('Extracted text:', jsonText);
          throw new Error('Failed to parse AI response as JSON');
        }

        // Validate the structure
        if (!content.content) {
          throw new Error('Invalid content structure returned from AI');
        }

        // Validate and fix ALL studyResources URLs
        if (content.studyResources && Array.isArray(content.studyResources)) {
          content.studyResources = content.studyResources.map((resource: any) => {
            if (!resource.url || !resource.url.startsWith('http') || !resource.url.includes('.')) {
              console.warn('⚠️ AI returned invalid URL:', resource.url, 'for', resource.title);
              // Generate appropriate fallback based on type
              if (resource.type === 'documentation') {
                resource.url = `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(topicTitle)}`;
              } else if (resource.type === 'video') {
                resource.url = `https://www.youtube.com/results?search_query=${encodeURIComponent(topicTitle + ' tutorial')}`;
              } else {
                resource.url = `https://www.google.com/search?q=${encodeURIComponent(topicTitle)}`;
              }
            }
            return resource;
          });
        }

        return content;
      } catch (error: any) {
        console.error(`Error generating topic content (Attempt ${attempts}/${maxAttempts}):`, error.message);
        
        // Handle Rate Limiting (429)
        if (error.message?.includes('429') || error.status === 429) {
           console.warn('⏳ Rate limit hit. Waiting 5s before retry...');
           await new Promise(resolve => setTimeout(resolve, 5000));
        }

        if (attempts === maxAttempts) throw error;
      }
    }
    throw new Error('Failed to generate content after multiple attempts');
  },

  /**
   * Fallback content if AI generation fails
   */
  getFallbackContent(topicTitle: string): TopicContent {
    return {
      content: `${topicTitle} is an essential concept in modern web development. It helps developers build better applications by providing structured approaches to common problems. Understanding this topic will enhance your development skills and make you more productive. Learning ${topicTitle} will give you the tools to create more efficient and maintainable code in your projects.`,
      codeExample: `// Example: ${topicTitle}\n\nfunction example() {\n  // Implementation details\n  console.log('${topicTitle} example');\n}\n\nexample();`,
      studyResources: [
        {
          title: `${topicTitle} - MDN Web Docs`,
          url: `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(topicTitle)}`,
          type: 'documentation',
        },
        {
          title: `${topicTitle} Tutorial`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(topicTitle + ' tutorial')}`,
          type: 'video',
        },
        {
          title: `Learn ${topicTitle}`,
          url: `https://www.w3schools.com/`,
          type: 'interactive',
        },
      ],
    };
  },
};
