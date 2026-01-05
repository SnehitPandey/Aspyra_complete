import { Router } from 'express';
import { channelController } from '../controllers/channel.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Channel routes
router.post('/', requireRole(['TEACHER', 'ADMIN']), channelController.createChannel.bind(channelController));
router.get('/', channelController.getChannels.bind(channelController));
router.get('/my', requireRole(['TEACHER', 'ADMIN']), channelController.getMyChannels.bind(channelController));
router.get('/:channelId', channelController.getChannelById.bind(channelController));
router.patch('/:channelId', requireRole(['TEACHER', 'ADMIN']), channelController.updateChannel.bind(channelController));
router.delete('/:channelId', requireRole(['TEACHER', 'ADMIN']), channelController.deleteChannel.bind(channelController));

// Note routes
router.post('/:channelId/notes', 
  requireRole(['TEACHER', 'ADMIN']), 
  uploadSingle('file'), 
  handleUploadError, 
  channelController.createNote.bind(channelController)
);
router.get('/:channelId/notes', channelController.getChannelNotes.bind(channelController));
router.get('/:channelId/notes/:noteId', channelController.getNoteById.bind(channelController));
router.patch('/:channelId/notes/:noteId', requireRole(['TEACHER', 'ADMIN']), channelController.updateNote.bind(channelController));
router.delete('/:channelId/notes/:noteId', requireRole(['TEACHER', 'ADMIN']), channelController.deleteNote.bind(channelController));

export { router as channelRouter };
