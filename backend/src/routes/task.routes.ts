import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Board routes
router.post('/boards', taskController.createBoard.bind(taskController));
router.get('/boards', taskController.getUserBoards.bind(taskController));
router.get('/boards/:boardId', taskController.getBoardById.bind(taskController));
router.patch('/boards/:boardId', taskController.updateBoard.bind(taskController));
router.delete('/boards/:boardId', taskController.deleteBoard.bind(taskController));

// List routes
router.post('/lists', taskController.createList.bind(taskController));
router.patch('/lists/:listId', taskController.updateList.bind(taskController));
router.delete('/lists/:listId', taskController.deleteList.bind(taskController));

// Task routes
router.post('/tasks', taskController.createTask.bind(taskController));
router.get('/tasks/:taskId', taskController.getTaskById.bind(taskController));
router.patch('/tasks/:taskId', taskController.updateTask.bind(taskController));
router.delete('/tasks/:taskId', taskController.deleteTask.bind(taskController));

export { router as taskRouter };
