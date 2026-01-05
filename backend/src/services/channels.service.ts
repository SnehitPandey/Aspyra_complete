import { Types } from 'mongoose';
import { Channel, IChannel, INote } from '../models/channel.model.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';
import { deleteFile } from '../middleware/upload.js';

export interface CreateChannelData {
  title: string;
  description?: string;
}

export interface UpdateChannelData {
  title?: string;
  description?: string;
  isActive?: boolean;
}

export interface CreateNoteData {
  channelId: string;
  title: string;
  content?: string;
  fileInfo?: {
    url: string;
    name: string;
    size: number;
    type: string;
  };
}

export interface UpdateNoteData {
  title?: string;
  content?: string;
  isPublic?: boolean;
}

export class ChannelService {

  // Create a new channel (teachers only)
  async createChannel(teacherId: string, data: CreateChannelData): Promise<IChannel> {
    if (!Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid user ID', 400);
    }

    // Verify user is a teacher
    const teacher = await User.findById(teacherId);
    if (!teacher) {
      throw createError('User not found', 404);
    }

    if (teacher.role !== 'TEACHER' && teacher.role !== 'ADMIN') {
      throw createError('Only teachers can create channels', 403);
    }

    const channel = new Channel({
      teacherId: new Types.ObjectId(teacherId),
      title: data.title,
      description: data.description,
      notes: [],
    });

    await channel.save();
    await channel.populate('teacherId', 'name email');

    return channel;
  }

