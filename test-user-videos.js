const mongoose = require('mongoose');
const Video = require('./models/Video');
const User = require('./models/User');

// Test the new user-specific video functionality
async function testUserVideos() {
  try {
    // Connect to MongoDB (update with your connection string)
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/video-encoding');
    console.log('✅ Connected to MongoDB');

    // Create a test user
    const testUser = new User({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123'
    });
    await testUser.save();
    console.log('✅ Created test user:', testUser._id);

    // Create some test videos for the user
    const testVideos = [
      {
        videoId: 'test-video-1',
        userId: testUser._id,
        filename: 'videos/1234567890-test1.mp4',
        originalName: 'test-video-1.mp4',
        size: 1024000,
        mimetype: 'video/mp4',
        url: 'https://example.com/videos/test1.mp4',
        s3Key: 'videos/1234567890-test1.mp4',
        status: 'completed',
        encodingProgress: 100,
        streamingUrls: {
          master: 'https://example.com/hls/test-video-1/master.m3u8',
          qualities: {
            '360p': 'https://example.com/hls/test-video-1/360p/playlist.m3u8',
            '720p': 'https://example.com/hls/test-video-1/720p/playlist.m3u8'
          }
        }
      },
      {
        videoId: 'test-video-2',
        userId: testUser._id,
        filename: 'videos/1234567891-test2.mp4',
        originalName: 'test-video-2.mp4',
        size: 2048000,
        mimetype: 'video/mp4',
        url: 'https://example.com/videos/test2.mp4',
        s3Key: 'videos/1234567891-test2.mp4',
        status: 'processing',
        encodingProgress: 45
      },
      {
        videoId: 'test-video-3',
        userId: testUser._id,
        filename: 'videos/1234567892-test3.mp4',
        originalName: 'test-video-3.mp4',
        size: 512000,
        mimetype: 'video/mp4',
        url: 'https://example.com/videos/test3.mp4',
        s3Key: 'videos/1234567892-test3.mp4',
        status: 'uploaded',
        encodingProgress: 0
      }
    ];

    for (const videoData of testVideos) {
      const video = new Video(videoData);
      await video.save();
      console.log(`✅ Created test video: ${video.videoId}`);
    }

    // Test fetching user's videos
    const userVideos = await Video.find({ userId: testUser._id })
      .sort({ createdAt: -1 })
      .select('-__v');

    console.log('\n📹 User Videos:');
    console.log(`Total videos: ${userVideos.length}`);
    
    userVideos.forEach(video => {
      console.log(`- ${video.originalName} (${video.videoId})`);
      console.log(`  Status: ${video.status}, Progress: ${video.encodingProgress}%`);
      console.log(`  Uploaded: ${video.createdAt.toISOString()}`);
      if (video.streamingUrls) {
        console.log(`  Streaming: ${video.streamingUrls.master}`);
      }
      console.log('');
    });

    // Test filtering by status
    const completedVideos = await Video.find({ 
      userId: testUser._id, 
      status: 'completed' 
    });
    console.log(`✅ Completed videos: ${completedVideos.length}`);

    const processingVideos = await Video.find({ 
      userId: testUser._id, 
      status: 'processing' 
    });
    console.log(`🔄 Processing videos: ${processingVideos.length}`);

    // Clean up test data
    await Video.deleteMany({ userId: testUser._id });
    await User.findByIdAndDelete(testUser._id);
    console.log('🧹 Cleaned up test data');

    console.log('\n🎉 All tests passed!');
    console.log('\nAPI Endpoints to test:');
    console.log('GET /api/upload/videos - Get user\'s videos');
    console.log('GET /api/upload/videos?status=completed - Filter by status');
    console.log('GET /api/upload/videos?page=1&limit=5 - Pagination');
    console.log('GET /api/upload/videos/:videoId - Get specific video');
    console.log('GET /api/upload/status/:videoId - Get encoding status');
    console.log('GET /api/upload/streaming/:videoId - Get streaming URLs');
    console.log('GET /api/upload/jobs - Get active encoding jobs');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testUserVideos();
}

module.exports = { testUserVideos }; 