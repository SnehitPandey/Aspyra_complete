import { GoogleGenerativeAI } from '@google/generative-ai';
import { kmeans } from 'ml-kmeans';
import mlDistance from 'ml-distance';
import { Embedding } from '../models/embedding.model.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';
import type { Logger } from 'pino';

// Handle ml-distance import
const cosineDistance = (mlDistance as any).cosine || ((a: number[], b: number[]) => {
  // Fallback implementation
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return 1 - dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
});

export interface UserProfile {
  skills: string;
  interests: string;
  goals: string;
}

export interface EmbedProfileData {
  userId: string;
  profile: UserProfile;
}

export interface GroupStudentsData {
  count: number;
  groupType?: 'size' | 'number'; // 'size' = desired group size, 'number' = number of groups
}

export interface StudentGroup {
  groupId: number;
  members: Array<{
    userId: string;
    name: string;
    email: string;
  }>;
  similarity: number; // Average similarity score within group
}

export class GroupingService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
    if (!env.GEMINI_API_KEY) {
      throw createError('GEMINI_API_KEY is required for grouping service', 500);
    }
    this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  // Generate and store user profile embedding
  async embedProfile(data: EmbedProfileData): Promise<{ userId: string; vectorLength: number }> {
    try {
      // Create text representation of user profile
      const profileText = this.buildProfileText(data.profile);

      // Generate embedding using Gemini
      const model = this.genAI.getGenerativeModel({ model: 'embedding-001' });
      const result = await model.embedContent(profileText);

      const embedding = result.embedding.values;
      if (!embedding || embedding.length === 0) {
        throw createError('Failed to generate embedding', 500);
      }

      // Store or update embedding in database using Mongoose
      await Embedding.findOneAndUpdate(
        { userId: data.userId },
        {
          userId: data.userId,
          vector: Array.from(embedding),
          profile: data.profile,
          updatedAt: new Date(),
        },
        {
          upsert: true,
          new: true,
        }
      );

      this.logger?.info(
        {
          userId: data.userId,
          vectorLength: embedding.length,
          profileText: profileText.substring(0, 100) + '...',
        },
        'User profile embedding generated and stored'
      );

      return {
        userId: data.userId,
        vectorLength: embedding.length,
      };
    } catch (error) {
      this.logger?.error({ error, userId: data.userId }, 'Failed to generate embedding');
      throw createError('Failed to generate embedding', 500);
    }
  }

  // Group students based on embeddings
  async groupStudents(data: GroupStudentsData): Promise<StudentGroup[]> {
    try {
      // Fetch all embeddings with user data using Mongoose populate
      const embeddings = await Embedding.find()
        .populate('userId', 'id name email')
        .lean();

      if (embeddings.length < 2) {
        throw createError('Need at least 2 users with embeddings to form groups', 400);
      }

      // Prepare data for clustering
      const vectors = embeddings.map((e: any) => e.vector);
      const users = embeddings.map((e: any) => ({
        userId: e.userId?._id?.toString() ?? e.userId ?? 'unknown',
        name: e.userId?.name ?? 'Unknown',
        email: e.userId?.email ?? 'unknown@email.com',
      })).filter((user): user is { userId: string; name: string; email: string } => 
        user.userId !== 'unknown'
      );

      // Determine number of clusters
      let numClusters: number;
      if (data.groupType === 'size') {
        // If count represents desired group size
        numClusters = Math.ceil(embeddings.length / data.count);
      } else {
        // If count represents number of groups
        numClusters = Math.min(data.count, embeddings.length);
      }

      // Perform K-means clustering
      const clusterResult = kmeans(vectors, numClusters, {
        maxIterations: 100,
        tolerance: 1e-4,
      });

      // Calculate similarity scores for each cluster
      const groups: StudentGroup[] = [];

      for (let i = 0; i < numClusters; i++) {
        const memberIndices = clusterResult.clusters
          .map((cluster: number, index: number) => ({ cluster, index }))
          .filter((item: any) => item.cluster === i)
          .map((item: any) => item.index);

        if (memberIndices.length === 0) continue;

        const members = memberIndices
          .map((index: number) => users[index])
          .filter((user): user is { userId: string; name: string; email: string } => user !== undefined);

        // Calculate average similarity within group
        let totalSimilarity = 0;
        let pairCount = 0;

        if (memberIndices.length > 1) {
          for (let j = 0; j < memberIndices.length; j++) {
            for (let k = j + 1; k < memberIndices.length; k++) {
              const similarity =
                1 - cosineDistance(vectors[memberIndices[j]], vectors[memberIndices[k]]);
              totalSimilarity += similarity;
              pairCount++;
            }
          }
        }

        const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 1;

        groups.push({
          groupId: i,
          members,
          similarity: Math.round(avgSimilarity * 100) / 100, // Round to 2 decimal places
        });
      }

      // Sort groups by similarity (most similar first)
      groups.sort((a, b) => b.similarity - a.similarity);

      this.logger?.info(
        {
          totalUsers: embeddings.length,
          numGroups: groups.length,
          groupSizes: groups.map((g: any) => g.members.length),
          averageSimilarities: groups.map((g: any) => g.similarity),
        },
        'Student grouping completed'
      );

      return groups;
    } catch (error) {
      this.logger?.error({ error, data }, 'Failed to group students');
      throw createError('Failed to group students', 500);
    }
  }

  // Get user embedding if it exists
  async getUserEmbedding(userId: string) {
    return await Embedding.findOne({ userId })
      .populate('userId', 'id name email')
      .lean();
  }

  // Get all embeddings with basic stats
  async getEmbeddingStats() {
    const count = await Embedding.countDocuments();
    const recentEmbeddings = await Embedding.find()
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate('userId', 'name')
      .lean();

    return {
      totalEmbeddings: count,
      recentlyUpdated: recentEmbeddings.map((e: any) => ({
        userId: e.userId?._id?.toString() ?? e.userId,
        userName: e.userId?.name ?? 'Unknown',
        updatedAt: e.updatedAt,
      })),
    };
  }

  // Build profile text for embedding
  private buildProfileText(profile: UserProfile): string {
    return `Skills: ${profile.skills}\nInterests: ${profile.interests}\nGoals: ${profile.goals}`;
  }

  // Alternative grouping using cosine similarity (without KMeans)
  async groupStudentsBySimilarity(data: GroupStudentsData): Promise<StudentGroup[]> {
    try {
      const embeddings = await Embedding.find()
        .populate('userId', 'id name email')
        .lean();

      if (embeddings.length < 2) {
        throw createError('Need at least 2 users with embeddings to form groups', 400);
      }

      const users = embeddings.map((e: any) => ({
        userId: e.userId?._id?.toString() ?? e.userId,
        name: e.userId?.name ?? 'Unknown',
        email: e.userId?.email ?? 'unknown@email.com',
      }));

      // Calculate similarity matrix
      const similarities: number[][] = [];
      for (let i = 0; i < embeddings.length; i++) {
        similarities[i] = [];
        for (let j = 0; j < embeddings.length; j++) {
          if (i === j) {
            similarities[i]![j] = 1;
          } else {
            similarities[i]![j] =
              1 - cosineDistance((embeddings[i] as any).vector, (embeddings[j] as any).vector);
          }
        }
      }

      // Simple greedy grouping algorithm
      const visited = new Set<number>();
      const groups: StudentGroup[] = [];
      let groupId = 0;

      while (visited.size < embeddings.length) {
        const unvisited = Array.from({ length: embeddings.length }, (_, i) => i).filter(
          (i) => !visited.has(i)
        );

        if (unvisited.length === 0) break;

        // Start with most similar unvisited pair or single user
        const firstUnvisited = unvisited[0];
        if (firstUnvisited === undefined) break;
        
        const currentGroup: number[] = [firstUnvisited];
        visited.add(firstUnvisited);

        // Add similar users to current group (up to desired size)
        const maxGroupSize =
          data.groupType === 'size'
            ? data.count
            : Math.ceil(embeddings.length / data.count);

        while (currentGroup.length < maxGroupSize && visited.size < embeddings.length) {
          let bestCandidate = -1;
          let bestSimilarity = -1;

          // Find best candidate based on average similarity to current group
          for (const candidate of unvisited) {
            if (visited.has(candidate)) continue;

            const avgSimilarity =
              currentGroup.reduce((sum, member) => {
                const simRow = similarities[member];
                return sum + (simRow ? simRow[candidate] ?? 0 : 0);
              }, 0) / currentGroup.length;

            if (avgSimilarity > bestSimilarity) {
              bestSimilarity = avgSimilarity;
              bestCandidate = candidate;
            }
          }

          if (bestCandidate !== -1 && bestSimilarity > 0.5) {
            // Minimum similarity threshold
            currentGroup.push(bestCandidate);
            visited.add(bestCandidate);
          } else {
            break;
          }
        }

        // Calculate group similarity
        let totalSimilarity = 0;
        let pairCount = 0;

        if (currentGroup.length > 1) {
          for (let i = 0; i < currentGroup.length; i++) {
            for (let j = i + 1; j < currentGroup.length; j++) {
              const memberI = currentGroup[i];
              const memberJ = currentGroup[j];
              if (memberI !== undefined && memberJ !== undefined) {
                const simRow = similarities[memberI];
                totalSimilarity += simRow ? (simRow[memberJ] ?? 0) : 0;
              }
              pairCount++;
            }
          }
        }

        const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 1;

        groups.push({
          groupId: groupId++,
          members: currentGroup
            .filter((index): index is number => index !== undefined)
            .map((index: number) => users[index])
            .filter((user): user is { userId: string; name: string; email: string } => user !== undefined),
          similarity: Math.round(avgSimilarity * 100) / 100,
        });
      }

      return groups;
    } catch (error) {
      this.logger?.error({ error }, 'Failed to group students by similarity');
      throw createError('Failed to group students', 500);
    }
  }
}

// Export singleton instance
export const groupingService = new GroupingService();
