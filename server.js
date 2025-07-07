const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
require('dotenv').config();

const uploadRoutes = require('./routes/uploadRoutes');
const backgroundProcessor = require('./services/backgroundProcessor');
const authRoutes = require('./routes/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

// MongoDB Connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/video-encoding', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`📦 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

console.log(process.env.NODE_ENV);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://stream-your-videos.netlify.app', 'http://localhost:5000', 'http://localhost:5001'] 
    : ['http://localhost:5000', 'http://localhost:5001', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use(morgan('combined'));

// Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/auth', authRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Video upload service is running',
    timestamp: new Date().toISOString(),
    activeJobs: backgroundProcessor.getAllJobs().length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Video Upload Service',
    version: '1.0.0',
    features: {
      asyncEncoding: true,
      cloudWatchLogging: true,
      progressTracking: true
    },
    endpoints: {
      health: '/health',
      upload: '/api/upload',
      status: '/api/upload/status/:videoId',
      jobs: '/api/upload/jobs'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Cleanup job scheduler (run every 30 minutes)
setInterval(() => {
  backgroundProcessor.cleanupCompletedJobs();
}, 30 * 60 * 1000);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  }
});

/**
 * ROOM MANAGEMENT STRUCTURE
 * 
 * Each room contains:
 * - host: Socket ID of the room host (only one per room)
 * - viewers: Set of viewer objects with { id: socketId, username: string } (multiple viewers allowed)
 * - videoState: Current state of video playback (isPlaying, currentTime)
 * 
 * Structure: { [roomId]: { host: socketId, viewers: Set<{id: string, username: string}>, videoState: { isPlaying: boolean, currentTime: number } } }
 */
const rooms = {};

