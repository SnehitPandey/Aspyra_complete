import { Types } from 'mongoose';
import { Board, IBoard, IList, ITask } from '../models/board.model.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';

export interface CreateBoardData {
  title: string;
  orgId?: string;
}

export interface UpdateBoardData {
  title?: string;
}

export interface CreateListData {
  boardId: string;
  title: string;
}

export interface UpdateListData {
  title?: string;
  position?: number;
}

export interface CreateTaskData {
  listId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  dueAt?: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  assigneeId?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  dueAt?: string;
  position?: number;
  listId?: string; // For moving tasks between lists
}

export class TaskService {

  // Create a new board
  async createBoard(ownerId: string, data: CreateBoardData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(ownerId)) {
      throw createError('Invalid user ID', 400);
    }

    // Verify owner exists
    const owner = await User.findById(ownerId);
    if (!owner) {
      throw createError('User not found', 404);
    }

    const board = new Board({
      ownerId: new Types.ObjectId(ownerId),
      title: data.title,
      orgId: data.orgId,
      lists: [],
    });

    await board.save();
    await board.populate('ownerId', 'name email');

    return board;
  }

  // Get board by ID with lists and tasks
  async getBoardById(boardId: string, userId: string): Promise<IBoard> {
    if (!Types.ObjectId.isValid(boardId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findById(boardId)
      .populate('ownerId', 'name email')
      .populate('lists.tasks.assigneeId', 'name email');

    if (!board) {
      throw createError('Board not found', 404);
    }

    // Check ownership
    if (board.ownerId._id.toString() !== userId) {
      throw createError('Access denied', 403);
    }

    // Sort lists and tasks by position
    board.lists.sort((a, b) => a.position - b.position);
    board.lists.forEach(list => {
      list.tasks.sort((a, b) => a.position - b.position);
    });

    return board;
  }

  // Update board
  async updateBoard(boardId: string, userId: string, data: UpdateBoardData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(boardId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOneAndUpdate(
      { _id: boardId, ownerId: new Types.ObjectId(userId) },
      { $set: data },
      { new: true }
    ).populate('ownerId', 'name email');

    if (!board) {
      throw createError('Board not found or access denied', 404);
    }

    return board;
  }

  // Delete board
  async deleteBoard(boardId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(boardId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const result = await Board.findOneAndDelete({
      _id: boardId,
      ownerId: new Types.ObjectId(userId)
    });

    if (!result) {
      throw createError('Board not found or access denied', 404);
    }
  }

  // Create a list in a board
  async createList(userId: string, data: CreateListData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(data.boardId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      _id: data.boardId,
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('Board not found or access denied', 404);
    }

    // Get next position
    const position = board.lists.length;

    // Add list to board
    board.lists.push({
      _id: new Types.ObjectId(),
      title: data.title,
      position,
      tasks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IList);

    await board.save();
    return board;
  }

  // Update list
  async updateList(listId: string, userId: string, data: UpdateListData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(listId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      'lists._id': new Types.ObjectId(listId),
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('List not found or access denied', 404);
    }

    // Find and update the list
    const list = board.lists.find(l => l._id.toString() === listId);
    if (!list) {
      throw createError('List not found', 404);
    }

    if (data.title) list.title = data.title;
    if (data.position !== undefined) list.position = data.position;
    list.updatedAt = new Date();

    await board.save();
    return board;
  }

  // Delete list
  async deleteList(listId: string, userId: string): Promise<IBoard> {
    if (!Types.ObjectId.isValid(listId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      'lists._id': new Types.ObjectId(listId),
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('List not found or access denied', 404);
    }

    // Remove the list
    board.lists = board.lists.filter(l => l._id.toString() !== listId);

    await board.save();
    return board;
  }

  // Create a task in a list
  async createTask(userId: string, data: CreateTaskData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(data.listId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      'lists._id': new Types.ObjectId(data.listId),
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('List not found or access denied', 404);
    }

    // Validate assignee if provided
    if (data.assigneeId) {
      if (!Types.ObjectId.isValid(data.assigneeId)) {
        throw createError('Invalid assignee ID', 400);
      }
      
      const assignee = await User.findById(data.assigneeId);
      if (!assignee) {
        throw createError('Assignee not found', 404);
      }
    }

    // Find the list
    const list = board.lists.find(l => l._id.toString() === data.listId);
    if (!list) {
      throw createError('List not found', 404);
    }

    // Get next position
    const position = list.tasks.length;

    // Add task to list
    const newTask: ITask = {
      _id: new Types.ObjectId(),
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId ? new Types.ObjectId(data.assigneeId) : undefined,
      status: data.status || 'TODO',
      dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
      position,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ITask;

    list.tasks.push(newTask);

    await board.save();
    await board.populate('lists.tasks.assigneeId', 'name email');

    return board;
  }

  // Update task
  async updateTask(taskId: string, userId: string, data: UpdateTaskData): Promise<IBoard> {
    if (!Types.ObjectId.isValid(taskId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      'lists.tasks._id': new Types.ObjectId(taskId),
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('Task not found or access denied', 404);
    }

    // Find the task and list
    let targetList: IList | undefined;
    let task: ITask | undefined;

    for (const list of board.lists) {
      const foundTask = list.tasks.find(t => t._id.toString() === taskId);
      if (foundTask) {
        targetList = list;
        task = foundTask;
        break;
      }
    }

    if (!task || !targetList) {
      throw createError('Task not found', 404);
    }

    // Validate assignee if provided
    if (data.assigneeId) {
      if (!Types.ObjectId.isValid(data.assigneeId)) {
        throw createError('Invalid assignee ID', 400);
      }
      
      const assignee = await User.findById(data.assigneeId);
      if (!assignee) {
        throw createError('Assignee not found', 404);
      }
    }

    // Handle moving task to different list
    if (data.listId && data.listId !== targetList._id.toString()) {
      if (!Types.ObjectId.isValid(data.listId)) {
        throw createError('Invalid list ID', 400);
      }

      const newList = board.lists.find(l => l._id.toString() === data.listId);
      if (!newList) {
        throw createError('Target list not found', 404);
      }

      // Remove from current list
      targetList.tasks = targetList.tasks.filter(t => t._id.toString() !== taskId);

      // Add to new list
      task.position = data.position !== undefined ? data.position : newList.tasks.length;
      newList.tasks.push(task);

      targetList = newList;
    }

    // Update task properties
    if (data.title) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.assigneeId !== undefined) {
      task.assigneeId = data.assigneeId ? new Types.ObjectId(data.assigneeId) : undefined;
    }
    if (data.status) task.status = data.status;
    if (data.dueAt !== undefined) task.dueAt = data.dueAt ? new Date(data.dueAt) : undefined;
    if (data.position !== undefined) task.position = data.position;
    
    task.updatedAt = new Date();

    await board.save();
    await board.populate('lists.tasks.assigneeId', 'name email');

    return board;
  }

  // Delete task
  async deleteTask(taskId: string, userId: string): Promise<IBoard> {
    if (!Types.ObjectId.isValid(taskId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const board = await Board.findOne({
      'lists.tasks._id': new Types.ObjectId(taskId),
      ownerId: new Types.ObjectId(userId)
    });

    if (!board) {
      throw createError('Task not found or access denied', 404);
    }

    // Find and remove the task
    for (const list of board.lists) {
      const taskIndex = list.tasks.findIndex(t => t._id.toString() === taskId);
      if (taskIndex !== -1) {
        list.tasks.splice(taskIndex, 1);
        break;
      }
    }

    await board.save();
    return board;
  }

  // Get user's boards
  async getUserBoards(userId: string): Promise<IBoard[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    return await Board.find({ ownerId: new Types.ObjectId(userId) })
      .populate('ownerId', 'name email')
      .sort({ updatedAt: -1 });
  }
}

// Export singleton instance
export const taskService = new TaskService();
