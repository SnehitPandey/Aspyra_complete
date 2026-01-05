/**
 * Gemini AI Service
 * Handles all interactions with Google's Gemini AI API
 */

import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from '@google/generative-ai';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';

// Helper function to wait for a specific amount of time
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface GeminiConfig {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private defaultConfig: GenerationConfig;

  constructor() {
    // Initialize Gemini AI with API key
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    
    // Set up default configuration
    this.defaultConfig = {
      temperature: env.GEMINI_TEMPERATURE,
      maxOutputTokens: env.GEMINI_MAX_TOKENS,
      topP: 0.95,
      topK: 40,
    };

    // Initialize the model
    this.model = this.genAI.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: this.defaultConfig,
    });
  }

  /**
   * Generate text using Gemini AI with automatic retries for server-side errors
   * @param prompt - The prompt to send to Gemini
   * @param config - Optional configuration overrides
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns Generated text response
   */
  async generateText(prompt: string, config?: GeminiConfig, maxRetries: number = 3): Promise<string> {
    let delay = 1000; // Start with a 1-second delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use custom config if provided
        const model = config?.model || config?.temperature || config?.maxOutputTokens || config?.responseMimeType
          ? this.genAI.getGenerativeModel({
              model: config.model || env.GEMINI_MODEL,
              generationConfig: {
                ...this.defaultConfig,
                temperature: config.temperature ?? this.defaultConfig.temperature,
                maxOutputTokens: config.maxOutputTokens ?? this.defaultConfig.maxOutputTokens,
                responseMimeType: config.responseMimeType || undefined,
              },
            })
          : this.model;

        const result = await model.generateContent(prompt);
        const response = result.response;

        // Validate response completion status
        const finishReason = response.candidates?.[0]?.finishReason;
        
        // Try to get text, with error handling
        let text: string;
        try {
          text = response.text();
        } catch (textError: any) {
          console.error('⚠ Error extracting text from response:', textError.message);
          // Try to get text from candidates directly
          const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) {
            text = content;
            console.log('✓ Extracted text from candidates directly');
          } else {
            throw createError('Could not extract text from Gemini response', 500);
          }
        }

        console.log(`📊 Response stats: finishReason=${finishReason}, textLength=${text?.length || 0}`);

        // Check if the response was stopped for any reason other than normal "STOP"
        if (finishReason && finishReason !== 'STOP') {
          console.error(`⚠ Gemini response finished with non-STOP reason: ${finishReason}`);
          console.error(`Response text length: ${text?.length || 0} characters`);
          
          // For MAX_TOKENS, check if we at least got some text
          if (finishReason === 'MAX_TOKENS') {
            if (!text || text.trim().length === 0) {
              // Log more details for debugging
              console.error('Full response structure:', JSON.stringify(response, null, 2));
              throw createError('Response truncated: Token limit too low or prompt too long. Try reducing prompt size.', 500);
            }
            // If we have text, return it with a warning
            console.warn('⚠ Response may be truncated due to token limit, but returning available text');
            return text.trim();
          } else {
            // For SAFETY, RECITATION, or OTHER, this is a real error
            throw createError(
              `AI response was incomplete or blocked (Reason: ${finishReason})`,
              500
            );
          }
        }

        if (!text || text.trim().length === 0) {
          throw createError('Empty response from Gemini AI', 500);
        }

        // Success! Return the text
        if (attempt > 1) {
          console.log(`✓ Gemini request succeeded on attempt ${attempt}`);
        }
        return text;

      } catch (error: any) {
        // Check for non-retryable errors first
        if (error.message?.includes('API_KEY')) {
          throw createError('Invalid Gemini API key. Please check your configuration.', 500);
        }
        
        if (error.message?.includes('quota') && !error.message?.includes('overloaded')) {
          throw createError('Gemini API quota exceeded. Please try again later.', 429);
        }

        // Check if the error is retryable (503, 500, or "overloaded")
        const isRetryable =
          error.status === 503 ||
          error.status === 500 ||
          error.statusCode === 503 ||
          error.statusCode === 500 ||
          (error.message && error.message.toLowerCase().includes('overloaded'));

        // If it's a retryable error and we haven't exhausted our retries
        if (isRetryable && attempt < maxRetries) {
          console.warn(`⚠ Gemini AI model overloaded (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s...`);
          console.warn(`Error: ${error.message}`);
          
          // Wait for the delay
          await sleep(delay);
          
          // Exponential backoff: double the delay for next attempt
          delay *= 2;

        } else {
          // If it's not a retryable error OR we've run out of attempts
          console.error(`❌ Gemini request failed after ${attempt} attempts`);
          console.error('Gemini AI Error:', error);
          
          throw createError(
            `Gemini AI error: ${error.message || 'Unknown error'}`,
            error.status || error.statusCode || 500
          );
        }
      }
    }

    // This line should be unreachable, but it satisfies TypeScript
    throw createError('Failed to generate text after all retries', 500);
  }

  /**
   * Generate JSON response using Gemini AI with dedicated JSON model and retry logic
   * @param prompt - The prompt to send to Gemini
   * @param config - Optional configuration overrides
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns Parsed JSON response
   */
  async generateJSON<T = any>(prompt: string, config?: GeminiConfig, maxRetries: number = 3): Promise<T> {
    let delay = 1000; // Start with 1-second delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use a dedicated model configured for JSON output
        const jsonConfig: GenerationConfig = {
          ...this.defaultConfig,
          temperature: config?.temperature ?? 0.7,
          maxOutputTokens: config?.maxOutputTokens ?? 4096, // Higher limit for JSON
          responseMimeType: 'application/json', // Force JSON output
        };

        const jsonModel = this.genAI.getGenerativeModel({
          model: config?.model || env.GEMINI_MODEL,
          generationConfig: jsonConfig,
        });

        // Add explicit instruction to ensure valid JSON
        const jsonPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no code blocks.`;

        const result = await jsonModel.generateContent(jsonPrompt);
        const response = result.response;

        // Validate response completion
        const finishReason = response.candidates?.[0]?.finishReason;
        const text = response.text();

        if (finishReason && finishReason !== 'STOP') {
          console.warn(`⚠ JSON response finished with reason: ${finishReason}`);
          if (finishReason === 'MAX_TOKENS') {
            console.error('❌ Response truncated due to token limit');
            throw createError('AI response was truncated. Try reducing the request scope.', 500);
          }
        }

        if (!text || text.trim().length === 0) {
          throw createError('AI returned an empty JSON response', 500);
        }

        // With responseMimeType: 'application/json', the response should be valid JSON
        console.log('✓ Received JSON response from Gemini');
        console.log(`Response length: ${text.length} characters`);
        
        // Parse the JSON directly (no extraction needed with responseMimeType)
        try {
          const parsed = JSON.parse(text);
          console.log('✓ Successfully parsed JSON response');
          
          // Success! Return on first attempt or after retries
          if (attempt > 1) {
            console.log(`✓ JSON generation succeeded on attempt ${attempt}`);
          }
          return parsed as T;
        } catch (parseError: any) {
          // If parsing fails, log details
          console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.error('❌ JSON PARSE ERROR (with responseMimeType)');
          console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.error('Parse Error:', parseError.message);
          console.error('Response length:', text.length, 'characters');
          console.error('First 300 chars:', text.substring(0, 300));
          console.error('Last 300 chars:', text.substring(Math.max(0, text.length - 300)));
          console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          
          throw createError(
            `Failed to parse JSON response: ${parseError.message}`,
            500
          );
        }

      } catch (error: any) {
        // Check for non-retryable errors first
        if (error.statusCode && error.statusCode !== 500 && error.statusCode !== 503) {
          throw error; // Don't retry client errors (400s) or other specific errors
        }

        // Check if the error is retryable (503, 500, or "overloaded")
        const isRetryable =
          error.status === 503 ||
          error.status === 500 ||
          error.statusCode === 503 ||
          error.statusCode === 500 ||
          (error.message && error.message.toLowerCase().includes('overloaded'));

        // If it's a retryable error and we haven't exhausted our retries
        if (isRetryable && attempt < maxRetries) {
          console.warn(`⚠ Gemini JSON API overloaded (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s...`);
          console.warn(`Error: ${error.message}`);
          
          // Wait for the delay
          await sleep(delay);
          
          // Exponential backoff: double the delay for next attempt
          delay *= 2;

        } else {
          // If it's not a retryable error OR we've run out of attempts
          console.error(`❌ JSON generation failed after ${attempt} attempts`);
          console.error('Error:', error.message);
          
          if (error.statusCode) {
            throw error;
          }
          throw createError(`Failed to generate JSON: ${error.message}`, error.status || 500);
        }
      }
    }

    // This line should be unreachable, but it satisfies TypeScript
    throw createError('Failed to generate JSON after all retries', 500);
  }

  /**
   * Generate content with streaming support
   * @param prompt - The prompt to send to Gemini
   * @param config - Optional configuration overrides
   * @returns Async generator for streaming response
   */
  async *generateStream(prompt: string, config?: GeminiConfig): AsyncGenerator<string> {
    try {
      const model = config?.model || config?.temperature || config?.maxOutputTokens || config?.responseMimeType
        ? this.genAI.getGenerativeModel({
            model: config.model || env.GEMINI_MODEL,
            generationConfig: {
              ...this.defaultConfig,
              temperature: config.temperature ?? this.defaultConfig.temperature,
              maxOutputTokens: config.maxOutputTokens ?? this.defaultConfig.maxOutputTokens,
              responseMimeType: config.responseMimeType || undefined,
            },
          })
        : this.model;

      const result = await model.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          yield chunkText;
        }
      }
    } catch (error: any) {
      console.error('Gemini Streaming Error:', error);
      throw createError(`Gemini streaming error: ${error.message || 'Unknown error'}`, 500);
    }
  }

  /**
   * Check if Gemini service is properly configured
   * @returns true if configured, false otherwise
   */
  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'your-gemini-api-key-here');
  }

  /**
   * Test connection to Gemini API
   * @returns true if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateText('Say "OK" if you can read this message.');
      return response.toLowerCase().includes('ok');
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const geminiService = new GeminiService();