// Handle new socket connections
io.on('connection', (socket) => {
  // Track which room this socket is in and their role
  let joinedRoom = null;
  let isHost = false;

  /**
   * JOIN ROOM EVENT
   * 
   * Handles when a client (host or viewer) wants to join a room
   * Flow:
   * 1. Validate roomId and role parameters
   * 2. Create room if it doesn't exist
   * 3. Assign role (host or viewer)
   * 4. Notify other participants
   * 5. Send initial video state to new viewers
   */
  socket.on('join', ({ roomId, role, userInfo, videoUrl }) => {
    console.log(`[JOIN ATTEMPT] socket.id=${socket.id}, role=${role}, roomId=${roomId}, user=${userInfo?.username || 'Unknown'}`);
    
    // Validate required parameters
    if (!roomId || !role) {
      socket.emit('join-error', { message: 'Missing roomId or role' });
      console.log(`[JOIN ERROR] socket.id=${socket.id}, reason=Missing roomId or role`);
      return;
    }
    
    // Store room reference and user info for this socket
    joinedRoom = roomId;
    socket.username = userInfo?.username || 'Unknown User';
    socket.userId = userInfo?.id;
    
    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        host: null, 
        viewers: new Set(),
        videoState: { isPlaying: false, currentTime: 0 },
        videoUrl: null
      };
    }
    
    // Handle host joining
    if (role === 'host') {
      rooms[roomId].host = socket.id;
      isHost = true;
      
      // Store video URL if provided by host
      if (videoUrl) {
        rooms[roomId].videoUrl = videoUrl;
        console.log(`[VIDEO URL STORED] Room ${roomId}: ${videoUrl}`);
      }
      
      // Add host to viewers list
      const hostObj = { id: socket.id, username: socket.username };
      rooms[roomId].viewers.add(hostObj);
      
      console.log(`[HOST JOINED] socket.id=${socket.id}, roomId=${roomId}, user=${socket.username}, videoUrl=${videoUrl}`);
      
      // Send current viewers list to the host (including themselves)
      socket.emit('viewers-list', { viewers: Array.from(rooms[roomId].viewers) });
    } 
    // Handle viewer joining
    else {
      // Add viewer object with id and username to the Set
      const viewerObj = { id: socket.id, username: socket.username };
      rooms[roomId].viewers.add(viewerObj);
      console.log(`[VIEWER JOINED] socket.id=${socket.id}, roomId=${roomId}, user=${socket.username}`);
      
      const hostId = rooms[roomId].host;
      if (hostId) {
        // Notify host about new viewer
        console.log('viewer-joined', { viewerId: socket.id, roomId, username: socket.username });
        console.log('viewers-list', { viewers: Array.from(rooms[roomId].viewers) });
        io.to(hostId).emit('viewer-joined', { viewerId: socket.id, roomId, username: socket.username });
        
        // Request current video state from host for the new viewer
        // This ensures the viewer gets the most up-to-date state
        io.to(hostId).emit('request-video-state', { viewerId: socket.id });
      }
      
      // Send current video state and video URL to the new viewer
      const currentVideoState = rooms[roomId].videoState;
      const initialSyncData = {
        ...currentVideoState,
        videoUrl: rooms[roomId].videoUrl
      };
      socket.emit('initial-sync', initialSyncData);
      
      if (rooms[roomId].videoUrl) {
        console.log(`[VIDEO URL SENT] To viewer ${socket.id}: ${rooms[roomId].videoUrl}`);
      }
      
      console.log(`[INITIAL SYNC] Sent to viewer ${socket.id}:`, currentVideoState);
      console.log(`[ROOM STATE] Room ${roomId} state:`, rooms[roomId]);
    }
    
    // Join the socket to the room for broadcasting
    socket.join(roomId);
    
    // Send viewers list to the new participant
    socket.emit('viewers-list', { viewers: Array.from(rooms[roomId].viewers) });
    
    // Send updated viewers list to all other participants in the room
    socket.to(roomId).emit('viewers-list', { viewers: Array.from(rooms[roomId].viewers) });
    
    // Notify all users in the room about the new user joining (for chat)
    socket.to(roomId).emit('user-joined-chat', {
      username: socket.username,
      userId: socket.userId
    });
    
    // Confirm successful join
    socket.emit('join-success', { roomId, role, socketId: socket.id });
  });

  /**
   * SYNC EVENT HANDLER
   * 
   * Handles video synchronization events from the host
   * Only the host can emit these events to maintain control
   * 
   * Event types:
   * - 'play': Video started playing
   * - 'pause': Video paused
   * - 'seek': Video seeked to new position
   * 
   * Flow:
   * 1. Validate sender is host
   * 2. Update room's video state
   * 3. Broadcast to all viewers in the room
   */
  socket.on('sync-event', (data) => {
    // Only host can emit sync events (security check)
    if (isHost && joinedRoom) {
      // Update the room's video state based on event type
      if (data.type === 'play') {
        rooms[joinedRoom].videoState = { isPlaying: true, currentTime: data.currentTime };
      } else if (data.type === 'pause') {
        rooms[joinedRoom].videoState = { isPlaying: false, currentTime: data.currentTime };
      } else if (data.type === 'seek') {
        rooms[joinedRoom].videoState = { 
          isPlaying: rooms[joinedRoom].videoState.isPlaying, 
          currentTime: data.currentTime 
        };
      }
      
      // Broadcast the sync event to all viewers in the room
      // socket.to() sends to all sockets in the room EXCEPT the sender
      socket.to(joinedRoom).emit('sync-event', data);
      console.log(`[SYNC EVENT] ${data.type} at ${data.currentTime}s, isPlaying: ${rooms[joinedRoom].videoState.isPlaying}`);
    }
  });

  /**
   * SEND VIDEO STATE HANDLER
   * 
   * Handles requests from host to send current video state to a specific viewer
   * This is used when a new viewer joins and needs to sync with current playback
   * 
   * Flow:
   * 1. Host receives 'request-video-state' event for new viewer
   * 2. Host responds with current video state via this event
   * 3. Server forwards the state to the specific viewer
   */
  socket.on('send-video-state', (data) => {
    // Only host can send video state (security check)
    if (isHost && joinedRoom && data.viewerId) {
      const videoState = {
        isPlaying: data.isPlaying,
        currentTime: data.currentTime
      };
      
      // Send to specific viewer by their socket ID
      io.to(data.viewerId).emit('initial-sync', videoState);
      console.log(`[VIDEO STATE SENT] To viewer ${data.viewerId}:`, videoState);
    }
  });

  /**
   * CHAT MESSAGE HANDLER
   * 
   * Handles chat messages from users in a room
   * Broadcasts messages to all users in the same room
   * 
   * Flow:
   * 1. Validate message data
   * 2. Broadcast message to all users in the room
   * 3. Log the message for debugging
   */
  socket.on('send-chat-message', (data) => {
    if (!joinedRoom || !data.message || !data.username) {
      console.log(`[CHAT ERROR] Invalid message data from ${socket.id}`);
      return;
    }

    const messageData = {
      message: data.message,
      username: data.username,
      userId: data.userId,
      timestamp: new Date().toISOString()
    };

    // Broadcast to all users in the room (including sender)
    io.to(joinedRoom).emit('chat-message', messageData);
    console.log(`[CHAT MESSAGE] ${data.username} in room ${joinedRoom}: ${data.message}`);
  });

  /**
   * DISCONNECT HANDLER
   * 
   * Handles when a socket disconnects (user leaves or connection lost)
   * 
   * Flow:
   * 1. Remove user from room data structure
   * 2. Notify other participants about the departure
   * 3. Clean up empty rooms
   */
  socket.on('disconnect', () => {
    if (joinedRoom) {
      // Get user info before cleanup for chat notifications
      const userInfo = {
        username: socket.username || 'Unknown User',
        userId: socket.userId
      };

      if (isHost) {
        // Host disconnected
        rooms[joinedRoom].host = null;
        
        // Remove host from viewers list
        const hostToRemove = Array.from(rooms[joinedRoom].viewers).find(v => v.id === socket.id);
        if (hostToRemove) {
          rooms[joinedRoom].viewers.delete(hostToRemove);
        }
        
        // Notify all viewers that host has left
        io.to(joinedRoom).emit('user-left', { role: 'host', socketId: socket.id });
        
        // Send updated viewers list to all remaining participants
        io.to(joinedRoom).emit('viewers-list', { viewers: Array.from(rooms[joinedRoom].viewers) });
        io.to(joinedRoom).emit('user-left-chat', userInfo);
      } else {
        // Viewer disconnected - remove from viewers Set by finding the object with matching id
        const viewerToRemove = Array.from(rooms[joinedRoom].viewers).find(v => v.id === socket.id);
        if (viewerToRemove) {
          rooms[joinedRoom].viewers.delete(viewerToRemove);
        }
        
        // Notify host that viewer has left
        const hostId = rooms[joinedRoom].host;
        if (hostId) {
          io.to(hostId).emit('user-left', { role: 'viewer', socketId: socket.id });
        }
        
        // Send updated viewers list to all participants in the room
        io.to(joinedRoom).emit('viewers-list', { viewers: Array.from(rooms[joinedRoom].viewers) });
        io.to(joinedRoom).emit('user-left-chat', userInfo);
      }
      
      // Clean up room if it's completely empty
      // This prevents memory leaks from abandoned rooms
      if (!rooms[joinedRoom].host && rooms[joinedRoom].viewers.size === 0) {
        delete rooms[joinedRoom];
        console.log(`[ROOM CLEANUP] Deleted empty room: ${joinedRoom}`);
      }
    }
  });
});

// Start server after MongoDB connection
const startServer = async () => {
  await connectDB();
  
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📤 Video upload service ready`);
    console.log(`🔄 Background processing enabled`);
    console.log(`📊 CloudWatch logging enabled`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔌 Socket.IO available at http://localhost:${PORT}`);
  });
};

startServer(); 