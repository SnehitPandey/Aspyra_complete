/**
 * Integration tests for Socket.IO presence tracking system
 * Tests real-time presence updates, activity tracking, and partner synchronization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import { SocketService } from '../../services/socket.service';
import { User } from '../../models/user.model';
import { setSocketServiceInstance } from '../../services/socket.instance';

describe('Presence System Integration Tests', () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let socketService: SocketService;
  let serverPort: number;
  let client1: ClientSocket;
  let client2: ClientSocket;
  let user1Id: string;
  let user2Id: string;

  beforeAll(async () => {
    // Create test HTTP server
    const app = express();
    httpServer = app.listen(0); // Use random available port
    serverPort = (httpServer.address() as any).port;

    // Create Socket.IO server
    io = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });

    // Initialize SocketService with existing io instance
    socketService = new SocketService(io);
    setSocketServiceInstance(socketService);

    // Create test users
    user1Id = 'test-user-1';
    user2Id = 'test-user-2';
  });

  afterAll(async () => {
    // Cleanup
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    io?.close();
    httpServer?.close();
  });

  beforeEach(() => {
    // Disconnect clients before each test
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
  });

  describe('Socket Connection & Presence Initialization', () => {
    it('should establish socket connection and emit presence:init', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client1.on('connect', () => {
        expect(client1.connected).toBe(true);
        
        // Emit presence:init
        client1.emit('presence:init', { userId: user1Id });
        
        // Wait briefly for server to process
        setTimeout(() => {
          // Check if user is registered as online
          const isOnline = socketService.isUserOnline(user1Id);
          expect(isOnline).toBe(true);
          done();
        }, 100);
      });

      client1.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should mark user as offline on disconnect', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client1.on('connect', () => {
        client1.emit('presence:init', { userId: user1Id });

        setTimeout(() => {
          expect(socketService.isUserOnline(user1Id)).toBe(true);
          
          // Disconnect
          client1.disconnect();
          
          setTimeout(() => {
            expect(socketService.isUserOnline(user1Id)).toBe(false);
            done();
          }, 100);
        }, 100);
      });
    });
  });

  describe('Activity Updates & Partner Notifications', () => {
    it('should broadcast presence:update to partner when activity changes', (done) => {
      // Connect both clients
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user2Id },
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) {
          // Both connected - set up listener on client2
          client2.on('presence:update', (data) => {
            expect(data.userId).toBe(user1Id);
            expect(data.isOnline).toBe(true);
            expect(data.activity?.type).toBe('studying');
            expect(data.activity?.topic).toBe('Socket.IO Testing');
            done();
          });

          // Emit activity update from client1
          client1.emit('presence:updateActivity', {
            userId: user1Id,
            activity: {
              type: 'studying',
              topic: 'Socket.IO Testing',
            },
          });
        }
      };

      client1.on('connect', onConnect);
      client2.on('connect', onConnect);
    });

    it('should update activity to idle and notify partner', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user2Id },
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) {
          // Listen for idle update
          client2.on('presence:update', (data) => {
            if (data.activity?.type === 'idle') {
              expect(data.userId).toBe(user1Id);
              expect(data.isOnline).toBe(true);
              expect(data.activity.topic).toBeUndefined();
              done();
            }
          });

          // Emit idle activity
          client1.emit('presence:updateActivity', {
            userId: user1Id,
            activity: { type: 'idle' },
          });
        }
      };

      client1.on('connect', onConnect);
      client2.on('connect', onConnect);
    });
  });

  describe('Bidirectional Partner Disconnect', () => {
    it('should emit duo:update to both users on partner removal', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user2Id },
      });

      let duoUpdateCount = 0;

      const checkDone = () => {
        duoUpdateCount++;
        if (duoUpdateCount === 2) {
          done();
        }
      };

      client1.on('duo:update', (data) => {
        expect(data.removed).toBe(true);
        expect(data.timestamp).toBeDefined();
        checkDone();
      });

      client2.on('duo:update', (data) => {
        expect(data.removed).toBe(true);
        expect(data.timestamp).toBeDefined();
        checkDone();
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) {
          // Simulate partner disconnect by emitting duo:update from server
          setTimeout(() => {
            socketService.emitToUser(user1Id, 'duo:update', {
              partnerId: user2Id,
              removed: true,
              timestamp: new Date().toISOString(),
            });

            socketService.emitToUser(user2Id, 'duo:update', {
              partnerId: user1Id,
              removed: true,
              timestamp: new Date().toISOString(),
            });
          }, 100);
        }
      };

      client1.on('connect', onConnect);
      client2.on('connect', onConnect);
    });
  });

  describe('Legacy Event Compatibility', () => {
    it('should support legacy statusUpdate event alongside presence:update', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user2Id },
      });

      const receivedEvents: string[] = [];

      client2.on('presence:update', (data) => {
        receivedEvents.push('presence:update');
        if (receivedEvents.includes('statusUpdate')) {
          expect(receivedEvents).toContain('presence:update');
          expect(receivedEvents).toContain('statusUpdate');
          done();
        }
      });

      client2.on('statusUpdate', (data) => {
        receivedEvents.push('statusUpdate');
        expect(data.userId).toBe(user1Id);
        if (receivedEvents.includes('presence:update')) {
          done();
        }
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) {
          // Emit activity to trigger both events
          client1.emit('presence:updateActivity', {
            userId: user1Id,
            activity: { type: 'studying', topic: 'Testing' },
          });
        }
      };

      client1.on('connect', onConnect);
      client2.on('connect', onConnect);
    });
  });

  describe('Multi-tab Support', () => {
    it('should handle multiple connections from same user', (done) => {
      // Simulate same user in 2 tabs
      const client1Tab1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      const client1Tab2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      let connectCount = 0;
      const onConnect = () => {
        connectCount++;
        if (connectCount === 2) {
          // Both tabs connected
          setTimeout(() => {
            // User should still be online
            expect(socketService.isUserOnline(user1Id)).toBe(true);
            
            // Disconnect one tab
            client1Tab1.disconnect();
            
            setTimeout(() => {
              // User should STILL be online (second tab active)
              expect(socketService.isUserOnline(user1Id)).toBe(true);
              
              // Disconnect second tab
              client1Tab2.disconnect();
              
              setTimeout(() => {
                // Now user should be offline
                expect(socketService.isUserOnline(user1Id)).toBe(false);
                done();
              }, 100);
            }, 100);
          }, 100);
        }
      };

      client1Tab1.on('connect', () => {
        client1Tab1.emit('presence:init', { userId: user1Id });
        onConnect();
      });

      client1Tab2.on('connect', () => {
        client1Tab2.emit('presence:init', { userId: user1Id });
        onConnect();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing userId gracefully', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
      });

      client1.on('connect', () => {
        // Emit without userId
        client1.emit('presence:updateActivity', {
          activity: { type: 'studying', topic: 'Test' },
        });

        // Should not crash - wait and verify
        setTimeout(() => {
          expect(client1.connected).toBe(true);
          done();
        }, 100);
      });
    });

    it('should handle malformed activity data', (done) => {
      client1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        auth: { userId: user1Id },
      });

      client1.on('connect', () => {
        client1.emit('presence:init', { userId: user1Id });

        // Emit malformed activity
        client1.emit('presence:updateActivity', {
          userId: user1Id,
          activity: null, // Invalid
        });

        setTimeout(() => {
          // Should not crash
          expect(client1.connected).toBe(true);
          done();
        }, 100);
      });
    });
  });
});