  // Get all channels with pagination
  async getChannels(page: number = 1, limit: number = 10, search?: string): Promise<{
    channels: IChannel[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const skip = (page - 1) * limit;

    // Build query
    const query: any = { isActive: true };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const [channels, total] = await Promise.all([
      Channel.find(query)
        .populate('teacherId', 'name email')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Channel.countDocuments(query),
    ]);

    return {
      channels,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get channel by ID with notes
  async getChannelById(channelId: string): Promise<IChannel> {
    if (!Types.ObjectId.isValid(channelId)) {
      throw createError('Invalid channel ID', 400);
    }

    const channel = await Channel.findOne({
      _id: channelId,
      isActive: true,
    }).populate('teacherId', 'name email');

    if (!channel) {
      throw createError('Channel not found', 404);
    }

    // Filter only public notes and sort by creation date
    channel.notes = channel.notes
      .filter(note => note.isPublic)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return channel;
  }

  // Update channel (teachers only)
  async updateChannel(channelId: string, teacherId: string, data: UpdateChannelData): Promise<IChannel> {
    if (!Types.ObjectId.isValid(channelId) || !Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid ID format', 400);
    }

    const channel = await Channel.findOneAndUpdate(
      { _id: channelId, teacherId: new Types.ObjectId(teacherId) },
      { $set: data },
      { new: true }
    ).populate('teacherId', 'name email');

    if (!channel) {
      throw createError('Channel not found or access denied', 404);
    }

    return channel;
  }

  // Delete channel (teachers only)
  async deleteChannel(channelId: string, teacherId: string): Promise<void> {
    if (!Types.ObjectId.isValid(channelId) || !Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid ID format', 400);
    }

    const channel = await Channel.findOne({
      _id: channelId,
      teacherId: new Types.ObjectId(teacherId)
    });

    if (!channel) {
      throw createError('Channel not found or access denied', 404);
    }

    // Delete associated files
    for (const note of channel.notes) {
      if (note.fileUrl && note.fileUrl.startsWith('/uploads/')) {
        const filePath = '.' + note.fileUrl;
        await deleteFile(filePath);
      }
    }

    await Channel.findByIdAndDelete(channelId);
  }

  // Create a note in a channel (teachers only)
  async createNote(teacherId: string, data: CreateNoteData): Promise<INote> {
    if (!Types.ObjectId.isValid(data.channelId) || !Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid ID format', 400);
    }

    // Verify channel ownership
    const channel = await Channel.findOne({
      _id: data.channelId,
      teacherId: new Types.ObjectId(teacherId)
    });

    if (!channel) {
      throw createError('Channel not found or access denied', 404);
    }

    const noteData: Partial<INote> = {
      _id: new Types.ObjectId(),
      title: data.title,
      content: data.content,
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (data.fileInfo) {
      noteData.fileUrl = data.fileInfo.url;
      noteData.fileName = data.fileInfo.name;
      noteData.fileSize = data.fileInfo.size;
      noteData.fileType = data.fileInfo.type;
    }

    // Add note to channel
    channel.notes.push(noteData as INote);
    channel.updatedAt = new Date();

    await channel.save();

    // Return the created note
    const createdNote = channel.notes[channel.notes.length - 1];
    if (!createdNote) {
      throw createError('Failed to create note', 500);
    }
    return createdNote;
  }

  // Get note by ID
  async getNoteById(channelId: string, noteId: string): Promise<INote> {
    if (!Types.ObjectId.isValid(channelId) || !Types.ObjectId.isValid(noteId)) {
      throw createError('Invalid ID format', 400);
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      throw createError('Channel not found', 404);
    }

    const note = channel.notes.find((n: any) => n._id.toString() === noteId);
    if (!note) {
      throw createError('Note not found', 404);
    }

    if (!note.isPublic) {
      throw createError('Note is not publicly accessible', 403);
    }

    return note;
  }

  // Update note (teachers only)
  async updateNote(channelId: string, noteId: string, teacherId: string, data: UpdateNoteData): Promise<INote> {
    if (!Types.ObjectId.isValid(channelId) || !Types.ObjectId.isValid(noteId) || !Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid ID format', 400);
    }

    const channel = await Channel.findOne({
      _id: channelId,
      teacherId: new Types.ObjectId(teacherId)
    });

    if (!channel) {
      throw createError('Channel not found or access denied', 404);
    }

    const note = channel.notes.find((n: any) => n._id.toString() === noteId);
    if (!note) {
      throw createError('Note not found', 404);
    }

    // Update note properties
    if (data.title) note.title = data.title;
    if (data.content !== undefined) note.content = data.content;
    if (data.isPublic !== undefined) note.isPublic = data.isPublic;
    note.updatedAt = new Date();

    channel.updatedAt = new Date();
    await channel.save();

    return note;
  }

  // Delete note (teachers only)
  async deleteNote(channelId: string, noteId: string, teacherId: string): Promise<void> {
    if (!Types.ObjectId.isValid(channelId) || !Types.ObjectId.isValid(noteId) || !Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid ID format', 400);
    }

    const channel = await Channel.findOne({
      _id: channelId,
      teacherId: new Types.ObjectId(teacherId)
    });

    if (!channel) {
      throw createError('Channel not found or access denied', 404);
    }

    const noteIndex = channel.notes.findIndex((n: any) => n._id.toString() === noteId);
    if (noteIndex === -1) {
      throw createError('Note not found', 404);
    }

    const note = channel.notes[noteIndex];
    if (!note) {
      throw createError('Note not found', 404);
    }

    // Delete associated file if exists
    if (note.fileUrl && note.fileUrl.startsWith('/uploads/')) {
      const filePath = '.' + note.fileUrl;
      await deleteFile(filePath);
    }

    // Remove note from array
    channel.notes.splice(noteIndex, 1);
    channel.updatedAt = new Date();

    await channel.save();
  }

  // Get notes for a channel with pagination
  async getChannelNotes(channelId: string, page: number = 1, limit: number = 10): Promise<{
    notes: INote[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    if (!Types.ObjectId.isValid(channelId)) {
      throw createError('Invalid channel ID', 400);
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      throw createError('Channel not found', 404);
    }

    const skip = (page - 1) * limit;
    const notes = channel.notes.slice(skip, skip + limit);
    const total = channel.notes.length;
    const totalPages = Math.ceil(total / limit);

    return {
      notes,
      total,
      page,
      totalPages,
    };
  }

  // Get teacher's channels
  async getTeacherChannels(teacherId: string): Promise<IChannel[]> {
    if (!Types.ObjectId.isValid(teacherId)) {
      throw createError('Invalid user ID', 400);
    }

    return await Channel.find({ teacherId: new Types.ObjectId(teacherId) })
      .populate('teacherId', 'name email')
      .sort({ updatedAt: -1 });
  }
}

// Export singleton instance
export const channelService = new ChannelService();
